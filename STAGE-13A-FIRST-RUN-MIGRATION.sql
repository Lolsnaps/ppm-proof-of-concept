/* =============================================================================
   PORTFOLIO MANAGER — STAGE 13A
   First-run account setup: enrol an authenticator, then set your own password

   WHY THIS EXISTS

   The pilot could not onboard anybody. Three separate faults, found when the
   documented process was actually attempted:

   1. THE APPLICATION HAS NO TOTP ENROLMENT.
      login-page.js only ever CHALLENGED an existing verified factor. A new
      account reached prepareMfa(), found no factor, and dead-ended with "Enrol
      MFA before using Portfolio Manager" — with nowhere to do that. Since every
      table requires AAL2, an un-enrolled user could sign in and see nothing.

   2. THERE WAS NO WAY FOR A USER TO SET THEIR OWN PASSWORD.
      No updateUser call existed anywhere. An administrator had to know the
      password, and it stayed known.

   3. THE DOCUMENTED LINKING SQL DID NOT WORK.
      Stage 12A's guard refuses any change to auth_user_id. Triggers fire
      regardless of privilege, so it refused the table owner in the SQL editor
      too — the one place the handover said to do it. Verified by attempting it.

   WHAT THIS CHANGES

   The guard's intent was never "auth_user_id can never change". It was "the
   APPLICATION can never change it", because that column decides who someone is.
   auth.uid() is null outside an application session and always present inside one,
   so that intent can be expressed exactly. anon has no UPDATE privilege on people,
   so a browser can never reach this branch with a null uid.

   Then two small pieces of machinery for the first-run flow:

     password_reset_required   set when an account is created with a temporary
                               password; cleared by the user once they choose
                               their own.
     ppm_complete_first_run()  how the user clears it — an RPC rather than a
                               table grant, so no new write path opens on the
                               identity table.
     ppm_link_person_login()   owner-only helper that links a person to a login
                               and flags the password reset in one validated
                               call, so the runbook is one line instead of a
                               hand-written UPDATE.

   WHAT THIS DOES NOT CHANGE

   AAL2 is still mandatory for every read and write. Enrolment happens at AAL1,
   which is the only level at which Supabase permits it, and grants access to
   nothing — the 37 restrictive policies still refuse everything until the factor
   is verified. The application still cannot decide who a person is.

   SAFE TO RE-RUN.
   ========================================================================== */

begin;

/* -------------------------------------------------------------------------
   1. The first-run flag.

      Added with default false so every existing account — including the only
      linked one — is untouched. Nobody currently signed in is forced to change
      anything.

      Deliberately NOT part of the access-control set in the guard. It is not a
      privilege: it says "this password was issued by an administrator and should
      be replaced". Treating it as access control would mean the person could not
      clear their own flag, which is the one thing they must be able to do.
   ------------------------------------------------------------------------- */
alter table public.people
    add column if not exists password_reset_required boolean not null default false;


/* -------------------------------------------------------------------------
   2. Correct the identity guard.

      Only the auth_user_id rule changes. Everything else — the immutable
      resource id, the users.manage requirement, the self-edit refusal, the
      manager resolution — is carried over verbatim.
   ------------------------------------------------------------------------- */
create or replace function private.guard_person_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    me_id            uuid;
    access_changed   boolean := false;
    is_account       boolean;
    from_application boolean;
