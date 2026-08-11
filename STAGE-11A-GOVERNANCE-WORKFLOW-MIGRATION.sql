/* =============================================================================
   PORTFOLIO MANAGER — STAGE 11A
   Transactional Stage-Gate workflow: Stage Gates + Actions + Decisions + Project

   The browser still calculates the same legacy workflow result for UX continuity,
   but this function is the commit boundary. It validates the authenticated actor,
   MFA, permission, scope, loaded versions and core workflow invariants, then writes
   every participating row in ONE PostgreSQL transaction.

   SAFE TO RE-RUN.

   IMPORTANT FIRST-RUN ORDER:
     Seed + parity-check Actions/Decisions/Stage Gates from the browser BEFORE
     applying this migration. The guard installed below deliberately refuses
     direct insertion of historical non-Draft stage gates after it is active.
   ========================================================================== */

begin;

/* Direct table writes remain available for ordinary Draft/Deferred/Rejected gate
   editing, but workflow status/history may only move through the transactional RPC.
   This closes the browser-side bypass where a caller could otherwise update the
   stage_gates table directly and skip approval rules. */
create or replace function private.guard_stage_gate_workflow_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    old_status text;
    new_status text;
    old_route  text;
    new_route  text;
begin
    if tg_op = 'INSERT' then
        new_status := coalesce(nullif(new.legacy_payload->>'workflowStatus',''), nullif(new.legacy_payload->>'status',''), 'Draft');
        new_route := coalesce(nullif(new.legacy_payload->>'routeApprovalStatus',''), 'Not Required');
        if new_status <> 'Draft' or new_route in ('Pending','Approved','Rejected') then
            raise exception 'New stage gates must begin as Draft; seed existing workflow history before applying Stage 11A.'
                using errcode = '42501';
        end if;
        if jsonb_array_length(coalesce(new.legacy_payload->'submissionHistory','[]'::jsonb)) <> 0
           or jsonb_array_length(coalesce(new.legacy_payload->'decisionHistory','[]'::jsonb)) <> 0
           or jsonb_array_length(coalesce(new.legacy_payload->'routeApprovalHistory','[]'::jsonb)) <> 0
           or jsonb_array_length(coalesce(new.legacy_payload->'linkedActionIds','[]'::jsonb)) <> 0
           or nullif(btrim(coalesce(new.legacy_payload->>'linkedDecisionId','')), '') is not null then
            raise exception 'A newly created Draft stage gate cannot contain workflow history or linked workflow records.'
                using errcode = '42501';
        end if;
        return new;
    end if;

    if coalesce(current_setting('ppm.stage_gate_workflow', true), '') = 'on' then
        return new;
    end if;

    old_status := coalesce(nullif(old.legacy_payload->>'workflowStatus',''), nullif(old.legacy_payload->>'status',''), 'Draft');
    new_status := coalesce(nullif(new.legacy_payload->>'workflowStatus',''), nullif(new.legacy_payload->>'status',''), 'Draft');
    old_route := coalesce(nullif(old.legacy_payload->>'routeApprovalStatus',''), 'Not Required');
    new_route := coalesce(nullif(new.legacy_payload->>'routeApprovalStatus',''), 'Not Required');

    if new.deleted_at is distinct from old.deleted_at and old_status <> 'Draft' then
        raise exception 'Only Draft stage gates can be soft-deleted/restored after Stage 11A; decided gates are retained as governance history.'
            using errcode = '42501';
    end if;
    if old_status not in ('Draft','Deferred','Rejected') or old_route = 'Pending' then
        raise exception 'Submitted/approved/closed stage gates are read-only outside the governance workflow.'
            using errcode = '42501';
    end if;
    if new_status is distinct from old_status or new_route is distinct from old_route then
        raise exception 'Stage-gate workflow status can only change through the governance workflow.'
            using errcode = '42501';
    end if;
    if coalesce(new.legacy_payload->'submissionHistory','[]'::jsonb) is distinct from coalesce(old.legacy_payload->'submissionHistory','[]'::jsonb)
       or coalesce(new.legacy_payload->'decisionHistory','[]'::jsonb) is distinct from coalesce(old.legacy_payload->'decisionHistory','[]'::jsonb)
       or coalesce(new.legacy_payload->'routeApprovalHistory','[]'::jsonb) is distinct from coalesce(old.legacy_payload->'routeApprovalHistory','[]'::jsonb)
       or coalesce(new.legacy_payload->'linkedActionIds','[]'::jsonb) is distinct from coalesce(old.legacy_payload->'linkedActionIds','[]'::jsonb)
       or coalesce(new.legacy_payload->>'linkedDecisionId','') is distinct from coalesce(old.legacy_payload->>'linkedDecisionId','') then
        raise exception 'Stage-gate workflow history/links can only change through the governance workflow.'
            using errcode = '42501';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_stage_gates_workflow_guard on public.stage_gates;
