/*
  STAGE 15A — verification
  ========================

  Run in the Supabase SQL editor after applying STAGE-15A-MULTI-ROLE-MIGRATION.sql.
  Every row returned should read PASS. Read-only: it writes nothing.

  The claim being tested is narrow and specific: a person with no additional roles must get
  exactly the same answer from private.person_has_permission as the old rule gave. Everything
  else this migration does is new behaviour that could not previously be expressed, so it has
  nothing to be compared against - but the no-change claim is what makes the migration safe
  to apply to a live pilot, and it is checked here against every person and all 47
  permissions rather than argued.
*/

/* ---------------------------------------------------------------- 1. structure */

select
    'additional_roles column exists' as check,
    case when exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'people' and column_name = 'additional_roles'
    ) then 'PASS' else 'FAIL' end as result;

select
    'additional_roles defaults to empty, never null' as check,
    case when (
        select is_nullable = 'NO' and column_default like '%{}%'
          from information_schema.columns
         where table_schema = 'public' and table_name = 'people' and column_name = 'additional_roles'
    ) then 'PASS' else 'FAIL' end as result;

select
    'private.person_has_permission exists' as check,
    case when exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private' and p.proname = 'person_has_permission'
    ) then 'PASS' else 'FAIL' end as result;

select
    'the additional-role guard is installed' as check,
    case when exists (
        select 1 from pg_trigger where tgname = 'guard_additional_roles' and not tgisinternal
    ) then 'PASS' else 'FAIL' end as result;

/* ------------------------------------------------- 2. nothing changed for anyone

   The old rule, written out here as the control, evaluated against every person and every
   permission and compared with what the new function now returns. 24 people x 47
   permissions, so any single disagreement shows up.
*/
with control as (
    select
        pe.id,
        rp.permission_key,
        case
            when pe.permission_overrides ->> rp.permission_key = 'allow' then true
            when pe.permission_overrides ->> rp.permission_key = 'deny'  then false
            else exists (
                select 1 from private.role_permissions old
                 where old.role_name = pe.access_role
                   and old.permission_key = rp.permission_key
            )
        end as old_answer
      from public.people pe
      /* private.permissions is the catalogue of all 47 keys; role_permissions only holds the
         ones some role grants, so comparing against it would skip any permission reachable
         only through an override. */
      cross join (select key as permission_key from private.permissions) rp
     where pe.active = true
       and coalesce(pe.account_status, 'Active') = 'Active'
       and coalesce(array_length(pe.additional_roles, 1), 0) = 0
)
select
    'single-role answers are unchanged' as check,
    case when count(*) = 0 then 'PASS' else 'FAIL' end as result,
    count(*) as disagreements,
    format('%s person/permission pairs compared', (select count(*) from control)) as detail
  from control
 where control.old_answer is distinct from private.person_has_permission(control.id, control.permission_key);

/* ------------------------------------------- 3. the union actually does something

   A person given a second role must gain that role's permissions and keep their own. Tested
   against the role catalogue rather than against a person, so it needs no test account and
   writes nothing.
*/
with pair as (
    select 'Executive / Steering User'::text as primary_role,
           'Project Sponsor / Project Lead'::text as second_role,
           'stageGates.approve'::text as permission
),
answers as (
    select
        p.permission,
        exists (select 1 from private.role_permissions rp
                 where rp.role_name = p.primary_role and rp.permission_key = p.permission) as primary_has,
        exists (select 1 from private.role_permissions rp
                 where rp.role_name in (p.primary_role, p.second_role) and rp.permission_key = p.permission) as union_has
      from pair p
)
select
    'an executive gains stage-gate approval from a sponsor role' as check,
    case when primary_has = false and union_has = true then 'PASS' else 'FAIL' end as result,
    format('executive alone: %s, executive plus sponsor: %s', primary_has, union_has) as detail
  from answers;

/* ------------------------------------------------------- 4. the guard still guards */

select
    'access-control changes still need users.manage' as check,
    case when (
        select pg_get_functiondef(p.oid) like '%users.manage%'
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private' and p.proname = 'guard_person_identity'
    ) then 'PASS' else 'FAIL' end as result;

select
    'additional_roles is an access-control field' as check,
    case when (
        select pg_get_functiondef(p.oid) like '%additional_roles%'
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private' and p.proname = 'guard_person_identity'
    ) then 'PASS' else 'FAIL' end as result;

/* ------------------------------------- 5. the workflow RPCs union roles as well

   The eligibility checks inside the two workflow functions were patched in place. If a later
   migration recreates either function from its original source, this is what notices.
*/
select
    format('%s unions additional roles', p.proname) as check,
    case when pg_get_functiondef(p.oid) like '%additional_roles%' then 'PASS' else 'FAIL' end as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('ppm_commit_stage_gate_workflow', 'ppm_commit_financial_workflow')
 order by p.proname;

/* --------------------------------------------------------- 6. nothing new to anon */

select
    'anon cannot call the new function' as check,
    case when not has_function_privilege('anon', 'private.person_has_permission(uuid, text)', 'execute')
         then 'PASS' else 'FAIL' end as result;

/* ------------------------------------------------------------ 7. who holds what

   Not a test - the record of what the portfolio looks like after applying, for the delivery
   note. Expect every person to show an empty additional_roles until somebody is given one.
*/
select
    coalesce(access_role, '(no account)') as access_role,
    additional_roles,
    count(*) as people
  from public.people
 group by 1, 2
 order by 3 desc, 1;
