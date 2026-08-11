/* =============================================================================
   PORTFOLIO MANAGER — STAGE 11D
   Transactional resource workflow: Resource Demand + Resource Scenarios

   IMPORTANT FIRST-RUN ORDER:
     1. Start the Stage 11D browser build.
     2. Seed + parity-check resourceDemand and resourceScenarios.
     3. Only then apply this migration.

   WHY SEED FIRST
   --------------
   The migration makes Published/Rejected scenario state workflow-owned and makes
   scenario scope explicit. Historical scenario rows therefore need to be present
   before those guards are installed.

   SAFE TO RE-RUN AFTER THE INITIAL SEED.
   ========================================================================== */

begin;

/* -------------------------------------------------------------------------
   1. Resource-scenario scope is the set of projects embedded in its demand
      snapshot. Stage 10A correctly stopped pretending a scenario belonged to one
      project, but its permission-only policy could expose a multi-project snapshot
      to a scoped resource user. Store the derived project set and require access
      to every project in that set.
   ------------------------------------------------------------------------- */
alter table public.resource_scenarios
    add column if not exists project_codes text[] not null default '{}'::text[];

/* Refuse malformed historical scenarios rather than silently treating a demand
   with no project code as portfolio-wide/global content. */
do $$
declare
    bad_scenario text;
begin
    select rs.record_key
      into bad_scenario
      from public.resource_scenarios rs
     where rs.deleted_at is null
       and jsonb_typeof(coalesce(rs.legacy_payload->'demands', '[]'::jsonb)) <> 'array'
     limit 1;

    if bad_scenario is not null then
        raise exception
            'Stage 11D cannot install: resource scenario % has a non-array demands payload.',
            bad_scenario
            using errcode = '22023';
    end if;

    select rs.record_key
      into bad_scenario
      from public.resource_scenarios rs
     where rs.deleted_at is null
       and exists (
           select 1
             from jsonb_array_elements(coalesce(rs.legacy_payload->'demands', '[]'::jsonb)) d(value)
            where jsonb_typeof(d.value) <> 'object'
               or nullif(btrim(coalesce(d.value->>'projectCode', '')), '') is null
       )
     limit 1;

    if bad_scenario is not null then
        raise exception
            'Stage 11D cannot install: resource scenario % contains demand without a project code.',
            bad_scenario
            using errcode = '22023';
    end if;
end;
$$;

/* Backfill scope for rows seeded before Stage 11D. */
update public.resource_scenarios rs
   set project_codes = coalesce((
       select array_agg(distinct btrim(d.value->>'projectCode') order by btrim(d.value->>'projectCode'))
         from jsonb_array_elements(coalesce(rs.legacy_payload->'demands', '[]'::jsonb)) d(value)
        where nullif(btrim(coalesce(d.value->>'projectCode', '')), '') is not null
   ), '{}'::text[])
 where rs.project_codes is distinct from coalesce((
       select array_agg(distinct btrim(d.value->>'projectCode') order by btrim(d.value->>'projectCode'))
         from jsonb_array_elements(coalesce(rs.legacy_payload->'demands', '[]'::jsonb)) d(value)
        where nullif(btrim(coalesce(d.value->>'projectCode', '')), '') is not null
   ), '{}'::text[]);

create index if not exists resource_scenarios_project_codes_gin_idx
    on public.resource_scenarios using gin (project_codes);

create or replace function private.sync_resource_scenario_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    demands jsonb := coalesce(new.legacy_payload->'demands', '[]'::jsonb);
    derived_codes text[];
begin
    if jsonb_typeof(demands) <> 'array' then
        raise exception 'A resource scenario demands payload must be an array.' using errcode = '22023';
    end if;

    if exists (
        select 1
          from jsonb_array_elements(demands) d(value)
         where jsonb_typeof(d.value) <> 'object'
            or nullif(btrim(coalesce(d.value->>'projectCode', '')), '') is null
    ) then
        raise exception 'Every resource-scenario demand item must contain a projectCode.' using errcode = '22023';
    end if;

    select coalesce(
               array_agg(distinct btrim(d.value->>'projectCode') order by btrim(d.value->>'projectCode')),
               '{}'::text[]
           )
      into derived_codes
      from jsonb_array_elements(demands) d(value);

    new.project_codes := derived_codes;
    return new;
end;
$$;

revoke all on function private.sync_resource_scenario_scope() from public;

