/* =============================================================================
   PORTFOLIO MANAGER — STAGE 11C
   Transactional financial workflow: Project Financials + Financial Entries
   + Financial Approval Requests

   IMPORTANT FIRST-RUN ORDER:
     1. Start the Stage 11C browser build.
     2. Seed + parity-check financials, financialEntries and financialApprovals.
     3. Only then apply this migration.

   The guards below make budget-approval state workflow-owned. Historical approval
   rows and approved-budget summaries therefore have to exist before the guards are
   installed.

   SAFE TO RE-RUN AFTER THE INITIAL SEED.
   ========================================================================== */

begin;

/* The legacy application models one live financial summary per project and at most
   one live Pending Approval request. Make those invariants concurrency-safe before
   the transactional API starts accepting requests. */
do $$
declare
    duplicate_summary text;
    duplicate_pending text;
begin
    select project_code
      into duplicate_summary
      from public.project_financials
     where deleted_at is null
     group by project_code
    having count(*) > 1
     limit 1;

    if duplicate_summary is not null then
        raise exception
            'Stage 11C cannot install: project % has more than one active financial summary.',
            duplicate_summary
            using errcode = '23505';
    end if;

    select project_code
      into duplicate_pending
      from public.financial_approval_requests
     where deleted_at is null
       and status = 'Pending Approval'
     group by project_code
    having count(*) > 1
     limit 1;

    if duplicate_pending is not null then
        raise exception
            'Stage 11C cannot install: project % has more than one pending financial approval request.',
            duplicate_pending
            using errcode = '23505';
    end if;
end;
$$;

create unique index if not exists project_financials_one_active_per_project_idx
    on public.project_financials (project_code)
    where deleted_at is null;

create unique index if not exists financial_approvals_one_pending_per_project_idx
    on public.financial_approval_requests (project_code)
    where deleted_at is null and status = 'Pending Approval';

/* Approval requests are governance history. After Stage 11C they can only be
   created or decided by the transaction function below. */
create or replace function private.guard_financial_approval_workflow_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if coalesce(current_setting('ppm.financial_workflow', true), '') = 'on' then
        return new;
    end if;

    raise exception
        'Financial approval requests can only be created or decided through the Stage 11C financial workflow.'
        using errcode = '42501';
end;
$$;

drop trigger if exists trg_financial_approval_requests_workflow_guard
    on public.financial_approval_requests;
create trigger trg_financial_approval_requests_workflow_guard
before insert or update on public.financial_approval_requests
for each row execute function private.guard_financial_approval_workflow_write();

/* Ordinary financial editing remains row-level CRUD, but approved-budget state is
   workflow-owned. Protect both the normalized columns and the legacy aliases because
   older pages still read the merged legacy shape. */
create or replace function private.guard_project_financial_approval_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if coalesce(current_setting('ppm.financial_workflow', true), '') = 'on' then
        return new;
    end if;

    if tg_op = 'INSERT' then
        if coalesce(new.approved_budget, 0) <> 0
           or coalesce(new.approved_budget_version, 0) <> 0
           or nullif(btrim(coalesce(new.approved_budget_request_id, '')), '') is not null
           or new.approved_at is not null
           or nullif(btrim(coalesce(new.approved_by_resource_id, '')), '') is not null
           or nullif(btrim(coalesce(new.approved_by, '')), '') is not null
           or coalesce(new.budget_approval_status, '') not in ('', 'No approved budget')
           or coalesce(nullif(new.legacy_payload->>'approvedBudget', '')::numeric, 0) <> 0
           or coalesce(nullif(new.legacy_payload->>'approvedBudgetVersion', '')::numeric, 0) <> 0
           or coalesce(nullif(new.legacy_payload->>'budget', '')::numeric, 0) <> 0
           or nullif(btrim(coalesce(new.legacy_payload->>'approvedBudgetRequestId', '')), '') is not null
           or nullif(btrim(coalesce(new.legacy_payload->>'approvedAt', '')), '') is not null
           or nullif(btrim(coalesce(new.legacy_payload->>'approvedByResourceId', '')), '') is not null
           or nullif(btrim(coalesce(new.legacy_payload->>'approvedBy', '')), '') is not null
           or coalesce(new.legacy_payload->>'budgetApprovalStatus', '') not in ('', 'No approved budget') then
            raise exception
                'Approved-budget fields can only be introduced through the Stage 11C financial workflow.'
                using errcode = '42501';
        end if;
        return new;
    end if;

    if new.approved_budget is distinct from old.approved_budget
       or new.budget_approval_status is distinct from old.budget_approval_status
       or new.approved_budget_version is distinct from old.approved_budget_version
       or new.approved_budget_request_id is distinct from old.approved_budget_request_id
       or new.approved_at is distinct from old.approved_at
       or new.approved_by_resource_id is distinct from old.approved_by_resource_id
       or new.approved_by is distinct from old.approved_by
       or coalesce(new.legacy_payload->>'approvedBudget', '') is distinct from coalesce(old.legacy_payload->>'approvedBudget', '')
       or coalesce(new.legacy_payload->>'budgetApprovalStatus', '') is distinct from coalesce(old.legacy_payload->>'budgetApprovalStatus', '')
       or coalesce(new.legacy_payload->>'approvedBudgetVersion', '') is distinct from coalesce(old.legacy_payload->>'approvedBudgetVersion', '')
       or coalesce(new.legacy_payload->>'approvedBudgetRequestId', '') is distinct from coalesce(old.legacy_payload->>'approvedBudgetRequestId', '')
       or coalesce(new.legacy_payload->>'approvedAt', '') is distinct from coalesce(old.legacy_payload->>'approvedAt', '')
       or coalesce(new.legacy_payload->>'approvedByResourceId', '') is distinct from coalesce(old.legacy_payload->>'approvedByResourceId', '')
       or coalesce(new.legacy_payload->>'approvedBy', '') is distinct from coalesce(old.legacy_payload->>'approvedBy', '')
       or coalesce(new.legacy_payload->>'budget', '') is distinct from coalesce(old.legacy_payload->>'budget', '') then
        raise exception
            'Approved-budget fields can only change through the Stage 11C financial workflow.'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_project_financials_workflow_guard on public.project_financials;
