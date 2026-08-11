/* =============================================================================
   PORTFOLIO MANAGER — STAGE 10B
   Milestones cutover prerequisite / live-state verification

   READ-ONLY. This file changes nothing.
   ========================================================================== */

select
    'project_milestones deleted_at exists' as check,
    case when exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'project_milestones'
          and column_name = 'deleted_at'
    ) then 'PASS' else 'FAIL' end as result;

select
    'authenticated milestone privileges' as check,
    case when
        has_table_privilege('authenticated', 'public.project_milestones', 'SELECT')
        and has_table_privilege('authenticated', 'public.project_milestones', 'INSERT')
        and has_table_privilege('authenticated', 'public.project_milestones', 'UPDATE')
        and not has_table_privilege('authenticated', 'public.project_milestones', 'DELETE')
        and not has_table_privilege('authenticated', 'public.project_milestones', 'TRUNCATE')
    then 'PASS' else 'FAIL' end as result;

select
    'anon milestone privileges' as check,
    case when not (
        has_table_privilege('anon', 'public.project_milestones', 'SELECT')
        or has_table_privilege('anon', 'public.project_milestones', 'INSERT')
        or has_table_privilege('anon', 'public.project_milestones', 'UPDATE')
        or has_table_privilege('anon', 'public.project_milestones', 'DELETE')
        or has_table_privilege('anon', 'public.project_milestones', 'TRUNCATE')
    ) then 'PASS' else 'FAIL' end as result;

select
    'milestone RLS enabled' as check,
    case when c.relrowsecurity then 'PASS' else 'FAIL' end as result
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'project_milestones';

select
    'milestone key/lock/audit triggers' as check,
    case when count(*) = 3 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'project_milestones'
  and not t.tgisinternal
  and t.tgname = any(array[
      'trg_project_milestones_key',
      'trg_project_milestones_lock',
      'trg_project_milestones_audit'
  ]);

select
    project_code,
    record_key,
    version,
    deleted_at
from public.project_milestones
order by project_code, record_key;
