/* Portfolio Manager — Stage 12 read-only verification

   Run after STAGE-12-REMAINING-STORES-MIGRATION.sql. Every statement is a SELECT.
   Expect PASS on every row.
*/

with expected(tbl, family) as (
    values
        ('programme_milestones',       'programme'),
        ('programme_raid',             'programme'),
        ('lifecycle_templates',        'config'),
        ('lifecycle_mandatory_rules',  'config'),
        ('reference_data',             'config'),
        ('reporting_calendars',        'config'),
        ('reporting_periods',          'config'),
        ('rag_config',                 'config'),
        ('financial_categories',       'config'),
        ('resource_absence',           'config'),
        ('resource_config',            'config'),
        ('resource_gantt_views',       'view'),
        ('report_views',               'view'),
        ('search_views',               'view')
)
select 'All 14 Stage 12 tables exist' as check,
       case when count(*) filter (where to_regclass('public.' || tbl) is not null) = 14
            then 'PASS'
            else 'FAIL: missing ' || coalesce(string_agg(tbl, ', ') filter (where to_regclass('public.' || tbl) is null), '?')
       end as result
from expected;

select 'Stage 12 readiness function exists' as check,
       case when to_regprocedure('public.ppm_stage12_ready()') is not null then 'PASS' else 'FAIL' end as result;

select 'Shared scope_key machinery exists' as check,
       case when to_regprocedure('private.protect_scope_key()') is not null
             and to_regprocedure('private.record_scope_audit()') is not null
             and to_regprocedure('private.own_saved_view()') is not null
            then 'PASS' else 'FAIL' end as result;

/* ------------------------------------------------------------------ structure */

select 'Every table has the scope_key scaffold' as check,
       case when count(*) = 14 then 'PASS' else 'FAIL: ' || count(*) || ' of 14' end as result
from (
    select table_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name = any(array[
           'programme_milestones','programme_raid','lifecycle_templates',
           'lifecycle_mandatory_rules','reference_data','reporting_calendars',
           'reporting_periods','rag_config','financial_categories',
           'resource_absence','resource_config','resource_gantt_views',
           'report_views','search_views'])
       and column_name in ('scope_key','record_key','legacy_payload','version','deleted_at')
     group by table_name
    having count(*) = 5
) complete;

select 'Every table has a unique (scope_key, record_key)' as check,
       case when count(*) = 14 then 'PASS' else 'FAIL: ' || count(*) || ' of 14' end as result
from pg_catalog.pg_constraint c
join pg_catalog.pg_class t on t.oid = c.conrelid
join pg_catalog.pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and c.contype = 'u'
  and t.relname = any(array[
      'programme_milestones','programme_raid','lifecycle_templates',
      'lifecycle_mandatory_rules','reference_data','reporting_calendars',
      'reporting_periods','rag_config','financial_categories',
      'resource_absence','resource_config','resource_gantt_views',
      'report_views','search_views'])
  /* attname is type "name", and there is no name[] = text[] operator, so the
     aggregate is cast to text[] before comparing. */
  and (
      select array_agg(a.attname::text order by a.attname::text)
        from pg_catalog.pg_attribute a
       where a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  ) = array['record_key','scope_key']::text[];

select 'Saved views carry owner and publish columns' as check,
       case when count(*) = 6 then 'PASS' else 'FAIL: ' || count(*) || ' of 6' end as result
from information_schema.columns
where table_schema = 'public'
  and table_name = any(array['resource_gantt_views','report_views','search_views'])
  and column_name in ('owner_auth_user_id','view_scope');

/* ------------------------------------------------------------------- security */

select 'RLS enabled on all 14' as check,
       case when count(*) = 14 then 'PASS' else 'FAIL: ' || count(*) || ' of 14' end as result
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relrowsecurity
  and c.relname = any(array[
      'programme_milestones','programme_raid','lifecycle_templates',
      'lifecycle_mandatory_rules','reference_data','reporting_calendars',
      'reporting_periods','rag_config','financial_categories',
      'resource_absence','resource_config','resource_gantt_views',
      'report_views','search_views']);

select 'Each table has aal2 + read + insert + update policies' as check,
       case when count(*) = 14 then 'PASS' else 'FAIL: ' || count(*) || ' of 14' end as result
from (
    select tablename
      from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename = any(array[
           'programme_milestones','programme_raid','lifecycle_templates',
           'lifecycle_mandatory_rules','reference_data','reporting_calendars',
           'reporting_periods','rag_config','financial_categories',
           'resource_absence','resource_config','resource_gantt_views',
           'report_views','search_views'])
     group by tablename
    having count(*) = 4
) full_set;

select 'AAL2 is enforced as a restrictive policy' as check,
       case when count(*) = 14 then 'PASS' else 'FAIL: ' || count(*) || ' of 14' end as result
from pg_catalog.pg_policies
where schemaname = 'public'
  and permissive = 'RESTRICTIVE'
  and qual like '%aal2%'
  and tablename = any(array[
      'programme_milestones','programme_raid','lifecycle_templates',
      'lifecycle_mandatory_rules','reference_data','reporting_calendars',
      'reporting_periods','rag_config','financial_categories',
      'resource_absence','resource_config','resource_gantt_views',
      'report_views','search_views']);

