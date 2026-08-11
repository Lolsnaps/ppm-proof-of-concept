/* =============================================================================
   PORTFOLIO MANAGER — STAGE 11B
   Transactional approved-baseline workflow: Plan Baselines + Rebaseline Requests
   + approved baseline dates on Project Plan rows

   IMPORTANT FIRST-RUN ORDER:
     1. Start the Stage 11B browser build.
     2. Seed + parity-check planBaselines and baselineRequests.
     3. Only then apply this migration.

   The guards below deliberately make approved baseline history and rebaseline
   request state workflow-owned. Historical rows therefore have to exist before
   the guards are installed.

   SAFE TO RE-RUN AFTER THE INITIAL SEED.
   ========================================================================== */

begin;

/* Approved baseline snapshots are governance history. Once Stage 11B is active,
   browser row writes may not create, alter, soft-delete or restore them. */
create or replace function private.guard_plan_baseline_workflow_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if coalesce(current_setting('ppm.baseline_workflow', true), '') = 'on' then
        return new;
    end if;

    raise exception
        'Approved plan baseline history can only be changed through the baseline workflow.'
        using errcode = '42501';
end;
$$;

drop trigger if exists trg_plan_baselines_workflow_guard on public.plan_baselines;
create trigger trg_plan_baselines_workflow_guard
before insert or update on public.plan_baselines
for each row execute function private.guard_plan_baseline_workflow_write();

/* A rebaseline request is created and decided through the same transaction API.
   This prevents callers from manufacturing Requested/Approved/Rejected states by
   writing the table directly. */
create or replace function private.guard_plan_baseline_request_workflow_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if coalesce(current_setting('ppm.baseline_workflow', true), '') = 'on' then
        return new;
    end if;

    raise exception
        'Rebaseline requests can only be created or decided through the baseline workflow.'
        using errcode = '42501';
end;
$$;

drop trigger if exists trg_plan_baseline_requests_workflow_guard on public.plan_baseline_requests;
create trigger trg_plan_baseline_requests_workflow_guard
before insert or update on public.plan_baseline_requests
for each row execute function private.guard_plan_baseline_request_workflow_write();

/* Once an approved baseline exists, baseline dates on plan rows are governance
   fields. Ordinary plan editing may still change every other task field, but it
   cannot bypass rebaseline approval by changing the approved dates directly. */
create or replace function private.guard_project_plan_baseline_dates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    has_approved_baseline boolean;
begin
    if coalesce(current_setting('ppm.baseline_workflow', true), '') = 'on' then
        return new;
    end if;

    select exists (
        select 1
          from public.plan_baselines pb
         where pb.project_code = new.project_code
           and pb.deleted_at is null
           and coalesce(pb.status, pb.legacy_payload->>'status', '') = 'Approved'
    ) into has_approved_baseline;

    if not has_approved_baseline then
        return new;
    end if;

    if tg_op = 'INSERT' then
        if new.baseline_start_date is not null
           or new.baseline_end_date is not null
           or nullif(btrim(coalesce(new.legacy_payload->>'baselineStartDate', '')), '') is not null
           or nullif(btrim(coalesce(new.legacy_payload->>'baselineEndDate', '')), '') is not null then
            raise exception
                'Approved baseline dates can only be introduced through an approved rebaseline.'
                using errcode = '42501';
        end if;
        return new;
    end if;

    if new.baseline_start_date is distinct from old.baseline_start_date
       or new.baseline_end_date is distinct from old.baseline_end_date
       or coalesce(new.legacy_payload->>'baselineStartDate', '') is distinct from coalesce(old.legacy_payload->>'baselineStartDate', '')
       or coalesce(new.legacy_payload->>'baselineEndDate', '') is distinct from coalesce(old.legacy_payload->>'baselineEndDate', '') then
        raise exception
            'Approved baseline dates can only change through an approved rebaseline.'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_project_plans_baseline_guard on public.project_plans;
create trigger trg_project_plans_baseline_guard
before insert or update on public.project_plans
for each row execute function private.guard_project_plan_baseline_dates();

/* Browser cutover readiness probe. Presence of this function means the migration
   was installed; the trigger checks prevent a partially-created migration from
   reporting ready. */
