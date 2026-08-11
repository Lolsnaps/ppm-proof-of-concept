/* =============================================================================
   PORTFOLIO MANAGER — STAGE 12A
   Resource Directory writes: public.people becomes authoritative

   This is the last business store outside the database, and the one with the most
   to get wrong. public.people is not ordinary business data: it is the identity
   table. auth.users.id -> people.auth_user_id is how sign-in resolves to an
   application identity, and people.legacy_resource_id is the join key behind every
   denormalised owner name and email in projects, plans and RAID.

   FOUR THINGS FOUND BY INSPECTING THE LIVE DATABASE RATHER THAN THE FILES

   1. NOBODY COULD SEE THE WHOLE DIRECTORY.

      private.can_access_person() grants visibility if the target is you, shares
      your team, or leads a project you can access. There was no portfolio-wide
      branch, so not even a System Administrator saw all five people, and a person
      with no team who leads no project was invisible to everyone.

      That is a latent data-loss bug the moment the directory becomes
      database-backed. Hydration replaces the whole local array with what the
      reader can see; the next save writes that array back. Invisible people would
      disappear from the directory and look deleted. Worse, nextResourceId() takes
      max(RES-nnn) of the visible list, so it would reissue an identifier already
      in use — colliding with the unique constraint at best, and silently attaching
      new records to an existing person's history at worst.

      Fixed here: portfolio-wide access sees every person. Scoped roles keep the
      existing team-and-project rules.

   2. public.people HAD NO version COLUMN.

      So no optimistic locking. Two administrators editing the directory would
      overwrite each other silently, with no conflict raised. Added, with the same
      trigger every other table uses.

   3. public.people HAD NO AUDIT TRIGGER, and audit_log held zero entries for it.

      Role changes, scope changes and account suspensions — the most
      security-significant edits in the application — were not being recorded at
      all. private.record_audit() is extended to cover people.

   4. ONLY ONE OF FIVE ROWS IS LINKED TO A LOGIN.

      Which makes auth_user_id the single most dangerous column in the schema. It
      is never writable from the browser here, at any permission level.

   WHAT THIS MIGRATION DELIBERATELY DOES NOT DO

   It does not create or manage Supabase Auth users. Provisioning a login needs the
   Admin API and a server-held secret, and no secret goes near the browser. Linking
   a person to a login stays a deliberate administrative act performed outside the
   application — via the Supabase dashboard now, or Entra later. The browser can
   only edit people rows; it can never decide who they are.

   It does not grant DELETE. Removal is represented by active/account_status,
   consistent with every other table.

   SAFE TO RE-RUN.
   ========================================================================== */

begin;

/* -------------------------------------------------------------------------
   1. Optimistic locking, so two administrators cannot silently overwrite
      each other.
   ------------------------------------------------------------------------- */
alter table public.people add column if not exists version integer not null default 1;

drop trigger if exists trg_people_lock on public.people;
create trigger trg_people_lock
before update on public.people
for each row execute function private.enforce_optimistic_lock();


/* -------------------------------------------------------------------------
   2. Widen directory visibility.

      Adds one branch: portfolio-wide access sees every person. Everything else is
      carried over unchanged, so a Project Manager or Resource Manager keeps
      exactly the visibility they have today.

      Read access to contact detail is a separate concern and stays governed by
      resources.viewContact in the application.
   ------------------------------------------------------------------------- */
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
        /*
          Stage 12A. A directory that nobody can see in full cannot be maintained,
          and hydrating a partial view into a whole-array store loses the rows the
          reader cannot see.
        */
        (select private.has_portfolio_wide_access())
        or me.id = t.id
        or (me.team_key is not null and me.team_key = t.team_key)
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

revoke all on function private.can_access_person(uuid) from public, anon;
grant execute on function private.can_access_person(uuid) to authenticated;


