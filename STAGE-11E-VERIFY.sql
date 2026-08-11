/* Portfolio Manager — Stage 11E read-only verification

   Run after STAGE-11E-RAG-HISTORY-MIGRATION.sql. Every statement is a SELECT;
   nothing here changes data, grants or structure.

   Expect PASS on every row. The privilege checks are the important ones: they
   are what distinguishes append-only recorded history from an ordinary editable
   child table.
*/

select 'Stage 11E readiness function exists' as check,
       case when to_regprocedure('public.ppm_stage11e_ready()') is not null
            then 'PASS' else 'FAIL' end as result;

select 'Append guard function exists' as check,
       case when to_regprocedure('private.rag_history_append_guard()') is not null
            then 'PASS' else 'FAIL' end as result;

select 'Immutability function exists' as check,
       case when to_regprocedure('private.rag_history_immutable()') is not null
            then 'PASS' else 'FAIL' end as result;

select 'Payload audit function exists' as check,
       case when to_regprocedure('private.record_rag_history_audit()') is not null
            then 'PASS' else 'FAIL' end as result;

select 'Normalised columns present' as check,
       case when count(*) = 3 then 'PASS' else 'FAIL: ' || count(*) || ' of 3' end as result
from information_schema.columns
where table_schema = 'public'
  and table_name = 'rag_history'
  and (column_name, udt_name) in (
      ('recorded_at', 'timestamptz'),
      ('recorded_by', 'text'),
      ('dimensions',  'jsonb')
  );

select 'Derived reporting columns present' as check,
       case when count(*) = 3 then 'PASS' else 'FAIL: ' || count(*) || ' of 3' end as result
from information_schema.columns
where table_schema = 'public'
  and table_name = 'rag_history'
  and column_name = any(array['overall_calculated', 'overall_reported', 'override_count']);

select 'Chronology index present' as check,
       case when to_regclass('public.rag_history_recorded_idx') is not null
            then 'PASS' else 'FAIL' end as result;

select 'Append-only triggers installed' as check,
       case when count(*) = 3 then 'PASS' else 'FAIL: ' || count(*) || ' of 3' end as result
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and c.relname = 'rag_history'
  and t.tgname = any(array[
      'trg_rag_history_append_guard',
      'trg_rag_history_immutable',
      'trg_rag_history_payload_audit'
  ]);

/* Stage 9's before-update triggers are deliberately retired: with UPDATE
   refused outright they are unreachable, and leaving them would imply this
   table has a concurrency model. */
select 'Update-shaped Stage 9 triggers retired' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) || ' still present' end as result
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and c.relname = 'rag_history'
  and t.tgname = any(array['trg_rag_history_lock', 'trg_rag_history_key']);

select 'RLS enabled on rag_history' as check,
       case when bool_and(c.relrowsecurity) then 'PASS' else 'FAIL' end as result
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'rag_history';

select 'Read and insert policies installed' as check,
       case when count(*) = 3 then 'PASS' else 'FAIL: ' || count(*) || ' of 3' end as result
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = 'rag_history'
  and policyname = any(array[
      'rag_history require aal2',
      'rag_history read scope',
      'rag_history insert'
  ]);

/* The single most important check in this file. An UPDATE policy here would
   mean Stage 9 has been re-run over the top of Stage 11E. */
select 'No UPDATE or DELETE policy exists' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || string_agg(policyname, ', ') end as result
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = 'rag_history'
  and cmd in ('UPDATE', 'DELETE');

select 'authenticated may read and append' as check,
       case when has_table_privilege('authenticated', 'public.rag_history', 'SELECT')
             and has_table_privilege('authenticated', 'public.rag_history', 'INSERT')
            then 'PASS' else 'FAIL' end as result;

select 'authenticated cannot change or remove history' as check,
       case when not has_table_privilege('authenticated', 'public.rag_history', 'UPDATE')
             and not has_table_privilege('authenticated', 'public.rag_history', 'DELETE')
             and not has_table_privilege('authenticated', 'public.rag_history', 'TRUNCATE')
             and not has_table_privilege('authenticated', 'public.rag_history', 'TRIGGER')
             and not has_table_privilege('authenticated', 'public.rag_history', 'REFERENCES')
            then 'PASS' else 'FAIL' end as result;

select 'anon has no access at all' as check,
       case when not has_table_privilege('anon', 'public.rag_history', 'SELECT')
             and not has_table_privilege('anon', 'public.rag_history', 'INSERT')
             and not has_table_privilege('anon', 'public.rag_history', 'UPDATE')
             and not has_table_privilege('anon', 'public.rag_history', 'DELETE')
            then 'PASS' else 'FAIL' end as result;

select 'Readiness probe executable by authenticated only' as check,
       case when has_function_privilege('authenticated', 'public.ppm_stage11e_ready()', 'EXECUTE')
             and not has_function_privilege('anon', 'public.ppm_stage11e_ready()', 'EXECUTE')
            then 'PASS' else 'FAIL' end as result;

/* ---------------------------------------------------------------- data shape */

select 'Every row has a project code and status id' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) || ' row(s)' end as result
from public.rag_history
where coalesce(btrim(project_code), '') = ''
   or coalesce(btrim(record_key), '') = '';

select 'No row has been soft-deleted' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) || ' row(s)' end as result
from public.rag_history
where deleted_at is not null;

select 'Every row is still at version 1' as check,
       case when count(*) = 0 then 'PASS'
            else 'FAIL: ' || count(*) || ' row(s) have been versioned, so something updated them' end as result
from public.rag_history
where version <> 1;

select 'Normalised values agree with the payload' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) || ' row(s) disagree' end as result
from public.rag_history r
where (
        r.recorded_by is distinct from nullif(r.legacy_payload ->> 'recordedBy', '')
      )
   or (
        jsonb_typeof(coalesce(r.legacy_payload -> 'dimensions', 'null'::jsonb)) = 'object'
        and r.dimensions is distinct from r.legacy_payload -> 'dimensions'
      )
   or (
        coalesce(r.legacy_payload ->> 'recordedAt', '') ~ '^\d{4}-\d{2}-\d{2}([T ]|$)'
        and r.recorded_at is distinct from (r.legacy_payload ->> 'recordedAt')::timestamptz
      );

select 'Derived override counts agree with the dimensions' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) || ' row(s) disagree' end as result
from public.rag_history r
where coalesce(r.override_count, -1) is distinct from (
    select count(*)
      from jsonb_each(case
               when jsonb_typeof(coalesce(r.dimensions, 'null'::jsonb)) = 'object' then r.dimensions
               else '{}'::jsonb
           end) as d(dim_key, dim_value)
     where jsonb_typeof(d.dim_value) = 'object'
       and lower(coalesce(d.dim_value ->> 'override', '')) in ('true', 't', '1', 'yes')
);

select 'No duplicate status id within a project' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) || ' duplicate group(s)' end as result
from (
    select project_code, record_key
      from public.rag_history
     group by project_code, record_key
    having count(*) > 1
) duplicates;

/* --------------------------------------------------------------- inspection */

select 'Recorded status rows by project' as summary,
       project_code,
       count(*)              as records,
       min(recorded_at)      as first_recorded,
       max(recorded_at)      as last_recorded,
       sum(coalesce(override_count, 0)) as total_overrides
from public.rag_history
group by project_code
order by project_code;

select 'Server audit entries for recorded status' as summary,
       count(*) as audit_rows,
       min(occurred_at) as first_entry,
       max(occurred_at) as last_entry
from public.audit_log
where table_name = 'rag_history';
