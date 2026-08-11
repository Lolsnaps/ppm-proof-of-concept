/* =============================================================================
   PORTFOLIO MANAGER — STAGE 6
   Allow the browser to WRITE portfolios, programmes and projects

   This is the first time the browser is granted anything beyond SELECT, so the
   guard rails matter more than the grants:

     Part 1  version columns so every table can be locked optimistically
     Part 2  triggers: optimistic locking, immutable business keys,
             archive gated on its own permission
     Part 3  INSERT and UPDATE grants - deliberately NO DELETE
     Part 4  write policies, gated on the Stage 3F permission model
     Part 5  verification

   DELETE is withheld on purpose. The application archives and deactivates rather
   than hard-deleting, so nothing needs it, and withholding it means no fault in
   the write path can destroy a row.

   SAFE TO RE-RUN.
   ========================================================================== */

begin;

/* ----------------------------------------------------------------- PART 1 */

alter table public.portfolios add column if not exists version integer not null default 1;
alter table public.programmes add column if not exists version integer not null default 1;
-- public.projects.version already exists from Stage 2.

/* ----------------------------------------------------------------- PART 2 */

/*
  Optimistic locking.

  The client sends back the version it read. If that no longer matches the row,
  somebody else changed it in between and the write is refused rather than
  silently overwriting their work. Otherwise the version is bumped.

  Raised as serialization_failure (40001) so the adapter can tell a genuine
  conflict apart from a permission problem and say something useful.
*/
create or replace function private.enforce_optimistic_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if NEW.version is null then
        raise exception
            'This record was saved without a version, so it cannot be checked for conflicts.'
            using errcode = '40001';
    end if;

    if NEW.version <> OLD.version then
        raise exception
            'This % was changed by someone else while you were editing it (you loaded version %, the current version is %). Reload and reapply your change.',
            TG_TABLE_NAME, NEW.version, OLD.version
            using errcode = '40001';
    end if;

    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    return NEW;
end;
$$;

/*
  Business keys identify records everywhere else in the application and in every
  localStorage collection that has not migrated yet. Letting the browser rewrite
  one would orphan plans, RAID items, milestones and audit history, so they are
  fixed once created.
*/
create or replace function private.protect_business_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    old_key text;
    new_key text;
begin
    if TG_TABLE_NAME = 'projects' then
        old_key := OLD.project_code;   new_key := NEW.project_code;
    elsif TG_TABLE_NAME = 'programmes' then
        old_key := OLD.programme_code; new_key := NEW.programme_code;
    else
        old_key := OLD.portfolio_code;  new_key := NEW.portfolio_code;
    end if;

    if new_key is distinct from old_key then
        raise exception
            'The identifier of an existing % cannot be changed (% to %). Other records refer to it.',
            TG_TABLE_NAME, old_key, new_key
            using errcode = '42501';
    end if;

    -- legacy_payload is preserved evidence of the original import.
    if TG_TABLE_NAME = 'projects' and NEW.legacy_payload is null and OLD.legacy_payload is not null then
        NEW.legacy_payload := OLD.legacy_payload;
    end if;

    return NEW;
end;
$$;

/*
  Archiving and reopening are their own permission in the application model.
  A row policy cannot compare old and new values, so the distinction between
  "edit this project" and "archive this project" is enforced here instead.
*/
create or replace function private.enforce_archive_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if coalesce(NEW.archived, false) is distinct from coalesce(OLD.archived, false)
       and not private.has_permission('projects.archive') then
        raise exception
            'Your role does not allow projects to be archived or reopened.'
            using errcode = '42501';
    end if;
    return NEW;
end;
$$;

drop trigger if exists trg_projects_lock       on public.projects;
drop trigger if exists trg_programmes_lock     on public.programmes;
drop trigger if exists trg_portfolios_lock     on public.portfolios;
drop trigger if exists trg_projects_key        on public.projects;
drop trigger if exists trg_programmes_key      on public.programmes;
drop trigger if exists trg_portfolios_key      on public.portfolios;
drop trigger if exists trg_projects_archive    on public.projects;

create trigger trg_projects_key    before update on public.projects
    for each row execute function private.protect_business_key();
create trigger trg_programmes_key  before update on public.programmes
    for each row execute function private.protect_business_key();
create trigger trg_portfolios_key  before update on public.portfolios
    for each row execute function private.protect_business_key();

create trigger trg_projects_archive before update on public.projects
    for each row execute function private.enforce_archive_permission();

-- Locking runs last so it always has the final say on version and updated_at.
create trigger trg_projects_lock   before update on public.projects
    for each row execute function private.enforce_optimistic_lock();
