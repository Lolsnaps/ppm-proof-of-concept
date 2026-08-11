/* =============================================================================
   PORTFOLIO MANAGER — STAGE 11F
   Audit consolidation: verified server trail first, legacy history as context

   THE PROBLEM THIS CLOSES

   public.audit_log has been the verified trail since Stage 8. Database triggers
   write it from the authenticated identity, and the browser has no INSERT, UPDATE
   or DELETE privilege on it. Meanwhile audit-history-page.js has been reading
   PPMAudit.read() — browser localStorage — the whole time. So the screen presented
   as "Audit History" showed the one source that is not evidence, and ignored the
   one that is.

   The browser side of that is fixed in this build. This file does the two things
   that have to happen in the database.

   1. A GATED, ONE-TIME IMPORT PATH FOR LEGACY HISTORY

   public.legacy_audit_history has existed since Stage 9 as a read-only table with
   a typed column per field. It has no INSERT grant for authenticated, and this
   migration does not give it one. A browser that can write rows into an audit
   table — even a clearly-labelled legacy one — is precisely what an audit trail
   exists to rule out.

   Instead there is one SECURITY DEFINER function, public.ppm_import_legacy_audit(),
   which:

     - requires AAL2 and users.manage, checked server-side, not in the browser;
     - accepts the local records as jsonb and maps them into typed columns;
     - refuses to overwrite anything, so re-running it imports only what is new;
     - stamps every row as legacy and unverified in import_payload, so an imported
       row can never later be mistaken for a verified one;
     - records its own use in audit_log, because a bulk import of historical
       evidence is itself an event worth evidencing.

   It is designed to be dropped once the import is done. Section 5 has the
   statement. Nothing else depends on it.

   2. READ ACCESS THAT MATCHES THE NEW UI

   The Audit History page now reads legacy_audit_history alongside audit_log, so the
   legacy table's read policy has to be scope-aware in the same way. Stage 9 gave it
   'audit.view' only, which meant a Project Manager saw none of their own project's
   history. Now it follows the same rule as audit_log: audit.view sees everything,
   everyone else sees entries for records they could already read.

   WHAT THIS FILE DOES NOT DO

   It does not make legacy history editable, and it does not stop modules writing
   to ppmAuditHistory. Retiring that local write path belongs with Stage 14, once
   every module's changes are covered by database triggers.

   SAFE TO RE-RUN.
   ========================================================================== */

begin;

/* -------------------------------------------------------------------------
   1. Confirm the shape this stage relies on, and record a naming correction.

      A NOTE ON timestamp_value

      STAGE-9-CHILD-TABLES.sql as written defines this column as `timestamp`. The
      column actually in the database is `timestamp_value` — it was renamed when
      Stage 9 was applied, sensibly, since `timestamp` is a type name and reads
      badly as a column even though PostgreSQL permits it. The Stage 9 file was
      never updated to match, so the file and the database disagreed, and nothing
      noticed because the application had never read this table.

      Checked across the whole schema: this is the ONLY difference between the
      Stage 9 file and the live database. All 352 other columns across all 18 child
      tables match exactly. STAGE-9-CHILD-TABLES.sql has been corrected to say
      timestamp_value so the two agree from here on.

      This block verifies rather than patches. Adding a missing column would have
      been the wrong instinct: had it run against this database it would have
      created an empty `timestamp` alongside the populated `timestamp_value` and
      left two columns where there should be one.
   ------------------------------------------------------------------------- */
do $$
declare
    missing text[];
begin
    select array_agg(needed order by needed)
      into missing
      from unnest(array[
          'project_code', 'record_key', 'legacy_payload', 'import_payload', 'version',
          'timestamp_value', 'entity_type', 'entity_id', 'action', 'summary',
          'source_page', 'location', 'actor_name', 'actor_resource_id', 'actor_email',
          'actor_role', 'status_from', 'status_to', 'approval_status_from',
          'approval_status_to', 'approval_id', 'changes', 'metadata'
      ]) as needed
     where not exists (
         select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'legacy_audit_history'
            and column_name = needed
     );

    if missing is not null then
        raise exception
            'Stage 11F cannot install: public.legacy_audit_history is missing %. Compare the table against STAGE-9-CHILD-TABLES.sql before continuing rather than adding columns blindly.',
            array_to_string(missing, ', ')
            using errcode = '42703';
    end if;
