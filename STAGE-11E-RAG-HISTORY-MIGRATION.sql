/* =============================================================================
   PORTFOLIO MANAGER — STAGE 11E
   ppmRagHistory -> public.rag_history, as append-only recorded history

   WHY THIS STAGE IS NOT AN ORDINARY CHILD CUTOVER

   Every child collection migrated in Stages 10B to 11D is editable business
   data: a milestone date moves, a RAID entry is reworded, a demand line is
   re-planned. Recorded project status is not like that. PPMPlanning.recordRagHistory()
   only ever appends, and PPMPlanning.getRagHistory() only ever reads. There is no
   screen, and no legitimate business reason, for editing or deleting a status
   snapshot that has already been reported.

   That makes the generic write-through mechanism the wrong shape for this table.
   Left alone it would happily issue an UPDATE when a payload changed and a
   deleted_at soft delete when a key disappeared from the local store, which is
   exactly the ability this stage exists to remove. So the database posture here
   is deliberately narrower than its neighbours:

       SELECT   permission projects.view  + project scope
       INSERT   permission projects.status + project scope
       UPDATE   revoked
       DELETE   revoked (already the case since Stage 9)

   Append-only is enforced in three independent places, so removing any one of
   them does not open the table:

       1. the grant      authenticated has no UPDATE privilege;
       2. the policy     there is no UPDATE policy to satisfy;
       3. the trigger    private.rag_history_immutable() refuses UPDATE and
                         DELETE at row level even if a future migration or a
                         restored default privilege hands the grant back.

   WHAT ELSE THIS MIGRATION DOES

   rag_history was created as a Stage 9 scaffold table because the backup held no
   records, so every meaningful field currently lives inside legacy_payload. This
   migration normalises the three fields that materially support ordering, audit
   and reporting, each mapping 1:1 onto a real legacy field name so the round trip
   back to the browser shape stays exact:

       recorded_at  timestamptz  <-  recordedAt
       recorded_by  text         <-  recordedBy
       dimensions   jsonb        <-  dimensions

   It also adds three columns that are derived on the server and deliberately NOT
   mapped back into the legacy record: overall_calculated, overall_reported and
   override_count. They exist so status history can be queried and reported
   server-side without unpacking JSON. Because the browser adapter never reads
   them, they cannot affect the parity comparison.

   Finally, because the generic child audit skips legacy_payload, an INSERT on a
   scaffold table would otherwise be audited as nothing more than "(record
   created)". Stage 11D hit the same problem with resource data. This migration
   installs a payload-aware audit that records who reported what, and captures
   every dimension where the reported RAG deliberately departs from the
   calculated one, together with the justification given.

   ORDER OF OPERATIONS

   Run this migration BEFORE seeding. Seeding is insert-only, so it is unaffected
   by the loss of UPDATE, and running the migration first means the guards are in
   place before any row lands.

   ONE INTERACTION WORTH KNOWING ABOUT

   STAGE-9-CHILD-TABLES.sql is itself safe to re-run, and its policy loop would
   hand rag_history back its UPDATE policy and UPDATE grant. So if Stage 9 is
   ever re-run, re-run this file afterwards. Nothing silently breaks in the
   meantime: public.ppm_stage11e_ready() checks for exactly that state, and the
   browser refuses to cut over or to keep treating the table as append-only while
   the probe returns false.

   SAFE TO RE-RUN.
   ========================================================================== */

begin;

/* -------------------------------------------------------------------------
   1. Pre-flight. Refuse to install onto data that append-only rules would
      permanently freeze in a bad state.

      Making a row immutable is irreversible from the browser's point of view,
      so anything questionable is reported now rather than sealed in.
   ------------------------------------------------------------------------- */
do $$
declare
    bad_keys      integer;
    bad_payload   integer;
    soft_deleted  integer;
