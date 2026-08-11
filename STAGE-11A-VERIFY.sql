/* =============================================================================
   PORTFOLIO MANAGER — STAGE 11A READ-ONLY VERIFICATION
   Run AFTER STAGE-11A-GOVERNANCE-WORKFLOW-MIGRATION.sql.
   Makes no changes.
   ========================================================================== */

select 'workflow rpc exists' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'ppm_commit_stage_gate_workflow'
  and p.pronargs = 9;

select 'workflow rpc is SECURITY DEFINER + pinned search_path' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'ppm_commit_stage_gate_workflow'
  and p.prosecdef = true
  and exists (
      select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
      where cfg like 'search_path=%'
  );

select 'stage11 readiness rpc exists' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'ppm_stage11a_ready';

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

select 'authenticated can execute readiness rpc' as check,
       case when has_function_privilege('authenticated','public.ppm_stage11a_ready()','EXECUTE')
            then 'PASS' else 'FAIL' end as result;

select 'anon cannot execute readiness rpc' as check,
       case when not has_function_privilege('anon','public.ppm_stage11a_ready()','EXECUTE')
            then 'PASS' else 'FAIL' end as result;

select 'stage-gate workflow guard exists' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'stage_gates'
  and t.tgname = 'trg_stage_gates_workflow_guard'
  and not t.tgisinternal;

select 'Stage 11A tables use RLS' as check,
       case when count(*) = 3 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('project_actions','project_decisions','stage_gates')
  and c.relrowsecurity = true;

select 'Stage 11A soft-delete columns' as check,
       case when count(*) = 3 then 'PASS' else 'FAIL: ' || count(*) end as result
from information_schema.columns
where table_schema = 'public'
  and column_name = 'deleted_at'
  and table_name in ('project_actions','project_decisions','stage_gates');

select 'Stage 11A optimistic-lock triggers' as check,
       case when count(*) = 3 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('project_actions','project_decisions','stage_gates')
  and t.tgname in ('trg_project_actions_lock','trg_project_decisions_lock','trg_stage_gates_lock')
  and not t.tgisinternal;

select 'Stage 11A server-audit triggers' as check,
       case when count(*) = 3 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('project_actions','project_decisions','stage_gates')
  and t.tgname in ('trg_project_actions_audit','trg_project_decisions_audit','trg_stage_gates_audit')
  and not t.tgisinternal;

select 'authenticated/anon have no DELETE on Stage 11A tables' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) end as result
from information_schema.role_table_grants
where grantee in ('authenticated','anon')
  and privilege_type = 'DELETE'
  and table_schema = 'public'
  and table_name in ('project_actions','project_decisions','stage_gates');

-- Diagnostic only: useful after the browser seed. No PASS/FAIL expectation.
select 'seeded Stage 11A rows' as diagnostic,
       (select count(*) from public.project_actions) as actions,
       (select count(*) from public.project_decisions) as decisions,
       (select count(*) from public.stage_gates) as stage_gates;
