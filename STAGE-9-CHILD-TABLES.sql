/* =============================================================================
   PORTFOLIO MANAGER — STAGE 9
   The 18 project-scoped collections

   Columns were generated from the real records in
   portfolio-manager-backup-2026-08-07-14-52.json, not inferred from the code.

   Ten collections held records and are modelled with typed columns. Every column
   is nullable: eight of those ten contained exactly one record, which is enough
   to prove a field exists but not that it is ever required.

   Eight collections were empty or absent from the backup. They get the standard
   scaffold only - project scoping, record key, legacy_payload, version - so they
   are under row-level security, auditing and optimistic locking immediately, and
   can be normalised once they hold real data. Nothing about them is guessed.

   Every table follows the pattern established in Stages 3F to 8:
     project_code scoping via private.can_access_project
     AAL2 required to read or write
     permission-gated policies
     optimistic locking on version, immutable record keys
     INSERT and UPDATE only - never DELETE
     audit triggers

   SAFE TO RE-RUN.
   ========================================================================== */

begin;

/* ---------- helpers for the child tables ---------- */

/*
  The child tables are identified by (project_code, record_key) rather than by a
  single business code. Both are fixed once created: record_key is referenced by
  the legacy collections that have not migrated, and moving a row to a different
  project would silently move work between projects and past a scope check.
*/
create or replace function private.protect_child_key()
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
    if NEW.project_code is distinct from OLD.project_code then
        raise exception 'A % record cannot be moved to a different project (% to %).',
            TG_TABLE_NAME, OLD.project_code, NEW.project_code using errcode = '42501';
    end if;
    if NEW.legacy_payload is null and OLD.legacy_payload is not null then
        NEW.legacy_payload := OLD.legacy_payload;
    end if;
    return NEW;
end;
$$;

/*
  Same contract as private.record_audit, but keyed on (project_code, record_key).
  Kept separate rather than branching inside one function so neither has to know
  about the other's shape.
*/
create or replace function private.record_child_audit()
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
    skip_fields text[] := array['legacy_payload','import_payload','updated_at','created_at','version','id','project_id'];
begin
    select p.id, p.full_name, p.email, p.access_role
      into me from public.people p
     where p.auth_user_id = (select auth.uid()) limit 1;

    key_text := coalesce(NEW.project_code, OLD.project_code) || ' / ' || coalesce(NEW.record_key, OLD.record_key);

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

/*
  audit_log.record_key now carries "PRJ-00001 / TSK-0003" for child rows, so the
  project-scope branch of the read policy has to match on the prefix rather than
  on the whole value. Rewritten rather than extended so there is one rule.
*/
drop policy if exists "users can read audit history" on public.audit_log;
create policy "users can read audit history" on public.audit_log
    for select to authenticated
    using (
        (select private.has_permission('audit.view'))
        or (select private.can_access_project(split_part(record_key, ' / ', 1)))
    );



