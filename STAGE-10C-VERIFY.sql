/* =============================================================================
   PORTFOLIO MANAGER — STAGE 10C READ-ONLY VERIFICATION
   No changes are made by this script.
   ========================================================================== */

with target(table_name) as (
  values
    ('project_plans'),
    ('project_raid'),
    ('project_benefits'),
    ('project_documents'),
    ('status_reports')
)
select
  'Stage 10C tables exist' as check,
  case when count(*) = 5 then 'PASS' else 'FAIL: ' || count(*) end as result
from information_schema.tables t
join target x on x.table_name = t.table_name
where t.table_schema = 'public';

with target(table_name) as (
  values
    ('project_plans'),
    ('project_raid'),
    ('project_benefits'),
    ('project_documents'),
    ('status_reports')
)
select
  'soft-delete columns' as check,
  case when count(*) = 5 then 'PASS' else 'FAIL: ' || count(*) end as result
from information_schema.columns c
join target x on x.table_name = c.table_name
where c.table_schema = 'public'
  and c.column_name = 'deleted_at';

with target(table_name) as (
  values
    ('project_plans'),
    ('project_raid'),
    ('project_benefits'),
    ('project_documents'),
    ('status_reports')
)
select
  'RLS enabled' as check,
  case when count(*) = 5 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join target x on x.table_name = c.relname
where n.nspname = 'public'
  and c.relrowsecurity;

with target(table_name) as (
  values
    ('project_plans'),
    ('project_raid'),
    ('project_benefits'),
    ('project_documents'),
    ('status_reports')
)
select
  'authenticated SELECT/INSERT/UPDATE' as check,
  case when count(*) = 5 then 'PASS' else 'FAIL: ' || count(*) end as result
from target x
where has_table_privilege('authenticated', format('public.%I', x.table_name), 'SELECT')
  and has_table_privilege('authenticated', format('public.%I', x.table_name), 'INSERT')
  and has_table_privilege('authenticated', format('public.%I', x.table_name), 'UPDATE');

with target(table_name) as (
  values
    ('project_plans'),
    ('project_raid'),
    ('project_benefits'),
    ('project_documents'),
    ('status_reports')
)
select
  'authenticated destructive privileges' as check,
  case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) end as result
from target x
where has_table_privilege('authenticated', format('public.%I', x.table_name), 'DELETE')
   or has_table_privilege('authenticated', format('public.%I', x.table_name), 'TRUNCATE')
   or has_table_privilege('authenticated', format('public.%I', x.table_name), 'TRIGGER')
   or has_table_privilege('authenticated', format('public.%I', x.table_name), 'REFERENCES');

with target(table_name) as (
  values
    ('project_plans'),
    ('project_raid'),
    ('project_benefits'),
    ('project_documents'),
    ('status_reports')
)
select
  'anon privileges' as check,
  case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) end as result
from target x
where has_table_privilege('anon', format('public.%I', x.table_name), 'SELECT')
   or has_table_privilege('anon', format('public.%I', x.table_name), 'INSERT')
   or has_table_privilege('anon', format('public.%I', x.table_name), 'UPDATE')
   or has_table_privilege('anon', format('public.%I', x.table_name), 'DELETE')
   or has_table_privilege('anon', format('public.%I', x.table_name), 'TRUNCATE');

with target(table_name) as (
  values
    ('project_plans'),
    ('project_raid'),
    ('project_benefits'),
    ('project_documents'),
    ('status_reports')
), expected(table_name, trigger_name) as (
  select table_name, 'trg_' || table_name || '_key' from target
  union all
  select table_name, 'trg_' || table_name || '_lock' from target
  union all
  select table_name, 'trg_' || table_name || '_audit' from target
)
select
  'key/lock/audit triggers' as check,
  case when count(*) = 15 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join expected e on e.table_name = c.relname and e.trigger_name = t.tgname
where n.nspname = 'public'
  and not t.tgisinternal;

select
  'benefit programme scope helper' as check,
  case when to_regprocedure('private.can_access_programme_code(text)') is not null
       then 'PASS' else 'FAIL' end as result;
