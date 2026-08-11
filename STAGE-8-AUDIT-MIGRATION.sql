/* =============================================================================
   PORTFOLIO MANAGER — STAGE 8
   Server-side, append-only audit for the migrated tables

   Today's audit trail lives in localStorage. Anyone with developer tools can
   rewrite it, so it records what happened but cannot prove it. This adds a
   parallel trail the browser cannot forge: written by the database itself, on
   every change, attributed to the authenticated user rather than to whatever
   the page claimed.

   Design decisions worth stating:

     - INSERT only. No UPDATE or DELETE is granted to anyone through the API,
       and a trigger refuses both even if a grant were added by mistake.
     - Rows are written by a SECURITY DEFINER trigger, so the audit table needs
       no INSERT grant at all - the browser cannot write to it directly, and
       therefore cannot fabricate an entry.
     - The actor is taken from auth.uid(), never from the payload.
     - Only fields that actually changed are stored, so the trail stays readable.
     - Auditing must never block a legitimate write: if the trigger itself
       fails, the failure is logged and the write proceeds.

   SAFE TO RE-RUN.
   ========================================================================== */

begin;

create table if not exists public.audit_log (
    id            bigint generated always as identity primary key,
    occurred_at   timestamptz not null default now(),

    -- Who, established server-side. auth_user_id is the fact; the rest is
    -- convenience copied at write time so the trail stays readable even if the
    -- person record is later changed.
    auth_user_id  uuid,
    person_id     uuid references public.people(id) on delete set null,
    actor_name    text,
    actor_email   text,
    actor_role    text,

    -- What
    table_name    text not null,
    record_key    text,
    record_id     uuid,
    operation     text not null check (operation in ('INSERT','UPDATE','DELETE')),
    changes       jsonb not null default '[]'::jsonb,
    row_version   integer
);

create index if not exists audit_log_occurred_at_idx on public.audit_log (occurred_at desc);
create index if not exists audit_log_record_idx      on public.audit_log (table_name, record_key);
create index if not exists audit_log_actor_idx       on public.audit_log (auth_user_id);

comment on table public.audit_log is
    'Append-only record of every change to the migrated tables, written by database triggers. Cannot be inserted, updated or deleted through the API.';

alter table public.audit_log enable row level security;

/*
  Append-only, enforced rather than assumed. The trigger below runs as the table
  owner, so legitimate audit rows are still written; this only stops anything
  else editing history.
*/
create or replace function private.audit_log_is_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception 'The audit log is append-only. Entries cannot be % once written.',
        lower(TG_OP) using errcode = '42501';
end;
$$;

drop trigger if exists trg_audit_log_no_update on public.audit_log;
drop trigger if exists trg_audit_log_no_delete on public.audit_log;

create trigger trg_audit_log_no_update before update on public.audit_log
    for each row execute function private.audit_log_is_immutable();
create trigger trg_audit_log_no_delete before delete on public.audit_log
    for each row execute function private.audit_log_is_immutable();

/*
  The recorder.

  legacy_payload and import_payload are skipped: legacy_payload duplicates the
  normalised columns and would make every entry unreadable, and import_payload
  never changes.
*/
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
    else
        business_key := coalesce(NEW.portfolio_code, OLD.portfolio_code);
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

drop trigger if exists trg_projects_audit   on public.projects;
drop trigger if exists trg_programmes_audit on public.programmes;
drop trigger if exists trg_portfolios_audit on public.portfolios;

-- AFTER, so a write refused by policy or by the locking trigger is never logged
-- as if it had succeeded.
create trigger trg_projects_audit   after insert or update or delete on public.projects
    for each row execute function private.record_audit();
create trigger trg_programmes_audit after insert or update or delete on public.programmes
    for each row execute function private.record_audit();
create trigger trg_portfolios_audit after insert or update or delete on public.portfolios
    for each row execute function private.record_audit();

/*
  Reading it. SELECT only, never INSERT - entries arrive through the trigger,
  which runs as the owner and does not need a grant.
*/
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

drop policy if exists "audit requires aal2"          on public.audit_log;
drop policy if exists "users can read audit history" on public.audit_log;

create policy "audit requires aal2" on public.audit_log
    as restrictive for select to authenticated
    using ((select auth.jwt()->>'aal') = 'aal2');

/*
  Anyone holding audit.view sees the whole trail, which is the point of an audit
  role. Everyone else sees only entries for records they could already read, so
  the audit log can never become a way around project scoping.
*/
create policy "users can read audit history" on public.audit_log
    for select to authenticated
    using (
        (select private.has_permission('audit.view'))
        or (
            table_name = 'projects'
            and (select private.can_access_project(record_key))
        )
    );

commit;

select 'audit_log table exists' as check, (count(*) = 1)::text as found, 'true' as expected
from information_schema.tables where table_schema='public' and table_name='audit_log'
union all
select 'audit triggers installed', (count(*) = 3)::text, 'true'
from pg_trigger where tgname in ('trg_projects_audit','trg_programmes_audit','trg_portfolios_audit')
union all
select 'immutability triggers installed', (count(*) = 2)::text, 'true'
from pg_trigger where tgname in ('trg_audit_log_no_update','trg_audit_log_no_delete')
union all
select 'authenticated can SELECT audit', has_table_privilege('authenticated','public.audit_log','select')::text, 'true'
union all
select 'authenticated CANNOT INSERT audit', (not has_table_privilege('authenticated','public.audit_log','insert'))::text, 'true'
union all
select 'authenticated CANNOT UPDATE audit', (not has_table_privilege('authenticated','public.audit_log','update'))::text, 'true'
union all
select 'authenticated CANNOT DELETE audit', (not has_table_privilege('authenticated','public.audit_log','delete'))::text, 'true'
union all
select 'anon has no audit access', (not has_table_privilege('anon','public.audit_log','select'))::text, 'true'
union all
select 'RLS enabled on audit_log', relrowsecurity::text, 'true' from pg_class where relname='audit_log';
