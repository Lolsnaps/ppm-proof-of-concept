/* Portfolio Manager — Stage 11D read-only verification */

select 'Stage 11D readiness function' as check,
       case when to_regprocedure('public.ppm_stage11d_ready()') is not null then 'PASS' else 'FAIL' end as result;

select 'Stage 11D workflow function' as check,
       case when to_regprocedure('public.ppm_commit_resource_scenario_workflow(text,text,integer)') is not null
            then 'PASS' else 'FAIL' end as result;

select 'Scenario project_codes column' as check,
       case when exists (
           select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'resource_scenarios'
              and column_name = 'project_codes'
              and udt_name = '_text'
       ) then 'PASS' else 'FAIL' end as result;

select 'Scenario project_codes index' as check,
       case when to_regclass('public.resource_scenarios_project_codes_gin_idx') is not null
            then 'PASS' else 'FAIL' end as result;

select 'Stage 11D workflow/scope/audit triggers' as check,
       case when count(*) = 4 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and (t.tgname, c.relname) in (
      ('trg_resource_scenarios_scope', 'resource_scenarios'),
      ('trg_resource_scenarios_workflow_guard', 'resource_scenarios'),
      ('trg_resource_scenarios_payload_audit', 'resource_scenarios'),
      ('trg_resource_demand_payload_audit', 'resource_demand')
  );

select 'Stage 11D child RLS enabled' as check,
       case when count(*) filter (where relrowsecurity) = 2 then 'PASS' else 'FAIL' end as result
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = any(array['resource_demand','resource_scenarios']);

select 'Scenario scope policies installed' as check,
       case when count(*) = 3 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = 'resource_scenarios'
  and policyname = any(array[
      'resource_scenarios read scope',
      'resource_scenarios insert',
      'resource_scenarios update'
  ]);

select 'Scenario stored scope matches payload' as check,
       case when exists (
           select 1
             from public.resource_scenarios rs
            where rs.project_codes is distinct from coalesce((
                select array_agg(distinct btrim(d.value->>'projectCode') order by btrim(d.value->>'projectCode'))
                  from jsonb_array_elements(coalesce(rs.legacy_payload->'demands', '[]'::jsonb)) d(value)
                 where nullif(btrim(coalesce(d.value->>'projectCode', '')), '') is not null
            ), '{}'::text[])
       ) then 'FAIL' else 'PASS' end as result;

select 'No malformed active scenario demand scope' as check,
       case when exists (
           select 1
             from public.resource_scenarios rs
            where rs.deleted_at is null
              and (
                  jsonb_typeof(coalesce(rs.legacy_payload->'demands', '[]'::jsonb)) <> 'array'
                  or exists (
                      select 1
                        from jsonb_array_elements(coalesce(rs.legacy_payload->'demands', '[]'::jsonb)) d(value)
                       where jsonb_typeof(d.value) <> 'object'
                          or nullif(btrim(coalesce(d.value->>'projectCode', '')), '') is null
                  )
              )
       ) then 'FAIL' else 'PASS' end as result;

select 'Stage 11D browser table grants' as check,
       case when
           has_table_privilege('authenticated', 'public.resource_demand', 'SELECT')
           and has_table_privilege('authenticated', 'public.resource_demand', 'INSERT')
           and has_table_privilege('authenticated', 'public.resource_demand', 'UPDATE')
           and not has_table_privilege('authenticated', 'public.resource_demand', 'DELETE')
           and not has_table_privilege('authenticated', 'public.resource_demand', 'TRUNCATE')
           and not has_table_privilege('authenticated', 'public.resource_demand', 'TRIGGER')
           and not has_table_privilege('authenticated', 'public.resource_demand', 'REFERENCES')
           and has_table_privilege('authenticated', 'public.resource_scenarios', 'SELECT')
           and has_table_privilege('authenticated', 'public.resource_scenarios', 'INSERT')
           and has_table_privilege('authenticated', 'public.resource_scenarios', 'UPDATE')
           and not has_table_privilege('authenticated', 'public.resource_scenarios', 'DELETE')
           and not has_table_privilege('authenticated', 'public.resource_scenarios', 'TRUNCATE')
           and not has_table_privilege('authenticated', 'public.resource_scenarios', 'TRIGGER')
           and not has_table_privilege('authenticated', 'public.resource_scenarios', 'REFERENCES')
       then 'PASS' else 'FAIL' end as result;

select 'Anon has no Stage 11D table privileges' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) end as result
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = any(array['resource_demand','resource_scenarios'])
  and grantee = 'anon';

select 'Authenticated may execute resource scenario RPC' as check,
       case when has_function_privilege(
           'authenticated',
           'public.ppm_commit_resource_scenario_workflow(text,text,integer)',
           'EXECUTE'
       ) then 'PASS' else 'FAIL' end as result;

select 'Anon cannot execute resource scenario RPC' as check,
       case when not has_function_privilege(
           'anon',
           'public.ppm_commit_resource_scenario_workflow(text,text,integer)',
           'EXECUTE'
       ) then 'PASS' else 'FAIL' end as result;

select 'Workflow function uses SECURITY DEFINER' as check,
       case when (select prosecdef from pg_catalog.pg_proc
                   where oid = to_regprocedure('public.ppm_commit_resource_scenario_workflow(text,text,integer)'))
            then 'PASS' else 'FAIL' end as result;

select 'Readiness/guards remain invoker functions' as check,
       case when
           not (select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure('public.ppm_stage11d_ready()'))
           and not (select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure('private.sync_resource_scenario_scope()'))
           and not (select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure('private.guard_resource_scenario_workflow_write()'))
       then 'PASS' else 'FAIL' end as result;

select 'Stage 11D helper/audit functions use SECURITY DEFINER where required' as check,
       case when
           (select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure('private.can_access_all_projects(text[])'))
           and (select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure('private.can_access_project(text)'))
           and (select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure('private.record_resource_payload_audit()'))
       then 'PASS' else 'FAIL' end as result;

select 'Pinned Stage 11D function search paths' as check,
       case when count(*) = 7 then 'PASS' else 'FAIL: ' || count(*) end as result
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (
    ('private','sync_resource_scenario_scope'),
    ('private','can_access_all_projects'),
    ('private','can_access_project'),
    ('private','guard_resource_scenario_workflow_write'),
    ('private','record_resource_payload_audit'),
    ('public','ppm_stage11d_ready'),
    ('public','ppm_commit_resource_scenario_workflow')
)
and exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
    where cfg like 'search_path=%'
);

/* Diagnostics only — no PASS/FAIL target. */
select 'resource_demand' as table_name, count(*) as active_rows
from public.resource_demand where deleted_at is null
union all
select 'resource_scenarios', count(*)
from public.resource_scenarios where deleted_at is null;

select 'Draft scenarios without Stage 11D version snapshot' as diagnostic,
       count(*) as rows
from public.resource_scenarios
where deleted_at is null
  and coalesce(nullif(btrim(legacy_payload->>'status'), ''), 'Draft') = 'Draft'
  and jsonb_typeof(coalesce(legacy_payload->'sourceDemandVersions', 'null'::jsonb)) <> 'object';
