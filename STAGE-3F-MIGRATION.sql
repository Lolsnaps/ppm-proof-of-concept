/* =============================================================================
   PORTFOLIO MANAGER — STAGE 3F
   Server-side role/permission model + access-scope fix

   Generated: 7 August 2026
   Generated FROM: ppm-auth-utils.js (ROLE_DEFINITIONS / ALL_PERMISSIONS)

   Contents
     Part 1  Permission + role tables in the non-exposed `private` schema
     Part 2  Seed: 47 permissions, 9 roles, 240 role-permission grants
     Part 3  private.has_permission() — mirrors the browser's can()
     Part 4  private.can_access_project() — now resolves all four access scopes
     Part 5  Attach permission checks to the existing SELECT policies
     Part 6  Verification

   SAFE TO RE-RUN. Every step is idempotent; Part 2 fully re-seeds so the
   database self-corrects if it has drifted from the application code.

   THIS SCRIPT DOES NOT GRANT ANY WRITE ACCESS. Browser INSERT/UPDATE/DELETE
   stay revoked exactly as Stage 3C left them.
   ========================================================================== */

begin;

/* -----------------------------------------------------------------------------
   PART 1 — Tables
   These live in `private`, which is not exposed through the Data API, so the
   browser cannot read or modify the permission model. The SECURITY DEFINER
   helper functions below can still read them because they run as the owner.
   -------------------------------------------------------------------------- */

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table if not exists private.permissions (
    key         text primary key,
    category    text not null,
    sort_order  integer not null
);

create table if not exists private.roles (
    name          text primary key,
    description   text,
    default_scope text not null,
    sort_order    integer not null
);

create table if not exists private.role_permissions (
    role_name      text not null references private.roles(name) on delete cascade,
    permission_key text not null references private.permissions(key) on delete cascade,
    primary key (role_name, permission_key)
);

comment on table private.permissions is
    'The 47 application permission strings. Authoritative copy of ALL_PERMISSIONS in ppm-auth-utils.js.';
comment on table private.roles is
    'The 9 application roles. Authoritative copy of ROLE_DEFINITIONS in ppm-auth-utils.js.';
comment on table private.role_permissions is
    'Which role receives which permission. Regenerated from the application code; do not hand-edit.';

-- Nothing in the browser may read these directly.
revoke all on private.permissions      from public, anon, authenticated;
revoke all on private.roles            from public, anon, authenticated;
revoke all on private.role_permissions from public, anon, authenticated;

/* -----------------------------------------------------------------------------
   PART 2 — Seed
   Full re-seed rather than an upsert, so re-running this script repairs any
   drift between the database and ppm-auth-utils.js.
   -------------------------------------------------------------------------- */

delete from private.role_permissions;
delete from private.roles;
delete from private.permissions;

