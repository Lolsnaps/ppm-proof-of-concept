/*
  STAGE 18 — being named as an approver is the authority
  ======================================================

  Safe to re-run.

  THE PROBLEM

  A person named as a required approver on a stage gate could not decide it, and in most
  cases could not see it at all. Three separate rules refused them, in this order:

    1. private.can_access_project() does not consider stage-gate approvers, so the
       project row and the gate row were both filtered out by row-level security. The
       page showed nothing.
    2. ppm_commit_stage_gate_workflow raises 'The stage gate is outside your project
       access.' using the same predicate.
    3. It then requires private.has_permission('stageGates.approve', project) - a role
       test scoped to a project the person cannot access, so it fails even for a role
       that holds the permission.

  Found in the pilot: Nadia Kaur, Project Sponsor / Project Lead, scope 'Assigned
  projects' with no assigned projects, is a required approver on sixteen gates across five
  projects - two of them Submitted and waiting for her. Her role does hold
  stageGates.approve. She could not act on any of them, and the screen said only 'No
  workflow actions are available to your account for this record.'

  A fourth rule sits at submission: every required approver must already hold
  stageGates.approve. That prevents the case this application was built to support - an
  executive requiring a subject-matter expert's approval - because the expert's role would
  have to be changed for every other screen in order to sign one gate.

  WHAT THIS CHANGES

  Being named as a required approver on a gate is treated as the authority to decide that
  gate, and as a reason to see it.

    private.is_named_gate_approver(project_code)   new predicate
    projects            read policy    also true for a named approver
    stage_gates         read policy    also true for a named approver, per gate
    workflow: access    check          accepts a named approver
    workflow: decide    check          accepts a named approver in place of the role test
    workflow: submit    check          approvers must be active; the role test is dropped

  WHAT IT DELIBERATELY DOES NOT CHANGE

  Every control that makes an approval mean something is untouched:

    - the submission owner cannot also be a required approver
    - you cannot decide a gate you submitted or own
    - only an assigned required approver can decide
    - required approvers cannot be changed while a decision is being recorded
    - an approver may change only their own decision fields
    - the decision is written by trigger from the authenticated identity

  Nor does it widen anything beyond stage gates. A named approver gains the project header
  and the gates they are named on. They do not gain the plan, RAID, registers, financials,
  benefits, resources or the ability to edit anything - can_access_project is unchanged, so
  every other table's policy answers exactly as it did before.

  THE TRADE-OFF, STATED

  Whoever submits a gate now decides who may approve it, without an administrator granting
  a role first. That is the point - it is how approvals work outside software - but it does
  mean the naming step is where authority is conferred. What stops it being abused is that
  the submitter cannot name themselves, that every decision names the authenticated person
  in public.audit_log, and that the set of approvers is frozen once a decision is being
  recorded.
*/

begin;