drop trigger if exists trg_resource_scenarios_scope on public.resource_scenarios;
create trigger trg_resource_scenarios_scope
before insert or update of legacy_payload on public.resource_scenarios
for each row execute function private.sync_resource_scenario_scope();

create or replace function private.can_access_all_projects(target_project_codes text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select not exists (
        select 1
          from unnest(coalesce(target_project_codes, '{}'::text[])) code
         where nullif(btrim(code), '') is null
            or not private.can_access_project(code)
    );
$$;

revoke all on function private.can_access_all_projects(text[]) from public;
grant execute on function private.can_access_all_projects(text[]) to authenticated;

/* -------------------------------------------------------------------------
   2. Complete Team-project scope now that project plan and resource demand are
      database-backed. Stage 3F deliberately used only team leadership as a
      conservative interim approximation until these tables migrated.
   ------------------------------------------------------------------------- */
create or replace function private.can_access_project(target_project_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    with me as (
        select
            pe.id,
            pe.legacy_resource_id,
            coalesce(pe.access_scope, 'Selected projects') as access_scope,
            nullif(btrim(lower(coalesce(pe.team, ''))), '') as team_key,
            coalesce(pe.selected_project_codes, '{}'::text[]) as selected_project_codes
        from public.people pe
        where pe.auth_user_id = (select auth.uid())
          and pe.active = true
          and coalesce(pe.account_status, 'Active') = 'Active'
        limit 1
    ),
    target as (
        select pr.id, pr.project_manager_id, pr.sponsor_id, pr.project_lead_id,
               coalesce(pr.legacy_payload, '{}'::jsonb) as legacy_payload
        from public.projects pr
        where pr.project_code = target_project_code
    )
    select coalesce(bool_or(
        /* Portfolio-wide. */
        me.access_scope = 'Portfolio-wide'

        /* Explicit project grant. */
        or target_project_code = any (me.selected_project_codes)

        /* Named on the project through normalised foreign keys. */
        or t.project_manager_id = me.id
        or t.sponsor_id         = me.id
        or t.project_lead_id    = me.id

        /* Named on the original project record. */
        or (
            me.legacy_resource_id is not null
            and me.legacy_resource_id = any (array_remove(array[
                t.legacy_payload ->> 'projectManagerResourceId',
                t.legacy_payload ->> 'sponsorResourceId',
                t.legacy_payload ->> 'projectLeadResourceId',
                t.legacy_payload ->> 'deputyProjectManagerResourceId',
                t.legacy_payload ->> 'businessAnalystResourceId',
                t.legacy_payload ->> 'technicalLeadResourceId',
                t.legacy_payload ->> 'benefitOwnerResourceId',
                t.legacy_payload ->> 'financialOwnerResourceId',
                t.legacy_payload ->> 'createdByResourceId'
            ], null))
        )

        /* Assigned-project scope also includes direct resource-demand assignment,
           matching the browser facade. */
        or (
            me.legacy_resource_id is not null
            and exists (
                select 1
                  from public.resource_demand rd
                 where rd.project_code = target_project_code
                   and rd.deleted_at is null
                   and me.legacy_resource_id = any (array_remove(array[
                       rd.legacy_payload ->> 'resourceId',
                       rd.legacy_payload ->> 'resourceResourceId',
                       rd.legacy_payload ->> 'assignedResourceId'
                   ], null))
            )
        )

        /* Team projects: leadership, a team-coded demand row, demand assigned to
           a person on the same team, or a plan item owned by that team. */
        or (
            me.access_scope = 'Team projects'
            and me.team_key is not null
            and (
                exists (
                    select 1
                      from public.people tm
                     where nullif(btrim(lower(coalesce(tm.team, ''))), '') = me.team_key
                       and (
                           t.project_manager_id = tm.id
                           or t.sponsor_id      = tm.id
                           or t.project_lead_id = tm.id
                           or (
                               tm.legacy_resource_id is not null
                               and tm.legacy_resource_id = any (array_remove(array[
                                   t.legacy_payload ->> 'projectManagerResourceId',
                                   t.legacy_payload ->> 'sponsorResourceId',
                                   t.legacy_payload ->> 'projectLeadResourceId'
                               ], null))
                           )
                       )
                )
                or exists (
                    select 1
                      from public.resource_demand rd
                     where rd.project_code = target_project_code
                       and rd.deleted_at is null
                       and (
                           me.team_key = any (array_remove(array[
                               nullif(btrim(lower(coalesce(rd.legacy_payload->>'team', ''))), ''),
                               nullif(btrim(lower(coalesce(rd.legacy_payload->>'owningTeam', ''))), ''),
                               nullif(btrim(lower(coalesce(rd.legacy_payload->>'requiredTeam', ''))), '')
                           ], null))
                           or exists (
                               select 1
                                 from public.people tm
                                where nullif(btrim(lower(coalesce(tm.team, ''))), '') = me.team_key
                                  and tm.legacy_resource_id is not null
                                  and tm.legacy_resource_id = any (array_remove(array[
                                      rd.legacy_payload ->> 'resourceId',
                                      rd.legacy_payload ->> 'resourceResourceId',
                                      rd.legacy_payload ->> 'assignedResourceId'
                                  ], null))
                           )
                       )
                )
                or exists (
                    select 1
                      from public.project_plans pp
                      join public.people tm
                        on tm.legacy_resource_id = pp.task_owner_resource_id
                     where pp.project_code = target_project_code
                       and pp.deleted_at is null
                       and nullif(btrim(lower(coalesce(tm.team, ''))), '') = me.team_key
                )
            )
        )
    ), false)
    from me
    left join target t on true;
$$;

revoke all on function private.can_access_project(text) from public;
grant execute on function private.can_access_project(text) to authenticated;

/* -------------------------------------------------------------------------
   3. Replace Stage 10A's permission-only scenario policies with all-project scope.
   ------------------------------------------------------------------------- */
drop policy if exists "resource_scenarios read scope" on public.resource_scenarios;
create policy "resource_scenarios read scope"
on public.resource_scenarios
for select to authenticated
using (
    (select private.has_permission('resourceManagement.view'))
    and (select private.can_access_all_projects(project_codes))
);

drop policy if exists "resource_scenarios insert" on public.resource_scenarios;
create policy "resource_scenarios insert"
on public.resource_scenarios
for insert to authenticated
with check (
    (select private.has_permission('resourceManagement.edit'))
    and (select private.can_access_all_projects(project_codes))
);

drop policy if exists "resource_scenarios update" on public.resource_scenarios;
create policy "resource_scenarios update"
on public.resource_scenarios
for update to authenticated
using (
    (select private.has_permission('resourceManagement.edit'))
    and (select private.can_access_all_projects(project_codes))
)
with check (
    (select private.has_permission('resourceManagement.edit'))
    and (select private.can_access_all_projects(project_codes))
);

/* -------------------------------------------------------------------------
   4. Scenario terminal state is workflow-owned. Draft name/notes/adjustments may
      still use ordinary optimistic write-through. The source-demand version map
      is immutable once the scenario is created.
   ------------------------------------------------------------------------- */
create or replace function private.guard_resource_scenario_workflow_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    old_status text;
    new_status text;
begin
    if coalesce(current_setting('ppm.resource_scenario_workflow', true), '') = 'on' then
        return new;
    end if;

    new_status := coalesce(nullif(btrim(new.legacy_payload->>'status'), ''), 'Draft');

    if tg_op = 'INSERT' then
        if new_status <> 'Draft'
           or nullif(btrim(coalesce(new.legacy_payload->>'publishedAt', '')), '') is not null
           or nullif(btrim(coalesce(new.legacy_payload->>'rejectedAt', '')), '') is not null then
            raise exception
                'A new resource scenario must start as Draft. Publish/reject through the Stage 11D workflow.'
                using errcode = '42501';
        end if;
        return new;
    end if;

    old_status := coalesce(nullif(btrim(old.legacy_payload->>'status'), ''), 'Draft');

    if old_status <> 'Draft' then
        raise exception
            'Published or rejected resource scenarios are immutable history.'
            using errcode = '42501';
    end if;

    if new_status <> old_status
       or coalesce(new.legacy_payload->>'publishedAt', '') is distinct from coalesce(old.legacy_payload->>'publishedAt', '')
       or coalesce(new.legacy_payload->>'rejectedAt', '') is distinct from coalesce(old.legacy_payload->>'rejectedAt', '') then
        raise exception
            'Resource scenario publication/rejection can only occur through the Stage 11D workflow.'
            using errcode = '42501';
    end if;

    if coalesce(new.legacy_payload->'sourceDemandVersions', '{}'::jsonb)
       is distinct from coalesce(old.legacy_payload->'sourceDemandVersions', '{}'::jsonb)
       or coalesce(new.legacy_payload->>'snapshotCreatedAt', '')
          is distinct from coalesce(old.legacy_payload->>'snapshotCreatedAt', '') then
        raise exception
            'A resource scenario source-demand snapshot cannot be rewritten after creation.'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

revoke all on function private.guard_resource_scenario_workflow_write() from public;

drop trigger if exists trg_resource_scenarios_workflow_guard on public.resource_scenarios;
create trigger trg_resource_scenarios_workflow_guard
before insert or update on public.resource_scenarios
for each row execute function private.guard_resource_scenario_workflow_write();

/* -------------------------------------------------------------------------
   5. Keep server audit visibility aligned with the stricter scenario scope and
      add compact payload-aware audit entries for the two Stage 11D scaffold
      tables. Their business fields still live in legacy_payload, which the
      generic Stage 8/9 audit trigger intentionally omits.
   ------------------------------------------------------------------------- */
drop policy if exists "users can read audit history" on public.audit_log;
create policy "users can read audit history"
on public.audit_log
for select to authenticated
using (
    (select private.has_permission('audit.view'))
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
        record_key not like 'programme:% / %'
        and table_name <> 'resource_scenarios'
        and (select private.can_access_project(split_part(record_key, ' / ', 1)))
    )
);

create or replace function private.record_resource_payload_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    me record;
    changed jsonb := '[]'::jsonb;
    field text;
    before_value jsonb;
    after_value jsonb;
    key_text text;
    before_count integer;
    after_count integer;
    tracked_demand_fields text[] := array[
        'roleSkill', 'resourceId', 'team', 'startDate', 'endDate',
        'allocationMethod', 'allocationPercentage', 'hours', 'normalisedHours',
        'status', 'confidence', 'priority', 'requestorResourceId',
        'approverResourceId', 'notes', 'scenarioPublishedFrom'
    ];
    tracked_scenario_fields text[] := array[
        'name', 'visibility', 'notes', 'status', 'publishedAt', 'rejectedAt'
    ];
begin
    if tg_op <> 'UPDATE' then
        return new;
    end if;

    if tg_table_name = 'resource_demand' then
        foreach field in array tracked_demand_fields loop
            before_value := old.legacy_payload -> field;
            after_value := new.legacy_payload -> field;
            if before_value is distinct from after_value then
                changed := changed || jsonb_build_array(jsonb_build_object(
                    'field', field,
                    'before', before_value,
                    'after', after_value
                ));
            end if;
        end loop;
        key_text := new.project_code || ' / ' || new.record_key;
    elsif tg_table_name = 'resource_scenarios' then
        foreach field in array tracked_scenario_fields loop
            before_value := old.legacy_payload -> field;
            after_value := new.legacy_payload -> field;
            if before_value is distinct from after_value then
                changed := changed || jsonb_build_array(jsonb_build_object(
                    'field', field,
                    'before', before_value,
                    'after', after_value
                ));
            end if;
        end loop;

        if coalesce(old.legacy_payload->'demands', '[]'::jsonb)
           is distinct from coalesce(new.legacy_payload->'demands', '[]'::jsonb) then
            before_count := case
                when jsonb_typeof(coalesce(old.legacy_payload->'demands', '[]'::jsonb)) = 'array'
                    then jsonb_array_length(coalesce(old.legacy_payload->'demands', '[]'::jsonb))
                else 0
            end;
            after_count := case
                when jsonb_typeof(coalesce(new.legacy_payload->'demands', '[]'::jsonb)) = 'array'
                    then jsonb_array_length(coalesce(new.legacy_payload->'demands', '[]'::jsonb))
                else 0
            end;
            changed := changed || jsonb_build_array(jsonb_build_object(
                'field', 'demands',
                'before', jsonb_build_object('count', before_count),
                'after', jsonb_build_object('count', after_count)
            ));
        end if;
        key_text := 'resource-scenario / ' || new.record_key;
    else
        return new;
    end if;

    if jsonb_array_length(changed) = 0 then
        return new;
    end if;

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
        tg_table_name, key_text, new.id, 'UPDATE', changed, new.version
    );

    return new;