create trigger trg_project_financials_workflow_guard
before insert or update on public.project_financials
for each row execute function private.guard_project_financial_approval_fields();

/* Once the historical rows are seeded, the browser has no reason to write the
   approval table directly at all. The SECURITY DEFINER workflow function below is
   the only mutation path; SELECT remains available under the existing RLS policy. */
revoke insert, update, delete, truncate, references, trigger
    on public.financial_approval_requests from authenticated;
grant select on public.financial_approval_requests to authenticated;
revoke all on public.financial_approval_requests from anon;

/* Readiness probe used by the browser before it allows Stage 11C cutover. */
create or replace function public.ppm_stage11c_ready()
returns boolean
language sql
stable
set search_path = ''
as $$
    select
        coalesce((select auth.jwt()->>'aal'), '') = 'aal2'
        and exists (
            select 1 from pg_catalog.pg_trigger
             where tgname = 'trg_financial_approval_requests_workflow_guard'
               and not tgisinternal
        )
        and exists (
            select 1 from pg_catalog.pg_trigger
             where tgname = 'trg_project_financials_workflow_guard'
               and not tgisinternal
        )
        and not has_table_privilege('authenticated', 'public.financial_approval_requests', 'INSERT')
        and not has_table_privilege('authenticated', 'public.financial_approval_requests', 'UPDATE')
        and not has_table_privilege('authenticated', 'public.financial_approval_requests', 'DELETE')
        and not has_table_privilege('authenticated', 'public.financial_approval_requests', 'TRUNCATE');
$$;

/* One commit boundary for:
     request -> creates the Pending Approval snapshot and marks the summary pending
     approve -> decides the request and applies the approved budget/version
     reject  -> decides the request without changing the approved budget

   Requester and decision-maker identity are always derived from auth.uid(). The
   caller supplies the target approver only when raising a request. */