select 'Programme tables are scoped by programme, not permission alone' as check,
       case when count(*) = 2 then 'PASS' else 'FAIL: ' || count(*) || ' of 2' end as result
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = any(array['programme_milestones','programme_raid'])
  and cmd = 'SELECT'
  and qual like '%can_access_programme_code%';

select 'Saved view reads are limited to own or shared rows' as check,
       case when count(*) = 3 then 'PASS' else 'FAIL: ' || count(*) || ' of 3' end as result
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = any(array['resource_gantt_views','report_views','search_views'])
  and cmd = 'SELECT'
  and qual like '%owner_auth_user_id%'
  and qual like '%shared%';

select 'Publishing a shared view requires views.publish' as check,
       case when count(*) = 6 then 'PASS' else 'FAIL: ' || count(*) || ' of 6' end as result
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = any(array['resource_gantt_views','report_views','search_views'])
  and cmd in ('INSERT','UPDATE')
  and with_check like '%views.publish%';

/* The most important check in this file. */
select 'authenticated can read and write but never destroy' as check,
       case when count(*) = 14 then 'PASS' else 'FAIL: ' || count(*) || ' of 14 correct' end as result
from (
    select tbl from (
        values ('programme_milestones'),('programme_raid'),('lifecycle_templates'),
               ('lifecycle_mandatory_rules'),('reference_data'),('reporting_calendars'),
               ('reporting_periods'),('rag_config'),('financial_categories'),
               ('resource_absence'),('resource_config'),('resource_gantt_views'),
               ('report_views'),('search_views')
    ) as t(tbl)
    where has_table_privilege('authenticated', 'public.' || tbl, 'SELECT')
      and has_table_privilege('authenticated', 'public.' || tbl, 'INSERT')
      and has_table_privilege('authenticated', 'public.' || tbl, 'UPDATE')
      and not has_table_privilege('authenticated', 'public.' || tbl, 'DELETE')
      and not has_table_privilege('authenticated', 'public.' || tbl, 'TRUNCATE')
      and not has_table_privilege('authenticated', 'public.' || tbl, 'TRIGGER')
      and not has_table_privilege('authenticated', 'public.' || tbl, 'REFERENCES')
) correct;

select 'anon has no access to any Stage 12 table' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) || ' table(s) reachable' end as result
from (
    select tbl from (
        values ('programme_milestones'),('programme_raid'),('lifecycle_templates'),
               ('lifecycle_mandatory_rules'),('reference_data'),('reporting_calendars'),
               ('reporting_periods'),('rag_config'),('financial_categories'),
               ('resource_absence'),('resource_config'),('resource_gantt_views'),
               ('report_views'),('search_views')
    ) as t(tbl)
    where has_table_privilege('anon', 'public.' || tbl, 'SELECT')
       or has_table_privilege('anon', 'public.' || tbl, 'INSERT')
       or has_table_privilege('anon', 'public.' || tbl, 'UPDATE')
) reachable;

/* ------------------------------------------------------------------- triggers */

select 'Key protection, optimistic lock and audit triggers installed' as check,
       case when count(*) = 42 then 'PASS' else 'FAIL: ' || count(*) || ' of 42' end as result
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and c.relname = any(array[
      'programme_milestones','programme_raid','lifecycle_templates',
      'lifecycle_mandatory_rules','reference_data','reporting_calendars',
      'reporting_periods','rag_config','financial_categories',
      'resource_absence','resource_config','resource_gantt_views',
      'report_views','search_views'])
  and (t.tgname like '%\_key' or t.tgname like '%\_lock' or t.tgname like '%\_audit');

select 'Saved view ownership triggers installed' as check,
       case when count(*) = 3 then 'PASS' else 'FAIL: ' || count(*) || ' of 3' end as result
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and c.relname = any(array['resource_gantt_views','report_views','search_views'])
  and t.tgname like '%\_owner';

/* --------------------------------------------------------------------- audit */

select 'Audit read policy understands the new tables' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as result
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = 'audit_log'
  and policyname = 'users can read audit history'
  and qual like '%can_access_programme_code%'
  and qual like '%reference_data%';

/* ---------------------------------------------------------------- inspection */

select 'Row counts by table' as summary, c.relname as table_name, c.reltuples::bigint as approx_rows
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = any(array[
      'programme_milestones','programme_raid','lifecycle_templates',
      'lifecycle_mandatory_rules','reference_data','reporting_calendars',
      'reporting_periods','rag_config','financial_categories',
      'resource_absence','resource_config','resource_gantt_views',
      'report_views','search_views'])
order by c.relname;

select 'Saved views by owner and publication state' as summary,
       'report_views' as table_name, coalesce(view_scope, '(unset)') as view_scope, count(*) as views
from public.report_views group by view_scope
union all
select 'Saved views by owner and publication state', 'search_views', coalesce(view_scope, '(unset)'), count(*)
from public.search_views group by view_scope
union all
select 'Saved views by owner and publication state', 'resource_gantt_views', coalesce(view_scope, '(unset)'), count(*)
from public.resource_gantt_views group by view_scope;