begin
    select count(*) into bad_keys
      from public.rag_history
     where coalesce(btrim(project_code), '') = ''
        or coalesce(btrim(record_key), '') = '';

    if bad_keys > 0 then
        raise exception
            'Stage 11E cannot install: % rag_history row(s) have an empty project code or status identifier. Investigate before making this table immutable.',
            bad_keys using errcode = '22023';
    end if;

    select count(*) into bad_payload
      from public.rag_history
     where jsonb_typeof(coalesce(legacy_payload, '{}'::jsonb)) <> 'object';

    if bad_payload > 0 then
        raise exception
            'Stage 11E cannot install: % rag_history row(s) hold a non-object payload.',
            bad_payload using errcode = '22023';
    end if;

    select count(*) into soft_deleted
      from public.rag_history
     where deleted_at is not null;

    if soft_deleted > 0 then
        raise exception
            'Stage 11E cannot install: % rag_history row(s) are soft-deleted. Recorded status history should never have been deleted; establish why before sealing the table.',
            soft_deleted using errcode = '22023';
    end if;
end $$;


/* -------------------------------------------------------------------------
   2. Normalised columns.

      Every column added here is nullable on purpose. A null means "this field
      was not present in the legacy record", which the adapter reads as "keep
      whatever legacy_payload holds". Defaulting any of them would invent data
      that the browser never recorded and break parity.
   ------------------------------------------------------------------------- */
alter table public.rag_history add column if not exists recorded_at timestamptz;   -- recordedAt
alter table public.rag_history add column if not exists recorded_by text;          -- recordedBy
alter table public.rag_history add column if not exists dimensions  jsonb;         -- dimensions

/* Derived server-side reporting columns. Not part of the legacy record shape. */
alter table public.rag_history add column if not exists overall_calculated text;
alter table public.rag_history add column if not exists overall_reported   text;
alter table public.rag_history add column if not exists override_count     integer;

/* Chronology, not insertion order, is what the status history means. */
create index if not exists rag_history_recorded_idx
    on public.rag_history (project_code, recorded_at);


/* -------------------------------------------------------------------------
   3. Retire the update-shaped Stage 9 triggers, then backfill rows already
      present from their own payload.

      Stage 9 gave this table the same before-update triggers as its editable
      neighbours: private.protect_child_key() and private.enforce_optimistic_lock().
      Both become unreachable once section 5 refuses every UPDATE outright, and
      leaving them would imply this table has a concurrency model when it does
      not. Neither is load-bearing here: they constrain how a row may be updated,
      whereas the immutability trigger removes updating altogether, which is
      strictly stronger. They are dropped so the table has one rule.

      Dropping them before the backfill also keeps the invariant honest. The
      optimistic-lock trigger increments version on every update, so with it in
      place this housekeeping statement would leave existing rows sitting at
      version 2 on a table whose version is supposed to never move off 1.

      The audit trigger is dropped for the same window. Run from the SQL editor
      there is no auth.uid(), so a backfill would otherwise post schema
      housekeeping to the business audit trail with no actor attached.

      All of this is re-run safe: a second run finds nothing left to backfill.
   ------------------------------------------------------------------------- */
drop trigger if exists trg_rag_history_immutable on public.rag_history;
drop trigger if exists trg_rag_history_audit     on public.rag_history;
drop trigger if exists trg_rag_history_lock      on public.rag_history;
drop trigger if exists trg_rag_history_key       on public.rag_history;

update public.rag_history r
   set recorded_at = coalesce(
           r.recorded_at,
           case
               when coalesce(r.legacy_payload ->> 'recordedAt', '') ~
                    '^\d{4}-\d{2}-\d{2}([T ]|$)'
                   then (r.legacy_payload ->> 'recordedAt')::timestamptz
               else null
           end
       ),
       recorded_by = coalesce(r.recorded_by, nullif(r.legacy_payload ->> 'recordedBy', '')),
       dimensions  = coalesce(
           r.dimensions,
           case
               when jsonb_typeof(coalesce(r.legacy_payload -> 'dimensions', 'null'::jsonb)) = 'object'
                   then r.legacy_payload -> 'dimensions'
               else null
           end
       )
 where r.recorded_at is null
    or r.recorded_by is null
    or r.dimensions is null;


/* -------------------------------------------------------------------------
   4. Insert guard.

      Two jobs. First, refuse a record that cannot be identified or read.
      Second, take ownership of everything the browser has no business setting
      on an append-only table: the version never moves off 1, deleted_at is
      always null, and the timestamps are the server's.

      It also fills the normalised and derived columns from the payload, so a
      record inserted by the generic adapter (which knows about the three mapped
      columns) and one inserted by a future caller that only supplies
      legacy_payload both end up complete.
   ------------------------------------------------------------------------- */
