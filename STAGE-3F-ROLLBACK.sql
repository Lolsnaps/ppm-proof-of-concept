/* =============================================================================
   PORTFOLIO MANAGER — STAGE 3F ROLLBACK

   Puts the database back exactly as Stage 3C left it:
     - removes the three permission-based SELECT policies
     - restores the original two-scope can_access_project()
     - drops the permission model tables and helper functions

   The AAL2 policies, the project/programme/portfolio scope policies and the
   read-only grants are NOT touched, so sign-in and reads keep working.
   ========================================================================== */

begin;

drop policy if exists "projects require view permission"   on public.projects;
drop policy if exists "programmes require view permission" on public.programmes;
drop policy if exists "portfolios require view permission" on public.portfolios;

-- Original Stage 3C version, restored verbatim.
create or replace function private.can_access_project(target_project_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.people p
        where p.auth_user_id = (select auth.uid())
          and p.active = true
          and (
              p.access_scope = 'Portfolio-wide'
              or target_project_code = any(p.selected_project_codes)
          )
    );
$$;

drop function if exists private.has_permission(text, text);
drop function if exists private.has_permission(text);
drop function if exists private.effective_permissions();

drop table if exists private.role_permissions;
drop table if exists private.roles;
drop table if exists private.permissions;

commit;

select 'rollback complete' as status,
       (select count(*) from pg_policies
         where schemaname='public' and policyname like '%require view permission') as view_policies_remaining,
       (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='private' and p.proname='has_permission') as has_permission_remaining;