insert into private.permissions (key, category, sort_order) values
    ('home.view', 'home', 1),
    ('projects.view', 'projects', 2),
    ('projects.create', 'projects', 3),
    ('projects.edit', 'projects', 4),
    ('projects.status', 'projects', 5),
    ('projects.archive', 'projects', 6),
    ('administration.view', 'administration', 7),
    ('administration.edit', 'administration', 8),
    ('portfolios.view', 'portfolios', 9),
    ('portfolios.edit', 'portfolios', 10),
    ('programmes.view', 'programmes', 11),
    ('programmes.edit', 'programmes', 12),
    ('programmes.approve', 'programmes', 13),
    ('milestones.view', 'milestones', 14),
    ('milestones.edit', 'milestones', 15),
    ('stageGates.view', 'stageGates', 16),
    ('stageGates.submit', 'stageGates', 17),
    ('stageGates.approve', 'stageGates', 18),
    ('stageGates.override', 'stageGates', 19),
    ('plan.view', 'plan', 20),
    ('plan.edit', 'plan', 21),
    ('plan.requestBaseline', 'plan', 22),
    ('plan.approveBaseline', 'plan', 23),
    ('raid.view', 'raid', 24),
    ('raid.edit', 'raid', 25),
    ('registers.view', 'registers', 26),
    ('registers.edit', 'registers', 27),
    ('benefits.view', 'benefits', 28),
    ('benefits.edit', 'benefits', 29),
    ('resources.view', 'resources', 30),
    ('resources.viewContact', 'resources', 31),
    ('resources.edit', 'resources', 32),
    ('resources.manageTeam', 'resources', 33),
    ('users.manage', 'users', 34),
    ('resourceManagement.view', 'resourceManagement', 35),
    ('resourceManagement.edit', 'resourceManagement', 36),
    ('resourceManagement.publishScenario', 'resourceManagement', 37),
    ('financials.viewRag', 'financials', 38),
    ('financials.viewDetail', 'financials', 39),
    ('financials.edit', 'financials', 40),
    ('financials.configure', 'financials', 41),
    ('financials.approve', 'financials', 42),
    ('audit.view', 'audit', 43),
    ('reports.view', 'reports', 44),
    ('reports.export', 'reports', 45),
    ('views.publish', 'views', 46),
    ('search.use', 'search', 47);

insert into private.roles (name, description, default_scope, sort_order) values
    ('System Administrator',
     'Full configuration, user administration, records, approvals and audit access.',
     'Portfolio-wide', 1),
    ('Portfolio Manager / PMO Manager',
     'Portfolio-wide project, resource, governance, baseline, reporting and approval control.',
     'Portfolio-wide', 2),
    ('Project Manager',
     'Maintain assigned projects, plans, milestones, status, RAID, benefits and resource forecasts.',
     'Assigned projects', 3),
    ('PMO Analyst',
     'Portfolio maintenance, data-quality review, governance updates and reporting without self-approval.',
     'Portfolio-wide', 4),
    ('Project Sponsor / Project Lead',
     'Review and approve assigned project scope, status, stage gates, closure, finance and benefits.',
     'Assigned projects', 5),
    ('Resource Manager / Team Manager',
     'Manage team capacity, availability, resource requests and assignments without wider project editing.',
     'Team projects', 6),
    ('Project Team Member',
     'View assigned projects and update tasks and actions owned by the signed-in person.',
     'Assigned projects', 7),
    ('Executive / Steering User',
     'Read-only portfolio dashboards, approved reports and project summaries.',
     'Portfolio-wide', 8),
    ('Read-only / Auditor',
     'Read-only selected records, historical versions, approval evidence and permitted exports.',
     'Selected projects', 9);