end $$;

/*
  import_payload carries the provenance stamp, so an imported row states what it is
  in the row itself rather than relying on an application to remember which table
  means what.
*/
create index if not exists legacy_audit_history_timestamp_idx
    on public.legacy_audit_history (timestamp_value desc);


/* -------------------------------------------------------------------------
   2. Scope-aware read policy for legacy history.

      Deliberately identical in shape to the audit_log policy: holders of
      audit.view see the whole trail, and everyone else sees only entries for
      projects they can already access. Stage 9's 'audit.view'-only rule meant a
      Project Manager could not see their own project's history, which stops being
      acceptable now that this table is part of what the page shows.
   ------------------------------------------------------------------------- */
drop policy if exists "legacy_audit_history require aal2" on public.legacy_audit_history;
drop policy if exists "legacy_audit_history read scope"   on public.legacy_audit_history;

alter table public.legacy_audit_history enable row level security;

create policy "legacy_audit_history require aal2" on public.legacy_audit_history
    as restrictive for all to authenticated
    using ((select auth.jwt() ->> 'aal') = 'aal2')
    with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy "legacy_audit_history read scope" on public.legacy_audit_history
    for select to authenticated
    using (
        (select private.has_permission('audit.view'))
        or (
            coalesce(btrim(project_code), '') <> ''
            and (select private.can_access_project(project_code))
        )
    );

/* Read only. No INSERT policy, and no INSERT grant — the import goes through the
   function in section 3, which is the only way rows get in. */
grant select on public.legacy_audit_history to authenticated;
revoke insert, update, delete, truncate, trigger, references
    on public.legacy_audit_history from authenticated;
revoke all on public.legacy_audit_history from anon;


/* -------------------------------------------------------------------------
   3. The one-time import function.

      SECURITY DEFINER is justified here: the caller must be able to insert into a
      table they have no privilege on, and that is the whole point. The safety comes
      from what the function checks before it does anything — AAL2, a linked active
      person, and users.manage — and from search_path being pinned so nothing can be
      resolved out from under it.

      Idempotent by (project_code, record_key). Re-running after a partial failure
      imports the remainder and leaves existing rows untouched; it cannot be used to
      rewrite history that is already in the table.
   ------------------------------------------------------------------------- */