/* -------------------------------------------------------------------------
   3. Identity and access-control guard.

      This is the security heart of the stage. The application already hides these
      fields unless PPMAuth.can("users.manage"), but that is a UX control; this is
      the boundary.

      Three separate rules, deliberately not merged:

        a. auth_user_id is never writable from the browser. Not under
           users.manage, not by a System Administrator. Linking a person to a login
           decides who someone IS, and it happens outside the application.

        b. legacy_resource_id is immutable once set. Every owner name and email
           denormalised into projects, plans and RAID is joined on it, so changing
           it would orphan that data silently.

        c. Access-control fields need users.manage, and cannot be changed on your
           OWN row at all. Self-approval is refused everywhere else in this
           application and granting yourself permissions is the same shape of
           problem. If you are the only administrator and need to change your own
           access, do it through the Supabase dashboard — a deliberate act outside
           the tool, which is the point.

      `active` is treated as access-significant only when the person actually has a
      login or an access role. Deactivating a generic placeholder resource is
      ordinary directory maintenance; deactivating a user account is not.
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
begin
    select p.id into me_id
      from public.people p
     where p.auth_user_id = (select auth.uid())
     limit 1;

    /* (a) auth_user_id: never from here. */
    if tg_op = 'INSERT' then
        if new.auth_user_id is not null then
            raise exception
                'A login cannot be attached to a person from the application. Create the row first, then link the account in Supabase.'
                using errcode = '42501';
        end if;
    elsif new.auth_user_id is distinct from old.auth_user_id then
        raise exception
            'The login linked to a person cannot be changed from the application. This is deliberate: it decides who someone is.'
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

    /* (c) access-control fields. */
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

    if access_changed then
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

    /*
      Keep the manager relationship meaningful. The application stores the
      manager as a RES- code inside legacy_payload; resolving it here means the
      foreign key stays true without the browser having to know UUIDs.
    */
    if coalesce(btrim(coalesce(new.legacy_payload ->> 'managerResourceId', '')), '') = '' then
        new.manager_id := null;
    else
        select p.id into new.manager_id
          from public.people p
         where p.legacy_resource_id = new.legacy_payload ->> 'managerResourceId'
         limit 1;
    end if;

    /* A person cannot be their own manager. */
    if new.manager_id is not null and new.manager_id = new.id then
        new.manager_id := null;
    end if;

    new.updated_at := now();
    return new;
end;
$$;

revoke all on function private.guard_person_identity() from public, anon;

drop trigger if exists trg_people_identity on public.people;
create trigger trg_people_identity
before insert or update on public.people
for each row execute function private.guard_person_identity();


/* -------------------------------------------------------------------------
   4. Audit.

      public.people had no audit trigger and audit_log held no entries for it, so
      role changes, scope changes and suspensions were unrecorded. record_audit()
      resolved the business key with an if/elsif chain whose else branch assumed
      portfolio_code, so it could not simply be pointed at another table.

      Rewritten with an explicit branch per table and a safe fallback. The
      projects/programmes/portfolios behaviour is unchanged.
   ------------------------------------------------------------------------- */
create or replace function private.record_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    me            record;
    changed       jsonb := '[]'::jsonb;
    old_json      jsonb;
    new_json      jsonb;
    field         text;
    business_key  text;
    skip_fields   text[] := array['legacy_payload','import_payload','updated_at','created_at','version'];
begin
    select p.id, p.full_name, p.email, p.access_role
      into me
      from public.people p
     where p.auth_user_id = (select auth.uid())
     limit 1;

    if TG_TABLE_NAME = 'projects' then
        business_key := coalesce(NEW.project_code, OLD.project_code);
    elsif TG_TABLE_NAME = 'programmes' then
        business_key := coalesce(NEW.programme_code, OLD.programme_code);
    elsif TG_TABLE_NAME = 'portfolios' then
        business_key := coalesce(NEW.portfolio_code, OLD.portfolio_code);
    elsif TG_TABLE_NAME = 'people' then
        /* Falls back to the full name so a person with no resource id is still
           identifiable in the trail. */
        business_key := coalesce(
            NEW.legacy_resource_id, OLD.legacy_resource_id,
            NEW.full_name, OLD.full_name, 'unknown person'
        );
    else
        business_key := coalesce(NEW.id::text, OLD.id::text);
    end if;

    if TG_OP = 'UPDATE' then
        old_json := to_jsonb(OLD);
        new_json := to_jsonb(NEW);
        for field in select jsonb_object_keys(new_json) loop
            if field = any(skip_fields) then continue; end if;
            if new_json -> field is distinct from old_json -> field then
                changed := changed || jsonb_build_object(
                    'field',  field,
                    'before', old_json -> field,
                    'after',  new_json -> field
                );
            end if;
        end loop;

        -- A write that changed nothing is noise, not history.
        if jsonb_array_length(changed) = 0 then
            return NEW;
        end if;
    elsif TG_OP = 'INSERT' then
        changed := jsonb_build_array(jsonb_build_object('field','(record created)','before',null,'after',business_key));
    else
        changed := jsonb_build_array(jsonb_build_object('field','(record deleted)','before',business_key,'after',null));
    end if;

    insert into public.audit_log (
        auth_user_id, person_id, actor_name, actor_email, actor_role,
        table_name, record_key, record_id, operation, changes, row_version
    ) values (
        (select auth.uid()), me.id, me.full_name, me.email, me.access_role,
        TG_TABLE_NAME, business_key,
        case when TG_OP = 'DELETE' then OLD.id else NEW.id end,
        TG_OP, changed,
        case when TG_OP = 'DELETE' then OLD.version else NEW.version end
    );

    return case when TG_OP = 'DELETE' then OLD else NEW end;