exception when others then
    raise warning 'resource audit: could not record update on %: %', tg_table_name, sqlerrm;
    return new;
end;
$$;

revoke all on function private.record_resource_payload_audit() from public;

drop trigger if exists trg_resource_demand_payload_audit on public.resource_demand;
create trigger trg_resource_demand_payload_audit
after update on public.resource_demand
for each row execute function private.record_resource_payload_audit();

drop trigger if exists trg_resource_scenarios_payload_audit on public.resource_scenarios;
create trigger trg_resource_scenarios_payload_audit
after update on public.resource_scenarios
for each row execute function private.record_resource_payload_audit();


/* -------------------------------------------------------------------------
   6. Readiness probe used by the browser before coupled cutover.
   ------------------------------------------------------------------------- */
create or replace function public.ppm_stage11d_ready()
returns boolean
language sql
stable
set search_path = ''
as $$
    select
        coalesce((select auth.jwt()->>'aal'), '') = 'aal2'
        and exists (
            select 1 from information_schema.columns
             where table_schema = 'public'
               and table_name = 'resource_scenarios'
               and column_name = 'project_codes'
        )
        and exists (
            select 1 from pg_catalog.pg_trigger
             where tgname = 'trg_resource_scenarios_scope'
               and not tgisinternal
        )
        and exists (
            select 1 from pg_catalog.pg_trigger
             where tgname = 'trg_resource_scenarios_workflow_guard'
               and not tgisinternal
        )
        and has_table_privilege('authenticated', 'public.resource_demand', 'SELECT')
        and has_table_privilege('authenticated', 'public.resource_demand', 'INSERT')
        and has_table_privilege('authenticated', 'public.resource_demand', 'UPDATE')
        and not has_table_privilege('authenticated', 'public.resource_demand', 'DELETE')
        and not has_table_privilege('authenticated', 'public.resource_demand', 'TRUNCATE')
        and not has_table_privilege('authenticated', 'public.resource_demand', 'TRIGGER')
        and not has_table_privilege('authenticated', 'public.resource_demand', 'REFERENCES')
        and has_table_privilege('authenticated', 'public.resource_scenarios', 'SELECT')
        and has_table_privilege('authenticated', 'public.resource_scenarios', 'INSERT')
        and has_table_privilege('authenticated', 'public.resource_scenarios', 'UPDATE')
        and not has_table_privilege('authenticated', 'public.resource_scenarios', 'DELETE')
        and not has_table_privilege('authenticated', 'public.resource_scenarios', 'TRUNCATE')
        and not has_table_privilege('authenticated', 'public.resource_scenarios', 'TRIGGER')
        and not has_table_privilege('authenticated', 'public.resource_scenarios', 'REFERENCES');