begin
    select p.id into me_id
      from public.people p
     where p.auth_user_id = (select auth.uid())
     limit 1;

    /*
      An application session always carries a JWT, so auth.uid() is present. The
      SQL editor, a migration and a service-role connection have none. That is the
      line the original rule was reaching for.
    */
    from_application := (select auth.uid()) is not null;

    /* (a) auth_user_id: never from the application, at any permission level. */
    if tg_op = 'INSERT' then
        if new.auth_user_id is not null and from_application then
            raise exception
                'A login cannot be attached to a person from the application. Create the row first, then link the account with public.ppm_link_person_login().'
                using errcode = '42501';
        end if;
    elsif new.auth_user_id is distinct from old.auth_user_id and from_application then
        raise exception
            'The login linked to a person cannot be changed from the application. This is deliberate: it decides who someone is. Use public.ppm_link_person_login() as the database owner.'
            using errcode = '42501';
    end if;

    /* (b) legacy_resource_id: immutable once set. */
    if tg_op = 'UPDATE'
       and coalesce(btrim(old.legacy_resource_id), '') <> ''
       and new.legacy_resource_id is distinct from old.legacy_resource_id then
        raise exception
            'The resource identifier of an existing person cannot be changed (% to %). Project, plan and RAID records are joined on it.',
            old.legacy_resource_id, new.legacy_resource_id
            using errcode = '42501';
    end if;

    /* (c) access-control fields. password_reset_required is deliberately absent. */
    is_account := coalesce(btrim(coalesce(new.access_role, '')), '') <> ''
               or new.auth_user_id is not null
               or (tg_op = 'UPDATE' and old.auth_user_id is not null);

    if tg_op = 'INSERT' then
        access_changed :=
               coalesce(btrim(coalesce(new.access_role, '')), '') <> ''
            or coalesce(btrim(coalesce(new.access_scope, '')), '') <> ''
            or coalesce(new.account_status, 'Not enabled') not in ('Not enabled', '')
            or coalesce(new.permission_overrides, '{}'::jsonb) <> '{}'::jsonb
            or coalesce(array_length(new.selected_project_codes, 1), 0) > 0;
    else
        access_changed :=
               new.access_role            is distinct from old.access_role
            or new.access_scope           is distinct from old.access_scope
            or new.account_status         is distinct from old.account_status
            or new.permission_overrides   is distinct from old.permission_overrides
            or new.selected_project_codes is distinct from old.selected_project_codes
            or (is_account and new.active is distinct from old.active);
    end if;

    /*
      Only an application session is held to the permission and self-edit rules.
      The owner is already outside the security model — it can disable triggers and
      rewrite grants — so pretending otherwise buys nothing and blocks legitimate
      administration, which is exactly what fault 3 was.
    */
    if access_changed and from_application then
        if not (select private.has_permission('users.manage')) then
            raise exception
                'Changing a person''s role, scope, account status or permissions requires the users.manage permission.'
                using errcode = '42501';
        end if;

        if tg_op = 'UPDATE' and me_id is not null and old.id = me_id then
            raise exception
                'You cannot change your own role, scope, account status or permissions. Another administrator must do it.'
                using errcode = '42501';
        end if;
    end if;

    /* Keep the manager foreign key true without the browser knowing UUIDs. */
    if coalesce(btrim(coalesce(new.legacy_payload ->> 'managerResourceId', '')), '') = '' then
        new.manager_id := null;
    else
        select p.id into new.manager_id
          from public.people p
         where p.legacy_resource_id = new.legacy_payload ->> 'managerResourceId'
         limit 1;
    end if;

    if new.manager_id is not null and new.manager_id = new.id then
        new.manager_id := null;
    end if;

    new.updated_at := now();
    return new;
end;
$$;

revoke all on function private.guard_person_identity() from public, anon;


/* -------------------------------------------------------------------------
   3. Owner-only linking helper.

      Deliberately NOT granted to authenticated. Only the SQL editor, a migration
      or a service-role connection can call it, which keeps the browser out of
      identity decisions while making the administrative step a single validated
      call instead of a hand-written UPDATE that is easy to get wrong.

      It validates rather than assuming: unknown email, unknown resource, and an
      already-linked person each produce a specific message.
   ------------------------------------------------------------------------- */
