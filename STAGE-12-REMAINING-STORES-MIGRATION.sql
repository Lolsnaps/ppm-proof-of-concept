/* =============================================================================
   PORTFOLIO MANAGER — STAGE 12
   The fourteen remaining browser-local stores, in one migration

   After Stage 11E, seventeen of the eighteen Stage 9 child tables were
   database-authoritative. What was still living only in localStorage was
   everything that is not project child data:

     programme business data      ppmProgrammeMilestones, ppmProgrammeRaid
     administration configuration ppmLifecycleTemplates, ppmLifecycleMandatoryRules,
                                  ppmReferenceData, ppmReportingCalendars,
                                  ppmReportingPeriods, ppmRagConfig
     financial configuration      ppmFinancialCategories
     resource planning            ppmResourceAbsence, ppmResourceConfig
     saved views                  ppmResourceGanttViews, ppmReportViews, ppmSearchViews

   WHY ONE COLUMN INSTEAD OF FOUR

   A Stage 9 child table is identified by (project_code, record_key) and scoped by
   private.can_access_project(). None of these fourteen are project data, so a
   project_code column would be a lie on every row.

   The alternative — a different scope column per family — would have forked the
   generic mapper, hydration and write-through path four ways. Instead every table
   here has one uniform `scope_key`, and each table's RLS decides what that key
   means:

     programme tables   scope_key is a programme code, checked with
                        private.can_access_programme_code()
     configuration      scope_key is 'GLOBAL', or the configuration category for
                        reference data. Permission alone decides access; there is
                        nothing project-shaped to scope by
     saved views        scope_key is 'GLOBAL' and the row also carries
                        owner_auth_user_id. You always see your own rows; shared
                        rows are readable by anyone with the read permission, and
                        publishing one requires views.publish

   Same physical shape everywhere, so one adapter path serves all of them. Written
   as loops rather than fourteen near-identical blocks, for the reason Stage 9 gave:
   one rule applied uniformly means a table cannot quietly end up with a different
   security posture from its neighbours.

   NO DATA IS IMPORTED BY THIS FILE

   Deliberate. These tables are created empty, and the application populates them
   itself: getLifecycleTemplates(), getReferenceData(), getReportingCalendars() and
   getMandatoryRules() have always written their defaults on first read when they
   find nothing stored, and after cutover those default writes flow through to
   PostgreSQL. An empty table plus one page load is a properly populated table.

   PERMISSION MODEL IS UNCHANGED

   No new permission IDs. Every table below maps onto the existing 47.

   SAFE TO RE-RUN.
   ========================================================================== */

begin;

/* -------------------------------------------------------------------------
   1. Shared machinery for scope_key tables.

      Mirrors private.protect_child_key() but keyed on (scope_key, record_key).
      Kept separate rather than branching inside the existing function so neither
      has to know about the other's shape — the same reasoning Stage 9 used when
      it split record_child_audit() out of record_audit().
   ------------------------------------------------------------------------- */
create or replace function private.protect_scope_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if NEW.record_key is distinct from OLD.record_key then
        raise exception 'The identifier of an existing % record cannot be changed (% to %).',
            TG_TABLE_NAME, OLD.record_key, NEW.record_key using errcode = '42501';
    end if;
    if NEW.scope_key is distinct from OLD.scope_key then
        raise exception 'A % record cannot be moved to a different scope (% to %).',
            TG_TABLE_NAME, OLD.scope_key, NEW.scope_key using errcode = '42501';
    end if;
    if NEW.legacy_payload is null and OLD.legacy_payload is not null then
        NEW.legacy_payload := OLD.legacy_payload;
    end if;
    return NEW;
end;
$$;

revoke all on function private.protect_scope_key() from public;

/*
  Audit for scope_key tables. Same contract as private.record_child_audit(), with
  the business key rendered as "scope / record" so the audit read policy can still
  recover the scope from the prefix.
*/
create or replace function private.record_scope_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    me          record;
    changed     jsonb := '[]'::jsonb;
    old_json    jsonb;
    new_json    jsonb;
    field       text;
    key_text    text;
    skip_fields text[] := array['legacy_payload','import_payload','updated_at','created_at','version','id'];