exception when others then
    -- Never block a legitimate change because the audit write failed.
    raise warning 'audit: could not record % on %: %', TG_OP, TG_TABLE_NAME, sqlerrm;
    return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

revoke all on function private.record_audit() from public, anon;

drop trigger if exists trg_people_audit on public.people;
create trigger trg_people_audit
after insert or update or delete on public.people
for each row execute function private.record_audit();


/* -------------------------------------------------------------------------
   5. Write policies and grants.

      Reads are recreated verbatim from what was already installed, so this file is
      the single current statement of the table's security rather than a patch that
      has to be read alongside Stage 3D and Stage 5.

      Writes require resources.edit plus visibility of the person being edited, so a
      Resource Manager can maintain their own team and nobody can edit a person they
      cannot see. The access-control guard in section 3 then decides what may
      actually change.

      DELETE stays revoked.
   ------------------------------------------------------------------------- */
drop policy if exists "people require aal2"                on public.people;
drop policy if exists "people can read own record"          on public.people;
drop policy if exists "people can read colleagues in scope" on public.people;
drop policy if exists "people insert"                       on public.people;
drop policy if exists "people update"                       on public.people;

alter table public.people enable row level security;

create policy "people require aal2" on public.people
    as restrictive for all to authenticated
    using ((select auth.jwt() ->> 'aal') = 'aal2')
    with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy "people can read own record" on public.people
    for select to authenticated
    using (
        auth_user_id = (select auth.uid())
        and active = true
        and coalesce(account_status, 'Active') = 'Active'
    );

create policy "people can read colleagues in scope" on public.people
    for select to authenticated
    using (
        (select private.has_permission('resources.view'))
        and (select private.can_access_person(people.id))
    );

create policy "people insert" on public.people
    for insert to authenticated
    with check ((select private.has_permission('resources.edit')));

create policy "people update" on public.people
    for update to authenticated
    using (
        (select private.has_permission('resources.edit'))
        and (select private.can_access_person(people.id))
    )
    with check (
        (select private.has_permission('resources.edit'))
        and (select private.can_access_person(people.id))
    );

grant select, insert, update on public.people to authenticated;
revoke delete, truncate, trigger, references on public.people from authenticated;
revoke all on public.people from anon;


/* -------------------------------------------------------------------------
   6. Readiness probe.
   ------------------------------------------------------------------------- */
create or replace function public.ppm_stage12a_ready()
returns boolean
language sql
stable
set search_path = ''
as $$
    select
        coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
        and exists (
            select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'people' and column_name = 'version'
        )
        and exists (
            select 1 from pg_catalog.pg_trigger
             where tgname = 'trg_people_identity' and not tgisinternal
        )
        and exists (
            select 1 from pg_catalog.pg_trigger
             where tgname = 'trg_people_lock' and not tgisinternal
        )
        and exists (
            select 1 from pg_catalog.pg_trigger
             where tgname = 'trg_people_audit' and not tgisinternal
        )
        and to_regprocedure('private.guard_person_identity()') is not null
        and has_table_privilege('authenticated', 'public.people', 'SELECT')
        and has_table_privilege('authenticated', 'public.people', 'INSERT')
        and has_table_privilege('authenticated', 'public.people', 'UPDATE')
        and not has_table_privilege('authenticated', 'public.people', 'DELETE')
        and not has_table_privilege('authenticated', 'public.people', 'TRUNCATE')
        and not has_table_privilege('authenticated', 'public.people', 'TRIGGER')
        and not has_table_privilege('authenticated', 'public.people', 'REFERENCES');
$$;

revoke all on function public.ppm_stage12a_ready() from public, anon;
grant execute on function public.ppm_stage12a_ready() to authenticated;


/* -------------------------------------------------------------------------
   7. Close the anon default-grant hole again, for anything added above.
      Same sweep Stage 11F installed; harmless when there is nothing to do.
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
   ROLLBACK

   To put the browser back on local resource data:  PPMDatabase.revertToLocal("people")
   then reload. That changes source selection only; every row stays.

   The guards are deliberately not scripted away. Handing the browser the ability to
   rewrite auth_user_id or a person's own permissions is the specific risk this
   stage removes.

   IF YOU LOCK YOURSELF OUT

   The self-edit rule means you cannot change your own access from the tool. As the
   only administrator, use the Supabase SQL editor:

       update public.people
          set account_status = 'Active', active = true
        where auth_user_id = '<your auth.users id>';

   That runs as the table owner and bypasses both the policy and the guard, which is
   why it is the documented escape hatch rather than something the application can do.
   ========================================================================== */
