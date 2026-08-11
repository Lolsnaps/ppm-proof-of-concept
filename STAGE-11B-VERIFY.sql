/* Portfolio Manager — Stage 11B read-only verification */

select 'Stage 11B readiness function' as check,
       case when to_regprocedure('public.ppm_stage11b_ready()') is not null then 'PASS' else 'FAIL' end as result;

select 'Stage 11B workflow function' as check,
       case when to_regprocedure('public.ppm_commit_baseline_workflow(text,text,jsonb,integer,date,text,jsonb)') is not null then 'PASS' else 'FAIL' end as result;

select 'Baseline workflow guards' as check,
       case when count(*) = 3 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_catalog.pg_trigger
where not tgisinternal
  and tgname = any(array[
      'trg_plan_baselines_workflow_guard',
      'trg_plan_baseline_requests_workflow_guard',
      'trg_project_plans_baseline_guard'
  ]);

select 'Child RLS enabled' as check,
       case when count(*) filter (where relrowsecurity) = 3 then 'PASS' else 'FAIL' end as result
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = any(array['project_plans','plan_baselines','plan_baseline_requests']);

select 'No authenticated DELETE on Stage 11B tables' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) end as result
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = any(array['project_plans','plan_baselines','plan_baseline_requests'])
  and grantee = 'authenticated'
  and privilege_type in ('DELETE','TRUNCATE');

select 'Authenticated may execute workflow RPC' as check,
       case when has_function_privilege(
           'authenticated',
           'public.ppm_commit_baseline_workflow(text,text,jsonb,integer,date,text,jsonb)',
           'EXECUTE'
       ) then 'PASS' else 'FAIL' end as result;

select 'Anon cannot execute workflow RPC' as check,
       case when not has_function_privilege(
           'anon',
           'public.ppm_commit_baseline_workflow(text,text,jsonb,integer,date,text,jsonb)',
           'EXECUTE'
       ) then 'PASS' else 'FAIL' end as result;

select 'Workflow functions use intended SECURITY DEFINER posture' as check,
       case when
           (select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure('public.ppm_commit_baseline_workflow(text,text,jsonb,integer,date,text,jsonb)'))
           and (select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure('private.guard_project_plan_baseline_dates()'))
           and not (select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure('public.ppm_stage11b_ready()'))
       then 'PASS' else 'FAIL' end as result;

select 'Pinned function search paths' as check,
       case when count(*) = 5 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (
    ('private','guard_plan_baseline_workflow_write'),
    ('private','guard_plan_baseline_request_workflow_write'),
    ('private','guard_project_plan_baseline_dates'),
    ('public','ppm_stage11b_ready'),
    ('public','ppm_commit_baseline_workflow')
)
and exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
    where cfg like 'search_path=%'
);

/* Diagnostic only — no PASS/FAIL target. */
select 'plan_baselines' as table_name, count(*) as active_rows
from public.plan_baselines where deleted_at is null
union all
select 'plan_baseline_requests', count(*)
from public.plan_baseline_requests where deleted_at is null
union all
select 'project_plans', count(*)
from public.project_plans where deleted_at is null;