begin
    select p.id, p.full_name, p.email, p.access_role
      into me from public.people p
     where p.auth_user_id = (select auth.uid()) limit 1;

    key_text := coalesce(NEW.scope_key, OLD.scope_key) || ' / ' || coalesce(NEW.record_key, OLD.record_key);

    if TG_OP = 'UPDATE' then
        old_json := to_jsonb(OLD); new_json := to_jsonb(NEW);
        for field in select jsonb_object_keys(new_json) loop
            if field = any(skip_fields) then continue; end if;
            if new_json -> field is distinct from old_json -> field then
                changed := changed || jsonb_build_object('field', field,
                    'before', old_json -> field, 'after', new_json -> field);
            end if;
        end loop;
        if jsonb_array_length(changed) = 0 then return NEW; end if;
    elsif TG_OP = 'INSERT' then
        changed := jsonb_build_array(jsonb_build_object('field','(record created)','before',null,'after',key_text));
    else
        changed := jsonb_build_array(jsonb_build_object('field','(record deleted)','before',key_text,'after',null));
    end if;

    insert into public.audit_log (
        auth_user_id, person_id, actor_name, actor_email, actor_role,
        table_name, record_key, record_id, operation, changes, row_version
    ) values (
        (select auth.uid()), me.id, me.full_name, me.email, me.access_role,
        TG_TABLE_NAME, key_text,
        case when TG_OP = 'DELETE' then OLD.id else NEW.id end,
        TG_OP, changed,
        case when TG_OP = 'DELETE' then OLD.version else NEW.version end
    );
    return case when TG_OP = 'DELETE' then OLD else NEW end;
exception when others then
    raise warning 'audit: could not record % on %: %', TG_OP, TG_TABLE_NAME, sqlerrm;
    return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

revoke all on function private.record_scope_audit() from public;

/*
  Ownership of a saved view is established from the session, never from the
  browser payload. A client-supplied owner would let one user file a view as
  another user's personal view, and then read it back through the "own rows" branch
  of the read policy.
*/
create or replace function private.own_saved_view()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if TG_OP = 'INSERT' then
        NEW.owner_auth_user_id := (select auth.uid());
        return NEW;
    end if;
    /* Ownership never transfers on update. */
    NEW.owner_auth_user_id := OLD.owner_auth_user_id;
    return NEW;
end;
$$;

revoke all on function private.own_saved_view() from public;


/* -------------------------------------------------------------------------
   2. Create the fourteen tables.

      Every table gets the identical scaffold Stage 9 used for collections that
      held no data: scope and record key, the full original record in
      legacy_payload, an optional import_payload, an optimistic version, timestamps
      and Stage 10A's deleted_at soft delete. Nothing is guessed about the record
      contents, because nothing needs to be — normalise later, once these hold real
      data and there is something to normalise against.
   ------------------------------------------------------------------------- */
do $$
declare
    t text;
    tables text[] := array[
        'programme_milestones', 'programme_raid',
        'lifecycle_templates', 'lifecycle_mandatory_rules', 'reference_data',
        'reporting_calendars', 'reporting_periods', 'rag_config',
        'financial_categories',
        'resource_absence', 'resource_config',
        'resource_gantt_views', 'report_views', 'search_views'
    ];
begin
    foreach t in array tables loop
        execute format($f$
            create table if not exists public.%I (
                id             uuid primary key default gen_random_uuid(),
                scope_key      text not null,
                record_key     text not null,
                legacy_payload jsonb not null default '{}'::jsonb,
                import_payload jsonb,
                version        integer not null default 1,
                created_at     timestamptz not null default now(),
                updated_at     timestamptz not null default now(),
                deleted_at     timestamptz,
                unique (scope_key, record_key)
            )$f$, t);

        execute format('create index if not exists %I on public.%I (scope_key)', t || '_scope_idx', t);
        execute format('alter table public.%I enable row level security', t);
    end loop;