create or replace function private.rag_history_append_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    dims      jsonb;
    dim_key   text;
    dim       jsonb;
    overrides integer := 0;
    flag      text;
begin
    if coalesce(btrim(new.project_code), '') = '' then
        raise exception 'A recorded project status must name a project.'
            using errcode = '22023';
    end if;

    if coalesce(btrim(new.record_key), '') = '' then
        raise exception 'A recorded project status must have a status identifier.'
            using errcode = '22023';
    end if;

    if jsonb_typeof(coalesce(new.legacy_payload, '{}'::jsonb)) <> 'object' then
        raise exception 'A recorded project status payload must be a JSON object.'
            using errcode = '22023';
    end if;

    /*
      Append-only bookkeeping is the server's, not the browser's. version stays
      at 1 because nothing will ever increment it, and deleted_at stays null
      because with UPDATE revoked this is the only chance to set it.
    */
    new.version    := 1;
    new.deleted_at := null;
    new.created_at := now();
    new.updated_at := now();

    /*
      recordedAt is the business chronology. If the payload genuinely has no
      timestamp the column is left null rather than filled with now(): a
      fabricated value would map back into the browser record as a field the
      browser never wrote, and parity would fail for the right reason but with
      the wrong explanation.
    */
    if new.recorded_at is null
       and coalesce(new.legacy_payload ->> 'recordedAt', '') ~ '^\d{4}-\d{2}-\d{2}([T ]|$)' then
        new.recorded_at := (new.legacy_payload ->> 'recordedAt')::timestamptz;
    end if;

    if new.recorded_by is null then
        new.recorded_by := nullif(new.legacy_payload ->> 'recordedBy', '');
    end if;

    if new.dimensions is null
       and jsonb_typeof(coalesce(new.legacy_payload -> 'dimensions', 'null'::jsonb)) = 'object' then
        new.dimensions := new.legacy_payload -> 'dimensions';
    end if;

    /* Derived reporting columns. Never mapped back to the legacy record. */
    dims := case
        when jsonb_typeof(coalesce(new.dimensions, 'null'::jsonb)) = 'object' then new.dimensions
        else '{}'::jsonb
    end;

    new.overall_calculated := dims -> 'overall' ->> 'calculated';
    new.overall_reported   := dims -> 'overall' ->> 'reported';

    for dim_key in select jsonb_object_keys(dims) loop
        dim := dims -> dim_key;
        if jsonb_typeof(coalesce(dim, 'null'::jsonb)) = 'object' then
            /*
              Compared as text rather than cast to boolean: a cast would raise on
              an unexpected payload value and refuse an otherwise valid status
              record, which is a worse outcome than under-counting an override.
            */
            flag := lower(coalesce(dim ->> 'override', ''));
            if flag in ('true', 't', '1', 'yes') then
                overrides := overrides + 1;
            end if;
        end if;
    end loop;

    new.override_count := overrides;

    return new;
end;
$$;

revoke all on function private.rag_history_append_guard() from public;

drop trigger if exists trg_rag_history_append_guard on public.rag_history;
create trigger trg_rag_history_append_guard
before insert on public.rag_history
for each row execute function private.rag_history_append_guard();


/* -------------------------------------------------------------------------
   5. Immutability at row level.

      The grant and the missing policy already prevent this, so reaching this
      function means something upstream has changed. It raises rather than
      silently discarding the change, because a caller that believes it edited
      recorded history needs to be told it did not.

      Trigger name matters: "immutable" sorts before "key" and "lock", so this
      fires ahead of the Stage 9 before-update triggers and the transaction
      stops here.
   ------------------------------------------------------------------------- */
create or replace function private.rag_history_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        raise exception
            'Recorded project status history cannot be deleted (% / %).',
            old.project_code, old.record_key using errcode = '42501';
    end if;

    raise exception
        'Recorded project status history cannot be changed (% / %). Record a new project status instead.',
        old.project_code, old.record_key using errcode = '42501';
end;
$$;

revoke all on function private.rag_history_immutable() from public;

drop trigger if exists trg_rag_history_immutable on public.rag_history;
create trigger trg_rag_history_immutable
before update or delete on public.rag_history
for each row execute function private.rag_history_immutable();


