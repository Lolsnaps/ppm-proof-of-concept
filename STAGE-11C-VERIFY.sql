/* Portfolio Manager — Stage 11C read-only verification */

select 'Stage 11C readiness function' as check,
       case when to_regprocedure('public.ppm_stage11c_ready()') is not null then 'PASS' else 'FAIL' end as result;

select 'Stage 11C workflow function' as check,
       case when to_regprocedure('public.ppm_commit_financial_workflow(text,text,jsonb,integer,integer,text,jsonb)') is not null
            then 'PASS' else 'FAIL' end as result;

select 'Financial workflow guards' as check,
       case when count(*) = 2 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and (t.tgname, c.relname) in (
      ('trg_financial_approval_requests_workflow_guard', 'financial_approval_requests'),
      ('trg_project_financials_workflow_guard', 'project_financials')
  );

select 'Stage 11C child RLS enabled' as check,
       case when count(*) filter (where relrowsecurity) = 3 then 'PASS' else 'FAIL' end as result
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = any(array['project_financials','financial_entries','financial_approval_requests']);

select 'One active financial summary index' as check,
       case when to_regclass('public.project_financials_one_active_per_project_idx') is not null
            then 'PASS' else 'FAIL' end as result;

select 'One pending approval index' as check,
       case when to_regclass('public.financial_approvals_one_pending_per_project_idx') is not null
            then 'PASS' else 'FAIL' end as result;

select 'No duplicate active financial summaries' as check,
       case when exists (
           select 1
             from public.project_financials
            where deleted_at is null
            group by project_code
           having count(*) > 1
       ) then 'FAIL' else 'PASS' end as result;

select 'No duplicate pending approvals' as check,
       case when exists (
           select 1
             from public.financial_approval_requests
            where deleted_at is null
              and status = 'Pending Approval'
            group by project_code
           having count(*) > 1
       ) then 'FAIL' else 'PASS' end as result;

select 'Approval table is browser read-only after cutover' as check,
       case when
           has_table_privilege('authenticated', 'public.financial_approval_requests', 'SELECT')
           and not has_table_privilege('authenticated', 'public.financial_approval_requests', 'INSERT')
           and not has_table_privilege('authenticated', 'public.financial_approval_requests', 'UPDATE')
           and not has_table_privilege('authenticated', 'public.financial_approval_requests', 'DELETE')
           and not has_table_privilege('authenticated', 'public.financial_approval_requests', 'TRUNCATE')
       then 'PASS' else 'FAIL' end as result;


select 'Financial summary/entries remain browser-editable' as check,
       case when
           has_table_privilege('authenticated', 'public.project_financials', 'SELECT')
           and has_table_privilege('authenticated', 'public.project_financials', 'INSERT')
           and has_table_privilege('authenticated', 'public.project_financials', 'UPDATE')
           and has_table_privilege('authenticated', 'public.financial_entries', 'SELECT')
           and has_table_privilege('authenticated', 'public.financial_entries', 'INSERT')
           and has_table_privilege('authenticated', 'public.financial_entries', 'UPDATE')
       then 'PASS' else 'FAIL' end as result;

select 'Anon has no Stage 11C table privileges' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) end as result
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = any(array['project_financials','financial_entries','financial_approval_requests'])
  and grantee = 'anon';

select 'Authenticated may execute financial workflow RPC' as check,
       case when has_function_privilege(
           'authenticated',
           'public.ppm_commit_financial_workflow(text,text,jsonb,integer,integer,text,jsonb)',
           'EXECUTE'
       ) then 'PASS' else 'FAIL' end as result;

select 'Anon cannot execute financial workflow RPC' as check,
       case when not has_function_privilege(
           'anon',
           'public.ppm_commit_financial_workflow(text,text,jsonb,integer,integer,text,jsonb)',
           'EXECUTE'
       ) then 'PASS' else 'FAIL' end as result;

select 'Workflow functions use intended SECURITY DEFINER posture' as check,
       case when
           (select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure('public.ppm_commit_financial_workflow(text,text,jsonb,integer,integer,text,jsonb)'))
           and not (select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure('public.ppm_stage11c_ready()'))
           and not (select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure('private.guard_financial_approval_workflow_write()'))
           and not (select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure('private.guard_project_financial_approval_fields()'))
       then 'PASS' else 'FAIL' end as result;

select 'Pinned function search paths' as check,
       case when count(*) = 4 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (
    ('private','guard_financial_approval_workflow_write'),
    ('private','guard_project_financial_approval_fields'),
    ('public','ppm_stage11c_ready'),
    ('public','ppm_commit_financial_workflow')
)
and exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
    where cfg like 'search_path=%'
);

/* Diagnostic only — no PASS/FAIL target. */
select 'project_financials' as table_name, count(*) as active_rows
from public.project_financials where deleted_at is null
union all
select 'financial_entries', count(*)
from public.financial_entries where deleted_at is null
union all
select 'financial_approval_requests', count(*)
from public.financial_approval_requests where deleted_at is null;