$$;

revoke all on function public.ppm_stage11d_ready() from public, anon;
grant execute on function public.ppm_stage11d_ready() to authenticated;

/* -------------------------------------------------------------------------
   7. One transaction boundary for resource-scenario decisions.

      publish:
        - requires resourceManagement.publishScenario;
        - validates access to every project in the scenario;
        - verifies the immutable source-demand version snapshot;
        - updates only those snapshotted demand records (newer demand created after
          the snapshot is deliberately left untouched);
        - marks the scenario Published in the same transaction.

      reject:
        - requires resourceManagement.edit;
        - leaves demand unchanged;
        - marks the scenario Rejected atomically.
   ------------------------------------------------------------------------- */
create or replace function public.ppm_commit_resource_scenario_workflow(
    p_operation                  text,
    p_scenario_id                text,
    p_expected_scenario_version  integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me                       record;
    scenario_row             public.resource_scenarios%rowtype;
    demand_row               public.resource_demand%rowtype;
    project_row              public.projects%rowtype;
    operation_name           text := lower(btrim(coalesce(p_operation, '')));
    scenario_id              text := btrim(coalesce(p_scenario_id, ''));
    actor_resource_id        text;
    scenario_payload         jsonb;
    scenario_demands         jsonb;
    source_versions          jsonb;
    scenario_item            jsonb;
    scenario_audit           jsonb;
    scenario_key             text;
    demand_id                text;
    project_code             text;
    expected_demand_version  integer;
    demand_count             integer := 0;
    source_count             integer := 0;
    applied_count            integer := 0;
    now_ts                   timestamptz := clock_timestamp();
    now_text                 text;
begin
    if (select auth.uid()) is null then
        raise exception 'You must be signed in to use the resource-scenario workflow.' using errcode = '42501';
    end if;
    if coalesce((select auth.jwt()->>'aal'), '') <> 'aal2' then
        raise exception 'MFA verification is required to use the resource-scenario workflow.' using errcode = '42501';
    end if;

    select p.id, p.legacy_resource_id, p.full_name, p.email, p.access_role
      into me
      from public.people p
     where p.auth_user_id = (select auth.uid())
       and p.active = true
       and coalesce(p.account_status, 'Active') = 'Active'
     limit 1;

    if not found or nullif(btrim(coalesce(me.legacy_resource_id, '')), '') is null then
        raise exception 'The signed-in account is not linked to an active PPM resource.' using errcode = '42501';
    end if;
    actor_resource_id := me.legacy_resource_id;

    if operation_name not in ('publish', 'reject') then
        raise exception 'Unknown resource-scenario workflow operation: %', operation_name using errcode = '22023';
    end if;
    if scenario_id = '' then
        raise exception 'The resource scenario has no identifier.' using errcode = '22023';
    end if;
    if not private.has_permission('resourceManagement.edit') then
        raise exception 'You do not have permission to edit resource scenarios.' using errcode = '42501';
    end if;
    if operation_name = 'publish' and not private.has_permission('resourceManagement.publishScenario') then
        raise exception 'You do not have permission to publish resource scenarios.' using errcode = '42501';
    end if;

    select rs.*
      into scenario_row
      from public.resource_scenarios rs
     where rs.record_key = scenario_id
       and rs.deleted_at is null
     for update;

    if not found then
        raise exception 'Resource scenario % could not be found.', scenario_id using errcode = 'P0002';
    end if;
    if p_expected_scenario_version is null or scenario_row.version <> p_expected_scenario_version then
        raise exception
            'Resource scenario % changed while it was open (loaded version %, current version %). Reload and reapply the action.',
            scenario_id, p_expected_scenario_version, scenario_row.version
            using errcode = '40001';
    end if;
    if not private.can_access_all_projects(scenario_row.project_codes) then
        raise exception 'The resource scenario includes a project outside your authorised scope.' using errcode = '42501';
    end if;

    scenario_payload := coalesce(scenario_row.legacy_payload, '{}'::jsonb);
    if coalesce(nullif(btrim(scenario_payload->>'status'), ''), 'Draft') <> 'Draft' then
        raise exception 'Only Draft resource scenarios can be published or rejected.' using errcode = '42501';
    end if;

    scenario_demands := coalesce(scenario_payload->'demands', '[]'::jsonb);
    if jsonb_typeof(scenario_demands) <> 'array' then
        raise exception 'The scenario demand snapshot is invalid.' using errcode = '22023';
    end if;

    now_text := to_char(now_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

    if operation_name = 'publish' then
        source_versions := coalesce(scenario_payload->'sourceDemandVersions', '{}'::jsonb);
        if not (scenario_payload ? 'sourceDemandVersions')
           or jsonb_typeof(source_versions) <> 'object' then
            raise exception
                'This scenario has no valid Stage 11D source-demand version snapshot. Create a fresh scenario before publishing.'
                using errcode = '40001';
        end if;

        select count(*) into demand_count from jsonb_array_elements(scenario_demands);
        source_count := jsonb_object_length(source_versions);
        if demand_count <> source_count then
            raise exception
                'The scenario demand set changed after its source snapshot was captured. Create a fresh scenario before publishing.'
                using errcode = '40001';
        end if;

        /* Validate the whole scenario before mutating any row. */
        for scenario_item in
            select d.value
              from jsonb_array_elements(scenario_demands) d(value)
             order by btrim(coalesce(d.value->>'projectCode', '')),
                      btrim(coalesce(d.value->>'demandId', ''))
        loop
            if jsonb_typeof(scenario_item) <> 'object' then
                raise exception 'The scenario contains an invalid demand item.' using errcode = '22023';
            end if;

            demand_id := btrim(coalesce(scenario_item->>'demandId', ''));
            project_code := btrim(coalesce(scenario_item->>'projectCode', ''));
            if demand_id = '' or project_code = '' then
                raise exception 'Every scenario demand item needs demandId and projectCode.' using errcode = '22023';
            end if;
            if not private.can_access_project(project_code) then
                raise exception 'Project % is outside your authorised scope.', project_code using errcode = '42501';
            end if;

            select pr.* into project_row
              from public.projects pr
             where pr.project_code = project_code;
            if not found then
                raise exception 'Project % no longer exists.', project_code using errcode = 'P0002';
            end if;
            if coalesce(project_row.archived, false) then
                raise exception 'Archived project % is read-only.', project_code using errcode = '42501';
            end if;

            scenario_key := project_code || '|' || demand_id;
            if not (source_versions ? scenario_key) then
                raise exception
                    'Demand % is not part of the immutable source snapshot. Create a fresh scenario before publishing.',
                    demand_id
                    using errcode = '40001';
            end if;
            begin
                expected_demand_version := nullif(source_versions->>scenario_key, '')::integer;
            exception when others then
                expected_demand_version := null;
            end;
            if expected_demand_version is null then
                raise exception 'Demand % has an invalid source version.', demand_id using errcode = '40001';
            end if;

            select rd.*
              into demand_row
              from public.resource_demand rd
             where rd.project_code = project_code
               and rd.record_key = demand_id
               and rd.deleted_at is null
             for update;
            if not found then
                raise exception
                    'Demand % changed or was removed after the scenario was created. Create a fresh scenario.',
                    demand_id
                    using errcode = '40001';
            end if;
            if demand_row.version <> expected_demand_version then
                raise exception
                    'Demand % changed after the scenario was created (snapshot version %, current version %). Create a fresh scenario.',
                    demand_id, expected_demand_version, demand_row.version
                    using errcode = '40001';
            end if;
        end loop;

        /* Apply only the rows present in the immutable snapshot. Demand created
           later is left untouched rather than being destroyed by a stale scenario. */
        for scenario_item in
            select d.value
              from jsonb_array_elements(scenario_demands) d(value)
             order by btrim(coalesce(d.value->>'projectCode', '')),
                      btrim(coalesce(d.value->>'demandId', ''))
        loop
            demand_id := btrim(scenario_item->>'demandId');
            project_code := btrim(scenario_item->>'projectCode');

            select rd.*
              into demand_row
              from public.resource_demand rd
             where rd.project_code = project_code
               and rd.record_key = demand_id
               and rd.deleted_at is null
             for update;

            update public.resource_demand
               set legacy_payload = (scenario_item
                                      - 'databaseId'
                                      - 'databaseVersion'
                                      - 'recordSource'
                                      - '__storageGroup'
                                      - '__projectCode'
                                      - '__programmeCode')
                                    || jsonb_build_object(
                                         'updatedAt', now_text,
                                         'scenarioPublishedFrom', scenario_id
                                       ),
                   version = demand_row.version
             where id = demand_row.id;
            applied_count := applied_count + 1;
        end loop;
    end if;

    scenario_audit := coalesce(scenario_payload->'audit', '[]'::jsonb);
    if jsonb_typeof(scenario_audit) <> 'array' then scenario_audit := '[]'::jsonb; end if;
    scenario_audit := scenario_audit || jsonb_build_array(jsonb_build_object(
        'action', case when operation_name = 'publish' then 'Published to live demand' else 'Rejected' end,
        'at', now_text,
        'by', coalesce(me.full_name, actor_resource_id),
        'byResourceId', actor_resource_id
    ));

    scenario_payload := scenario_payload || jsonb_build_object(
        'status', case when operation_name = 'publish' then 'Published' else 'Rejected' end,
        'updatedAt', now_text,
        'audit', scenario_audit
    );
    if operation_name = 'publish' then
        scenario_payload := scenario_payload || jsonb_build_object('publishedAt', now_text);
    else
        scenario_payload := scenario_payload || jsonb_build_object('rejectedAt', now_text);
    end if;

    perform set_config('ppm.resource_scenario_workflow', 'on', true);
    update public.resource_scenarios
       set legacy_payload = scenario_payload,
           version = scenario_row.version
     where id = scenario_row.id;

    return jsonb_build_object(
        'ok', true,
        'operation', operation_name,
        'scenarioId', scenario_id,
        'appliedDemandItems', applied_count,
        'projectCount', coalesce(array_length(scenario_row.project_codes, 1), 0)
    );
end;
$$;

revoke all on function public.ppm_commit_resource_scenario_workflow(text, text, integer) from public, anon;
grant execute on function public.ppm_commit_resource_scenario_workflow(text, text, integer) to authenticated;

commit;