insert into private.role_permissions (role_name, permission_key) values
    -- System Administrator (47)
    ('System Administrator', 'home.view'),
    ('System Administrator', 'projects.view'),
    ('System Administrator', 'projects.create'),
    ('System Administrator', 'projects.edit'),
    ('System Administrator', 'projects.status'),
    ('System Administrator', 'projects.archive'),
    ('System Administrator', 'administration.view'),
    ('System Administrator', 'administration.edit'),
    ('System Administrator', 'portfolios.view'),
    ('System Administrator', 'portfolios.edit'),
    ('System Administrator', 'programmes.view'),
    ('System Administrator', 'programmes.edit'),
    ('System Administrator', 'programmes.approve'),
    ('System Administrator', 'milestones.view'),
    ('System Administrator', 'milestones.edit'),
    ('System Administrator', 'stageGates.view'),
    ('System Administrator', 'stageGates.submit'),
    ('System Administrator', 'stageGates.approve'),
    ('System Administrator', 'stageGates.override'),
    ('System Administrator', 'plan.view'),
    ('System Administrator', 'plan.edit'),
    ('System Administrator', 'plan.requestBaseline'),
    ('System Administrator', 'plan.approveBaseline'),
    ('System Administrator', 'raid.view'),
    ('System Administrator', 'raid.edit'),
    ('System Administrator', 'registers.view'),
    ('System Administrator', 'registers.edit'),
    ('System Administrator', 'benefits.view'),
    ('System Administrator', 'benefits.edit'),
    ('System Administrator', 'resources.view'),
    ('System Administrator', 'resources.viewContact'),
    ('System Administrator', 'resources.edit'),
    ('System Administrator', 'resources.manageTeam'),
    ('System Administrator', 'users.manage'),
    ('System Administrator', 'resourceManagement.view'),
    ('System Administrator', 'resourceManagement.edit'),
    ('System Administrator', 'resourceManagement.publishScenario'),
    ('System Administrator', 'financials.viewRag'),
    ('System Administrator', 'financials.viewDetail'),
    ('System Administrator', 'financials.edit'),
    ('System Administrator', 'financials.configure'),
    ('System Administrator', 'financials.approve'),
    ('System Administrator', 'audit.view'),
    ('System Administrator', 'reports.view'),
    ('System Administrator', 'reports.export'),
    ('System Administrator', 'views.publish'),
    ('System Administrator', 'search.use'),
    -- Portfolio Manager / PMO Manager (46)
    ('Portfolio Manager / PMO Manager', 'home.view'),
    ('Portfolio Manager / PMO Manager', 'projects.view'),
    ('Portfolio Manager / PMO Manager', 'projects.create'),
    ('Portfolio Manager / PMO Manager', 'projects.edit'),
    ('Portfolio Manager / PMO Manager', 'projects.status'),
    ('Portfolio Manager / PMO Manager', 'projects.archive'),
    ('Portfolio Manager / PMO Manager', 'administration.view'),
    ('Portfolio Manager / PMO Manager', 'administration.edit'),
    ('Portfolio Manager / PMO Manager', 'portfolios.view'),
    ('Portfolio Manager / PMO Manager', 'portfolios.edit'),
    ('Portfolio Manager / PMO Manager', 'programmes.view'),
    ('Portfolio Manager / PMO Manager', 'programmes.edit'),
    ('Portfolio Manager / PMO Manager', 'programmes.approve'),
    ('Portfolio Manager / PMO Manager', 'milestones.view'),
    ('Portfolio Manager / PMO Manager', 'milestones.edit'),
    ('Portfolio Manager / PMO Manager', 'stageGates.view'),
    ('Portfolio Manager / PMO Manager', 'stageGates.submit'),
    ('Portfolio Manager / PMO Manager', 'stageGates.approve'),
    ('Portfolio Manager / PMO Manager', 'stageGates.override'),
    ('Portfolio Manager / PMO Manager', 'plan.view'),
    ('Portfolio Manager / PMO Manager', 'plan.edit'),
    ('Portfolio Manager / PMO Manager', 'plan.requestBaseline'),
    ('Portfolio Manager / PMO Manager', 'plan.approveBaseline'),
    ('Portfolio Manager / PMO Manager', 'raid.view'),
    ('Portfolio Manager / PMO Manager', 'raid.edit'),
    ('Portfolio Manager / PMO Manager', 'registers.view'),
    ('Portfolio Manager / PMO Manager', 'registers.edit'),
    ('Portfolio Manager / PMO Manager', 'benefits.view'),
    ('Portfolio Manager / PMO Manager', 'benefits.edit'),
    ('Portfolio Manager / PMO Manager', 'resources.view'),
    ('Portfolio Manager / PMO Manager', 'resources.viewContact'),
    ('Portfolio Manager / PMO Manager', 'resources.edit'),
    ('Portfolio Manager / PMO Manager', 'resources.manageTeam'),
    ('Portfolio Manager / PMO Manager', 'resourceManagement.view'),
    ('Portfolio Manager / PMO Manager', 'resourceManagement.edit'),
    ('Portfolio Manager / PMO Manager', 'resourceManagement.publishScenario'),
    ('Portfolio Manager / PMO Manager', 'financials.viewRag'),
    ('Portfolio Manager / PMO Manager', 'financials.viewDetail'),
    ('Portfolio Manager / PMO Manager', 'financials.edit'),
    ('Portfolio Manager / PMO Manager', 'financials.configure'),
    ('Portfolio Manager / PMO Manager', 'financials.approve'),
    ('Portfolio Manager / PMO Manager', 'audit.view'),
    ('Portfolio Manager / PMO Manager', 'reports.view'),
    ('Portfolio Manager / PMO Manager', 'reports.export'),
    ('Portfolio Manager / PMO Manager', 'views.publish'),
    ('Portfolio Manager / PMO Manager', 'search.use'),
    -- Project Manager (29)
    ('Project Manager', 'home.view'),
    ('Project Manager', 'projects.view'),
    ('Project Manager', 'projects.create'),
    ('Project Manager', 'projects.edit'),
    ('Project Manager', 'projects.status'),
    ('Project Manager', 'portfolios.view'),
    ('Project Manager', 'programmes.view'),
    ('Project Manager', 'milestones.view'),
    ('Project Manager', 'milestones.edit'),
    ('Project Manager', 'stageGates.view'),
    ('Project Manager', 'stageGates.submit'),
    ('Project Manager', 'plan.view'),
    ('Project Manager', 'plan.edit'),
    ('Project Manager', 'plan.requestBaseline'),
    ('Project Manager', 'raid.view'),
    ('Project Manager', 'raid.edit'),
    ('Project Manager', 'registers.view'),
    ('Project Manager', 'registers.edit'),
    ('Project Manager', 'benefits.view'),
    ('Project Manager', 'benefits.edit'),
    ('Project Manager', 'resources.view'),
    ('Project Manager', 'resourceManagement.view'),
    ('Project Manager', 'resourceManagement.edit'),
    ('Project Manager', 'financials.viewRag'),
    ('Project Manager', 'financials.viewDetail'),
    ('Project Manager', 'financials.edit'),
    ('Project Manager', 'reports.view'),
    ('Project Manager', 'reports.export'),
    ('Project Manager', 'search.use'),
    -- PMO Analyst (34)
    ('PMO Analyst', 'home.view'),
    ('PMO Analyst', 'projects.view'),
    ('PMO Analyst', 'projects.create'),
    ('PMO Analyst', 'projects.edit'),
    ('PMO Analyst', 'projects.status'),
    ('PMO Analyst', 'administration.view'),
    ('PMO Analyst', 'portfolios.view'),
    ('PMO Analyst', 'portfolios.edit'),
    ('PMO Analyst', 'programmes.view'),
    ('PMO Analyst', 'programmes.edit'),
    ('PMO Analyst', 'milestones.view'),
    ('PMO Analyst', 'milestones.edit'),
    ('PMO Analyst', 'stageGates.view'),
    ('PMO Analyst', 'stageGates.submit'),
    ('PMO Analyst', 'plan.view'),
    ('PMO Analyst', 'plan.edit'),
    ('PMO Analyst', 'plan.requestBaseline'),
    ('PMO Analyst', 'raid.view'),
    ('PMO Analyst', 'raid.edit'),
    ('PMO Analyst', 'registers.view'),
    ('PMO Analyst', 'registers.edit'),
    ('PMO Analyst', 'benefits.view'),
    ('PMO Analyst', 'benefits.edit'),
    ('PMO Analyst', 'resources.view'),
    ('PMO Analyst', 'resources.viewContact'),
    ('PMO Analyst', 'resourceManagement.view'),
    ('PMO Analyst', 'financials.viewRag'),
    ('PMO Analyst', 'financials.viewDetail'),
    ('PMO Analyst', 'financials.edit'),
    ('PMO Analyst', 'audit.view'),
    ('PMO Analyst', 'reports.view'),
    ('PMO Analyst', 'reports.export'),
    ('PMO Analyst', 'views.publish'),
    ('PMO Analyst', 'search.use'),
    -- Project Sponsor / Project Lead (20)
    ('Project Sponsor / Project Lead', 'home.view'),
    ('Project Sponsor / Project Lead', 'projects.view'),
    ('Project Sponsor / Project Lead', 'projects.status'),
    ('Project Sponsor / Project Lead', 'portfolios.view'),
    ('Project Sponsor / Project Lead', 'programmes.view'),
    ('Project Sponsor / Project Lead', 'milestones.view'),
    ('Project Sponsor / Project Lead', 'stageGates.view'),
    ('Project Sponsor / Project Lead', 'stageGates.approve'),
    ('Project Sponsor / Project Lead', 'plan.view'),
    ('Project Sponsor / Project Lead', 'plan.approveBaseline'),
    ('Project Sponsor / Project Lead', 'raid.view'),
    ('Project Sponsor / Project Lead', 'registers.view'),
    ('Project Sponsor / Project Lead', 'registers.edit'),
    ('Project Sponsor / Project Lead', 'benefits.view'),
    ('Project Sponsor / Project Lead', 'financials.viewRag'),
    ('Project Sponsor / Project Lead', 'financials.viewDetail'),
    ('Project Sponsor / Project Lead', 'financials.approve'),
    ('Project Sponsor / Project Lead', 'reports.view'),
    ('Project Sponsor / Project Lead', 'reports.export'),
    ('Project Sponsor / Project Lead', 'search.use'),
    -- Resource Manager / Team Manager (16)
    ('Resource Manager / Team Manager', 'home.view'),
    ('Resource Manager / Team Manager', 'projects.view'),
    ('Resource Manager / Team Manager', 'portfolios.view'),
    ('Resource Manager / Team Manager', 'milestones.view'),
    ('Resource Manager / Team Manager', 'stageGates.view'),
    ('Resource Manager / Team Manager', 'plan.view'),
    ('Resource Manager / Team Manager', 'raid.view'),
    ('Resource Manager / Team Manager', 'resources.view'),
    ('Resource Manager / Team Manager', 'resources.viewContact'),
    ('Resource Manager / Team Manager', 'resources.manageTeam'),
    ('Resource Manager / Team Manager', 'resourceManagement.view'),
    ('Resource Manager / Team Manager', 'resourceManagement.edit'),
    ('Resource Manager / Team Manager', 'resourceManagement.publishScenario'),
    ('Resource Manager / Team Manager', 'reports.view'),
    ('Resource Manager / Team Manager', 'reports.export'),
    ('Resource Manager / Team Manager', 'search.use'),
    -- Project Team Member (14)
    ('Project Team Member', 'home.view'),
    ('Project Team Member', 'projects.view'),
    ('Project Team Member', 'portfolios.view'),
    ('Project Team Member', 'milestones.view'),
    ('Project Team Member', 'stageGates.view'),
    ('Project Team Member', 'plan.view'),
    ('Project Team Member', 'plan.edit'),
    ('Project Team Member', 'raid.view'),
    ('Project Team Member', 'registers.view'),
    ('Project Team Member', 'registers.edit'),
    ('Project Team Member', 'resources.view'),
    ('Project Team Member', 'resourceManagement.view'),
    ('Project Team Member', 'reports.view'),
    ('Project Team Member', 'search.use'),
    -- Executive / Steering User (16)
    ('Executive / Steering User', 'home.view'),
    ('Executive / Steering User', 'projects.view'),
    ('Executive / Steering User', 'portfolios.view'),
    ('Executive / Steering User', 'programmes.view'),
    ('Executive / Steering User', 'milestones.view'),
    ('Executive / Steering User', 'stageGates.view'),
    ('Executive / Steering User', 'plan.view'),
    ('Executive / Steering User', 'raid.view'),
    ('Executive / Steering User', 'registers.view'),
    ('Executive / Steering User', 'benefits.view'),
    ('Executive / Steering User', 'resourceManagement.view'),
    ('Executive / Steering User', 'financials.viewRag'),
    ('Executive / Steering User', 'financials.viewDetail'),
    ('Executive / Steering User', 'reports.view'),
    ('Executive / Steering User', 'reports.export'),
    ('Executive / Steering User', 'search.use'),
    -- Read-only / Auditor (18)
    ('Read-only / Auditor', 'home.view'),
    ('Read-only / Auditor', 'projects.view'),
    ('Read-only / Auditor', 'portfolios.view'),
    ('Read-only / Auditor', 'programmes.view'),
    ('Read-only / Auditor', 'milestones.view'),
    ('Read-only / Auditor', 'stageGates.view'),
    ('Read-only / Auditor', 'plan.view'),
    ('Read-only / Auditor', 'raid.view'),
    ('Read-only / Auditor', 'registers.view'),
    ('Read-only / Auditor', 'benefits.view'),
    ('Read-only / Auditor', 'resources.view'),
    ('Read-only / Auditor', 'resourceManagement.view'),
    ('Read-only / Auditor', 'financials.viewRag'),
    ('Read-only / Auditor', 'financials.viewDetail'),
    ('Read-only / Auditor', 'audit.view'),
    ('Read-only / Auditor', 'reports.view'),
    ('Read-only / Auditor', 'reports.export'),
    ('Read-only / Auditor', 'search.use');

