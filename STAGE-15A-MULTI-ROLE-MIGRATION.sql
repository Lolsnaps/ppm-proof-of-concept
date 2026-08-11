/*
  STAGE 15A — more than one access role per person
  ================================================

  Safe to re-run.

  THE PROBLEM

  A person has one access_role, and the two roles a real executive needs are mutually
  exclusive:

    Executive / Steering User        Portfolio-wide scope, 16 permissions, approves nothing
    Project Sponsor / Project Lead   Assigned projects only, 20 permissions, approves
                                     stage gates, baselines and budgets

  An executive who sponsors two projects can have portfolio visibility or approval
  authority, never both. Choosing Executive means the stage-gate workflow refuses to even
  accept them as a required approver - ppm_commit_stage_gate_workflow checks that every
  named approver already holds stageGates.approve - so the gate cannot be submitted and no
  notification is ever raised. Choosing Sponsor drops them to assigned-projects scope, so
  they stop being an executive.

  The only way to express it today is people.permission_overrides, one permission at a
  time, by hand, with nothing anywhere to say it is needed.

  WHAT THIS CHANGES

  people.additional_roles - a person holds their access_role plus any number of others.
  Permissions become the union; permission_overrides still win over all of them. Scope is
  unchanged: access_scope stays explicit on the person, because a role's default scope is
  only ever a starting suggestion and every account already has one set.

  WHY additional_roles RATHER THAN REPLACING access_role WITH AN ARRAY

  access_role is read by RLS helpers, four workflow RPCs, the audit trigger, the browser
  facade, the demo seed and the specification generator. Replacing it would touch every one
  of them at once, on the security boundary, on a live pilot. Adding a second column means
  a person with no additional roles behaves exactly as before - which is provable, and is
  proved by STAGE-15A-VERIFY.sql - and the browser presents the two columns as one list.

  WHAT THIS DELIBERATELY DOES NOT CHANGE

  Being named as a required approver still does not, by itself, confer approval authority;
  the named person must hold the permission through one of their roles. With more than one
  role available that is now expressible, so the executive-as-sponsor case is solved by
  giving them both roles rather than by weakening the rule. The alternative - "named on the
  record is authority" - would let anyone who can submit a gate confer approval rights on
  anyone, which is a governance decision rather than a bug fix. The browser now tells a
  named person their roles cannot act, rather than silently sending no notification, so the
  situation is visible instead of stuck.
*/

begin;

/* ------------------------------------------------------------------ 1. column */

alter table public.people
    add column if not exists additional_roles text[] not null default '{}';

comment on column public.people.additional_roles is
    'Access roles held in addition to access_role. Permissions are the union of all of them; '
    'permission_overrides still take precedence. Validated by private.guard_person_identity.';