create or replace function public.ppm_link_person_login(
    p_email       text,
    p_resource_id text,
    p_require_password_reset boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id   uuid;
    v_person    record;
begin
    if (select auth.uid()) is not null then
        raise exception 'This function is for database administration and cannot be called from the application.'
            using errcode = '42501';
    end if;

    select u.id into v_user_id
      from auth.users u
     where lower(u.email) = lower(btrim(p_email))
     limit 1;

    if v_user_id is null then
        raise exception 'No Supabase Auth user exists with the email %. Create the user first.', p_email
            using errcode = '22023';
    end if;

    select p.id, p.legacy_resource_id, p.full_name, p.auth_user_id, p.access_role
      into v_person
      from public.people p
     where p.legacy_resource_id = btrim(p_resource_id)
     limit 1;

    if v_person.id is null then
        raise exception 'No person exists with resource id %. Create them in the Resource Directory first.', p_resource_id
            using errcode = '22023';
    end if;

    if v_person.auth_user_id is not null and v_person.auth_user_id <> v_user_id then
        raise exception 'Person % is already linked to a different login. Unlink it deliberately before relinking.',
            p_resource_id using errcode = '42501';
    end if;

    if exists (select 1 from public.people o
                where o.auth_user_id = v_user_id and o.legacy_resource_id <> v_person.legacy_resource_id) then
        raise exception 'That login is already linked to a different person.' using errcode = '42501';
    end if;

    if coalesce(btrim(coalesce(v_person.access_role, '')), '') = '' then
        raise exception 'Person % has no access role, so a login would grant nothing. Set the role first.',
            p_resource_id using errcode = '22023';
    end if;

    update public.people
       set auth_user_id = v_user_id,
           password_reset_required = coalesce(p_require_password_reset, true),
           version = version
     where id = v_person.id;

    return jsonb_build_object(
        'linked', true,
        'resourceId', v_person.legacy_resource_id,
        'fullName', v_person.full_name,
        'email', lower(btrim(p_email)),
        'passwordResetRequired', coalesce(p_require_password_reset, true)
    );
end;
$$;

revoke all on function public.ppm_link_person_login(text, text, boolean) from public, anon, authenticated;


/* -------------------------------------------------------------------------
   4. How a user clears their own first-run flag.

      An RPC rather than a column grant, so no new write path opens on the
      identity table. Requires AAL2, which by this point in the flow the user has
      just obtained by verifying their new authenticator.

      It only ever sets the flag false, and only ever on the caller's own row.
      There is nothing here that can raise a privilege.
   ------------------------------------------------------------------------- */
create or replace function public.ppm_complete_first_run()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    if coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then
        raise exception 'Completing first-run setup requires multi-factor authentication.'
            using errcode = '42501';
    end if;

    select p.id into v_id
      from public.people p
     where p.auth_user_id = (select auth.uid())
     limit 1;

    if v_id is null then
        raise exception 'Your sign-in is not linked to a person record.' using errcode = '42501';
    end if;

    update public.people
       set password_reset_required = false,
           version = version
     where id = v_id
       and password_reset_required;

    return true;
end;
$$;

revoke all on function public.ppm_complete_first_run() from public, anon;
grant execute on function public.ppm_complete_first_run() to authenticated;


/* -------------------------------------------------------------------------
   5. Readiness probe.
   ------------------------------------------------------------------------- */
create or replace function public.ppm_stage13a_ready()
returns boolean
language sql
stable
set search_path = ''
as $$
    select
        coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
        and exists (
            select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'people'
               and column_name = 'password_reset_required'
        )
        and to_regprocedure('public.ppm_complete_first_run()') is not null
        and to_regprocedure('public.ppm_link_person_login(text,text,boolean)') is not null
        and has_function_privilege('authenticated', 'public.ppm_complete_first_run()', 'EXECUTE')
        /* The linking helper must NOT be reachable from the browser. */
        and not has_function_privilege('authenticated', 'public.ppm_link_person_login(text,text,boolean)', 'EXECUTE');
$$;

revoke all on function public.ppm_stage13a_ready() from public, anon;
grant execute on function public.ppm_stage13a_ready() to authenticated;


/* -------------------------------------------------------------------------
   6. Close the anon default-grant hole for anything added above.
   ------------------------------------------------------------------------- */
do $$
declare
    fn     record;
    leaked text;
begin
    for fn in
        select p.oid::regprocedure as signature
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname like 'ppm%'
           and has_function_privilege('anon', p.oid, 'EXECUTE')
    loop
        execute format('revoke execute on function %s from anon', fn.signature);
    end loop;

    select string_agg(p.proname, ', ' order by p.proname) into leaked
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'ppm%'
       and has_function_privilege('anon', p.oid, 'EXECUTE');

    if leaked is not null then
        raise exception 'anon can still execute: %', leaked using errcode = '42501';
    end if;
end $$;

commit;

/* =============================================================================
   ADDING A TESTER, AFTER THIS MIGRATION

   1. Supabase dashboard -> Authentication -> Users -> Add user.
      Enter their email and a temporary password you invent. Tick Auto Confirm
      User. This is the one-time password.

   2. In the tool: Resources -> add the person. Set their access role and scope.
      Note the resource id it assigns, for example RES-00006.

   3. In the SQL editor:

        select public.ppm_link_person_login('tester@example.com', 'RES-00006');

      It validates both sides and returns what it did. It refuses if the email or
      the resource does not exist, if either is already linked to something else,
      or if the person has no access role.

   4. Send them the URL, their email and the temporary password. On first sign-in
      the tool walks them through scanning an authenticator QR code and then
      choosing their own password. No further administration needed.

   ROLLBACK

   The flag and both functions are additive; nothing depends on them:

       alter table public.people drop column if exists password_reset_required;
       drop function if exists public.ppm_complete_first_run();
       drop function if exists public.ppm_link_person_login(text, text, boolean);

   To restore the stricter auth_user_id rule, re-run
   STAGE-12A-PEOPLE-WRITES-MIGRATION.sql — but note that doing so reinstates
   fault 3, and linking becomes impossible without disabling the trigger.
   ========================================================================== */