create trigger trg_programmes_lock before update on public.programmes
    for each row execute function private.enforce_optimistic_lock();
create trigger trg_portfolios_lock before update on public.portfolios
    for each row execute function private.enforce_optimistic_lock();

/* ----------------------------------------------------------------- PART 3 */

grant insert, update on public.projects, public.programmes, public.portfolios to authenticated;
revoke delete on public.projects, public.programmes, public.portfolios from authenticated;
revoke insert, update, delete on public.people from authenticated;
revoke all on public.projects, public.programmes, public.portfolios, public.people from anon;

/* ----------------------------------------------------------------- PART 4 */

drop policy if exists "users can create projects"    on public.projects;
drop policy if exists "users can update projects"    on public.projects;
drop policy if exists "users can create programmes"  on public.programmes;
drop policy if exists "users can update programmes"  on public.programmes;
drop policy if exists "users can create portfolios"  on public.portfolios;
drop policy if exists "users can update portfolios"  on public.portfolios;

drop policy if exists "projects require aal2 to write"   on public.projects;
drop policy if exists "programmes require aal2 to write" on public.programmes;
drop policy if exists "portfolios require aal2 to write" on public.portfolios;

-- MFA is required to write, exactly as it is to read.
create policy "projects require aal2 to write" on public.projects
    as restrictive for all to authenticated
    using ((select auth.jwt()->>'aal') = 'aal2')
    with check ((select auth.jwt()->>'aal') = 'aal2');
create policy "programmes require aal2 to write" on public.programmes
    as restrictive for all to authenticated
    using ((select auth.jwt()->>'aal') = 'aal2')
    with check ((select auth.jwt()->>'aal') = 'aal2');
create policy "portfolios require aal2 to write" on public.portfolios
    as restrictive for all to authenticated
    using ((select auth.jwt()->>'aal') = 'aal2')
    with check ((select auth.jwt()->>'aal') = 'aal2');

create policy "users can create projects" on public.projects
    for insert to authenticated
    with check ((select private.has_permission('projects.create')));

/*
  USING decides which rows may be updated; WITH CHECK decides what they may be
  updated to. Both require projects.edit and project access, so a user cannot
  edit a project outside their scope, nor move one out of their scope.
*/
create policy "users can update projects" on public.projects
    for update to authenticated
    using (
        (select private.has_permission('projects.edit'))
        and (select private.can_access_project(project_code))
    )
    with check (
        (select private.has_permission('projects.edit'))
        and (select private.can_access_project(project_code))
    );

create policy "users can create programmes" on public.programmes
    for insert to authenticated
    with check ((select private.has_permission('programmes.edit')));

create policy "users can update programmes" on public.programmes
    for update to authenticated
    using (
        (select private.has_permission('programmes.edit'))
        and (select private.can_access_programme(id))
    )
    with check ((select private.has_permission('programmes.edit')));

create policy "users can create portfolios" on public.portfolios
    for insert to authenticated
    with check ((select private.has_permission('portfolios.edit')));

create policy "users can update portfolios" on public.portfolios
    for update to authenticated
    using (
        (select private.has_permission('portfolios.edit'))
        and (select private.can_access_portfolio(id))
    )
    with check ((select private.has_permission('portfolios.edit')));

commit;

/* ----------------------------------------------------------------- PART 5 */

select 'version column on portfolios' as check,
       (count(*) = 1)::text as found, 'true' as expected
from information_schema.columns
where table_schema='public' and table_name='portfolios' and column_name='version'
union all
select 'version column on programmes', (count(*) = 1)::text, 'true'
from information_schema.columns
where table_schema='public' and table_name='programmes' and column_name='version'
union all
select 'write triggers installed', (count(*) = 7)::text, 'true'
from pg_trigger where tgname like 'trg_%' and not tgisinternal
union all
select 'authenticated can INSERT projects', has_table_privilege('authenticated','public.projects','insert')::text, 'true'
union all
select 'authenticated can UPDATE projects', has_table_privilege('authenticated','public.projects','update')::text, 'true'
union all
select 'authenticated CANNOT DELETE projects', (not has_table_privilege('authenticated','public.projects','delete'))::text, 'true'
union all
select 'authenticated CANNOT DELETE programmes', (not has_table_privilege('authenticated','public.programmes','delete'))::text, 'true'
union all
select 'authenticated CANNOT DELETE portfolios', (not has_table_privilege('authenticated','public.portfolios','delete'))::text, 'true'
union all
select 'people still read-only', (not has_table_privilege('authenticated','public.people','update'))::text, 'true'
union all
select 'anon has no project access', (not has_table_privilege('anon','public.projects','select'))::text, 'true';
