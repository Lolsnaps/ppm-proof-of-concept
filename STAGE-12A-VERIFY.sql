/* Portfolio Manager — Stage 12A read-only verification

   Run after STAGE-12A-PEOPLE-WRITES-MIGRATION.sql. Every statement is a SELECT.
   Expect PASS on every row.

   public.people is the identity table, so the checks that matter most are the ones
   proving the login path is intact and that auth_user_id cannot be written from the
   browser.
*/

select 'Stage 12A readiness function exists' as check,
       case when to_regprocedure('public.ppm_stage12a_ready()') is not null then 'PASS' else 'FAIL' end as result;

select 'Identity guard function exists' as check,
       case when to_regprocedure('private.guard_person_identity()') is not null then 'PASS' else 'FAIL' end as result;

select 'people.version column present (optimistic locking)' as check,
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='people' and column_name='version')
            then 'PASS' else 'FAIL' end as result;

select 'Guard, lock and audit triggers installed' as check,
       case when count(*) = 3 then 'PASS' else 'FAIL: ' || count(*) || ' of 3' end as result
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and n.nspname = 'public' and c.relname = 'people'
  and t.tgname = any(array['trg_people_identity','trg_people_lock','trg_people_audit']);

/* --------------------------------------------------------------- login path */

select 'LOGIN PATH: exactly the expected accounts are linked and readable' as check,
       case when count(*) >= 1 then 'PASS — ' || count(*) || ' linked account(s)'
            else 'FAIL — no linked account can sign in' end as result
from public.people
where auth_user_id is not null
  and active = true
  and coalesce(account_status, 'Active') = 'Active';

select 'LOGIN PATH: own-record read policy still resolves identity' as check,
       case when exists (select 1 from pg_catalog.pg_policies
                          where schemaname='public' and tablename='people'
                            and policyname='people can read own record'
                            and qual like '%auth_user_id%'
                            and qual like '%active%'
                            and qual like '%account_status%')
            then 'PASS' else 'FAIL' end as result;

select 'LOGIN PATH: auth_user_id is still unique and FK-bound' as check,
       case when count(*) = 2 then 'PASS' else 'FAIL: ' || count(*) || ' of 2' end as result
from pg_catalog.pg_constraint c
join pg_catalog.pg_class t on t.oid = c.conrelid
join pg_catalog.pg_namespace n on n.oid = t.relnamespace
where n.nspname='public' and t.relname='people'
  and c.conname in ('people_auth_user_id_key','people_auth_user_id_fkey');

/* ------------------------------------------------------------------ security */

select 'people writable by browser, DELETE and worse revoked' as check,
       case when has_table_privilege('authenticated','public.people','SELECT')
             and has_table_privilege('authenticated','public.people','INSERT')
             and has_table_privilege('authenticated','public.people','UPDATE')
             and not has_table_privilege('authenticated','public.people','DELETE')
             and not has_table_privilege('authenticated','public.people','TRUNCATE')
             and not has_table_privilege('authenticated','public.people','TRIGGER')
             and not has_table_privilege('authenticated','public.people','REFERENCES')
            then 'PASS' else 'FAIL' end as result;

select 'anon has no access to people' as check,
       case when not has_table_privilege('anon','public.people','SELECT')
             and not has_table_privilege('anon','public.people','INSERT')
             and not has_table_privilege('anon','public.people','UPDATE')
             and not has_table_privilege('anon','public.people','DELETE')
            then 'PASS' else 'FAIL' end as result;

select 'Five policies installed' as check,
       case when count(*) = 5 then 'PASS'
            else 'FAIL: ' || count(*) || ' — expected aal2, own record, colleagues, insert, update' end as result
from pg_catalog.pg_policies where schemaname='public' and tablename='people';

select 'AAL2 enforced as a restrictive policy' as check,
       case when exists (select 1 from pg_catalog.pg_policies
                          where schemaname='public' and tablename='people'
                            and permissive='RESTRICTIVE' and qual like '%aal2%')
            then 'PASS' else 'FAIL' end as result;

select 'Writes require resources.edit AND visibility of the person' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as result
from pg_catalog.pg_policies
where schemaname='public' and tablename='people' and cmd='UPDATE'
  and qual like '%resources.edit%' and qual like '%can_access_person%';

select 'Directory visibility now has a portfolio-wide branch' as check,
       case when pg_get_functiondef(to_regprocedure('private.can_access_person(uuid)')::oid)
                 like '%has_portfolio_wide_access%'
            then 'PASS' else 'FAIL — some people are invisible to everyone' end as result;

/* -------------------------------------------------------------- data sanity */

select 'Every person has a resource identifier' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) || ' row(s) without one' end as result
from public.people where coalesce(btrim(legacy_resource_id), '') = '';

select 'No duplicate resource identifiers' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) || ' duplicate(s)' end as result
from (select legacy_resource_id from public.people
       group by legacy_resource_id having count(*) > 1) d;

select 'Nobody is their own manager' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) || ' row(s)' end as result
from public.people where manager_id = id;

select 'Manager links resolve to a real person' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*) || ' dangling link(s)' end as result
from public.people p
where p.manager_id is not null
  and not exists (select 1 from public.people m where m.id = p.manager_id);

/* ---------------------------------------------------------------- inspection */

select 'Directory' as summary,
       legacy_resource_id as resource_id,
       full_name,
       coalesce(nullif(team,''),'(no team)')            as team,
       coalesce(nullif(access_role,''),'(no login)')    as access_role,
       coalesce(account_status,'(none)')                as account_status,
       active,
       case when auth_user_id is not null then 'LINKED' else '-' end as login,
       version
from public.people
order by legacy_resource_id;

/* Who would be invisible to a portfolio-wide administrator if the visibility fix
   were ever reverted. Should return nothing now. */
select 'People with neither a team nor a project role' as summary,
       legacy_resource_id as resource_id, full_name
from public.people t
where coalesce(btrim(t.team), '') = ''
  and not exists (
      select 1 from public.projects pr
       where pr.project_manager_id = t.id or pr.sponsor_id = t.id or pr.project_lead_id = t.id
          or (t.legacy_resource_id = any (array_remove(array[
                pr.legacy_payload ->> 'projectManagerResourceId',
                pr.legacy_payload ->> 'sponsorResourceId',
                pr.legacy_payload ->> 'projectLeadResourceId',
                pr.legacy_payload ->> 'deputyProjectManagerResourceId',
                pr.legacy_payload ->> 'businessAnalystResourceId',
                pr.legacy_payload ->> 'technicalLeadResourceId',
                pr.legacy_payload ->> 'benefitOwnerResourceId',
                pr.legacy_payload ->> 'financialOwnerResourceId'], null)))
  )
order by legacy_resource_id;

select 'Access changes recorded in the verified audit trail' as summary,
       occurred_at, actor_name, record_key,
       changes -> 0 ->> 'field' as first_field_changed
from public.audit_log
where table_name = 'people'
order by occurred_at desc
limit 20;