/* ---------- ppmProjectPlans -> public.project_plans (modelled from 3 record(s)) */
create table if not exists public.project_plans (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    phase                              text,            -- phase
    task_name                          text,            -- taskName
    task_owner                         text,            -- taskOwner
    task_owner_resource_id             text,            -- taskOwnerResourceId
    task_owner_email                   text,            -- taskOwnerEmail
    duration_days                      numeric,         -- durationDays
    allocation_percentage              numeric,         -- allocationPercentage
    baseline_start_date                date,            -- baselineStartDate
    baseline_end_date                  date,            -- baselineEndDate
    forecast_start_date                date,            -- forecastStartDate
    forecast_end_date                  date,            -- forecastEndDate
    status                             text,            -- status
    percentage_complete                numeric,         -- percentageComplete
    reason_for_slippage                text,            -- reasonForSlippage
    return_to_green                    text,            -- returnToGreen
    notes                              text,            -- notes
    task_type                          text,            -- taskType
    parent_task_id                     text,            -- parentTaskId
    deliverable                        text,            -- deliverable
    supporting_contributor_ids         jsonb,           -- supportingContributorIds
    priority                           text,            -- priority
    actual_start_date                  text,            -- actualStartDate
    actual_end_date                    text,            -- actualEndDate
    estimated_effort_hours             numeric,         -- estimatedEffortHours
    remaining_effort_hours             numeric,         -- remainingEffortHours
    dependencies                       jsonb,           -- dependencies
    critical_path                      boolean,         -- criticalPath
    slippage_impact                    text,            -- slippageImpact
    recovery_not_possible              boolean,         -- recoveryNotPossible
    mandatory                          boolean,         -- mandatory
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists project_plans_project_idx on public.project_plans (project_code);
alter table public.project_plans enable row level security;

/* ---------- ppmProjectMilestones -> public.project_milestones (modelled from 1 record(s)) */
create table if not exists public.project_milestones (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    milestone_name                     text,            -- milestoneName
    milestone_type                     text,            -- milestoneType
    percentage_complete                numeric,         -- percentageComplete
    baseline_start_date                date,            -- baselineStartDate
    baseline_finish_date               date,            -- baselineFinishDate
    forecast_start_date                date,            -- forecastStartDate
    forecast_finish_date               date,            -- forecastFinishDate
    notes                              text,            -- notes
    status                             text,            -- status
    status_updated_at                  timestamptz,     -- statusUpdatedAt
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists project_milestones_project_idx on public.project_milestones (project_code);
alter table public.project_milestones enable row level security;

/* ---------- ppmProjectRaid -> public.project_raid (modelled from 1 record(s)) */
create table if not exists public.project_raid (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    type                               text,            -- type
    title                              text,            -- title
    status                             text,            -- status
    description                        text,            -- description
    owner                              text,            -- owner
    raised_by                          text,            -- raisedBy
    date_raised                        date,            -- dateRaised
    target_date                        date,            -- targetDate
    priority                           text,            -- priority
    escalation_status                  text,            -- escalationStatus
    last_reviewed_date                 date,            -- lastReviewedDate
    related_tasks                      text,            -- relatedTasks
    related_actions                    text,            -- relatedActions
    attachments                        text,            -- attachments
    comments                           text,            -- comments
    date_closed                        text,            -- dateClosed
    closure_evidence                   text,            -- closureEvidence
    risk_cause                         text,            -- riskCause
    risk_event                         text,            -- riskEvent
    risk_effect                        text,            -- riskEffect
    inherent_probability               text,            -- inherentProbability
    inherent_impact                    text,            -- inherentImpact
    inherent_score                     text,            -- inherentScore
    mitigation                         text,            -- mitigation
    contingency                        text,            -- contingency
    residual_probability               text,            -- residualProbability
    residual_impact                    text,            -- residualImpact
    residual_score                     text,            -- residualScore
    risk_appetite_position             text,            -- riskAppetitePosition
    escalation_threshold               text,            -- escalationThreshold
    risk_trend                         text,            -- riskTrend
    review_frequency                   text,            -- reviewFrequency
    date_identified                    text,            -- dateIdentified
    business_impact                    text,            -- businessImpact
    delivery_impact                    text,            -- deliveryImpact
    root_cause                         text,            -- rootCause
    resolution_plan                    text,            -- resolutionPlan
    resolution_owner                   text,            -- resolutionOwner
    expected_resolution_date           text,            -- expectedResolutionDate
    actual_resolution_date             text,            -- actualResolutionDate
    workaround                         text,            -- workaround
    decision_required                  text,            -- decisionRequired
    dependency_scope                   text,            -- dependencyScope
    dependency_direction               text,            -- dependencyDirection
    provider                           text,            -- provider
    recipient                          text,            -- recipient
    required_by_date                   text,            -- requiredByDate
    dependency_confidence              text,            -- dependencyConfidence
    impact_if_missed                   text,            -- impactIfMissed
    related_project                    text,            -- relatedProject
    related_milestone                  text,            -- relatedMilestone
    acceptance_criteria                text,            -- acceptanceCriteria
    audit_history                      jsonb,           -- auditHistory
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists project_raid_project_idx on public.project_raid (project_code);
alter table public.project_raid enable row level security;

/* ---------- ppmProjectActions -> public.project_actions (scaffold only - no data in the backup) */
create table if not exists public.project_actions (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists project_actions_project_idx on public.project_actions (project_code);
alter table public.project_actions enable row level security;

/* ---------- ppmProjectDecisions -> public.project_decisions (modelled from 1 record(s)) */
create table if not exists public.project_decisions (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    status                             text,            -- status
    decision_owner                     text,            -- decisionOwner
    decision_owner_resource_id         text,            -- decisionOwnerResourceId
    decision_owner_email               text,            -- decisionOwnerEmail
    recommendation                     text,            -- recommendation
    options_considered                 text,            -- optionsConsidered
    background                         text,            -- background
    decision_required                  text,            -- decisionRequired
    required_by_date                   date,            -- requiredByDate
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists project_decisions_project_idx on public.project_decisions (project_code);
alter table public.project_decisions enable row level security;

/* ---------- ppmProjectFinancials -> public.project_financials (modelled from 1 record(s)) */
create table if not exists public.project_financials (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    proposed_budget                    numeric,         -- proposedBudget
    approved_budget                    numeric,         -- approvedBudget
    forecast_cost                      numeric,         -- forecastCost
    actual_cost                        numeric,         -- actualCost
    committed_cost                     numeric,         -- committedCost
    remaining_forecast                 numeric,         -- remainingForecast
    contingency                        numeric,         -- contingency
    estimate_at_completion             numeric,         -- estimateAtCompletion
    budget_variance                    numeric,         -- budgetVariance
    budget_variance_percentage         numeric,         -- budgetVariancePercentage
    budget_variance_percentage_available boolean,       -- budgetVariancePercentageAvailable
    currency                           text,            -- currency
    funding_source                     text,            -- fundingSource
    financial_owner                    text,            -- financialOwner
    financial_owner_resource_id        text,            -- financialOwnerResourceId
    financial_owner_email              text,            -- financialOwnerEmail
    financial_commentary               text,            -- financialCommentary
    financial_rag                      text,            -- financialRag
    budget_approval_status             text,            -- budgetApprovalStatus
    approved_budget_version            numeric,         -- approvedBudgetVersion
    last_financial_update_date         date,            -- lastFinancialUpdateDate
    approved_budget_request_id         text,            -- approvedBudgetRequestId
    approved_at                        timestamptz,     -- approvedAt
    approved_by_resource_id            text,            -- approvedByResourceId
    approved_by                        text,            -- approvedBy
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists project_financials_project_idx on public.project_financials (project_code);
alter table public.project_financials enable row level security;

/* ---------- ppmProjectBenefits -> public.project_benefits (scaffold only - no data in the backup) */
create table if not exists public.project_benefits (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists project_benefits_project_idx on public.project_benefits (project_code);
alter table public.project_benefits enable row level security;

/* ---------- ppmProjectDocuments -> public.project_documents (scaffold only - no data in the backup) */
create table if not exists public.project_documents (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists project_documents_project_idx on public.project_documents (project_code);
alter table public.project_documents enable row level security;

/* ---------- ppmStatusReports -> public.status_reports (scaffold only - no data in the backup) */
create table if not exists public.status_reports (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists status_reports_project_idx on public.status_reports (project_code);
alter table public.status_reports enable row level security;

/* ---------- ppmStageGates -> public.stage_gates (scaffold only - no data in the backup) */
create table if not exists public.stage_gates (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists stage_gates_project_idx on public.stage_gates (project_code);
alter table public.stage_gates enable row level security;

/* ---------- ppmPlanBaselines -> public.plan_baselines (modelled from 1 record(s)) */
create table if not exists public.plan_baselines (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    record_version                     numeric,         -- version
    status                             text,            -- status
    reason                             text,            -- reason
    impact                             text,            -- impact
    approved_by                        text,            -- approvedBy
    approved_by_resource_id            text,            -- approvedByResourceId
    approval_date                      date,            -- approvalDate
    approved_at                        timestamptz,     -- approvedAt
    task_baselines                     jsonb,           -- taskBaselines
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists plan_baselines_project_idx on public.plan_baselines (project_code);
alter table public.plan_baselines enable row level security;

/* ---------- ppmPlanBaselineRequests -> public.plan_baseline_requests (modelled from 1 record(s)) */
create table if not exists public.plan_baseline_requests (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    status                             text,            -- status
    existing_baseline                  jsonb,           -- existingBaseline
    proposed_baseline                  jsonb,           -- proposedBaseline
    reason                             text,            -- reason
    impact                             text,            -- impact
    requested_by                       text,            -- requestedBy
    requested_by_resource_id           text,            -- requestedByResourceId
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists plan_baseline_requests_project_idx on public.plan_baseline_requests (project_code);
alter table public.plan_baseline_requests enable row level security;

/* ---------- ppmRagHistory -> public.rag_history (scaffold only - no data in the backup) */
create table if not exists public.rag_history (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists rag_history_project_idx on public.rag_history (project_code);
alter table public.rag_history enable row level security;

/* ---------- ppmFinancialEntries -> public.financial_entries (modelled from 4 record(s)) */
create table if not exists public.financial_entries (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    category_id                        text,            -- categoryId
    category_name                      text,            -- categoryName
    description                        text,            -- description
    financial_period                   text,            -- financialPeriod
    budget_amount                      numeric,         -- budgetAmount
    forecast_cost                      numeric,         -- forecastCost
    actual_cost                        numeric,         -- actualCost
    committed_cost                     numeric,         -- committedCost
    remaining_forecast                 numeric,         -- remainingForecast
    notes                              text,            -- notes
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists financial_entries_project_idx on public.financial_entries (project_code);
alter table public.financial_entries enable row level security;

/* ---------- ppmFinancialApprovalRequests -> public.financial_approval_requests (modelled from 3 record(s)) */
create table if not exists public.financial_approval_requests (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    request_type                       text,            -- requestType
    current_approved_budget            numeric,         -- currentApprovedBudget
    proposed_budget                    numeric,         -- proposedBudget
    change_amount                      numeric,         -- changeAmount
    change_percentage                  numeric,         -- changePercentage
    reason                             text,            -- reason
    requester_resource_id              text,            -- requesterResourceId
    requester_name                     text,            -- requesterName
    requester_email                    text,            -- requesterEmail
    approver_resource_id               text,            -- approverResourceId
    approver_name                      text,            -- approverName
    approver_email                     text,            -- approverEmail
    status                             text,            -- status
    requested_at                       timestamptz,     -- requestedAt
    decision_at                        timestamptz,     -- decisionAt
    decision_by_resource_id            text,            -- decisionByResourceId
    decision_by_name                   text,            -- decisionByName
    decision_comments                  text,            -- decisionComments
    budget_snapshot                    jsonb,           -- budgetSnapshot
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists financial_approval_requests_project_idx on public.financial_approval_requests (project_code);
alter table public.financial_approval_requests enable row level security;

/* ---------- ppmResourceDemand -> public.resource_demand (scaffold only - no data in the backup) */
create table if not exists public.resource_demand (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists resource_demand_project_idx on public.resource_demand (project_code);
alter table public.resource_demand enable row level security;

/* ---------- ppmResourceScenarios -> public.resource_scenarios (scaffold only - no data in the backup) */
create table if not exists public.resource_scenarios (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists resource_scenarios_project_idx on public.resource_scenarios (project_code);
alter table public.resource_scenarios enable row level security;

/* ---------- ppmAuditHistory -> public.legacy_audit_history (modelled from 44 record(s)) */
create table if not exists public.legacy_audit_history (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects(id) on delete cascade,
    project_code text not null,
    record_key   text not null,
    timestamp_value                    timestamptz,     -- timestamp (renamed: 'timestamp' is a type name and reads badly as a column)
    entity_type                        text,            -- entityType
    entity_id                          text,            -- entityId
    action                             text,            -- action
    summary                            text,            -- summary
    source_page                        text,            -- sourcePage
    actor_name                         text,            -- actorName
    actor_resource_id                  text,            -- actorResourceId
    actor_email                        text,            -- actorEmail
    actor_role                         text,            -- actorRole
    status_from                        text,            -- statusFrom
    status_to                          text,            -- statusTo
    approval_status_from               text,            -- approvalStatusFrom
    approval_status_to                 text,            -- approvalStatusTo
    approval_id                        text,            -- approvalId
    changes                            jsonb,           -- changes
    metadata                           jsonb,           -- metadata
    location                           text,            -- location
    legacy_payload jsonb not null default '{}'::jsonb,
    import_payload jsonb,
    version      integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (project_code, record_key)
);
create index if not exists legacy_audit_history_project_idx on public.legacy_audit_history (project_code);
alter table public.legacy_audit_history enable row level security;

/* ---------- policies, grants and triggers for all 18 child tables ----------

   Written as a loop rather than 18 near-identical blocks: one rule, applied
   uniformly, so a table cannot accidentally be given a different security
   posture from its neighbours.
*/
do $$
declare
    t record;
begin
    for t in
        select * from (values
            ('project_plans',               'plan.view',              'plan.edit',                 true),
            ('project_milestones',          'milestones.view',        'milestones.edit',           true),
            ('project_raid',                'raid.view',              'raid.edit',                 true),
            ('project_actions',             'registers.view',         'registers.edit',            true),
            ('project_decisions',           'registers.view',         'registers.edit',            true),
            ('project_financials',          'financials.viewDetail',  'financials.edit',           true),
            ('project_benefits',            'benefits.view',          'benefits.edit',             true),
            ('project_documents',           'registers.view',         'registers.edit',            true),
            ('status_reports',              'registers.view',         'registers.edit',            true),
            ('stage_gates',                 'stageGates.view',        'stageGates.submit',         true),
            ('plan_baselines',              'plan.view',              'plan.approveBaseline',      true),
            ('plan_baseline_requests',      'plan.view',              'plan.requestBaseline',      true),
            ('rag_history',                 'projects.view',          'projects.status',           true),
            ('financial_entries',           'financials.viewDetail',  'financials.edit',           true),
            ('financial_approval_requests', 'financials.viewDetail',  'financials.approve',        true),
            ('resource_demand',             'resourceManagement.view','resourceManagement.edit',   true),
            ('resource_scenarios',          'resourceManagement.view','resourceManagement.edit',   true),
            -- historical import: readable, never written from the browser
            ('legacy_audit_history',        'audit.view',              null,                       false)
        ) as x(tbl, view_perm, edit_perm, writable)
    loop
        execute format('drop policy if exists %I on public.%I', t.tbl||' require aal2', t.tbl);
        execute format('drop policy if exists %I on public.%I', t.tbl||' read scope',   t.tbl);
        execute format('drop policy if exists %I on public.%I', t.tbl||' insert',       t.tbl);
        execute format('drop policy if exists %I on public.%I', t.tbl||' update',       t.tbl);

        execute format($f$
            create policy %I on public.%I as restrictive for all to authenticated
            using ((select auth.jwt()->>'aal') = 'aal2')
            with check ((select auth.jwt()->>'aal') = 'aal2')$f$,
            t.tbl||' require aal2', t.tbl);

        execute format($f$
            create policy %I on public.%I for select to authenticated
            using ((select private.has_permission(%L))
                   and (select private.can_access_project(project_code)))$f$,
            t.tbl||' read scope', t.tbl, t.view_perm);

        if t.writable then
            execute format($f$
                create policy %I on public.%I for insert to authenticated
                with check ((select private.has_permission(%L))
                            and (select private.can_access_project(project_code)))$f$,
                t.tbl||' insert', t.tbl, t.edit_perm);

            execute format($f$
                create policy %I on public.%I for update to authenticated
                using ((select private.has_permission(%L))
                       and (select private.can_access_project(project_code)))
                with check ((select private.has_permission(%L))
                            and (select private.can_access_project(project_code)))$f$,
                t.tbl||' update', t.tbl, t.edit_perm, t.edit_perm);

            execute format('grant select, insert, update on public.%I to authenticated', t.tbl);
        else
            execute format('grant select on public.%I to authenticated', t.tbl);
        end if;

        execute format('revoke delete on public.%I from authenticated', t.tbl);
        execute format('revoke all on public.%I from anon', t.tbl);

        execute format('drop trigger if exists %I on public.%I', 'trg_'||t.tbl||'_key',   t.tbl);
        execute format('drop trigger if exists %I on public.%I', 'trg_'||t.tbl||'_lock',  t.tbl);
        execute format('drop trigger if exists %I on public.%I', 'trg_'||t.tbl||'_audit', t.tbl);

        execute format('create trigger %I before update on public.%I for each row execute function private.protect_child_key()',
            'trg_'||t.tbl||'_key', t.tbl);
        execute format('create trigger %I before update on public.%I for each row execute function private.enforce_optimistic_lock()',
            'trg_'||t.tbl||'_lock', t.tbl);
        execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.record_child_audit()',
            'trg_'||t.tbl||'_audit', t.tbl);
    end loop;
end $$;

commit;