/* ------------------------------------------------------------------ predicate

   True when the signed-in person is a required approver on at least one live stage gate
   for this project.

   SECURITY DEFINER with an empty search_path, like the other private predicates: it reads
   public.stage_gates, which is exactly what the caller may not be able to read yet.

   The jsonb containment test is on resourceId only. Approver entries also carry a name and
   an email, and matching on those would let a rename or a shared mailbox confer approval
   authority. The resource id is the identity everywhere else in this schema.
*/
create or replace function private.is_named_gate_approver(target_project_code text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
    with me as (
        select pe.legacy_resource_id
          from public.people pe
         where pe.auth_user_id = (select auth.uid())
           and pe.active = true
           and coalesce(pe.account_status, 'Active') = 'Active'
         limit 1
    )
    select exists (
        select 1
          from public.stage_gates sg, me
         where sg.project_code = target_project_code
           and sg.deleted_at is null
           and me.legacy_resource_id is not null
           and coalesce(sg.legacy_payload -> 'requiredApprovers', '[]'::jsonb)
               @> jsonb_build_array(jsonb_build_object('resourceId', me.legacy_resource_id))
    );
$function$;

comment on function private.is_named_gate_approver(text) is
  'True when the signed-in person is a required approver on a live stage gate for this project. '
  'Stage 18: being named is the authority to decide, and the reason to be able to see it.';

revoke all on function private.is_named_gate_approver(text) from public, anon;
grant execute on function private.is_named_gate_approver(text) to authenticated;

/* Same question for one gate rather than the project, so the stage-gate read policy can
   grant the gates a person is named on without granting the project's other gates. */
create or replace function private.is_named_approver_of(gate_payload jsonb)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
    select exists (
        select 1
          from public.people pe
         where pe.auth_user_id = (select auth.uid())
           and pe.active = true
           and coalesce(pe.account_status, 'Active') = 'Active'
           and pe.legacy_resource_id is not null
           and coalesce(gate_payload -> 'requiredApprovers', '[]'::jsonb)
               @> jsonb_build_array(jsonb_build_object('resourceId', pe.legacy_resource_id))
    );
$function$;

comment on function private.is_named_approver_of(jsonb) is
  'True when the signed-in person is a required approver on this particular stage gate.';

revoke all on function private.is_named_approver_of(jsonb) from public, anon;
grant execute on function private.is_named_approver_of(jsonb) to authenticated;

/* -------------------------------------------------------------- read policies

   The project header. Without it the gate names a project the person cannot resolve -
   no name, no stage, no dates - which is not enough to judge a gate on.

   projects also carries a separate restrictive 'projects require view permission' policy
   on projects.view. That is left alone: every role in this application holds projects.view,
   and a person who genuinely cannot view projects at all should not be approving their
   gates.
*/
drop policy if exists "users can read accessible projects" on public.projects;
create policy "users can read accessible projects"
  on public.projects
  for select
  to authenticated
  using (
    (select private.can_access_project(projects.project_code))
    or (select private.is_named_gate_approver(projects.project_code))
  );

/* The gates they are named on, and only those. A named approver on one gate does not get
   the project's other gates - is_named_approver_of() is evaluated against the row. */
drop policy if exists "stage_gates read scope" on public.stage_gates;
create policy "stage_gates read scope"
  on public.stage_gates
  for select
  to authenticated
  using (
    (
      (select private.has_permission('stageGates.view'))
      and (select private.can_access_project(stage_gates.project_code))
    )
    or private.is_named_approver_of(stage_gates.legacy_payload)
  );

/*
  The update policy is deliberately NOT widened. A named approver changes a gate through
  ppm_commit_stage_gate_workflow, which is SECURITY DEFINER and does its own checking -
  that is the whole reason the workflow exists. Widening the table's own update policy
  would let an approver write the row directly, outside every rule the function enforces.
*/

commit;

/* --------------------------------------------------- the workflow function

   ppm_commit_stage_gate_workflow is around four hundred lines and three of them are
   wrong. It is patched here rather than restated, because restating it would mean
   transcribing the other three hundred and ninety-seven by hand into a file nobody would
   diff line by line - and a transcription error inside a SECURITY DEFINER function on the
   security boundary is a worse risk than the patch being unusual.

   Every substitution asserts that it matched exactly once. If the function has moved on,
   this migration fails loudly and changes nothing, which is the behaviour to want: a patch
   that silently applied to two places, or none, would be far harder to notice than one
   that refuses.

   Safe to re-run: applying it twice is a no-op, because the second run finds the new text
   and not the old, and says so.
*/
do $patch$
declare
    src        text;
    patched    text;
    hits       integer;
    already    boolean;
begin
    select pg_get_functiondef(p.oid)
      into src
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'ppm_commit_stage_gate_workflow';

    if src is null then
        raise exception 'ppm_commit_stage_gate_workflow does not exist; apply the Stage 11A migration first.';
    end if;

    already := src like '%is_named_gate_approver%';
    if already then
        raise notice 'Stage 18: the workflow function already accepts named approvers. Nothing to do.';
        return;
    end if;

    patched := src;

    /* 1. Reading the gate at all. A named approver is inside their access for this gate,
          even when can_access_project() says the project is not theirs. */
    select count(*) into hits
      from regexp_matches(patched, 'if not private\.can_access_project\(v_project_code\) then', 'g');
    if hits <> 1 then
        raise exception 'Stage 18: expected exactly one project-access check, found %.', hits;
    end if;
    patched := replace(
        patched,
        'if not private.can_access_project(v_project_code) then',
        'if not (private.can_access_project(v_project_code) '
          || 'or private.is_named_gate_approver(v_project_code)) then'
    );

    /* 2. Deciding. Being named is the authority - that is the whole change. The separate
          checks that you cannot decide your own gate, and that only a named approver may
          decide, are further down and untouched. */
    select count(*) into hits
      from regexp_matches(patched, 'if not private\.has_permission\(''stageGates\.approve'', v_project_code\) then', 'g');
    if hits <> 1 then
        raise exception 'Stage 18: expected exactly one approve-permission check, found %.', hits;
    end if;
    patched := replace(
        patched,
        'if not private.has_permission(''stageGates.approve'', v_project_code) then',
        'if not (private.has_permission(''stageGates.approve'', v_project_code) '
          || 'or private.is_named_gate_approver(v_project_code)) then'
    );

    /* 3. Naming. An approver must still be a real, active, enabled person - so a gate
          cannot be blocked by naming a directory entry that can never sign in - but their
          role no longer has to include stage-gate approval. That rule is what stopped an
          executive requiring a subject-matter expert's sign-off. */
    /*
       Bounded on both ends by [^;], because the CASE body contains no semicolon and its
       terminator does.

       The first attempt used '.*?end;' with the s flag, counted one match and applied it. A
       non-greedy match still runs to the first 'end;' AFTER the pattern can start matching, and
       with '.' crossing newlines that turned out to be 25,648 characters away - two thirds of
       the function, deleted. The count of one was true and told me nothing, which is the exact
       trap this codebase already has a section about: a check that passes while the thing it
       describes is wrong.

       So the extent is asserted, not just the count.
    */
    select count(*) into hits from regexp_matches(patched, 'or case[^;]*end;', 'g');
    if hits <> 1 then
        raise exception 'Stage 18: expected exactly one approver-permission case, found %.', hits;
    end if;
    if length((regexp_matches(patched, 'or case[^;]*end;'))[1]) > 800 then
        raise exception 'Stage 18: the approver-permission case matched % characters, which is far more than it should be. Refusing to patch.',
            length((regexp_matches(patched, 'or case[^;]*end;'))[1]);
    end if;
    patched := regexp_replace(patched, 'or case[^;]*end;', ';');

    /* And the whole patch must not have removed anything substantial. Three substitutions add
       characters and one removes about 560; anything outside that band means a regex ran away. */
    if length(patched) < length(src) - 700 then
        raise exception 'Stage 18: patching removed % characters, which is far too many. Refusing to apply.',
            length(src) - length(patched);
    end if;

    patched := replace(
        patched,
        'Every required approver must be an active resource with stage-gate approval permission.',
        'Every required approver must be an active person with an enabled account.'
    );

    execute patched;
    raise notice 'Stage 18: ppm_commit_stage_gate_workflow now accepts named approvers.';
end
$patch$;