/* ------------------------------------------------ 2. one place for the rule

   The role-to-permission rule was written in five places: private.has_permission,
   private.effective_permissions, and three eligibility checks inside the two workflow
   RPCs. Five copies of one rule is five chances for four of them to be right.

   This is now the single definition. has_permission() answers for the current user;
   everything that asks about somebody else calls this directly.
*/
create or replace function private.person_has_permission(target_person_id uuid, target_permission text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
    with me as (
        select pe.access_role,
               coalesce(pe.additional_roles, '{}'::text[]) as additional_roles,
               pe.permission_overrides
          from public.people pe
         where pe.id = target_person_id
           and pe.active = true
           and coalesce(pe.account_status, 'Active') = 'Active'
         limit 1
    )
    select coalesce(bool_or(
        case
            /* An explicit override on the person wins over every role they hold. */
            when me.permission_overrides ->> target_permission = 'allow' then true
            when me.permission_overrides ->> target_permission = 'deny'  then false
            else exists (
                select 1
                  from private.role_permissions rp
                 where rp.permission_key = target_permission
                   and (
                       rp.role_name = me.access_role
                       or rp.role_name = any (me.additional_roles)
                   )
            )
        end
    ), false)
      from me;
$$;

revoke all on function private.person_has_permission(uuid, text) from public, anon;

/* ------------------------------------------------------- 3. the current user

   Same answer as before for a person with no additional roles. Kept as its own function
   because every RLS policy calls it by name.
*/
create or replace function private.has_permission(target_permission text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
    select coalesce(bool_or(private.person_has_permission(pe.id, target_permission)), false)
      from public.people pe
     where pe.auth_user_id = (select auth.uid())
       and pe.active = true
       and coalesce(pe.account_status, 'Active') = 'Active';
$$;

revoke all on function private.has_permission(text) from public, anon;

/* ------------------------------------------- 4. the current user's whole set

   Used by the browser to explain what someone can do. Must union the roles too, or the
   Administration page would describe a narrower account than the database enforces -
   which is the worse direction for the two to disagree in.

   RETURNS SETOF text and iterates private.permissions, both exactly as before. Neither is
   incidental: the return type cannot be changed by CREATE OR REPLACE at all, and the
   catalogue of permission keys is private.permissions rather than the role table, so a
   permission granted only by an override still appears.
*/
create or replace function private.effective_permissions()
returns setof text
language sql
stable
security definer
set search_path to ''
as $$
    with me as (
        select pe.id
          from public.people pe
         where pe.auth_user_id = (select auth.uid())
           and pe.active = true
           and coalesce(pe.account_status, 'Active') = 'Active'
         limit 1
    )
    select p.key
      from private.permissions p, me
     where private.person_has_permission(me.id, p.key);
$$;

revoke all on function private.effective_permissions() from public, anon;

/* --------------------------------------------------------------- 5. the guard

   additional_roles decides what somebody can do, so it belongs with access_role and
   access_scope: it needs users.manage, and it cannot be changed on your own row. Granting
   yourself a second role is the same shape of problem as approving your own budget.

   The existing guard is extended rather than replaced, so every rule it already enforces
   - auth_user_id never writable, legacy_resource_id immutable once set - stays exactly as
   it is. The function is recreated in full because plpgsql has no way to append to one.
*/
do $$
declare
    guard_source text;
begin
    select pg_get_functiondef(p.oid)
      into guard_source
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname = 'guard_person_identity';

    if guard_source is null then
        raise exception 'private.guard_person_identity() is missing - apply STAGE-12A first.';
    end if;

    /* Already extended by a previous run of this migration. */
    if guard_source like '%additional_roles%' then
        raise notice 'STAGE-15A: guard_person_identity already covers additional_roles.';
        return;
    end if;

    /*
      The guard tests the access-control fields with a single "is distinct from" chain. The
      new column joins that chain, so it is protected by the same permission and
      self-modification rules without restating either of them.

      Matched on a whitespace-tolerant pattern rather than an exact string: the live
      definition aligns that chain with spaces, and counting them from a migration file is
      how a patch silently does nothing. The assertion below is what makes the difference
      between "already applied" and "no longer matches" visible either way.
    */
    guard_source := regexp_replace(
        guard_source,
        '(or\s+new\.access_scope\s+is distinct from old\.access_scope)',
        '\1' || chr(10) || '            or new.additional_roles       is distinct from old.additional_roles'
    );

    if guard_source not like '%additional_roles%' then
        raise exception
            'STAGE-15A: could not extend private.guard_person_identity() - its access-control '
            'chain no longer matches the expected shape. Extend it by hand and re-run.';
    end if;

    execute guard_source;
end;
$$;

/* --------------------------------------------- 6. only real roles may be held

   A typo in additional_roles would not fail; it would silently grant nothing, which is the
   kind of quiet mistake that gets discovered when somebody cannot approve something.
*/
create or replace function private.guard_additional_roles()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
    unknown_role text;
begin
    if new.additional_roles is null then
        new.additional_roles := '{}'::text[];
    end if;

    select r into unknown_role
      from unnest(new.additional_roles) as r
     where nullif(btrim(r), '') is null
        or not exists (select 1 from private.role_permissions rp where rp.role_name = r)
     limit 1;

    if unknown_role is not null then
        raise exception 'Additional role "%" is not one of the defined access roles.', unknown_role
            using errcode = '22023';
    end if;

    /* Holding a role twice is meaningless rather than harmful, but it reads as a mistake
       in the audit trail and in the interface, so it is not stored. */
    if new.access_role is not null and new.access_role = any (new.additional_roles) then
        new.additional_roles := array_remove(new.additional_roles, new.access_role);
    end if;

    /*
      Additional roles with no primary role would be an account that the rest of the system
      does not recognise as one: guard_person_identity decides whether a row is an account
      by looking at access_role, and the browser labels people by it. So the combination is
      refused rather than half-supported.
    */
    if array_length(new.additional_roles, 1) > 0
       and coalesce(btrim(coalesce(new.access_role, '')), '') = '' then
        raise exception 'A person cannot hold additional access roles without a primary access role.'
            using errcode = '22023';
    end if;

    new.additional_roles := (
        select coalesce(array_agg(distinct r order by r), '{}'::text[])
          from unnest(new.additional_roles) as r
    );

    return new;
end;
$$;

drop trigger if exists guard_additional_roles on public.people;
create trigger guard_additional_roles
    before insert or update on public.people
    for each row execute function private.guard_additional_roles();

/* ------------------------------- 7. the workflow eligibility checks

   Three inline copies of the role lookup live inside the two workflow RPCs, deciding
   whether a person may be named as an approver. Each is patched in place rather than
   rewritten: the functions are 33,000 and 38,000 characters of governance logic, and the
   change needed is one line in each.

   Patched textually, from the live definition, so nothing else in them can move.
*/
do $$
declare
    target      record;
    definition  text;
    patched     text;
    replacements int;
begin
    for target in
        select p.oid, p.oid::regprocedure::text as signature
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('ppm_commit_stage_gate_workflow', 'ppm_commit_financial_workflow')
    loop
        definition := pg_get_functiondef(target.oid);
        patched := definition;

        /* ap = the candidate approver, rp_user = the acting user, approver_row = the
           candidate budget approver. Each is a public.people row. */
        patched := replace(patched,
            'where rp.role_name = ap.access_role',
            'where (rp.role_name = ap.access_role' || chr(10) ||
            '                                 or rp.role_name = any (coalesce(ap.additional_roles, ''{}''::text[])))');
        patched := replace(patched,
            'where rp.role_name = rp_user.access_role',
            'where (rp.role_name = rp_user.access_role' || chr(10) ||
            '                             or rp.role_name = any (coalesce(rp_user.additional_roles, ''{}''::text[])))');
        patched := replace(patched,
            'where rp.role_name = approver_row.access_role',
            'where (rp.role_name = approver_row.access_role' || chr(10) ||
            '                        or rp.role_name = any (coalesce(approver_row.additional_roles, ''{}''::text[])))');

        if patched = definition then
            /* Either already patched by a previous run, or the shape has changed. Tell the
               difference, because the second one matters. */
            if definition like '%additional_roles%' then
                raise notice 'STAGE-15A: % already unions additional roles.', target.signature;
            else
                raise exception
                    'STAGE-15A: % contains no recognised role lookup to patch. Check it by hand.',
                    target.signature;
            end if;
        else
            execute patched;
            raise notice 'STAGE-15A: % now unions additional roles.', target.signature;
        end if;
    end loop;
end;
$$;

commit;

/*
  AFTER APPLYING

  1. node VERIFY-ALL.mjs                     the offline gates
  2. STAGE-15A-VERIFY.sql                     proves single-role answers are unchanged
  3. VERIFY-INVARIANTS.sql                    RLS, policies, grants, triggers
  4. get_advisors(security)                   five authenticated_security_definer_function_executable
                                              warnings are expected and correct; nothing else

  ROLLBACK

  additional_roles defaults to '{}', so every function above answers exactly as it did
  before for every existing person. To undo it completely:

      drop trigger if exists guard_additional_roles on public.people;
      drop function if exists private.guard_additional_roles();
      alter table public.people drop column if exists additional_roles;

  and re-apply STAGE-12A (guard) plus the 11A/11C migrations to restore the original
  function bodies. Dropping the column alone would leave four functions referencing it.
*/
