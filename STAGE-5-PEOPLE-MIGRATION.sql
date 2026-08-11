/* =============================================================================
   PORTFOLIO MANAGER — STAGE 5 (database part)
   Widen public.people so a user can see colleagues in their own scope

   Until now the browser could read exactly one people row: its own. That was
   correct while only login needed it, but it blocks the Resources module and
   stops the adapter resolving a project's project_manager_id into a name.

   This adds a SECOND permissive policy. Permissive policies are ORed, so the
   existing "people can read own record" still stands on its own and signing in
   cannot break — which matters because Executive / Steering User does not hold
   resources.view and must still be able to read itself.

   A user holding resources.view may additionally read a person who is:
       - on the same team, or
       - named on a project that user can already access

   Everything else stays as it was. No write access is granted.

   SAFE TO RE-RUN.
   ========================================================================== */

begin;

create or replace function private.can_access_person(target_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    with me as (
        select
            pe.id,
            nullif(btrim(lower(coalesce(pe.team, ''))), '') as team_key
        from public.people pe
        where pe.auth_user_id = (select auth.uid())
          and pe.active = true
          and coalesce(pe.account_status, 'Active') = 'Active'
        limit 1
    ),
    target as (
        select
            t.id,
            t.legacy_resource_id,
            nullif(btrim(lower(coalesce(t.team, ''))), '') as team_key
        from public.people t
        where t.id = target_person_id
    )
    select coalesce(bool_or(
        -- Always yourself, so this function can never be the reason a sign-in fails.
        me.id = t.id

        -- Somebody on the same team.
        or (me.team_key is not null and me.team_key = t.team_key)

        -- Somebody named on a project this user can already reach. Reuses
        -- can_access_project, so people visibility can never exceed project
        -- visibility.
        or exists (
            select 1
            from public.projects pr
            where private.can_access_project(pr.project_code)
              and (
                  pr.project_manager_id = t.id
                  or pr.sponsor_id      = t.id
                  or pr.project_lead_id = t.id
                  or (
                      t.legacy_resource_id is not null
                      and t.legacy_resource_id = any (array_remove(array[
                          pr.legacy_payload ->> 'projectManagerResourceId',
                          pr.legacy_payload ->> 'sponsorResourceId',
                          pr.legacy_payload ->> 'projectLeadResourceId',
                          pr.legacy_payload ->> 'deputyProjectManagerResourceId',
                          pr.legacy_payload ->> 'businessAnalystResourceId',
                          pr.legacy_payload ->> 'technicalLeadResourceId',
                          pr.legacy_payload ->> 'benefitOwnerResourceId',
                          pr.legacy_payload ->> 'financialOwnerResourceId'
                      ], null))
                  )
              )
        )
    ), false)
    from me
    left join target t on true;
$$;

revoke all  on function private.can_access_person(uuid) from public;
grant execute on function private.can_access_person(uuid) to authenticated;

/*
  Permissive, and therefore ORed with "people can read own record". The
  resources.view check lives INSIDE this policy rather than in a restrictive one,
  because a restrictive policy would also gate the own-record read and lock out
  any role that lacks resources.view.
*/
drop policy if exists "people can read colleagues in scope" on public.people;

create policy "people can read colleagues in scope"
on public.people
for select
to authenticated
using (
    (select private.has_permission('resources.view'))
    and (select private.can_access_person(id))
);

/*
  Tighten the own-record read. Since Stage 3C this policy checked only
  auth_user_id, so a suspended or deactivated account could still read its own
  row through the API. It now also requires the account to be usable.

  Login still refuses a suspended account either way; the difference is that the
  refusal no longer confirms the account exists in a particular state.
*/
drop policy if exists "people can read own record" on public.people;

create policy "people can read own record"
on public.people
for select
to authenticated
using (
    auth_user_id = (select auth.uid())
    and active = true
    and coalesce(account_status, 'Active') = 'Active'
);

commit;

select 'can_access_person exists' as check,
       count(*)::text as found, '1' as expected,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private' and p.proname = 'can_access_person'
union all
select 'people SELECT policies', count(*)::text, '3',
       case when count(*) = 3 then 'PASS' else 'FAIL' end
from pg_policies where schemaname='public' and tablename='people'
union all
select 'own-record policy still present and permissive', count(*)::text, '1',
       case when count(*) = 1 then 'PASS' else 'FAIL' end
from pg_policies
where schemaname='public' and tablename='people'
  and policyname='people can read own record' and permissive='PERMISSIVE'
union all
select 'people still SELECT-only for authenticated',
       (has_table_privilege('authenticated','public.people','select')
        and not has_table_privilege('authenticated','public.people','update')
        and not has_table_privilege('authenticated','public.people','insert')
        and not has_table_privilege('authenticated','public.people','delete'))::text,
       'true',
       case when has_table_privilege('authenticated','public.people','select')
             and not has_table_privilege('authenticated','public.people','update')
            then 'PASS' else 'FAIL' end;