end $$;

/* Saved views additionally record who owns them and whether they were published. */
do $$
declare
    t text;
    views text[] := array['resource_gantt_views', 'report_views', 'search_views'];
begin
    foreach t in array views loop
        execute format('alter table public.%I add column if not exists owner_auth_user_id uuid', t);
        execute format('alter table public.%I add column if not exists view_scope text', t);
        execute format('create index if not exists %I on public.%I (owner_auth_user_id)', t || '_owner_idx', t);
    end loop;
end $$;


/* -------------------------------------------------------------------------
   3. Programme-scoped tables.

      Scoped exactly like programme-level benefits already are — through
      private.can_access_programme_code(), added in Stage 10A — rather than by
      pretending these records belong to a project.
   ------------------------------------------------------------------------- */
do $$
declare
    t record;
begin
    for t in
        select * from (values
            ('programme_milestones', 'programmes.view', 'programmes.edit'),
            ('programme_raid',       'programmes.view', 'programmes.edit')
        ) as x(tbl, view_perm, edit_perm)
    loop
        execute format('drop policy if exists %I on public.%I', t.tbl || ' require aal2', t.tbl);
        execute format('drop policy if exists %I on public.%I', t.tbl || ' read scope',   t.tbl);
        execute format('drop policy if exists %I on public.%I', t.tbl || ' insert',       t.tbl);
        execute format('drop policy if exists %I on public.%I', t.tbl || ' update',       t.tbl);

        execute format($f$
            create policy %I on public.%I as restrictive for all to authenticated
            using ((select auth.jwt() ->> 'aal') = 'aal2')
            with check ((select auth.jwt() ->> 'aal') = 'aal2')$f$,
            t.tbl || ' require aal2', t.tbl);

        execute format($f$
            create policy %I on public.%I for select to authenticated
            using ((select private.has_permission(%L))
                   and (select private.can_access_programme_code(scope_key)))$f$,
            t.tbl || ' read scope', t.tbl, t.view_perm);

        execute format($f$
            create policy %I on public.%I for insert to authenticated
            with check ((select private.has_permission(%L))
                        and (select private.can_access_programme_code(scope_key)))$f$,
            t.tbl || ' insert', t.tbl, t.edit_perm);

        execute format($f$
            create policy %I on public.%I for update to authenticated
            using ((select private.has_permission(%L))
                   and (select private.can_access_programme_code(scope_key)))
            with check ((select private.has_permission(%L))
                        and (select private.can_access_programme_code(scope_key)))$f$,
            t.tbl || ' update', t.tbl, t.edit_perm, t.edit_perm);
    end loop;
end $$;


/* -------------------------------------------------------------------------
   4. Global configuration tables.

      There is no scope check here, and that is the correct answer rather than a
      shortcut: lifecycle templates, reference lists, calendars and RAG thresholds
      are portfolio-wide settings, not records belonging to anything. Access is
      decided entirely by permission, and the write permissions are the
      administration ones, so an ordinary project manager can read the
      configuration the application needs but cannot change it.

      Reading is deliberately broad. Every page needs reference values and
      lifecycle stages to render a project at all, so read is granted to any
      authenticated AAL2 user rather than gated on administration.view — gating it
      would break the tool for everyone except administrators.
   ------------------------------------------------------------------------- */
do $$
declare
    t record;