/* -------------------------------------------------------------------------
   6. Payload-aware audit.

      The generic private.record_child_audit() skips legacy_payload to keep
      diffs small, which on a scaffold table reduces an INSERT to "(record
      created)" and loses the entire substance of the status report. Stage 11D
      solved the same problem for resource data.

      What is recorded: who reported the status and when, the overall calculated
      and reported RAG, and every dimension where the reported value was
      deliberately overridden away from the calculated one, with the
      justification. An override is a human judgement that departs from the
      arithmetic, so it is the part worth being able to evidence later.

      The generic audit trigger is replaced rather than supplemented, so one
      recorded status produces one audit entry rather than two.
   ------------------------------------------------------------------------- */
create or replace function private.record_rag_history_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    me         record;
    changed    jsonb := '[]'::jsonb;
    dims       jsonb;
    dim_key    text;
    dim        jsonb;
    key_text   text;
    calculated text;
    reported   text;
    flag       text;
begin
    key_text := new.project_code || ' / ' || new.record_key;

    dims := case
        when jsonb_typeof(coalesce(new.dimensions, 'null'::jsonb)) = 'object' then new.dimensions
        else '{}'::jsonb
    end;

    changed := jsonb_build_array(jsonb_build_object(
        'field',  '(project status recorded)',
        'before', null,
        'after',  key_text
    ));

    if new.recorded_at is not null then
        changed := changed || jsonb_build_array(jsonb_build_object(
            'field', 'recordedAt', 'before', null, 'after', to_jsonb(new.recorded_at)
        ));
    end if;

    if new.recorded_by is not null then
        changed := changed || jsonb_build_array(jsonb_build_object(
            'field', 'recordedBy', 'before', null, 'after', to_jsonb(new.recorded_by)
        ));
    end if;

    /* Overall health, expressed as calculated -> reported. */
    changed := changed || jsonb_build_array(jsonb_build_object(
        'field',  'overall',
        'before', to_jsonb(coalesce(new.overall_calculated, 'Not Assessed')),
        'after',  to_jsonb(coalesce(new.overall_reported,   'Not Assessed'))
    ));

    /* Every deliberate departure from the calculated value. */
    for dim_key in select jsonb_object_keys(dims) order by 1 loop
        dim  := dims -> dim_key;
        if jsonb_typeof(coalesce(dim, 'null'::jsonb)) <> 'object' then
            continue;
        end if;

        flag := lower(coalesce(dim ->> 'override', ''));
        if flag not in ('true', 't', '1', 'yes') then
            continue;
        end if;

        calculated := coalesce(dim ->> 'calculated', 'Not Assessed');
        reported   := coalesce(dim ->> 'reported',   'Not Assessed');

        changed := changed || jsonb_build_array(jsonb_build_object(
            'field',  dim_key || ' (reported override)',
            'before', to_jsonb(calculated),
            'after',  to_jsonb(
                reported || case
                    when coalesce(btrim(dim ->> 'justification'), '') = ''
                        then ' — justification not recorded'
                    else ' — ' || btrim(dim ->> 'justification')
                end
            )
        ));
    end loop;

    select p.id, p.full_name, p.email, p.access_role
      into me
      from public.people p
     where p.auth_user_id = (select auth.uid())
     limit 1;

    insert into public.audit_log (
        auth_user_id, person_id, actor_name, actor_email, actor_role,
        table_name, record_key, record_id, operation, changes, row_version
    ) values (
        (select auth.uid()), me.id, me.full_name, me.email, me.access_role,
        tg_table_name, key_text, new.id, 'INSERT', changed, new.version
    );

    return new;
exception when others then
    /*
      Consistent with private.record_child_audit: a status report that reached
      the table is not undone because the audit row could not be written. The
      warning surfaces in the database logs.
    */
    raise warning 'rag history audit: could not record insert on %: %', tg_table_name, sqlerrm;
    return new;
end;
$$;

revoke all on function private.record_rag_history_audit() from public;

drop trigger if exists trg_rag_history_audit on public.rag_history;
drop trigger if exists trg_rag_history_payload_audit on public.rag_history;

create trigger trg_rag_history_payload_audit
after insert on public.rag_history
for each row execute function private.record_rag_history_audit();