create or replace function public.ppm_commit_financial_workflow(
    p_operation                    text,
    p_project_code                 text,
    p_request                      jsonb,
    p_expected_request_version     integer,
    p_expected_financial_version   integer,
    p_decision_comments            text,
    p_expected_entry_versions      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me                           record;
    approver_row                 public.people%rowtype;
    project_row                  public.projects%rowtype;
    financial_row                public.project_financials%rowtype;
    approval_row                 public.financial_approval_requests%rowtype;
    entry_row                    record;
    operation_name               text := lower(btrim(coalesce(p_operation, '')));
    v_project_code               text := btrim(coalesce(p_project_code, ''));
    actor_resource_id            text;
    v_approver_resource_id         text;
    reason_text                  text;
    comments_text                text := btrim(coalesce(p_decision_comments, ''));
    approval_id                  text;
    v_request_type                 text;
    now_ts                       timestamptz := clock_timestamp();
    now_text                     text;
    entry_count                  integer := 0;
    expected_entry_count         integer := 0;
    expected_entry_version       integer;
    v_current_approved_budget      numeric := 0;
    next_approved_budget         numeric := 0;
    next_business_version        integer := 0;
    v_proposed_budget            numeric := 0;
    v_forecast_cost              numeric := 0;
    v_actual_cost                numeric := 0;
    v_committed_cost             numeric := 0;
    v_remaining_forecast         numeric := 0;
    v_contingency                numeric := 0;
    v_estimate_at_completion     numeric := 0;
    v_budget_variance            numeric := 0;
    v_budget_variance_percentage numeric := 0;
    v_financial_rag              text;
    v_change_amount              numeric := 0;
    v_change_percentage          numeric := 0;
    current_budget_snapshot      jsonb := '[]'::jsonb;
    stored_budget_snapshot_raw   jsonb := '[]'::jsonb;
    stored_budget_snapshot       jsonb := '[]'::jsonb;
    approval_payload             jsonb;
    summary_payload              jsonb;
    approval_database_version    integer := null;
    financial_database_version   integer := null;
    approver_can_approve         boolean := false;
    approver_can_view            boolean := false;
    approver_can_access_project  boolean := false;
begin
    if (select auth.uid()) is null then
        raise exception 'You must be signed in to use the financial workflow.' using errcode = '42501';
    end if;

    if coalesce((select auth.jwt()->>'aal'), '') <> 'aal2' then
        raise exception 'MFA verification is required to use the financial workflow.' using errcode = '42501';
    end if;

    select p.id, p.legacy_resource_id, p.full_name, p.email, p.access_role
      into me
      from public.people p
     where p.auth_user_id = (select auth.uid())
       and p.active = true
       and coalesce(p.account_status, 'Active') = 'Active'
     limit 1;

    if not found or nullif(btrim(coalesce(me.legacy_resource_id, '')), '') is null then
        raise exception 'Your sign-in is not linked to an active portfolio resource.' using errcode = '42501';
    end if;
    actor_resource_id := me.legacy_resource_id;
    now_text := to_char(now_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

    if v_project_code = '' then
        raise exception 'The financial workflow requires a project code.' using errcode = '22023';
    end if;
    if operation_name not in ('request', 'approve', 'reject') then
        raise exception 'Unknown financial workflow operation: %.', coalesce(operation_name, '') using errcode = '22023';
    end if;

    select pr.*
      into project_row
      from public.projects pr
     where pr.project_code = v_project_code
     for update;
    if not found then
        raise exception 'Project % could not be found.', v_project_code using errcode = 'P0002';
    end if;
    if coalesce(project_row.archived, false) then
        raise exception 'Archived projects are read-only.' using errcode = '42501';
    end if;
    if not private.can_access_project(v_project_code) then
        raise exception 'You do not have access to project %.', v_project_code using errcode = '42501';
    end if;

    if operation_name = 'request' then
        if not private.has_permission('financials.edit') then
            raise exception 'You do not have permission to request budget approval.' using errcode = '42501';
        end if;
    else
        if not private.has_permission('financials.approve') then
            raise exception 'You do not have permission to decide budget approvals.' using errcode = '42501';
        end if;
    end if;

    select pf.*
      into financial_row
      from public.project_financials pf
     where pf.project_code = v_project_code
       and pf.deleted_at is null
     for update;
    if not found then
        raise exception 'Save the project cost plan before using budget approval.' using errcode = '22023';
    end if;
    if p_expected_financial_version is null or financial_row.version <> p_expected_financial_version then
        raise exception
            'The financial summary changed while the approval workflow was open (loaded version %, current version %). Reload and reapply the action.',
            p_expected_financial_version, financial_row.version
            using errcode = '40001';
    end if;

    v_current_approved_budget := round(coalesce(financial_row.approved_budget, 0), 2);

    /* Lock all active cost-plan rows before calculating a request snapshot or
       applying a decision. This prevents a budget line from changing midway through
       the approval transaction. */
    for entry_row in
        select fe.record_key, fe.version
          from public.financial_entries fe
         where fe.project_code = v_project_code
           and fe.deleted_at is null
         order by fe.record_key
         for update
    loop
        entry_count := entry_count + 1;
        if operation_name = 'request' then
            if p_expected_entry_versions is null or jsonb_typeof(p_expected_entry_versions) <> 'object' then
                raise exception 'Reload the cost plan before requesting approval.' using errcode = '40001';
            end if;
            begin
                expected_entry_version := nullif(p_expected_entry_versions->>entry_row.record_key, '')::integer;
            exception when others then
                expected_entry_version := null;
            end;
            if expected_entry_version is null or expected_entry_version <> entry_row.version then
                raise exception
                    'Financial entry % changed while the approval request was being prepared. Reload and review the cost plan.',
                    entry_row.record_key
                    using errcode = '40001';
            end if;
        end if;
    end loop;

    select
        round(coalesce(sum(coalesce(fe.budget_amount, 0)), 0), 2),
        round(coalesce(sum(coalesce(fe.forecast_cost, 0)), 0), 2),
        round(coalesce(sum(coalesce(fe.actual_cost, 0)), 0), 2),
        round(coalesce(sum(coalesce(fe.committed_cost, 0)), 0), 2),
        round(coalesce(sum(greatest(coalesce(fe.forecast_cost, 0) - coalesce(fe.actual_cost, 0), 0)), 0), 2),
        round(coalesce(sum(case when lower(coalesce(fe.category_name, '')) = 'contingency' then coalesce(fe.forecast_cost, 0) else 0 end), 0), 2),
        coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'financialEntryId', fe.record_key,
                    'categoryId', coalesce(fe.category_id, ''),
                    'categoryName', coalesce(fe.category_name, ''),
                    'description', coalesce(fe.description, ''),
                    'budgetAmount', round(coalesce(fe.budget_amount, 0), 2)
                ) order by fe.record_key
            ),
            '[]'::jsonb
        )
      into v_proposed_budget, v_forecast_cost, v_actual_cost, v_committed_cost,
           v_remaining_forecast, v_contingency, current_budget_snapshot
      from public.financial_entries fe
     where fe.project_code = v_project_code
       and fe.deleted_at is null;

    v_estimate_at_completion := round(v_actual_cost + v_remaining_forecast, 2);

    if operation_name = 'request' then
        select count(*)
          into expected_entry_count
          from jsonb_object_keys(coalesce(p_expected_entry_versions, '{}'::jsonb));
        if expected_entry_count <> entry_count then
            raise exception
                'The cost plan changed while the approval request was being prepared. Reload and review the current lines.'
                using errcode = '40001';
        end if;
        if entry_count = 0 or v_proposed_budget <= 0 then
            raise exception 'Add and save at least one positive budget line before requesting approval.' using errcode = '22023';
        end if;
        if round(coalesce(financial_row.proposed_budget, 0), 2) <> v_proposed_budget then
            raise exception
                'The saved financial summary does not match the current cost plan. Save the cost plan again before requesting approval.'
                using errcode = '40001';
        end if;
        if exists (
            select 1
              from public.financial_approval_requests far
             where far.project_code = v_project_code
               and far.deleted_at is null
               and far.status = 'Pending Approval'
        ) then
            raise exception 'This project already has a budget request awaiting a decision.' using errcode = '23505';
        end if;

        reason_text := btrim(coalesce(p_request->>'reason', ''));
        v_approver_resource_id := btrim(coalesce(p_request->>'approverResourceId', ''));
        if reason_text = '' then
            raise exception 'Record the reason and impact for the budget request.' using errcode = '22023';
        end if;
        if v_approver_resource_id = '' then
            raise exception 'Select an authorised budget approver.' using errcode = '22023';
        end if;
        if v_approver_resource_id = actor_resource_id then
            raise exception 'The budget approver must be different from the requester.' using errcode = '42501';
        end if;

        select ap.*
          into approver_row
          from public.people ap
         where ap.legacy_resource_id = v_approver_resource_id
           and ap.active = true
           and coalesce(ap.account_status, 'Active') = 'Active'
         limit 1;
        if not found then
            raise exception 'The selected budget approver is not an active resource.' using errcode = '42501';
        end if;
        if approver_row.auth_user_id is null then
            raise exception 'The selected budget approver does not have a linked sign-in account.' using errcode = '42501';
        end if;

        approver_can_approve := case
            when approver_row.permission_overrides->>'financials.approve' = 'allow' then true
            when approver_row.permission_overrides->>'financials.approve' = 'deny' then false
            else exists (
                select 1
                  from private.role_permissions rp
                 where rp.role_name = approver_row.access_role
                   and rp.permission_key = 'financials.approve'
            )
        end;
        if not approver_can_approve then
            raise exception 'The selected resource does not have financial approval permission.' using errcode = '42501';
        end if;

        /* The approval page itself is protected by financials.viewDetail. Reject an
           assignment that the selected approver could never open in the UI. */
        approver_can_view := case
            when approver_row.permission_overrides->>'financials.viewDetail' = 'allow' then true
            when approver_row.permission_overrides->>'financials.viewDetail' = 'deny' then false
            else exists (
                select 1
                  from private.role_permissions rp
                 where rp.role_name = approver_row.access_role
                   and rp.permission_key = 'financials.viewDetail'
            )
        end;
        if not approver_can_view then
            raise exception 'The selected budget approver cannot view detailed financial records.' using errcode = '42501';
        end if;

        /* Mirror private.can_access_project for the selected approver rather than
           creating a request that they will later be unable to read or decide. */
        approver_can_access_project :=
            coalesce(approver_row.access_scope, 'Selected projects') = 'Portfolio-wide'
            or v_project_code = any(coalesce(approver_row.selected_project_codes, '{}'::text[]))
            or project_row.project_manager_id = approver_row.id
            or project_row.sponsor_id = approver_row.id
            or project_row.project_lead_id = approver_row.id
            or (
                approver_row.legacy_resource_id is not null
                and approver_row.legacy_resource_id = any(array_remove(array[
                    project_row.legacy_payload ->> 'projectManagerResourceId',
                    project_row.legacy_payload ->> 'sponsorResourceId',
                    project_row.legacy_payload ->> 'projectLeadResourceId',
                    project_row.legacy_payload ->> 'deputyProjectManagerResourceId',
                    project_row.legacy_payload ->> 'businessAnalystResourceId',
                    project_row.legacy_payload ->> 'technicalLeadResourceId',
                    project_row.legacy_payload ->> 'benefitOwnerResourceId',
                    project_row.legacy_payload ->> 'financialOwnerResourceId',
                    project_row.legacy_payload ->> 'createdByResourceId'
                ], null))
            )
            or (
                coalesce(approver_row.access_scope, 'Selected projects') = 'Team projects'
                and nullif(btrim(lower(coalesce(approver_row.team, ''))), '') is not null
                and exists (
                    select 1
                      from public.people tm
                     where nullif(btrim(lower(coalesce(tm.team, ''))), '') =
                           nullif(btrim(lower(coalesce(approver_row.team, ''))), '')
                       and (
                           project_row.project_manager_id = tm.id
                           or project_row.sponsor_id = tm.id
                           or project_row.project_lead_id = tm.id
                           or (
                               tm.legacy_resource_id is not null
                               and tm.legacy_resource_id = any(array_remove(array[
                                   project_row.legacy_payload ->> 'projectManagerResourceId',
                                   project_row.legacy_payload ->> 'sponsorResourceId',
                                   project_row.legacy_payload ->> 'projectLeadResourceId'
                               ], null))
                           )
                       )
                )
            );
        if not approver_can_access_project then
            raise exception 'The selected budget approver does not have access to this project.' using errcode = '42501';
        end if;

        v_request_type := case when coalesce(financial_row.approved_budget_version, 0) > 0 then 'Budget Change' else 'Initial Budget' end;
        v_change_amount := round(v_proposed_budget - v_current_approved_budget, 2);
        v_change_percentage := case
            when v_current_approved_budget = 0 then 0
            else round((v_change_amount / v_current_approved_budget) * 100, 2)
        end;
        approval_id := 'FAP-' || gen_random_uuid()::text;

        approval_payload := jsonb_build_object(
            'approvalId', approval_id,
            'projectCode', v_project_code,
            'requestType', v_request_type,
            'currentApprovedBudget', v_current_approved_budget,
            'proposedBudget', v_proposed_budget,
            'changeAmount', v_change_amount,
            'changePercentage', v_change_percentage,
            'reason', reason_text,
            'requesterResourceId', actor_resource_id,
            'requesterName', coalesce(me.full_name, actor_resource_id),
            'requesterEmail', coalesce(me.email, ''),
            'approverResourceId', v_approver_resource_id,
            'approverName', coalesce(approver_row.full_name, v_approver_resource_id),
            'approverEmail', coalesce(approver_row.email, ''),
            'status', 'Pending Approval',
            'requestedAt', now_text,
            'decisionAt', '',
            'decisionByResourceId', '',
            'decisionByName', '',
            'decisionComments', '',
            'budgetSnapshot', current_budget_snapshot,
            'createdAt', now_text,
            'updatedAt', now_text
        );

        perform set_config('ppm.financial_workflow', 'on', true);
        insert into public.financial_approval_requests (
            project_id, project_code, record_key, request_type,
            current_approved_budget, proposed_budget, change_amount, change_percentage,
            reason, requester_resource_id, requester_name, requester_email,
            approver_resource_id, approver_name, approver_email,
            status, requested_at, decision_at, decision_by_resource_id,
            decision_by_name, decision_comments, budget_snapshot, legacy_payload
        ) values (
            project_row.id, v_project_code, approval_id, v_request_type,
            v_current_approved_budget, v_proposed_budget, v_change_amount, v_change_percentage,
            reason_text, actor_resource_id, coalesce(me.full_name, actor_resource_id), coalesce(me.email, ''),
            v_approver_resource_id, coalesce(approver_row.full_name, v_approver_resource_id), coalesce(approver_row.email, ''),
            'Pending Approval', now_ts, null, '', '', '', current_budget_snapshot, approval_payload
        )
        returning version into approval_database_version;

        v_budget_variance := round(v_current_approved_budget - v_estimate_at_completion, 2);
        v_budget_variance_percentage := case
            when v_current_approved_budget = 0 then 0
            else round((v_budget_variance / v_current_approved_budget) * 100, 2)
        end;
        v_financial_rag := case
            when v_current_approved_budget = 0 then
                case
                    when nullif(coalesce(financial_row.financial_rag, ''), '') is not null
                         and financial_row.financial_rag <> 'Not Assessed'
                        then financial_row.financial_rag
                    else 'Not Assessed'
                end
            when v_budget_variance < 0 then 'Red'
            when v_budget_variance_percentage < 5 then 'Amber'
            else 'Green'
        end;

        summary_payload := coalesce(financial_row.legacy_payload, '{}'::jsonb) || jsonb_build_object(
            'proposedBudget', v_proposed_budget,
            'approvedBudget', v_current_approved_budget,
            'forecastCost', v_forecast_cost,
            'actualCost', v_actual_cost,
            'committedCost', v_committed_cost,
            'remainingForecast', v_remaining_forecast,
            'contingency', v_contingency,
            'estimateAtCompletion', v_estimate_at_completion,
            'budgetVariance', v_budget_variance,
            'budgetVariancePercentage', v_budget_variance_percentage,
            'budgetVariancePercentageAvailable', v_current_approved_budget <> 0,
            'financialRag', v_financial_rag,
            'budgetApprovalStatus', 'Pending Approval',
            'approvedBudgetRequestId', approval_id,
            'lastFinancialUpdateDate', current_date::text,
            'budget', v_current_approved_budget,
            'forecast', v_forecast_cost,
            'actual', v_actual_cost,
            'commitments', v_committed_cost,
            'variance', v_budget_variance,
            'lastUpdated', current_date::text,
            'updatedAt', now_text
        );

        update public.project_financials
           set proposed_budget = v_proposed_budget,
               forecast_cost = v_forecast_cost,
               actual_cost = v_actual_cost,
               committed_cost = v_committed_cost,
               remaining_forecast = v_remaining_forecast,
               contingency = v_contingency,
               estimate_at_completion = v_estimate_at_completion,
               budget_variance = v_budget_variance,
               budget_variance_percentage = v_budget_variance_percentage,
               budget_variance_percentage_available = (v_current_approved_budget <> 0),
               financial_rag = v_financial_rag,
               budget_approval_status = 'Pending Approval',
               approved_budget_request_id = approval_id,
               last_financial_update_date = current_date,
               legacy_payload = summary_payload,
               version = financial_row.version
         where id = financial_row.id
         returning version into financial_database_version;

        return jsonb_build_object(
            'ok', true,
            'operation', operation_name,
            'projectCode', v_project_code,
            'approvalId', approval_id,
            'approvalDatabaseVersion', approval_database_version,
            'financialDatabaseVersion', financial_database_version,
            'requestType', v_request_type,
            'currentApprovedBudget', v_current_approved_budget,
            'proposedBudget', v_proposed_budget
        );
    end if;

    /* Decision path. The caller identifies the request but cannot supply the actor,
       decision status fields, proposed budget or approved-budget version. */
    approval_id := btrim(coalesce(p_request->>'approvalId', ''));
    if approval_id = '' then
        raise exception 'The financial approval request has no identifier.' using errcode = '22023';
    end if;
    if comments_text = '' then
        raise exception 'Record the approval or rejection comments.' using errcode = '22023';
    end if;

    select far.*
      into approval_row
      from public.financial_approval_requests far
     where far.project_code = v_project_code
       and far.record_key = approval_id
       and far.deleted_at is null
     for update;
    if not found then
        raise exception 'Financial approval request % could not be found.', approval_id using errcode = 'P0002';
    end if;
    if p_expected_request_version is null or approval_row.version <> p_expected_request_version then
        raise exception
            'Financial approval request % changed while you were deciding it (loaded version %, current version %). Reload and reapply the decision.',
            approval_id, p_expected_request_version, approval_row.version
            using errcode = '40001';
    end if;
    if coalesce(approval_row.status, approval_row.legacy_payload->>'status', '') <> 'Pending Approval' then
        raise exception 'Only pending budget requests can be decided.' using errcode = '42501';
    end if;
    if coalesce(approval_row.approver_resource_id, approval_row.legacy_payload->>'approverResourceId', '') <> actor_resource_id then
        raise exception 'Only the assigned approver can decide this request.' using errcode = '42501';
    end if;
    if coalesce(approval_row.requester_resource_id, approval_row.legacy_payload->>'requesterResourceId', '') = actor_resource_id then
        raise exception 'The requester cannot approve or reject their own budget request.' using errcode = '42501';
    end if;

    if operation_name = 'approve' then
        stored_budget_snapshot_raw := coalesce(
            approval_row.budget_snapshot,
            approval_row.legacy_payload->'budgetSnapshot',
            '[]'::jsonb
        );
        if jsonb_typeof(stored_budget_snapshot_raw) <> 'array' then
            raise exception 'The stored budget approval snapshot is invalid.' using errcode = '22023';
        end if;

        select coalesce(
                   jsonb_agg(
                       jsonb_build_object(
                           'financialEntryId', coalesce(x.value->>'financialEntryId', ''),
                           'categoryId', coalesce(x.value->>'categoryId', ''),
                           'categoryName', coalesce(x.value->>'categoryName', ''),
                           'description', coalesce(x.value->>'description', ''),
                           'budgetAmount', round(coalesce(nullif(x.value->>'budgetAmount', '')::numeric, 0), 2)
                       ) order by coalesce(x.value->>'financialEntryId', '')
                   ),
                   '[]'::jsonb
               )
          into stored_budget_snapshot
          from jsonb_array_elements(stored_budget_snapshot_raw) as x(value);

        if stored_budget_snapshot is distinct from current_budget_snapshot then
            raise exception
                'The budget lines changed after this approval request was raised. Reject it and submit a new request from the current cost plan.'
                using errcode = '40001';
        end if;
        if round(coalesce(approval_row.current_approved_budget, 0), 2) <> v_current_approved_budget then
            raise exception
                'The approved budget changed after this request was raised. Reload and review the request.'
                using errcode = '40001';
        end if;
        next_approved_budget := round(coalesce(approval_row.proposed_budget, 0), 2);
        if next_approved_budget <= 0 then
            raise exception 'A positive proposed budget is required for approval.' using errcode = '22023';
        end if;
        next_business_version := coalesce(financial_row.approved_budget_version, 0)::integer + 1;
    else
        next_approved_budget := v_current_approved_budget;
        next_business_version := coalesce(financial_row.approved_budget_version, 0)::integer;
    end if;

    v_budget_variance := round(next_approved_budget - v_estimate_at_completion, 2);
    v_budget_variance_percentage := case
        when next_approved_budget = 0 then 0
        else round((v_budget_variance / next_approved_budget) * 100, 2)
    end;
    v_financial_rag := case
        when next_approved_budget = 0 then
            case
                when nullif(coalesce(financial_row.financial_rag, ''), '') is not null
                     and financial_row.financial_rag <> 'Not Assessed'
                    then financial_row.financial_rag
                else 'Not Assessed'
            end
        when v_budget_variance < 0 then 'Red'
        when v_budget_variance_percentage < 5 then 'Amber'
        else 'Green'
    end;

    approval_payload := coalesce(approval_row.legacy_payload, '{}'::jsonb) || jsonb_build_object(
        'status', case when operation_name = 'approve' then 'Approved' else 'Rejected' end,
        'decisionAt', now_text,
        'decisionByResourceId', actor_resource_id,
        'decisionByName', coalesce(me.full_name, actor_resource_id),
        'decisionComments', comments_text,
        'updatedAt', now_text
    );

    perform set_config('ppm.financial_workflow', 'on', true);
    update public.financial_approval_requests
       set status = case when operation_name = 'approve' then 'Approved' else 'Rejected' end,
           decision_at = now_ts,
           decision_by_resource_id = actor_resource_id,
           decision_by_name = coalesce(me.full_name, actor_resource_id),
           decision_comments = comments_text,
           legacy_payload = approval_payload,
           version = approval_row.version
     where id = approval_row.id
     returning version into approval_database_version;

    summary_payload := coalesce(financial_row.legacy_payload, '{}'::jsonb) || jsonb_build_object(
        'proposedBudget', v_proposed_budget,
        'approvedBudget', next_approved_budget,
        'forecastCost', v_forecast_cost,
        'actualCost', v_actual_cost,
        'committedCost', v_committed_cost,
        'remainingForecast', v_remaining_forecast,
        'contingency', v_contingency,
        'estimateAtCompletion', v_estimate_at_completion,
        'budgetVariance', v_budget_variance,
        'budgetVariancePercentage', v_budget_variance_percentage,
        'budgetVariancePercentageAvailable', next_approved_budget <> 0,
        'financialRag', v_financial_rag,
        'budgetApprovalStatus', case when operation_name = 'approve' then 'Approved' else 'Rejected' end,
        'approvedBudgetVersion', next_business_version,
        'approvedBudgetRequestId', approval_id,
        'lastFinancialUpdateDate', current_date::text,
        'budget', next_approved_budget,
        'forecast', v_forecast_cost,
        'actual', v_actual_cost,
        'commitments', v_committed_cost,
        'variance', v_budget_variance,
        'lastUpdated', current_date::text,
        'updatedAt', now_text
    );

    if operation_name = 'approve' then
        summary_payload := summary_payload || jsonb_build_object(
            'approvedAt', now_text,
            'approvedByResourceId', actor_resource_id,
            'approvedBy', coalesce(me.full_name, actor_resource_id)
        );

        update public.project_financials
           set proposed_budget = v_proposed_budget,
               approved_budget = next_approved_budget,
               forecast_cost = v_forecast_cost,
               actual_cost = v_actual_cost,
               committed_cost = v_committed_cost,
               remaining_forecast = v_remaining_forecast,
               contingency = v_contingency,
               estimate_at_completion = v_estimate_at_completion,
               budget_variance = v_budget_variance,
               budget_variance_percentage = v_budget_variance_percentage,
               budget_variance_percentage_available = (next_approved_budget <> 0),
               financial_rag = v_financial_rag,
               budget_approval_status = 'Approved',
               approved_budget_version = next_business_version,
               approved_budget_request_id = approval_id,
               approved_at = now_ts,
               approved_by_resource_id = actor_resource_id,
               approved_by = coalesce(me.full_name, actor_resource_id),
               last_financial_update_date = current_date,
               legacy_payload = summary_payload,
               version = financial_row.version
         where id = financial_row.id
         returning version into financial_database_version;
    else
        update public.project_financials
           set proposed_budget = v_proposed_budget,
               forecast_cost = v_forecast_cost,
               actual_cost = v_actual_cost,
               committed_cost = v_committed_cost,
               remaining_forecast = v_remaining_forecast,
               contingency = v_contingency,
               estimate_at_completion = v_estimate_at_completion,
               budget_variance = v_budget_variance,
               budget_variance_percentage = v_budget_variance_percentage,
               budget_variance_percentage_available = (next_approved_budget <> 0),
               financial_rag = v_financial_rag,
               budget_approval_status = 'Rejected',
               approved_budget_request_id = approval_id,
               last_financial_update_date = current_date,
               legacy_payload = summary_payload,
               version = financial_row.version
         where id = financial_row.id
         returning version into financial_database_version;
    end if;

    return jsonb_build_object(
        'ok', true,
        'operation', operation_name,
        'projectCode', v_project_code,
        'approvalId', approval_id,
        'status', case when operation_name = 'approve' then 'Approved' else 'Rejected' end,
        'approvalDatabaseVersion', approval_database_version,
        'financialDatabaseVersion', financial_database_version,
        'approvedBudget', next_approved_budget,
        'approvedBudgetVersion', next_business_version
    );
end;
$$;

revoke all on function public.ppm_stage11c_ready() from public, anon;
grant execute on function public.ppm_stage11c_ready() to authenticated;

revoke all on function public.ppm_commit_financial_workflow(text, text, jsonb, integer, integer, text, jsonb)
    from public, anon;
grant execute on function public.ppm_commit_financial_workflow(text, text, jsonb, integer, integer, text, jsonb)
    to authenticated;

commit;