begin
    for t in
        select * from (values
            ('lifecycle_templates',        'administration.edit'),
            ('lifecycle_mandatory_rules',  'administration.edit'),
            ('reference_data',             'administration.edit'),
            ('reporting_calendars',        'administration.edit'),
            ('reporting_periods',          'administration.edit'),
            ('rag_config',                 'administration.edit'),
            ('financial_categories',       'financials.configure'),
            ('resource_config',            'administration.edit'),
            /* Absence is business data about a person, not configuration. It sits
               here only because the resource directory is still browser-local, so
               there is no server-side person link to scope by yet.
               resourceManagement.edit is the same gate the UI already applies.
               Stage 12A should tighten this to person and team scope. */
            ('resource_absence',           'resourceManagement.edit')
        ) as x(tbl, edit_perm)
    loop
        execute format('drop policy if exists %I on public.%I', t.tbl || ' require aal2', t.tbl);
        execute format('drop policy if exists %I on public.%I', t.tbl || ' read scope',   t.tbl);
        execute format('drop policy if exists %I on public.%I', t.tbl || ' insert',       t.tbl);
        execute format('drop policy if exists %I on public.%I', t.tbl || ' update',       t.tbl);

        execute format($f$
            create policy %I on public.%I as restrictive for all to authenticated
            using ((select auth.jwt() ->> 'aal') = 'aal2')
            with check ((select auth.jwt() ->> 'aal') = 'aal2')$f$,
            t.tbl || ' require aal2', t.tbl);

        execute format($f$
            create policy %I on public.%I for select to authenticated
            using (true)$f$,
            t.tbl || ' read scope', t.tbl);

        execute format($f$
            create policy %I on public.%I for insert to authenticated
            with check ((select private.has_permission(%L)))$f$,
            t.tbl || ' insert', t.tbl, t.edit_perm);

        execute format($f$
            create policy %I on public.%I for update to authenticated
            using ((select private.has_permission(%L)))
            with check ((select private.has_permission(%L)))$f$,
            t.tbl || ' update', t.tbl, t.edit_perm, t.edit_perm);
    end loop;
end $$;


/* -------------------------------------------------------------------------
   5. Saved views: owner-scoped, with publishing.

      The application already tells the user a shared view was "published", and
      views.publish has been in the permission model since Stage 3F, so these
      cannot reasonably stay browser-only.

      The rule: your own rows are always yours to read and change. A row marked
      shared is readable by anyone holding the module read permission. Marking one
      shared — on insert or update — requires views.publish, so a user without it
      can save personal views all day and never publish one.
   ------------------------------------------------------------------------- */
do $$
declare
    t record;
begin
    for t in
        select * from (values
            ('resource_gantt_views', 'resourceManagement.view'),
            ('report_views',         'reports.view'),
            ('search_views',         'search.use')
        ) as x(tbl, view_perm)
    loop
        execute format('drop policy if exists %I on public.%I', t.tbl || ' require aal2', t.tbl);
        execute format('drop policy if exists %I on public.%I', t.tbl || ' read scope',   t.tbl);
        execute format('drop policy if exists %I on public.%I', t.tbl || ' insert',       t.tbl);
        execute format('drop policy if exists %I on public.%I', t.tbl || ' update',       t.tbl);

        execute format($f$
            create policy %I on public.%I as restrictive for all to authenticated
            using ((select auth.jwt() ->> 'aal') = 'aal2')
            with check ((select auth.jwt() ->> 'aal') = 'aal2')$f$,
            t.tbl || ' require aal2', t.tbl);

        execute format($f$
            create policy %I on public.%I for select to authenticated
            using (
                owner_auth_user_id = (select auth.uid())
                or (
                    coalesce(view_scope, '') = 'shared'
                    and (select private.has_permission(%L))
                )
            )$f$, t.tbl || ' read scope', t.tbl, t.view_perm);

        execute format($f$
            create policy %I on public.%I for insert to authenticated
            with check (
                (select private.has_permission(%L))
                and (
                    coalesce(view_scope, '') <> 'shared'
                    or (select private.has_permission('views.publish'))
                )
            )$f$, t.tbl || ' insert', t.tbl, t.view_perm);

        execute format($f$
            create policy %I on public.%I for update to authenticated
            using (
                owner_auth_user_id = (select auth.uid())
                or (
                    coalesce(view_scope, '') = 'shared'
                    and (select private.has_permission('views.publish'))
                )
            )
            with check (
                (select private.has_permission(%L))
                and (
                    coalesce(view_scope, '') <> 'shared'
                    or (select private.has_permission('views.publish'))
                )
            )$f$, t.tbl || ' update', t.tbl, t.view_perm);
    end loop;