/*
  UPDATE and DELETE are structurally impossible while section 5 stands, so this
  trigger should never fire. It is installed anyway: if it ever does fire, the
  event that should not have happened is still on the audit trail.
*/
create trigger trg_rag_history_audit
after update or delete on public.rag_history
for each row execute function private.record_child_audit();


/* -------------------------------------------------------------------------
   7. Policies and grants.

      Stage 9 created this table with the same read/insert/update posture as its
      editable neighbours. The UPDATE policy is dropped and the UPDATE grant
      revoked. Read and insert are recreated verbatim from the Stage 9 rule so
      this file is the single current statement of the table's security, rather
      than a patch that has to be read alongside its predecessor.
   ------------------------------------------------------------------------- */
drop policy if exists "rag_history update"       on public.rag_history;
drop policy if exists "rag_history require aal2" on public.rag_history;
drop policy if exists "rag_history read scope"   on public.rag_history;
drop policy if exists "rag_history insert"       on public.rag_history;

alter table public.rag_history enable row level security;

create policy "rag_history require aal2" on public.rag_history
    as restrictive for all to authenticated
    using ((select auth.jwt() ->> 'aal') = 'aal2')
    with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy "rag_history read scope" on public.rag_history
    for select to authenticated
    using (
        (select private.has_permission('projects.view'))
        and (select private.can_access_project(project_code))
    );

create policy "rag_history insert" on public.rag_history
    for insert to authenticated
    with check (
        (select private.has_permission('projects.status'))
        and (select private.can_access_project(project_code))
    );

grant select, insert on public.rag_history to authenticated;

revoke update, delete, truncate, trigger, references on public.rag_history from authenticated;
revoke all on public.rag_history from anon;


/* -------------------------------------------------------------------------
   8. Readiness probe, called by the browser before it will cut this
      collection over. It answers one question: is the append-only posture
      actually installed, or would cutover start writing into a table that can
      still be edited?
   ------------------------------------------------------------------------- */
create or replace function public.ppm_stage11e_ready()
returns boolean
language sql
stable
set search_path = ''
as $$
    select
        coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
        and exists (
            select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'rag_history'
               and column_name = 'recorded_at'
        )
        and exists (
            select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'rag_history'
               and column_name = 'recorded_by'
        )
        and exists (
            select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'rag_history'
               and column_name = 'dimensions'
        )
        and exists (
            select 1 from pg_catalog.pg_trigger
             where tgname = 'trg_rag_history_append_guard' and not tgisinternal
        )
        and exists (
            select 1 from pg_catalog.pg_trigger
             where tgname = 'trg_rag_history_immutable' and not tgisinternal
        )
        and exists (
            select 1 from pg_catalog.pg_trigger
             where tgname = 'trg_rag_history_payload_audit' and not tgisinternal
        )
        and not exists (
            select 1 from pg_catalog.pg_policies
             where schemaname = 'public' and tablename = 'rag_history' and cmd = 'UPDATE'
        )
        and has_table_privilege('authenticated', 'public.rag_history', 'SELECT')
        and has_table_privilege('authenticated', 'public.rag_history', 'INSERT')
        and not has_table_privilege('authenticated', 'public.rag_history', 'UPDATE')
        and not has_table_privilege('authenticated', 'public.rag_history', 'DELETE')
        and not has_table_privilege('authenticated', 'public.rag_history', 'TRUNCATE')
        and not has_table_privilege('authenticated', 'public.rag_history', 'TRIGGER')
        and not has_table_privilege('authenticated', 'public.rag_history', 'REFERENCES');
$$;

revoke all on function public.ppm_stage11e_ready() from public, anon;
grant execute on function public.ppm_stage11e_ready() to authenticated;

commit;

/* =============================================================================
   ROLLBACK

   Reverting the browser to local mode needs nothing here: use
   PPMChildDatabase.revertStage11E() in the console, which changes the source
   selection only and leaves every recorded row in place for inspection.

   Undoing the append-only posture itself is deliberately not scripted. Handing
   UPDATE back to authenticated would make already-reported status history
   editable, which is the specific risk this stage removes. If it is ever needed
   for a genuine data-correction exercise, do it as a considered, audited,
   one-off statement rather than from a file that can be run by accident.
   ========================================================================== */