create or replace function public.ppm_stage11b_ready()
returns boolean
language sql
stable
set search_path = ''
as $$
    select
        coalesce((select auth.jwt()->>'aal'), '') = 'aal2'
        and exists (
            select 1 from pg_catalog.pg_trigger
             where tgname = 'trg_plan_baselines_workflow_guard' and not tgisinternal
        )
        and exists (
            select 1 from pg_catalog.pg_trigger
             where tgname = 'trg_plan_baseline_requests_workflow_guard' and not tgisinternal
        )
        and exists (
            select 1 from pg_catalog.pg_trigger
             where tgname = 'trg_project_plans_baseline_guard' and not tgisinternal
        );
$$;

/* One commit boundary for:
     request          -> creates a Requested rebaseline request
     approve_initial  -> creates the first immutable approved baseline snapshot
     approve_request  -> applies proposed plan dates + creates next baseline +
                         decides the request
     reject_request   -> decides the request without changing the plan

   The caller never supplies an approver identity. The function derives the actor
   from auth.uid() and the linked people row. */
create or replace function public.ppm_commit_baseline_workflow(
    p_operation                     text,
    p_project_code                  text,
    p_request                       jsonb,
    p_expected_request_version      integer,
    p_approval_date                 date,
    p_decision_notes                text,
    p_expected_plan_versions        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me                         record;
    project_row                public.projects%rowtype;
    request_row                public.plan_baseline_requests%rowtype;
    latest_baseline            public.plan_baselines%rowtype;
    plan_row                   public.project_plans%rowtype;
    operation_name             text := lower(btrim(coalesce(p_operation, '')));
    v_project_code             text := btrim(coalesce(p_project_code, ''));
    actor_resource_id          text;
    request_id                 text;
    baseline_id                text;
    approval_day               date := coalesce(p_approval_date, current_date);
    now_ts                     timestamptz := clock_timestamp();
    now_text                   text;
    latest_found               boolean := false;
    plan_count                 integer := 0;
    expected_plan_count        integer := 0;
    expected_version           integer;
    proposed                   jsonb := '[]'::jsonb;
    proposed_item              jsonb;
    proposed_count             integer := 0;
    distinct_proposed_count    integer := 0;
    task_id                    text;
    start_text                 text;
    end_text                   text;
    task_snapshot              jsonb := '[]'::jsonb;
    baseline_business_version  integer;
    baseline_payload           jsonb;
    request_payload            jsonb;
    request_database_version   integer := null;
    changed_plan_count         integer := 0;
begin
    if (select auth.uid()) is null then
        raise exception 'You must be signed in to use the baseline workflow.' using errcode = '42501';
    end if;

    if coalesce((select auth.jwt()->>'aal'), '') <> 'aal2' then
        raise exception 'MFA verification is required to use the baseline workflow.' using errcode = '42501';
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

    if operation_name not in ('request', 'approve_initial', 'approve_request', 'reject_request') then
        raise exception 'Unknown baseline workflow operation: %', operation_name using errcode = '22023';
    end if;

    if v_project_code = '' then
        raise exception 'The baseline workflow is missing its project identifier.' using errcode = '22023';
    end if;

    if not private.can_access_project(v_project_code) then
        raise exception 'The project is outside your authorised scope.' using errcode = '42501';
    end if;

    select pr.*
      into project_row
      from public.projects pr
     where pr.project_code = v_project_code
     for update;

    if not found then
        raise exception 'Project % no longer exists.', v_project_code using errcode = 'P0002';
    end if;
    if coalesce(project_row.archived, false) then
        raise exception 'Archived projects are read-only.' using errcode = '42501';
    end if;

    if operation_name = 'request' then
        if not private.has_permission('plan.requestBaseline') then
            raise exception 'You do not have permission to request a project plan rebaseline.' using errcode = '42501';
        end if;
    else
        if not private.has_permission('plan.approveBaseline') then
            raise exception 'You do not have permission to approve or reject project plan baselines.' using errcode = '42501';
        end if;
    end if;

    select pb.*
      into latest_baseline
      from public.plan_baselines pb
     where pb.project_code = v_project_code
       and pb.deleted_at is null
       and coalesce(pb.status, pb.legacy_payload->>'status', '') = 'Approved'
     order by coalesce(pb.record_version, 0) desc, pb.created_at desc
     limit 1
     for update;
    latest_found := found;

    /* Request creation and approval depend on the currently loaded plan shape.
       Rejecting a request does not modify or snapshot the plan, so it only needs
       the request's optimistic version. */
    if operation_name <> 'reject_request' then
        if jsonb_typeof(coalesce(p_expected_plan_versions, '{}'::jsonb)) <> 'object' then
            raise exception 'The loaded plan-version snapshot is invalid.' using errcode = '40001';
        end if;

        select count(*)
          into plan_count
          from public.project_plans pp
         where pp.project_code = v_project_code
           and pp.deleted_at is null;
        expected_plan_count := jsonb_object_length(coalesce(p_expected_plan_versions, '{}'::jsonb));

        if plan_count <> expected_plan_count then
            raise exception
                'The project plan changed while the baseline workflow was open (loaded % rows, current % rows). Reload and reapply the action.',
                expected_plan_count, plan_count
                using errcode = '40001';
        end if;

        for plan_row in
            select pp.*
              from public.project_plans pp
             where pp.project_code = v_project_code
               and pp.deleted_at is null
             order by pp.record_key
             for update
        loop
            begin
                expected_version := nullif(p_expected_plan_versions->>plan_row.record_key, '')::integer;
            exception when others then
                expected_version := null;
            end;
            if expected_version is null or expected_version <> plan_row.version then
                raise exception
                    'Plan item % changed while the baseline workflow was open (loaded version %, current version %). Reload and reapply the action.',
                    plan_row.record_key, expected_version, plan_row.version
                    using errcode = '40001';
            end if;
        end loop;
    end if;

    now_text := to_char(now_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

    if operation_name = 'request' then
        if not latest_found then
            raise exception 'A rebaseline cannot be requested before the initial baseline is approved.' using errcode = '42501';
        end if;
        if p_request is null or jsonb_typeof(p_request) <> 'object' then
            raise exception 'The rebaseline request payload is missing.' using errcode = '22023';
        end if;

        request_id := btrim(coalesce(p_request->>'requestId', ''));
        if request_id = '' then
            raise exception 'The rebaseline request has no request identifier.' using errcode = '22023';
        end if;
        if btrim(coalesce(p_request->>'projectCode', '')) <> v_project_code then
            raise exception 'The rebaseline request cannot be moved to another project.' using errcode = '42501';
        end if;
        if coalesce(nullif(btrim(p_request->>'status'), ''), 'Requested') <> 'Requested' then
            raise exception 'A new rebaseline request must start in Requested status.' using errcode = '42501';
        end if;
        if nullif(btrim(coalesce(p_request->>'requestedByResourceId', '')), '') is not null
           and btrim(p_request->>'requestedByResourceId') <> actor_resource_id then
            raise exception 'A rebaseline request cannot be submitted as another person.' using errcode = '42501';
        end if;
        if coalesce(p_request->'existingBaseline'->>'baselineId', '') <> latest_baseline.record_key
           or coalesce(p_request->'existingBaseline'->>'version', '') <> coalesce(latest_baseline.record_version::text, '') then
            raise exception 'The approved baseline changed while the request was being prepared. Reload and try again.' using errcode = '40001';
        end if;

        proposed := coalesce(p_request->'proposedBaseline', '[]'::jsonb);
        if jsonb_typeof(proposed) <> 'array' then
            raise exception 'The proposed baseline must be an array of plan items.' using errcode = '22023';
        end if;
        select count(*), count(distinct btrim(coalesce(x.value->>'taskId', '')))
          into proposed_count, distinct_proposed_count
          from jsonb_array_elements(proposed) as x(value);
        if proposed_count <> distinct_proposed_count then
            raise exception 'The proposed baseline contains a duplicate task identifier.' using errcode = '22023';
        end if;

        for proposed_item in select x.value from jsonb_array_elements(proposed) as x(value)
        loop
            task_id := btrim(coalesce(proposed_item->>'taskId', ''));
            if task_id = '' then
                raise exception 'A proposed baseline row has no task identifier.' using errcode = '22023';
            end if;
            if not exists (
                select 1 from public.project_plans pp
                 where pp.project_code = v_project_code
                   and pp.record_key = task_id
                   and pp.deleted_at is null
            ) then
                raise exception 'Plan item % no longer exists. Reload before requesting a rebaseline.', task_id using errcode = '40001';
            end if;
            start_text := btrim(coalesce(proposed_item->>'baselineStartDate', ''));
            end_text := btrim(coalesce(proposed_item->>'baselineEndDate', ''));
            if start_text <> '' and end_text <> '' and end_text::date < start_text::date then
                raise exception 'Proposed baseline finish for % cannot be before its start.', task_id using errcode = '22023';
            end if;
        end loop;

        request_payload := p_request || jsonb_build_object(
            'requestId', request_id,
            'projectCode', v_project_code,
            'status', 'Requested',
            'createdAt', now_text,
            'requestedBy', coalesce(me.full_name, actor_resource_id),
            'requestedByResourceId', actor_resource_id
        );

        perform set_config('ppm.baseline_workflow', 'on', true);
        insert into public.plan_baseline_requests (
            project_id, project_code, record_key,
            status, existing_baseline, proposed_baseline, reason, impact,
            requested_by, requested_by_resource_id, legacy_payload
        ) values (
            project_row.id, v_project_code, request_id,
            'Requested', request_payload->'existingBaseline', request_payload->'proposedBaseline',
            coalesce(request_payload->>'reason', ''), coalesce(request_payload->>'impact', ''),
            coalesce(me.full_name, actor_resource_id), actor_resource_id, request_payload
        );

        return jsonb_build_object(
            'ok', true,
            'operation', operation_name,
            'projectCode', v_project_code,
            'requestId', request_id
        );
    end if;

    if operation_name = 'approve_initial' then
        if latest_found then
            raise exception 'This project already has an approved baseline. Use the rebaseline workflow.' using errcode = '42501';
        end if;

        if exists (
            select 1
              from public.project_plans pp
             where pp.project_code = v_project_code
               and pp.deleted_at is null
               and coalesce(pp.task_type, pp.legacy_payload->>'taskType', '') not in ('Phase', 'Deliverable')
               and (pp.baseline_start_date is null or pp.baseline_end_date is null)
        ) then
            raise exception 'Every task and milestone needs baseline start and finish dates before approval.' using errcode = '22023';
        end if;

        select coalesce(
                   jsonb_agg(
                       jsonb_build_object(
                           'taskId', pp.record_key,
                           'taskName', coalesce(pp.task_name, pp.legacy_payload->>'taskName', ''),
                           'taskType', coalesce(pp.task_type, pp.legacy_payload->>'taskType', ''),
                           'baselineStartDate', coalesce(pp.baseline_start_date::text, ''),
                           'baselineEndDate', coalesce(pp.baseline_end_date::text, ''),
                           'estimatedEffortHours', coalesce(pp.estimated_effort_hours, 0)
                       ) order by pp.created_at, pp.record_key
                   ),
                   '[]'::jsonb
               )
          into task_snapshot
          from public.project_plans pp
         where pp.project_code = v_project_code
           and pp.deleted_at is null;

        baseline_business_version := 1;
        baseline_id := 'BASELINE-' || gen_random_uuid()::text;
        baseline_payload := jsonb_build_object(
            'baselineId', baseline_id,
            'projectCode', v_project_code,
            'version', baseline_business_version,
            'status', 'Approved',
            'reason', coalesce(nullif(btrim(coalesce(p_decision_notes, '')), ''), 'Initial baseline approval'),
            'impact', '',
            'approvedBy', coalesce(me.full_name, actor_resource_id),
            'approvedByResourceId', actor_resource_id,
            'approvalDate', approval_day::text,
            'approvedAt', now_text,
            'taskBaselines', task_snapshot
        );

        perform set_config('ppm.baseline_workflow', 'on', true);
        insert into public.plan_baselines (
            project_id, project_code, record_key, record_version, status, reason, impact,
            approved_by, approved_by_resource_id, approval_date, approved_at,
            task_baselines, legacy_payload
        ) values (
            project_row.id, v_project_code, baseline_id, baseline_business_version, 'Approved',
            baseline_payload->>'reason', '', coalesce(me.full_name, actor_resource_id), actor_resource_id,
            approval_day, now_ts, task_snapshot, baseline_payload
        );

        return jsonb_build_object(
            'ok', true,
            'operation', operation_name,
            'projectCode', v_project_code,
            'baselineId', baseline_id,
            'baselineVersion', baseline_business_version
        );
    end if;

    /* Request decisions use only the database request row. Browser-supplied status,
       proposed dates and requester identity are not trusted at decision time. */
    if p_request is null or jsonb_typeof(p_request) <> 'object' then
        raise exception 'The rebaseline request payload is missing.' using errcode = '22023';
    end if;
    request_id := btrim(coalesce(p_request->>'requestId', ''));
    if request_id = '' then
        raise exception 'The rebaseline decision has no request identifier.' using errcode = '22023';
    end if;

    select br.*
      into request_row
      from public.plan_baseline_requests br
     where br.project_code = v_project_code
       and br.record_key = request_id
       and br.deleted_at is null
     for update;

    if not found then
        raise exception 'Rebaseline request % no longer exists.', request_id using errcode = 'P0002';
    end if;
    if p_expected_request_version is null or request_row.version <> p_expected_request_version then
        raise exception
            'Rebaseline request % changed while you were deciding it (loaded version %, current version %). Reload and reapply the decision.',
            request_id, p_expected_request_version, request_row.version
            using errcode = '40001';
    end if;
    if coalesce(request_row.status, request_row.legacy_payload->>'status', '') <> 'Requested' then
        raise exception 'Rebaseline request % is no longer awaiting a decision.', request_id using errcode = '42501';
    end if;
    if coalesce(request_row.requested_by_resource_id, request_row.legacy_payload->>'requestedByResourceId', '') = actor_resource_id then
        raise exception 'The person who requested the rebaseline cannot approve or reject their own request.' using errcode = '42501';
    end if;

    if operation_name = 'approve_request' then
        if not latest_found then
            raise exception 'The approved baseline no longer exists. Reload before deciding the request.' using errcode = '40001';
        end if;
        if coalesce(request_row.existing_baseline->>'baselineId', '') <> latest_baseline.record_key
           or coalesce(request_row.existing_baseline->>'version', '') <> coalesce(latest_baseline.record_version::text, '') then
            raise exception 'A newer baseline was approved after this request was raised. The request must be reviewed again.' using errcode = '40001';
        end if;

        proposed := coalesce(request_row.proposed_baseline, '[]'::jsonb);
        if jsonb_typeof(proposed) <> 'array' then
            raise exception 'The stored proposed baseline is invalid.' using errcode = '22023';
        end if;

        select count(*), count(distinct btrim(coalesce(x.value->>'taskId', '')))
          into proposed_count, distinct_proposed_count
          from jsonb_array_elements(proposed) as x(value);
        if proposed_count <> distinct_proposed_count then
            raise exception 'The stored proposed baseline contains a duplicate task identifier.' using errcode = '22023';
        end if;

        perform set_config('ppm.baseline_workflow', 'on', true);
        for proposed_item in select x.value from jsonb_array_elements(proposed) as x(value)
        loop
            task_id := btrim(coalesce(proposed_item->>'taskId', ''));
            start_text := btrim(coalesce(proposed_item->>'baselineStartDate', ''));
            end_text := btrim(coalesce(proposed_item->>'baselineEndDate', ''));
            if task_id = '' then
                raise exception 'A stored proposed baseline row has no task identifier.' using errcode = '22023';
            end if;
            if start_text <> '' and end_text <> '' and end_text::date < start_text::date then
                raise exception 'Proposed baseline finish for % cannot be before its start.', task_id using errcode = '22023';
            end if;

            select pp.*
              into plan_row
              from public.project_plans pp
             where pp.project_code = v_project_code
               and pp.record_key = task_id
               and pp.deleted_at is null
             for update;
            if not found then
                raise exception 'Plan item % no longer exists. Reload before approving the rebaseline.', task_id using errcode = '40001';
            end if;

            update public.project_plans
               set baseline_start_date = case when start_text = '' then null else start_text::date end,
                   baseline_end_date = case when end_text = '' then null else end_text::date end,
                   legacy_payload = coalesce(plan_row.legacy_payload, '{}'::jsonb) || jsonb_build_object(
                       'baselineStartDate', start_text,
                       'baselineEndDate', end_text
                   ),
                   version = plan_row.version
             where id = plan_row.id;
            changed_plan_count := changed_plan_count + 1;
        end loop;

        if exists (
            select 1
              from public.project_plans pp
             where pp.project_code = v_project_code
               and pp.deleted_at is null
               and coalesce(pp.task_type, pp.legacy_payload->>'taskType', '') not in ('Phase', 'Deliverable')
               and (pp.baseline_start_date is null or pp.baseline_end_date is null)
        ) then
            raise exception 'An approved rebaseline must retain baseline start and finish dates for every task and milestone.'
                using errcode = '22023';
        end if;

        select coalesce(
                   jsonb_agg(
                       jsonb_build_object(
                           'taskId', pp.record_key,
                           'taskName', coalesce(pp.task_name, pp.legacy_payload->>'taskName', ''),
                           'taskType', coalesce(pp.task_type, pp.legacy_payload->>'taskType', ''),
                           'baselineStartDate', coalesce(pp.baseline_start_date::text, ''),
                           'baselineEndDate', coalesce(pp.baseline_end_date::text, ''),
                           'estimatedEffortHours', coalesce(pp.estimated_effort_hours, 0)
                       ) order by pp.created_at, pp.record_key
                   ),
                   '[]'::jsonb
               )
          into task_snapshot
          from public.project_plans pp
         where pp.project_code = v_project_code
           and pp.deleted_at is null;

        select coalesce(max(pb.record_version), 0)::integer + 1
          into baseline_business_version
          from public.plan_baselines pb
         where pb.project_code = v_project_code
           and pb.deleted_at is null;
        baseline_id := 'BASELINE-' || gen_random_uuid()::text;
        baseline_payload := jsonb_build_object(
            'baselineId', baseline_id,
            'projectCode', v_project_code,
            'version', baseline_business_version,
            'status', 'Approved',
            'reason', coalesce(request_row.reason, request_row.legacy_payload->>'reason', ''),
            'impact', coalesce(request_row.impact, request_row.legacy_payload->>'impact', ''),
            'approvedBy', coalesce(me.full_name, actor_resource_id),
            'approvedByResourceId', actor_resource_id,
            'approvalDate', approval_day::text,
            'approvedAt', now_text,
            'taskBaselines', task_snapshot
        );

        insert into public.plan_baselines (
            project_id, project_code, record_key, record_version, status, reason, impact,
            approved_by, approved_by_resource_id, approval_date, approved_at,
            task_baselines, legacy_payload
        ) values (
            project_row.id, v_project_code, baseline_id, baseline_business_version, 'Approved',
            baseline_payload->>'reason', baseline_payload->>'impact', coalesce(me.full_name, actor_resource_id),
            actor_resource_id, approval_day, now_ts, task_snapshot, baseline_payload
        );
    end if;

    request_payload := coalesce(request_row.legacy_payload, '{}'::jsonb) || jsonb_build_object(
        'status', case when operation_name = 'reject_request' then 'Rejected' else 'Approved' end,
        'approval', case when operation_name = 'reject_request' then 'Rejected' else 'Approved' end,
        'approvedBy', coalesce(me.full_name, actor_resource_id),
        'approvedByResourceId', actor_resource_id,
        'approvalDate', approval_day::text,
        'decisionNotes', coalesce(p_decision_notes, ''),
        'decidedAt', now_text
    );

    perform set_config('ppm.baseline_workflow', 'on', true);
    update public.plan_baseline_requests
       set status = case when operation_name = 'reject_request' then 'Rejected' else 'Approved' end,
           legacy_payload = request_payload,
           version = request_row.version
     where id = request_row.id
     returning version into request_database_version;

    return jsonb_build_object(
        'ok', true,
        'operation', operation_name,
        'projectCode', v_project_code,
        'requestId', request_id,
        'requestDatabaseVersion', request_database_version,
        'baselineId', case when operation_name = 'approve_request' then baseline_id else null end,
        'baselineVersion', case when operation_name = 'approve_request' then baseline_business_version else null end,
        'updatedPlanItems', changed_plan_count
    );
end;
$$;

revoke all on function public.ppm_stage11b_ready() from public, anon;
grant execute on function public.ppm_stage11b_ready() to authenticated;

revoke all on function public.ppm_commit_baseline_workflow(text, text, jsonb, integer, date, text, jsonb)
    from public, anon;
grant execute on function public.ppm_commit_baseline_workflow(text, text, jsonb, integer, date, text, jsonb)
    to authenticated;

commit;