end $$;


/* -------------------------------------------------------------------------
   6. Grants and triggers, applied uniformly to all fourteen.

      INSERT and UPDATE only. DELETE stays revoked and removal is represented by
      deleted_at, exactly as for the Stage 9 child tables. TRUNCATE, TRIGGER and
      REFERENCES are revoked explicitly — Stage 9 found TRUNCATE present by default,
      and TRUNCATE bypasses RLS entirely.
   ------------------------------------------------------------------------- */
do $$
declare
    t text;
    tables text[] := array[
        'programme_milestones', 'programme_raid',
        'lifecycle_templates', 'lifecycle_mandatory_rules', 'reference_data',
        'reporting_calendars', 'reporting_periods', 'rag_config',
        'financial_categories',
        'resource_absence', 'resource_config',
        'resource_gantt_views', 'report_views', 'search_views'
    ];
    view_tables text[] := array['resource_gantt_views', 'report_views', 'search_views'];
begin
    foreach t in array tables loop
        execute format('grant select, insert, update on public.%I to authenticated', t);
        execute format('revoke delete, truncate, trigger, references on public.%I from authenticated', t);
        execute format('revoke all on public.%I from anon', t);

        execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_key',   t);
        execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_lock',  t);
        execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_audit', t);
        execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_owner', t);

        execute format(
            'create trigger %I before update on public.%I for each row execute function private.protect_scope_key()',
            'trg_' || t || '_key', t);
        execute format(
            'create trigger %I before update on public.%I for each row execute function private.enforce_optimistic_lock()',
            'trg_' || t || '_lock', t);
        execute format(
            'create trigger %I after insert or update or delete on public.%I for each row execute function private.record_scope_audit()',
            'trg_' || t || '_audit', t);

        if t = any(view_tables) then
            execute format(
                'create trigger %I before insert or update on public.%I for each row execute function private.own_saved_view()',
                'trg_' || t || '_owner', t);
        end if;
    end loop;
end $$;


/* -------------------------------------------------------------------------
   7. Let the audit read policy recover scope for the new tables.

      audit_log.record_key now also carries "PROG-001 / PM-00001" and
      "GLOBAL / LIFE-00001". The existing policy splits the prefix and hands it to
      private.can_access_project(), which is wrong for both. Rewritten as one rule
      rather than extended, for the same reason Stage 9 rewrote it: there should be
      exactly one statement of who can read the audit trail.
   ------------------------------------------------------------------------- */
drop policy if exists "users can read audit history" on public.audit_log;
create policy "users can read audit history" on public.audit_log
    for select to authenticated
    using (
        (select private.has_permission('audit.view'))
        or (
            /* Stage 12 configuration and saved views: administration-level reading. */
            table_name = any(array[
                'lifecycle_templates', 'lifecycle_mandatory_rules', 'reference_data',
                'reporting_calendars', 'reporting_periods', 'rag_config',
                'financial_categories', 'resource_config',
                'resource_gantt_views', 'report_views', 'search_views'
            ])
            and (select private.has_permission('administration.view'))
        )
        or (
            table_name = 'resource_absence'
            and (select private.has_permission('resourceManagement.view'))
        )
        or (
            table_name = any(array['programme_milestones', 'programme_raid'])
            and (select private.can_access_programme_code(split_part(record_key, ' / ', 1)))
        )
        or (
            table_name = 'resource_scenarios'
            and (select private.has_permission('resourceManagement.view'))
            and exists (
                select 1
                  from public.resource_scenarios rs
                 where rs.id = audit_log.record_id
                   and (select private.can_access_all_projects(rs.project_codes))
            )
        )
        or (
            record_key like 'programme:% / %'
            and (select private.can_access_programme_code(
                split_part(split_part(record_key, ' / ', 1), 'programme:', 2)
            ))
        )
        or (
            /*
              The original project-scoped branch, now explicitly excluding every
              table handled above.

              Written with <> ALL, not <> ANY. "x <> any(array[...])" is true as
              soon as x differs from a single element, so it is true for virtually
              everything and would have let this branch also apply to the Stage 12
              tables. It happens to be fail-safe here — can_access_project('GLOBAL')
              is false — but it is still the wrong rule, and it would stop being
              harmless the moment a scope key coincided with a project code.
            */
            record_key not like 'programme:% / %'
            and table_name <> all (array[
                'resource_scenarios', 'resource_absence',
                'programme_milestones', 'programme_raid',
                'lifecycle_templates', 'lifecycle_mandatory_rules', 'reference_data',
                'reporting_calendars', 'reporting_periods', 'rag_config',
                'financial_categories', 'resource_config',
                'resource_gantt_views', 'report_views', 'search_views'
            ])
            and (select private.can_access_project(split_part(record_key, ' / ', 1)))
        )
    );