/* -----------------------------------------------------------------------------
   PART 3 — has_permission()

   This deliberately mirrors can() in ppm-auth-utils.js, so the server and the
   UI agree on the answer:

       override 'allow'  -> permitted, whatever the role says
       override 'deny'   -> refused,   whatever the role says
       otherwise         -> whatever the role grants

   A person who is inactive, whose account status is not Active, or who is not
   linked to an auth user has no permissions at all.
   -------------------------------------------------------------------------- */

create or replace function private.has_permission(target_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    with me as (
        select pe.access_role, pe.permission_overrides
        from public.people pe
        where pe.auth_user_id = (select auth.uid())
          and pe.active = true
          and coalesce(pe.account_status, 'Active') = 'Active'
        limit 1
    )
    select coalesce(bool_or(
        case
            when me.permission_overrides ->> target_permission = 'allow' then true
            when me.permission_overrides ->> target_permission = 'deny'  then false
            else exists (
                select 1
                from private.role_permissions rp
                where rp.role_name      = me.access_role
                  and rp.permission_key = target_permission
            )
        end
    ), false)
    from me;
$$;

-- Convenience: permission AND access to a specific project.
create or replace function private.has_permission(target_permission text, target_project_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select private.has_permission(target_permission)
       and private.can_access_project(target_project_code);
$$;

-- Everything the signed-in person may do. Useful for diagnostics, and the
-- natural thing for a later stage to hand to the browser instead of the
-- hardcoded ROLE_DEFINITIONS.
create or replace function private.effective_permissions()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
    with me as (
        select pe.access_role, coalesce(pe.permission_overrides, '{}'::jsonb) as overrides
        from public.people pe
        where pe.auth_user_id = (select auth.uid())
          and pe.active = true
          and coalesce(pe.account_status, 'Active') = 'Active'
        limit 1
    )
    select p.key
    from private.permissions p, me
    where case
              when me.overrides ->> p.key = 'allow' then true
              when me.overrides ->> p.key = 'deny'  then false
              else exists (
                  select 1 from private.role_permissions rp
                  where rp.role_name = me.access_role and rp.permission_key = p.key
              )
          end;
$$;

/* -----------------------------------------------------------------------------
   PART 4 — can_access_project(), corrected

   The previous version understood only two of the application's four access
   scopes. Anyone whose scope was 'Assigned projects' or 'Team projects' and
   whose selected_project_codes happened to be empty could read NOTHING from the
   database, while the legacy UI still showed them their work.

   This version mirrors projectAssignments() in ppm-auth-utils.js:

       Portfolio-wide     every project
       any other scope    selected_project_codes
                          UNION projects where the person holds a named role
       Team projects      the above, plus projects where a named role is held
                          by someone on the same team

   Named roles are read both from the normalised foreign keys and from the
   original legacy_payload, because only three of the eight role fields were
   normalised during the Stage 2B import.
   -------------------------------------------------------------------------- */

create or replace function private.can_access_project(target_project_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    with me as (
        select
            pe.id,
            pe.legacy_resource_id,
            coalesce(pe.access_scope, 'Selected projects')  as access_scope,
            nullif(btrim(lower(coalesce(pe.team, ''))), '') as team_key,
            coalesce(pe.selected_project_codes, '{}'::text[]) as selected_project_codes
        from public.people pe
        where pe.auth_user_id = (select auth.uid())
          and pe.active = true
          and coalesce(pe.account_status, 'Active') = 'Active'
        limit 1
    ),
    target as (
        select pr.id, pr.project_manager_id, pr.sponsor_id, pr.project_lead_id,
               coalesce(pr.legacy_payload, '{}'::jsonb) as legacy_payload
        from public.projects pr
        where pr.project_code = target_project_code
    )
    select coalesce(bool_or(
        -- 1. Portfolio-wide sees everything.
        me.access_scope = 'Portfolio-wide'

        -- 2. Explicitly granted project codes.
        or target_project_code = any (me.selected_project_codes)

        -- 3. Named on the project through a normalised foreign key.
        or t.project_manager_id = me.id
        or t.sponsor_id         = me.id
        or t.project_lead_id    = me.id

        -- 4. Named on the project in the original legacy record.
        or (
            me.legacy_resource_id is not null
            and me.legacy_resource_id = any (array_remove(array[
                t.legacy_payload ->> 'projectManagerResourceId',
                t.legacy_payload ->> 'sponsorResourceId',
                t.legacy_payload ->> 'projectLeadResourceId',
                t.legacy_payload ->> 'deputyProjectManagerResourceId',
                t.legacy_payload ->> 'businessAnalystResourceId',
                t.legacy_payload ->> 'technicalLeadResourceId',
                t.legacy_payload ->> 'benefitOwnerResourceId',
                t.legacy_payload ->> 'financialOwnerResourceId',
                t.legacy_payload ->> 'createdByResourceId'
            ], null))
        )

        -- 5. Team projects: somebody on my team LEADS this project.
        --
        --    Deliberately narrower than clauses 3-4. The browser derives team
        --    projects from ppmResourceDemand and plan task owners, neither of
        --    which exists in the database yet, so an exact mirror is impossible
        --    at this stage. Leadership roles are used as a conservative stand-in:
        --    erring narrow risks a team manager missing a row at Stage 5, which
        --    is visible and fixable; erring wide would hand them rows the UI
        --    never shows, which is a silent widening of the security boundary.
        --    Revisit when the resource-demand and plan modules migrate.
        or (
            me.access_scope = 'Team projects'
            and me.team_key is not null
            and exists (
                select 1
                from public.people tm
                where nullif(btrim(lower(coalesce(tm.team, ''))), '') = me.team_key
                  and (
                      t.project_manager_id = tm.id
                      or t.sponsor_id      = tm.id
                      or t.project_lead_id = tm.id
                      or (
                          tm.legacy_resource_id is not null
                          and tm.legacy_resource_id = any (array_remove(array[
                              t.legacy_payload ->> 'projectManagerResourceId',
                              t.legacy_payload ->> 'sponsorResourceId',
                              t.legacy_payload ->> 'projectLeadResourceId'
                          ], null))
                      )
                  )
            )
        )
    ), false)
    from me
    left join target t on true;
$$;

/* Function grants. */
revoke all on function private.has_permission(text)              from public;
revoke all on function private.has_permission(text, text)        from public;
revoke all on function private.effective_permissions()           from public;
revoke all on function private.can_access_project(text)          from public;

grant execute on function private.has_permission(text)           to authenticated;
grant execute on function private.has_permission(text, text)     to authenticated;
grant execute on function private.effective_permissions()        to authenticated;
grant execute on function private.can_access_project(text)       to authenticated;

/* -----------------------------------------------------------------------------
   PART 5 — Attach permission checks to the existing SELECT policies

   Restrictive policies are ANDed with everything else, so the existing AAL2
   requirement and the existing project-scope rules all still apply. This adds
   "...and your role actually grants the matching view permission".

   All nine roles hold projects.view and portfolios.view, so those two change
   nothing today. programmes.view is NOT held by 'Resource Manager / Team
   Manager' or 'Project Team Member', so from now on those two roles are refused
   programme rows by the database — which is what the navigation rules already
   show them in the UI.

   public.people is deliberately NOT gated on resources.view. Signing in
   requires reading your own people row, and 'Executive / Steering User' does
   not hold resources.view; gating it would lock that role out entirely.
   -------------------------------------------------------------------------- */

drop policy if exists "projects require view permission"   on public.projects;
drop policy if exists "programmes require view permission" on public.programmes;
drop policy if exists "portfolios require view permission" on public.portfolios;

create policy "projects require view permission"
on public.projects
as restrictive
for select
to authenticated
using ((select private.has_permission('projects.view')));

create policy "programmes require view permission"
on public.programmes
as restrictive
for select
to authenticated
using ((select private.has_permission('programmes.view')));

create policy "portfolios require view permission"
on public.portfolios
as restrictive
for select
to authenticated
using ((select private.has_permission('portfolios.view')));

commit;

/* -----------------------------------------------------------------------------
   PART 6 — Verification
   Run this after the script. Every row should say PASS.
   -------------------------------------------------------------------------- */

select 'permission count'  as check,
       count(*)::text      as found,
       '47'                as expected,
       case when count(*) = 47 then 'PASS' else 'FAIL' end as result
from private.permissions
union all
select 'role count', count(*)::text, '9',
       case when count(*) = 9 then 'PASS' else 'FAIL' end
from private.roles
union all
select 'role-permission grants', count(*)::text, '240',
       case when count(*) = 240 then 'PASS' else 'FAIL' end
from private.role_permissions
union all
select 'System Administrator has all 47', count(*)::text, '47',
       case when count(*) = 47 then 'PASS' else 'FAIL' end
from private.role_permissions where role_name = 'System Administrator'
union all
select 'only System Administrator has users.manage', count(*)::text, '1',
       case when count(*) = 1 then 'PASS' else 'FAIL' end
from private.role_permissions where permission_key = 'users.manage'
union all
select 'people rows with an unknown access_role', count(*)::text, '0',
       case when count(*) = 0 then 'PASS' else 'FAIL — fix these before relying on server permissions' end
from public.people pe
where coalesce(pe.access_role, '') <> ''
  and not exists (select 1 from private.roles r where r.name = pe.access_role)
union all
select 'people rows with an unknown access_scope', count(*)::text, '0',
       case when count(*) = 0 then 'PASS' else 'FAIL — unknown scope behaves as Selected projects' end
from public.people pe
where coalesce(pe.access_scope, '') <> ''
  and pe.access_scope not in ('Portfolio-wide', 'Assigned projects', 'Team projects', 'Selected projects')
union all
select 'restrictive view policies installed', count(*)::text, '3',
       case when count(*) = 3 then 'PASS' else 'FAIL' end
from pg_policies
where schemaname = 'public' and policyname like '%require view permission';

/* Per-role summary — sanity-check this against the application. */
select r.sort_order          as "#",
       r.name                as role,
       r.default_scope       as default_scope,
       count(rp.permission_key) as permissions
from private.roles r
left join private.role_permissions rp on rp.role_name = r.name
group by r.sort_order, r.name, r.default_scope
order by r.sort_order;