create trigger trg_stage_gates_workflow_guard
before insert or update on public.stage_gates
for each row execute function private.guard_stage_gate_workflow_write();

/* Lightweight browser guard: Stage 11A will not switch its three collections to
   database-authoritative until this migration is present and the session is AAL2. */
create or replace function public.ppm_stage11a_ready()
returns boolean
language sql
stable
set search_path = ''
as $$
    select coalesce((select auth.jwt()->>'aal'), '') = 'aal2';
$$;

create or replace function public.ppm_commit_stage_gate_workflow(
    p_operation                    text,
    p_requested_status             text,
    p_gate                         jsonb,
    p_expected_gate_version        integer,
    p_actions                      jsonb,
    p_decision                     jsonb,
    p_expected_decision_version    integer,
    p_project                      jsonb,
    p_expected_project_version     integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    me                    record;
    gate_row              public.stage_gates%rowtype;
    project_row           public.projects%rowtype;
    decision_row          public.project_decisions%rowtype;
    action_item           jsonb;
    old_approver          jsonb;
    new_approver          jsonb;
    gate_id               text;
    v_project_code        text;
    actor_resource_id     text;
    operation_name        text := lower(btrim(coalesce(p_operation, '')));
    requested_status      text := btrim(coalesce(p_requested_status, ''));
    old_status            text;
    new_status            text;
    old_route_status      text;
    new_route_status      text;
    decision_id           text;
    action_id             text;
    project_uuid          uuid;
    action_count          integer := 0;
    decision_version      integer := null;
    new_gate_version      integer;
    new_project_version   integer := null;
    immutable_field       text;
    old_value             text;
    new_value             text;
    bad_count             integer := 0;
    old_action_signature  jsonb;
    new_action_signature  jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'You must be signed in to record a governance workflow.' using errcode = '42501';
    end if;

    if coalesce((select auth.jwt()->>'aal'), '') <> 'aal2' then
        raise exception 'MFA verification is required to record a governance workflow.' using errcode = '42501';
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

    gate_id := btrim(coalesce(p_gate->>'gateId', ''));
    v_project_code := btrim(coalesce(p_gate->>'projectCode', '')); 
    if gate_id = '' or v_project_code = '' then
        raise exception 'The workflow payload is missing its gate or project identifier.' using errcode = '22023';
    end if;

    if operation_name not in ('transition', 'route_request', 'route_decision') then
        raise exception 'Unknown stage-gate workflow operation: %', operation_name using errcode = '22023';
    end if;

    if not private.can_access_project(v_project_code) then
        raise exception 'The stage gate is outside your project access.' using errcode = '42501';
    end if;

    select sg.* into gate_row
      from public.stage_gates sg
     where sg.project_code = v_project_code
       and sg.record_key = gate_id
       and sg.deleted_at is null
     for update;

    if not found then
        raise exception 'Stage gate % is not present in the database.', gate_id using errcode = 'P0002';
    end if;

    if p_expected_gate_version is null or gate_row.version <> p_expected_gate_version then
        raise exception
            'Stage gate % changed while you were deciding it (loaded version %, current version %).',
            gate_id, p_expected_gate_version, gate_row.version
            using errcode = '40001';
    end if;

    if gate_row.project_code <> v_project_code then
        raise exception 'A stage gate cannot be moved to another project.' using errcode = '42501';
    end if;

    select pr.* into project_row
      from public.projects pr
     where pr.project_code = v_project_code
     for update;
    if not found then
        raise exception 'The linked project % no longer exists.', v_project_code using errcode = 'P0002';
    end if;
    project_uuid := project_row.id;

    if coalesce(project_row.archived, false) then
        raise exception 'Archived projects are read-only.' using errcode = '42501';
    end if;

    old_status := coalesce(nullif(gate_row.legacy_payload->>'workflowStatus',''),
                           nullif(gate_row.legacy_payload->>'status',''), 'Draft');
    new_status := coalesce(nullif(p_gate->>'workflowStatus',''), nullif(p_gate->>'status',''), '');
    old_route_status := coalesce(nullif(gate_row.legacy_payload->>'routeApprovalStatus',''), 'Not Required');
    new_route_status := coalesce(nullif(p_gate->>'routeApprovalStatus',''), 'Not Required');

    /* Workflow actions may not silently rewrite the gate definition. Any normal
       gate edits must already have been saved through the stageGates write path. */
    foreach immutable_field in array array[
        'gateId','projectCode','gateName','projectName','programmeId','programmeName',
        'currentStage','proposedNextStage','routeRequirement','routeReason',
        'submissionOwnerResourceId','routeApproverResourceId',
        'actionOwnerResourceId','actionDueDate','createdAt','createdByResourceId','revision','version'
    ] loop
        old_value := coalesce(gate_row.legacy_payload->>immutable_field, '');
        new_value := coalesce(p_gate->>immutable_field, '');
        if old_value is distinct from new_value then
            raise exception 'The workflow attempted to change % while recording a decision. Save the gate first.', immutable_field
                using errcode = '40001';
        end if;
    end loop;

    /* Workflow operations may record decisions, but they may not swap the assigned
       approvers. Draft editing is the place where approver identities are changed. */
    if (
        select coalesce(array_agg(a->>'resourceId' order by a->>'resourceId'), array[]::text[])
        from jsonb_array_elements(coalesce(gate_row.legacy_payload->'requiredApprovers','[]'::jsonb)) a
    ) is distinct from (
        select coalesce(array_agg(a->>'resourceId' order by a->>'resourceId'), array[]::text[])
        from jsonb_array_elements(coalesce(p_gate->'requiredApprovers','[]'::jsonb)) a
    ) then
        raise exception 'Required approver identities cannot be changed while recording a workflow decision.'
            using errcode = '42501';
    end if;

    /* Action definitions are also part of the submitted gate. A workflow decision
       may populate actionId, but cannot inject/change descriptions, owners or dates. */
    select coalesce(jsonb_agg(x.signature order by x.sort_key), '[]'::jsonb)
      into old_action_signature
      from (
        select jsonb_build_object(
                   'description', coalesce(a->>'description',''),
                   'ownerResourceId', coalesce(a->>'ownerResourceId',''),
                   'dueDate', coalesce(a->>'dueDate','')
               ) as signature,
               coalesce(a->>'description','') || E'\n' || coalesce(a->>'ownerResourceId','') || E'\n' || coalesce(a->>'dueDate','') as sort_key
          from jsonb_array_elements(coalesce(gate_row.legacy_payload->'actionsArising','[]'::jsonb)) a
      ) x;
    select coalesce(jsonb_agg(x.signature order by x.sort_key), '[]'::jsonb)
      into new_action_signature
      from (
        select jsonb_build_object(
                   'description', coalesce(a->>'description',''),
                   'ownerResourceId', coalesce(a->>'ownerResourceId',''),
                   'dueDate', coalesce(a->>'dueDate','')
               ) as signature,
               coalesce(a->>'description','') || E'\n' || coalesce(a->>'ownerResourceId','') || E'\n' || coalesce(a->>'dueDate','') as sort_key
          from jsonb_array_elements(coalesce(p_gate->'actionsArising','[]'::jsonb)) a
      ) x;
    if old_action_signature is distinct from new_action_signature then
        raise exception 'Actions arising cannot be changed while recording a workflow decision. Save the gate first.'
            using errcode = '40001';
    end if;

    /* Existing workflow links are append-only. */
    if nullif(coalesce(gate_row.legacy_payload->>'linkedDecisionId',''),'') is not null
       and coalesce(p_gate->>'linkedDecisionId','') <> coalesce(gate_row.legacy_payload->>'linkedDecisionId','') then
        raise exception 'The linked stage-gate decision cannot be replaced.' using errcode = '42501';
    end if;
    if exists (
        select 1
          from jsonb_array_elements_text(coalesce(gate_row.legacy_payload->'linkedActionIds','[]'::jsonb)) as old_id(value)
         where not exists (
             select 1 from jsonb_array_elements_text(coalesce(p_gate->'linkedActionIds','[]'::jsonb)) as new_id(value)
              where new_id.value = old_id.value
         )
    ) then
        raise exception 'Existing linked stage-gate actions cannot be removed.' using errcode = '42501';
    end if;

    if nullif(btrim(coalesce(p_gate->>'updatedByResourceId','')), '') is not null
       and p_gate->>'updatedByResourceId' <> actor_resource_id then
        raise exception 'The workflow actor does not match the signed-in account.' using errcode = '42501';
    end if;

    if operation_name = 'transition' then
        if requested_status in ('Submitted','Draft','Cancelled') then
            if not private.has_permission('stageGates.submit', v_project_code) then
                raise exception 'Your role does not allow you to submit or edit this stage gate.' using errcode = '42501';
            end if;
        elsif requested_status in ('Approved','Conditionally Approved','Deferred','Rejected') then
            if not private.has_permission('stageGates.approve', v_project_code) then
                raise exception 'Your role does not allow you to decide this stage gate.' using errcode = '42501';
            end if;
        else
            raise exception 'Invalid requested stage-gate transition: %', requested_status using errcode = '22023';
        end if;

        if requested_status = 'Submitted' then
            if old_status not in ('Draft','Deferred','Rejected') or new_status <> 'Submitted' then
                raise exception 'The transition from % to Submitted is not permitted.', old_status using errcode = '42501';
            end if;
            if coalesce(project_row.current_stage,'') <> coalesce(gate_row.legacy_payload->>'currentStage','') then
                raise exception 'The project stage changed before this gate was submitted.' using errcode = '40001';
            end if;
            if coalesce(p_gate->>'submittedByResourceId','') <> actor_resource_id then
                raise exception 'The stage-gate submitter does not match the signed-in account.' using errcode = '42501';
            end if;
            if jsonb_array_length(coalesce(p_gate->'requiredApprovers','[]'::jsonb)) = 0 then
                raise exception 'At least one required approver is needed before submission.' using errcode = '22023';
            end if;
            if exists (
                select 1
                  from jsonb_array_elements(coalesce(p_gate->'requiredApprovers','[]'::jsonb)) a
                 where a->>'resourceId' = coalesce(p_gate->>'submissionOwnerResourceId','')
            ) then
                raise exception 'The submission owner cannot also be a required approver.' using errcode = '42501';
            end if;
            select count(*) into bad_count
              from jsonb_array_elements(coalesce(p_gate->'requiredApprovers','[]'::jsonb)) a
              left join public.people ap
                on ap.legacy_resource_id = a->>'resourceId'
               and ap.active = true
               and coalesce(ap.account_status,'Active') = 'Active'
             where nullif(btrim(coalesce(a->>'resourceId','')), '') is null
                or ap.id is null
                or case
                     when ap.permission_overrides->>'stageGates.approve' = 'allow' then false
                     when ap.permission_overrides->>'stageGates.approve' = 'deny' then true
                     else not exists (
                         select 1 from private.role_permissions rp
                          where rp.role_name = ap.access_role
                            and rp.permission_key = 'stageGates.approve'
                     )
                   end;
            if bad_count > 0 then
                raise exception 'Every required approver must be an active resource with stage-gate approval permission.'
                    using errcode = '42501';
            end if;
        elsif requested_status = 'Draft' then
            if old_status not in ('Deferred','Rejected') or new_status <> 'Draft' then
                raise exception 'The transition from % to Draft is not permitted.', old_status using errcode = '42501';
            end if;
        elsif requested_status = 'Cancelled' then
            if old_status not in ('Draft','Submitted','Conditionally Approved','Deferred','Rejected')
               or new_status <> 'Cancelled' then
                raise exception 'The transition from % to Cancelled is not permitted.', old_status using errcode = '42501';
            end if;
            if actor_resource_id not in (
                coalesce(gate_row.legacy_payload->>'submissionOwnerResourceId',''),
                coalesce(gate_row.legacy_payload->>'submittedByResourceId','')
            ) and not private.has_permission('stageGates.override', v_project_code) then
                raise exception 'Only the gate owner/submitter or an override user can cancel this gate.' using errcode = '42501';
            end if;
        else
            if old_status not in ('Submitted','Conditionally Approved') then
                raise exception 'The transition from % to % is not permitted.', old_status, requested_status using errcode = '42501';
            end if;
            if actor_resource_id in (
                coalesce(gate_row.legacy_payload->>'submissionOwnerResourceId',''),
                coalesce(gate_row.legacy_payload->>'submittedByResourceId','')
            ) then
                raise exception 'You cannot approve or decide a stage gate that you submitted or own.' using errcode = '42501';
            end if;
            if not exists (
                select 1
                  from jsonb_array_elements(coalesce(gate_row.legacy_payload->'requiredApprovers','[]'::jsonb)) a
                 where a->>'resourceId' = actor_resource_id
            ) then
                raise exception 'Only an assigned required approver can decide this stage gate.' using errcode = '42501';
            end if;

            /* One approver may change only their own decision fields. */
            if jsonb_array_length(coalesce(gate_row.legacy_payload->'requiredApprovers','[]'::jsonb))
               <> jsonb_array_length(coalesce(p_gate->'requiredApprovers','[]'::jsonb)) then
                raise exception 'Required approvers cannot be changed during an approval decision.' using errcode = '42501';
            end if;
            for old_approver in
                select value from jsonb_array_elements(coalesce(gate_row.legacy_payload->'requiredApprovers','[]'::jsonb))
            loop
                select value into new_approver
                  from jsonb_array_elements(coalesce(p_gate->'requiredApprovers','[]'::jsonb))
                 where value->>'resourceId' = old_approver->>'resourceId'
                 limit 1;
                if new_approver is null then
                    raise exception 'Required approvers cannot be changed during an approval decision.' using errcode = '42501';
                end if;
                if old_approver->>'resourceId' = actor_resource_id then
                    if coalesce(new_approver->>'decision','') <> requested_status then
                        raise exception 'Your recorded approver decision does not match the requested outcome.' using errcode = '42501';
                    end if;
                else
                    if coalesce(new_approver->>'decision','') is distinct from coalesce(old_approver->>'decision','')
                       or coalesce(new_approver->>'decisionComments','') is distinct from coalesce(old_approver->>'decisionComments','')
                       or coalesce(new_approver->>'decidedAt','') is distinct from coalesce(old_approver->>'decidedAt','') then
                        raise exception 'A workflow decision cannot alter another approver''s recorded decision.' using errcode = '42501';
                    end if;
                end if;
            end loop;

            if requested_status = 'Approved' and new_status not in ('Submitted','Conditionally Approved','Approved') then
                raise exception 'The calculated final status is inconsistent with an Approved decision.' using errcode = '42501';
            elsif requested_status <> 'Approved' and new_status <> requested_status then
                raise exception 'The calculated final status does not match the requested decision.' using errcode = '42501';
            end if;
        end if;

    elsif operation_name = 'route_request' then
        if not private.has_permission('stageGates.submit', v_project_code) then
            raise exception 'Your role does not allow you to request this governance-route exception.' using errcode = '42501';
        end if;
        if old_status <> 'Draft'
           or coalesce(gate_row.legacy_payload->>'routeRequirement','') <> 'Not Applicable'
           or old_route_status = 'Pending'
           or new_route_status <> 'Pending' then
            raise exception 'This route exception is not in a state that can be submitted.' using errcode = '42501';
        end if;
        if actor_resource_id = coalesce(gate_row.legacy_payload->>'routeApproverResourceId','') then
            raise exception 'The person requesting a governance-route exception cannot approve it.' using errcode = '42501';
        end if;
        if coalesce(p_gate->>'routeRequestedByResourceId','') <> actor_resource_id then
            raise exception 'The route-exception requester does not match the signed-in account.' using errcode = '42501';
        end if;
        select count(*) into bad_count
          from public.people rp_user
         where rp_user.legacy_resource_id = coalesce(p_gate->>'routeApproverResourceId','')
           and rp_user.active = true
           and coalesce(rp_user.account_status,'Active') = 'Active'
           and case
                 when rp_user.permission_overrides->>'stageGates.override' = 'allow' then true
                 when rp_user.permission_overrides->>'stageGates.override' = 'deny' then false
                 else exists (
                     select 1 from private.role_permissions rp
                      where rp.role_name = rp_user.access_role
                        and rp.permission_key = 'stageGates.override'
                 )
               end;
        if bad_count <> 1 then
            raise exception 'The assigned route approver must be an active resource with governance-route override permission.'
                using errcode = '42501';
        end if;

    else /* route_decision */
        if requested_status not in ('Approved','Rejected') then
            raise exception 'Select Approved or Rejected for the route exception.' using errcode = '22023';
        end if;
        if not private.has_permission('stageGates.override', v_project_code) then
            raise exception 'Your role does not allow you to decide governance-route exceptions.' using errcode = '42501';
        end if;
        if coalesce(gate_row.legacy_payload->>'routeRequirement','') <> 'Not Applicable'
           or old_route_status <> 'Pending' then
            raise exception 'This gate does not have a route exception awaiting decision.' using errcode = '42501';
        end if;
        if actor_resource_id <> coalesce(gate_row.legacy_payload->>'routeApproverResourceId','') then
            raise exception 'Only the assigned route approver can decide this exception.' using errcode = '42501';
        end if;
        if actor_resource_id in (
            coalesce(gate_row.legacy_payload->>'routeRequestedByResourceId',''),
            coalesce(gate_row.legacy_payload->>'submissionOwnerResourceId','')
        ) then
            raise exception 'You cannot approve a governance-route exception that you requested or own.' using errcode = '42501';
        end if;
        if new_route_status <> requested_status then
            raise exception 'The route decision payload does not match the requested outcome.' using errcode = '42501';
        end if;
        if requested_status = 'Approved' and new_status <> 'Cancelled' then
            raise exception 'An approved not-applicable route must close the gate without advancing the project.' using errcode = '42501';
        elsif requested_status = 'Rejected' and new_status <> 'Draft' then
            raise exception 'A rejected route exception must return the gate to Draft.' using errcode = '42501';
        end if;
    end if;

    /* Stage-gate generated actions are INSERT-only here. Existing actions remain
       ordinary register records and are edited through their normal write path. */
    if p_actions is not null then
        if jsonb_typeof(p_actions) <> 'array' then
            raise exception 'Stage-gate actions must be supplied as an array.' using errcode = '22023';
        end if;
        if jsonb_array_length(p_actions) > 0
           and not (operation_name = 'route_decision' or (operation_name = 'transition' and new_status in ('Approved','Conditionally Approved','Deferred','Rejected'))) then
            raise exception 'This workflow operation is not allowed to create stage-gate actions.' using errcode = '42501';
        end if;
        if (operation_name = 'route_decision' or (operation_name = 'transition' and new_status in ('Approved','Conditionally Approved','Deferred','Rejected')))
           and jsonb_array_length(p_actions) <> (
               select count(*)
                 from jsonb_array_elements(coalesce(gate_row.legacy_payload->'actionsArising','[]'::jsonb)) a
                where nullif(btrim(coalesce(a->>'actionId','')), '') is null
           ) then
            raise exception 'The generated action count does not match the submitted gate actions.' using errcode = '42501';
        end if;
        for action_item in select value from jsonb_array_elements(p_actions)
        loop
            action_id := btrim(coalesce(action_item->>'actionId',''));
            if action_id = ''
               or coalesce(action_item->>'projectCode','') <> v_project_code
               or btrim(coalesce(action_item->>'ownerResourceId','')) = ''
               or btrim(coalesce(action_item->>'dueDate','')) = ''
               or coalesce(action_item->>'relatedRecords','') <> gate_id
               or coalesce(action_item->>'status','') <> 'Open' then
                raise exception 'A stage-gate action is missing its ID, project, owner, due date, Open status or exact gate link.' using errcode = '22023';
            end if;
            if not exists (
                select 1
                  from jsonb_array_elements(coalesce(gate_row.legacy_payload->'actionsArising','[]'::jsonb)) a
                 where nullif(btrim(coalesce(a->>'actionId','')), '') is null
                   and coalesce(a->>'description','') = coalesce(action_item->>'description','')
                   and coalesce(a->>'ownerResourceId','') = coalesce(action_item->>'ownerResourceId','')
                   and coalesce(a->>'dueDate','') = coalesce(action_item->>'dueDate','')
            ) then
                raise exception 'Generated action % does not match an unlinked action on the submitted gate.', action_id
                    using errcode = '42501';
            end if;
            if not exists (
                select 1 from jsonb_array_elements_text(coalesce(p_gate->'linkedActionIds','[]'::jsonb)) as x(value)
                 where x.value = action_id
            ) or not exists (
                select 1 from jsonb_array_elements(coalesce(p_gate->'actionsArising','[]'::jsonb)) a
                 where a->>'actionId' = action_id
                   and coalesce(a->>'description','') = coalesce(action_item->>'description','')
                   and coalesce(a->>'ownerResourceId','') = coalesce(action_item->>'ownerResourceId','')
                   and coalesce(a->>'dueDate','') = coalesce(action_item->>'dueDate','')
            ) then
                raise exception 'Generated action % is not linked back to the stage gate payload.', action_id
                    using errcode = '42501';
            end if;
            if exists (
                select 1 from public.project_actions pa
                 where pa.project_code = v_project_code and pa.record_key = action_id and pa.deleted_at is null
            ) then
                raise exception 'Stage-gate action % already exists; the workflow will not overwrite it.', action_id
                    using errcode = '40001';
            end if;
            insert into public.project_actions(project_id, project_code, record_key, legacy_payload)
            values (
                project_uuid, v_project_code, action_id,
                action_item - 'databaseId' - 'databaseVersion' - 'recordSource'
            );
            action_count := action_count + 1;
        end loop;
    end if;

    /* A linked decision is created once and may be updated by later approvers. */
    if p_decision is not null and jsonb_typeof(p_decision) <> 'null' then
        decision_id := btrim(coalesce(p_decision->>'decisionId',''));
        if decision_id = ''
           or coalesce(p_decision->>'projectCode','') <> v_project_code
           or position(gate_id in coalesce(p_decision->>'relatedRecords','')) = 0
           or decision_id <> coalesce(p_gate->>'linkedDecisionId','') then
            raise exception 'The stage-gate decision record is not correctly linked to this gate.' using errcode = '22023';
        end if;

        if operation_name not in ('transition','route_decision') then
            raise exception 'This workflow operation is not allowed to create or update a decision record.' using errcode = '42501';
        end if;
        if operation_name = 'transition' and new_status not in ('Approved','Conditionally Approved','Deferred','Rejected') then
            raise exception 'The calculated gate status does not require a linked decision.' using errcode = '42501';
        end if;
        if operation_name = 'route_decision' and coalesce(p_decision->>'status','') <> requested_status then
            raise exception 'The route decision record status does not match the route outcome.' using errcode = '42501';
        elsif operation_name = 'transition'
          and coalesce(p_decision->>'status','') <>
              (case
                   when new_status in ('Approved','Conditionally Approved') then 'Approved'
                   else new_status
               end) then
            raise exception 'The decision record status does not match the stage-gate outcome.' using errcode = '42501';
        end if;
        if operation_name = 'route_decision' and coalesce(p_decision->>'decisionOwnerResourceId','') <> coalesce(p_gate->>'routeApproverResourceId','') then
            raise exception 'The route decision owner does not match the assigned route approver.' using errcode = '42501';
        elsif operation_name = 'transition' and coalesce(p_decision->>'decisionOwnerResourceId','') <> coalesce(p_gate->'requiredApprovers'->0->>'resourceId','') then
            raise exception 'The stage-gate decision owner does not match the primary required approver.' using errcode = '42501';
        end if;

        select pd.* into decision_row
          from public.project_decisions pd
         where pd.project_code = v_project_code
           and pd.record_key = decision_id
           and pd.deleted_at is null
         for update;

        if found then
            if p_expected_decision_version is null or decision_row.version <> p_expected_decision_version then
                raise exception 'Decision % changed while you were deciding the gate.', decision_id using errcode = '40001';
            end if;
            update public.project_decisions
               set status = nullif(p_decision->>'status',''),
                   decision_owner = nullif(p_decision->>'decisionOwner',''),
                   decision_owner_resource_id = nullif(p_decision->>'decisionOwnerResourceId',''),
                   decision_owner_email = nullif(p_decision->>'decisionOwnerEmail',''),
                   recommendation = nullif(p_decision->>'recommendation',''),
                   options_considered = nullif(p_decision->>'optionsConsidered',''),
                   background = nullif(p_decision->>'background',''),
                   decision_required = nullif(p_decision->>'decisionRequired',''),
                   required_by_date = nullif(p_decision->>'requiredByDate','')::date,
                   legacy_payload = p_decision - 'databaseId' - 'databaseVersion' - 'recordSource',
                   version = p_expected_decision_version
             where id = decision_row.id
             returning version into decision_version;
        else
            if p_expected_decision_version is not null then
                raise exception 'Decision % was expected to exist but no longer does.', decision_id using errcode = '40001';
            end if;
            insert into public.project_decisions(
                project_id, project_code, record_key, status,
                decision_owner, decision_owner_resource_id, decision_owner_email,
                recommendation, options_considered, background, decision_required,
                required_by_date, legacy_payload
            ) values (
                project_uuid, v_project_code, decision_id, nullif(p_decision->>'status',''),
                nullif(p_decision->>'decisionOwner',''), nullif(p_decision->>'decisionOwnerResourceId',''),
                nullif(p_decision->>'decisionOwnerEmail',''), nullif(p_decision->>'recommendation',''),
                nullif(p_decision->>'optionsConsidered',''), nullif(p_decision->>'background',''),
                nullif(p_decision->>'decisionRequired',''), nullif(p_decision->>'requiredByDate','')::date,
                p_decision - 'databaseId' - 'databaseVersion' - 'recordSource'
            ) returning version into decision_version;
        end if;
    elsif nullif(coalesce(p_gate->>'linkedDecisionId',''),'') is not null
          and new_status in ('Approved','Conditionally Approved','Deferred','Rejected','Cancelled') then
        /* Existing gates may already carry a linked decision even when this
           particular approval does not change it. That is allowed. */
        null;
    end if;

    /* Final approval is the only Stage 11A path allowed to advance a project. */
    if p_project is not null and jsonb_typeof(p_project) <> 'null' then
        if operation_name <> 'transition' or new_status <> 'Approved' or old_status = 'Approved' then
            raise exception 'A project-stage update is only valid on first final stage-gate approval.' using errcode = '42501';
        end if;
        if p_expected_project_version is null or project_row.version <> p_expected_project_version then
            raise exception
                'Project % changed while the stage gate was being approved (loaded version %, current version %).',
                v_project_code, p_expected_project_version, project_row.version
                using errcode = '40001';
        end if;
        if coalesce(project_row.current_stage,'') <> coalesce(gate_row.legacy_payload->>'currentStage','') then
            raise exception 'The project has moved stage since this gate was submitted.' using errcode = '40001';
        end if;
        if coalesce(p_project->>'currentStage','') <> coalesce(p_gate->>'proposedNextStage','') then
            raise exception 'The project-stage result does not match the approved next stage.' using errcode = '42501';
        end if;
        if coalesce(p_project->>'projectCode','') <> v_project_code then
            raise exception 'The workflow attempted to update a different project.' using errcode = '42501';
        end if;
        update public.projects
           set current_stage = nullif(p_project->>'currentStage',''),
               next_stage = nullif(p_project->>'nextStage',''),
               legacy_payload = project_row.legacy_payload || jsonb_build_object(
                   'currentStage', p_project->>'currentStage',
                   'nextStage', p_project->>'nextStage',
                   'currentStageGate', p_gate->>'gateName',
                   'stageHistory', coalesce(project_row.legacy_payload->'stageHistory','[]'::jsonb) ||
                       jsonb_build_array(jsonb_build_object(
                           'gateId', gate_id,
                           'revision', coalesce(nullif(p_gate->>'revision','')::integer, 1),
                           'gateName', p_gate->>'gateName',
                           'fromStage', gate_row.legacy_payload->>'currentStage',
                           'toStage', p_gate->>'proposedNextStage',
                           'approvedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                           'decisionDate', p_gate->>'decisionDate'
                       )),
                   'updatedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
               ),
               version = p_expected_project_version
         where id = project_row.id
         returning version into new_project_version;
    elsif operation_name = 'transition' and new_status = 'Approved' and old_status <> 'Approved' then
        raise exception 'Final stage-gate approval must atomically advance the linked project.' using errcode = '42501';
    end if;

    /* The workflow RPC owns workflow fields only. Gate definition fields remain
       exactly as stored by the ordinary draft/edit path. */
    perform set_config('ppm.stage_gate_workflow', 'on', true);
    update public.stage_gates
       set legacy_payload = gate_row.legacy_payload || jsonb_build_object(
               'workflowStatus', new_status,
               'status', new_status,
               'submissionDate', p_gate->>'submissionDate',
               'submittedAt', p_gate->>'submittedAt',
               'submittedBy', p_gate->>'submittedBy',
               'submittedByResourceId', p_gate->>'submittedByResourceId',
               'submissionComments', p_gate->>'submissionComments',
               'decisionDate', p_gate->>'decisionDate',
               'meetingDate', p_gate->>'meetingDate',
               'approvalComments', p_gate->>'approvalComments',
               'conditions', p_gate->>'conditions',
               'rejectionDeferralReason', p_gate->>'rejectionDeferralReason',
               'decisionSummary', p_gate->>'decisionSummary',
               'completionDate', p_gate->>'completionDate',
               'requiredApprovers', coalesce(p_gate->'requiredApprovers','[]'::jsonb),
               'requiredApproverResourceIds', coalesce(p_gate->'requiredApproverResourceIds','[]'::jsonb),
               'submissionHistory', coalesce(p_gate->'submissionHistory','[]'::jsonb),
               'decisionHistory', coalesce(p_gate->'decisionHistory','[]'::jsonb),
               'routeApprovalStatus', new_route_status,
               'routeApprovalDate', p_gate->>'routeApprovalDate',
               'routeApprovalComments', p_gate->>'routeApprovalComments',
               'routeRequestedBy', p_gate->>'routeRequestedBy',
               'routeRequestedByResourceId', p_gate->>'routeRequestedByResourceId',
               'routeRequestedAt', p_gate->>'routeRequestedAt',
               'routeApprovalHistory', coalesce(p_gate->'routeApprovalHistory','[]'::jsonb),
               'actionsArising', coalesce(p_gate->'actionsArising','[]'::jsonb),
               'linkedActionIds', coalesce(p_gate->'linkedActionIds','[]'::jsonb),
               'linkedDecisionId', p_gate->>'linkedDecisionId',
               'updatedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'updatedBy', me.full_name,
               'updatedByResourceId', actor_resource_id
           ),
           version = p_expected_gate_version
     where id = gate_row.id
     returning version into new_gate_version;

    return jsonb_build_object(
        'ok', true,
        'operation', operation_name,
        'requestedStatus', requested_status,
        'gateId', gate_id,
        'gateVersion', new_gate_version,
        'actionsCreated', action_count,
        'decisionId', decision_id,
        'decisionVersion', decision_version,
        'projectVersion', new_project_version
    );
end;
$$;

revoke all on function private.guard_stage_gate_workflow_write() from public;
revoke all on function private.guard_stage_gate_workflow_write() from anon;
revoke all on function private.guard_stage_gate_workflow_write() from authenticated;

revoke all on function public.ppm_stage11a_ready() from public;
revoke all on function public.ppm_stage11a_ready() from anon;
grant execute on function public.ppm_stage11a_ready() to authenticated;

revoke all on function public.ppm_commit_stage_gate_workflow(text,text,jsonb,integer,jsonb,jsonb,integer,jsonb,integer) from public;
revoke all on function public.ppm_commit_stage_gate_workflow(text,text,jsonb,integer,jsonb,jsonb,integer,jsonb,integer) from anon;
grant execute on function public.ppm_commit_stage_gate_workflow(text,text,jsonb,integer,jsonb,jsonb,integer,jsonb,integer) to authenticated;

commit;

/* -----------------------------------------------------------------------------
   READ-ONLY VERIFICATION
   -------------------------------------------------------------------------- */

select 'workflow rpc exists' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'ppm_commit_stage_gate_workflow';

select 'stage11 readiness rpc exists' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'ppm_stage11a_ready';

select 'stage-gate workflow guard exists' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'stage_gates'
  and t.tgname = 'trg_stage_gates_workflow_guard'
  and not t.tgisinternal;

select 'authenticated can execute workflow rpc' as check,
       case when has_function_privilege(
         'authenticated',
         'public.ppm_commit_stage_gate_workflow(text,text,jsonb,integer,jsonb,jsonb,integer,jsonb,integer)',
         'EXECUTE'
       ) then 'PASS' else 'FAIL' end as result;

select 'anon cannot execute workflow rpc' as check,
       case when not has_function_privilege(
         'anon',
         'public.ppm_commit_stage_gate_workflow(text,text,jsonb,integer,jsonb,jsonb,integer,jsonb,integer)',
         'EXECUTE'
       ) then 'PASS' else 'FAIL' end as result;

select 'stage11 tables still deny DELETE' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) end as result
from information_schema.role_table_grants
where grantee = 'authenticated'
  and privilege_type = 'DELETE'
  and table_schema = 'public'
  and table_name in ('project_actions','project_decisions','stage_gates');