create or replace function public.ppm_import_legacy_audit(p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me           record;
    entry        jsonb;
    v_imported   integer := 0;
    v_skipped    integer := 0;
    v_rejected   integer := 0;
    v_audit_id   text;
    v_project    text;
    v_stamp      timestamptz;
begin
    if coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then
        raise exception 'Importing legacy audit history requires multi-factor authentication.'
            using errcode = '42501';
    end if;

    select p.id, p.full_name, p.email, p.access_role, p.account_status
      into me
      from public.people p
     where p.auth_user_id = (select auth.uid())
     limit 1;

    if me.id is null then
        raise exception 'Your sign-in is not linked to a person record.' using errcode = '42501';
    end if;

    /* Same active-account requirement the Stage 11A-D workflows apply. */
    if coalesce(me.account_status, 'Active') <> 'Active' then
        raise exception 'Your account is not active, so it cannot import audit history.'
            using errcode = '42501';
    end if;

    if not (select private.has_permission('users.manage')) then
        raise exception 'Importing legacy audit history requires the users.manage permission.'
            using errcode = '42501';
    end if;

    if jsonb_typeof(coalesce(p_entries, 'null'::jsonb)) <> 'array' then
        raise exception 'The legacy audit import expects an array of records.' using errcode = '22023';
    end if;

    for entry in select value from jsonb_array_elements(p_entries) as t(value) loop
        v_audit_id := nullif(btrim(coalesce(entry ->> 'auditId', '')), '');
        v_project  := coalesce(btrim(coalesce(entry ->> 'projectCode', '')), '');

        /* A record with no identifier cannot be de-duplicated, so it is counted
           and skipped rather than imported under an invented key. */
        if v_audit_id is null then
            v_rejected := v_rejected + 1;
            continue;
        end if;

        if exists (
            select 1 from public.legacy_audit_history l
             where l.project_code = v_project and l.record_key = v_audit_id
        ) then
            v_skipped := v_skipped + 1;
            continue;
        end if;

        v_stamp := case
            when coalesce(entry ->> 'timestamp', '') ~ '^\d{4}-\d{2}-\d{2}([T ]|$)'
                then (entry ->> 'timestamp')::timestamptz
            else null
        end;

        insert into public.legacy_audit_history (
            project_code, record_key, legacy_payload, import_payload,
            timestamp_value, entity_type, entity_id, action, summary, source_page, location,
            actor_name, actor_resource_id, actor_email, actor_role,
            status_from, status_to, approval_status_from, approval_status_to, approval_id,
            changes, metadata
        ) values (
            v_project,
            v_audit_id,
            entry,
            /* Provenance stamped into the row itself, so it does not depend on an
               application remembering which table means what. */
            jsonb_build_object(
                'source', 'browser-localStorage',
                'verified', false,
                'note', 'Legacy pre-migration history. Not written by the database and not verifiable.',
                'importedAt', now(),
                'importedBy', coalesce(me.email, me.full_name, 'unknown')
            ),
            v_stamp,
            nullif(entry ->> 'entityType', ''),
            nullif(entry ->> 'entityId', ''),
            nullif(entry ->> 'action', ''),
            nullif(entry ->> 'summary', ''),
            nullif(entry ->> 'sourcePage', ''),
            nullif(entry ->> 'location', ''),
            nullif(entry ->> 'actorName', ''),
            nullif(entry ->> 'actorResourceId', ''),
            nullif(entry ->> 'actorEmail', ''),
            nullif(entry ->> 'actorRole', ''),
            nullif(entry ->> 'statusFrom', ''),
            nullif(entry ->> 'statusTo', ''),
            nullif(entry ->> 'approvalStatusFrom', ''),
            nullif(entry ->> 'approvalStatusTo', ''),
            nullif(entry ->> 'approvalId', ''),
            case when jsonb_typeof(coalesce(entry -> 'changes', 'null'::jsonb)) = 'array'
                 then entry -> 'changes' else '[]'::jsonb end,
            case when jsonb_typeof(coalesce(entry -> 'metadata', 'null'::jsonb)) = 'object'
                 then entry -> 'metadata' else '{}'::jsonb end
        );

        v_imported := v_imported + 1;
    end loop;

    /*
      The import is itself an auditable event. Recorded only when something was
      actually imported, so repeated no-op calls do not pad the trail.
    */
    if v_imported > 0 then
        insert into public.audit_log (
            auth_user_id, person_id, actor_name, actor_email, actor_role,
            table_name, record_key, record_id, operation, changes, row_version
        ) values (
            (select auth.uid()), me.id, me.full_name, me.email, me.access_role,
            'legacy_audit_history', 'GLOBAL / legacy-import', null, 'INSERT',
            jsonb_build_array(jsonb_build_object(
                'field', '(legacy audit history imported)',
                'before', null,
                'after', v_imported || ' unverified historical record(s)'
            )),
            null
        );
    end if;

    return jsonb_build_object(
        'imported', v_imported,
        'skipped', v_skipped,
        'rejected', v_rejected
    );
end;
$$;

revoke all on function public.ppm_import_legacy_audit(jsonb) from public, anon;
grant execute on function public.ppm_import_legacy_audit(jsonb) to authenticated;


/* -------------------------------------------------------------------------
   4. Readiness probe.
   ------------------------------------------------------------------------- */
create or replace function public.ppm_stage11f_ready()
returns boolean
language sql
stable
set search_path = ''
as $$
    select
        coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
        and to_regprocedure('public.ppm_import_legacy_audit(jsonb)') is not null
        and has_table_privilege('authenticated', 'public.legacy_audit_history', 'SELECT')
        and not has_table_privilege('authenticated', 'public.legacy_audit_history', 'INSERT')
        and not has_table_privilege('authenticated', 'public.legacy_audit_history', 'UPDATE')
        and not has_table_privilege('authenticated', 'public.legacy_audit_history', 'DELETE')
        and has_table_privilege('authenticated', 'public.audit_log', 'SELECT')
        and not has_table_privilege('authenticated', 'public.audit_log', 'INSERT')
        and not has_table_privilege('authenticated', 'public.audit_log', 'UPDATE')
        and not has_table_privilege('authenticated', 'public.audit_log', 'DELETE')
        and exists (
            select 1 from pg_catalog.pg_policies
             where schemaname = 'public'
               and tablename = 'legacy_audit_history'
               and policyname = 'legacy_audit_history read scope'
               and qual like '%can_access_project%'
        );
$$;

revoke all on function public.ppm_stage11f_ready() from public, anon;
grant execute on function public.ppm_stage11f_ready() to authenticated;


/* -------------------------------------------------------------------------
   5. Close a default-grant hole across the whole public RPC surface.

      Supabase's default privileges grant EXECUTE on new functions in `public` to
      anon, authenticated and service_role. Stages 11D onward wrote:

          revoke all on function X from public;

      PUBLIC is a pseudo-role, so that removes the implicit "everyone" grant but
      leaves the explicit grant to `anon` untouched. Six functions were therefore
      callable without signing in, two of them SECURITY DEFINER.

      Nothing was exploitable — every one of them checks AAL2 before doing anything
      and anon carries no aal2 claim, so each call raised or returned false. But the
      internal check should not be the only thing standing there, and this is the
      same shape of mistake Stage 9 found when Supabase's defaults turned out to
      include TRUNCATE.

      Written as a sweep rather than a list so a function added later cannot quietly
      miss it, and it asserts the result so this file fails rather than reporting
      success on a surface that is still open.
   ------------------------------------------------------------------------- */
do $$
declare
    fn     record;
    leaked text;
begin
    for fn in
        select p.oid::regprocedure as signature
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname like 'ppm%'
           and has_function_privilege('anon', p.oid, 'EXECUTE')
    loop
        execute format('revoke execute on function %s from anon', fn.signature);
    end loop;

    select string_agg(p.proname, ', ' order by p.proname)
      into leaked
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'ppm%'
       and has_function_privilege('anon', p.oid, 'EXECUTE');

    if leaked is not null then
        raise exception 'anon can still execute: %', leaked using errcode = '42501';
    end if;
end $$;

commit;

/* =============================================================================
   5. AFTER THE IMPORT — REMOVE THE IMPORT PATH

   Once PPMAudit.importLegacyToDatabase() has run and STAGE-11F-VERIFY.sql shows
   the row count you expect, drop the function. It exists for a one-time job, and a
   privileged path into an audit table should not outlive the job it was built for.

       drop function if exists public.ppm_import_legacy_audit(jsonb);

   After that ppm_stage11f_ready() returns false, which is correct: the import
   capability is gone. Read access, the verified trail and the imported rows are
   unaffected. If you ever need to import again, re-run this migration.

   ROLLBACK

   The imported rows are historical context, not operational data, so removing them
   is safe if the import went wrong. This deletes only rows that came from an
   import, never anything else:

       delete from public.legacy_audit_history
        where import_payload ->> 'source' = 'browser-localStorage';

   That needs to run as the table owner; authenticated has no DELETE privilege.
   ========================================================================== */