/* -------------------------------------------------------------------------
   8. Readiness probe. One question: is every Stage 12 table present, RLS
      enabled, writable by the browser, and safely non-destructive?
   ------------------------------------------------------------------------- */
create or replace function public.ppm_stage12_ready()
returns boolean
language sql
stable
set search_path = ''
as $$
    with expected as (
        select unnest(array[
            'programme_milestones', 'programme_raid',
            'lifecycle_templates', 'lifecycle_mandatory_rules', 'reference_data',
            'reporting_calendars', 'reporting_periods', 'rag_config',
            'financial_categories',
            'resource_absence', 'resource_config',
            'resource_gantt_views', 'report_views', 'search_views'
        ]) as tbl
    )
    select
        coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
        and not exists (
            select 1 from expected e
             where to_regclass('public.' || e.tbl) is null
                or not exists (
                    select 1 from pg_catalog.pg_class c
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relname = e.tbl and c.relrowsecurity
                )
                or not exists (
                    select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = e.tbl and column_name = 'scope_key'
                )
                or not has_table_privilege('authenticated', 'public.' || e.tbl, 'SELECT')
                or not has_table_privilege('authenticated', 'public.' || e.tbl, 'INSERT')
                or not has_table_privilege('authenticated', 'public.' || e.tbl, 'UPDATE')
                or has_table_privilege('authenticated', 'public.' || e.tbl, 'DELETE')
                or has_table_privilege('authenticated', 'public.' || e.tbl, 'TRUNCATE')
                or has_table_privilege('authenticated', 'public.' || e.tbl, 'TRIGGER')
                or has_table_privilege('authenticated', 'public.' || e.tbl, 'REFERENCES')
        )
        and to_regprocedure('private.protect_scope_key()') is not null
        and to_regprocedure('private.record_scope_audit()') is not null
        and to_regprocedure('private.own_saved_view()') is not null;
$$;

revoke all on function public.ppm_stage12_ready() from public, anon;
grant execute on function public.ppm_stage12_ready() to authenticated;

commit;

/* =============================================================================
   ROLLBACK

   To put the browser back on local data:  PPMChildDatabase.revertStage12()
   That changes source selection only and leaves every row in place.

   These tables are new, so dropping them is a genuine option if you want to start
   over — nothing else references them:

     drop table if exists public.programme_milestones, public.programme_raid,
       public.lifecycle_templates, public.lifecycle_mandatory_rules,
       public.reference_data, public.reporting_calendars, public.reporting_periods,
       public.rag_config, public.financial_categories, public.resource_absence,
       public.resource_config, public.resource_gantt_views, public.report_views,
       public.search_views cascade;

   Note that doing so also drops their audit history. The audit_log rows survive,
   but record_id will point at rows that no longer exist.
   ========================================================================== */
