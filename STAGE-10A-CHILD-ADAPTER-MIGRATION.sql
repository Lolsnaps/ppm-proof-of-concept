/* =============================================================================
   PORTFOLIO MANAGER — STAGE 10A
   Child adapter pre-cutover hardening

   PURPOSE
   -------
   Stage 9 created the 18 destination tables. A full-code review before seeding
   found two shapes that are not actually project-scoped:
     1. Programme-level benefits can live under "programme:<id>" with no project.
     2. Resource scenarios are portfolio/resource-planning objects containing
        demand from multiple projects; the scenario itself has no project code.

   This migration fixes those two scope assumptions and adds a soft-delete field
   to every writable child table. DELETE remains revoked.

   It does not migrate data and changes no application behaviour.

   SAFE TO RE-RUN.
   ========================================================================== */

begin;

/* -------------------------------------------------------------------------
   1. Soft delete support.

   The existing application can remove milestones, RAID rows, register rows,
   gates and other child records. Stage 9 deliberately revoked DELETE. A
   database cutover therefore needs a reversible server representation of
   "removed from the live collection". The adapter will use deleted_at and
   query only current rows.
   ------------------------------------------------------------------------- */
do $$
declare
    t text;
begin
    foreach t in array array[
        'project_plans', 'project_milestones', 'project_raid', 'project_actions', 'project_decisions', 'project_financials', 'project_benefits', 'project_documents', 'status_reports', 'stage_gates', 'plan_baselines', 'plan_baseline_requests', 'rag_history', 'financial_entries', 'financial_approval_requests', 'resource_demand', 'resource_scenarios'
    ]
    loop
        execute format(
            'alter table public.%I add column if not exists deleted_at timestamptz',
            t
        );
    end loop;
end $$;


/* -------------------------------------------------------------------------
   2. Programme benefits.

   ppmProjectBenefits is the one register that can be linked either to a
   project or to a programme. Stage 9 was generated from an empty backup and
   therefore could not observe that shape.

   Keep project_code NOT NULL for compatibility with the generic child table
   contract. Programme-level rows use project_code = '' and programme_code =
   the PRG identifier.
   ------------------------------------------------------------------------- */
alter table public.project_benefits
    add column if not exists programme_code text;

alter table public.project_benefits
    drop constraint if exists project_benefits_scope_check;

alter table public.project_benefits
    add constraint project_benefits_scope_check check (
        (
            nullif(project_code, '') is not null
            and nullif(programme_code, '') is null
        )
        or
        (
            nullif(project_code, '') is null
            and nullif(programme_code, '') is not null
        )
    );

create index if not exists project_benefits_programme_idx
    on public.project_benefits (programme_code);

create or replace function private.can_access_programme_code(target_programme_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.programmes pg
        where pg.programme_code = target_programme_code
          and (select private.can_access_programme(pg.id))
    );
$$;

revoke all on function private.can_access_programme_code(text) from public;
grant execute on function private.can_access_programme_code(text) to authenticated;

drop policy if exists "project_benefits read scope" on public.project_benefits;
create policy "project_benefits read scope"
on public.project_benefits
for select to authenticated
using (
    (select private.has_permission('benefits.view'))
    and (
        (
            nullif(project_code, '') is not null
            and (select private.can_access_project(project_code))
        )
        or
        (
            nullif(programme_code, '') is not null
            and (select private.can_access_programme_code(programme_code))
        )
    )
);

drop policy if exists "project_benefits insert" on public.project_benefits;
create policy "project_benefits insert"
on public.project_benefits
for insert to authenticated
with check (
    (select private.has_permission('benefits.edit'))
    and (
        (
            nullif(project_code, '') is not null
            and (select private.can_access_project(project_code))
        )
        or
        (
            nullif(programme_code, '') is not null
            and (select private.can_access_programme_code(programme_code))
        )
    )
);

drop policy if exists "project_benefits update" on public.project_benefits;
create policy "project_benefits update"
on public.project_benefits
for update to authenticated
using (
    (select private.has_permission('benefits.edit'))
    and (
        (
            nullif(project_code, '') is not null
            and (select private.can_access_project(project_code))
        )
        or
        (
            nullif(programme_code, '') is not null
            and (select private.can_access_programme_code(programme_code))
        )
    )
)
with check (
    (select private.has_permission('benefits.edit'))
    and (
        (
            nullif(project_code, '') is not null
            and (select private.can_access_project(project_code))
        )
        or
        (
            nullif(programme_code, '') is not null
            and (select private.can_access_programme_code(programme_code))
        )
    )
);


/*
  project_code and record_key are already immutable through
  private.protect_child_key(). Programme-level benefits need their programme
  scope protected too.
*/
create or replace function private.protect_benefit_programme()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if NEW.programme_code is distinct from OLD.programme_code then
        raise exception
            'A project_benefits record cannot be moved to a different programme (% to %).',
            OLD.programme_code, NEW.programme_code
            using errcode = '42501';
    end if;
    return NEW;
end;
$$;

drop trigger if exists trg_project_benefits_programme_key on public.project_benefits;
create trigger trg_project_benefits_programme_key
before update on public.project_benefits
for each row execute function private.protect_benefit_programme();


/* -------------------------------------------------------------------------
   3. Resource scenarios.

   A scenario is not one project's row. It can contain demand copied from many
   projects and the current local model stores no projectCode on the scenario
   itself. Scope it by the existing resourceManagement permission instead of
   inventing a fake project relationship.
   ------------------------------------------------------------------------- */
drop policy if exists "resource_scenarios read scope" on public.resource_scenarios;
create policy "resource_scenarios read scope"
on public.resource_scenarios
for select to authenticated
using ((select private.has_permission('resourceManagement.view')));

drop policy if exists "resource_scenarios insert" on public.resource_scenarios;
create policy "resource_scenarios insert"
on public.resource_scenarios
for insert to authenticated
with check ((select private.has_permission('resourceManagement.edit')));

drop policy if exists "resource_scenarios update" on public.resource_scenarios;
create policy "resource_scenarios update"
on public.resource_scenarios
for update to authenticated
using ((select private.has_permission('resourceManagement.edit')))
with check ((select private.has_permission('resourceManagement.edit')));


/* -------------------------------------------------------------------------
   4. Audit key generation/read scope for the two non-project shapes.

   Normal child audit keys remain:
       PRJ-00001 / <record key>

   Programme benefits become:
       programme:PRG-00001 / <benefit id>

   Resource scenarios become:
       resource-scenario / <scenario id>
   ------------------------------------------------------------------------- */
create or replace function private.record_child_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    me          record;
    changed     jsonb := '[]'::jsonb;
    old_json    jsonb;
    new_json    jsonb;
    field       text;
    key_text    text;
    project_txt text;
    record_txt  text;
    programme_txt text;
    skip_fields text[] := array[
        'legacy_payload','import_payload','updated_at','created_at',
        'version','id','project_id'
    ];
begin
    select p.id, p.full_name, p.email, p.access_role
      into me
      from public.people p
     where p.auth_user_id = (select auth.uid())
     limit 1;

    old_json := case when TG_OP = 'INSERT' then '{}'::jsonb else to_jsonb(OLD) end;
    new_json := case when TG_OP = 'DELETE' then '{}'::jsonb else to_jsonb(NEW) end;

    project_txt := coalesce(
        nullif(new_json ->> 'project_code', ''),
        nullif(old_json ->> 'project_code', ''),
        ''
    );
    record_txt := coalesce(
        nullif(new_json ->> 'record_key', ''),
        nullif(old_json ->> 'record_key', ''),
        ''
    );
    programme_txt := coalesce(
        nullif(new_json ->> 'programme_code', ''),
        nullif(old_json ->> 'programme_code', ''),
        ''
    );

    if TG_TABLE_NAME = 'project_benefits' and project_txt = '' and programme_txt <> '' then
        key_text := 'programme:' || programme_txt || ' / ' || record_txt;
    elsif TG_TABLE_NAME = 'resource_scenarios' then
        key_text := 'resource-scenario / ' || record_txt;
    else
        key_text := project_txt || ' / ' || record_txt;
    end if;

    if TG_OP = 'UPDATE' then
        old_json := to_jsonb(OLD);
        new_json := to_jsonb(NEW);
        for field in select jsonb_object_keys(new_json) loop
            if field = any(skip_fields) then continue; end if;
            if new_json -> field is distinct from old_json -> field then
                changed := changed || jsonb_build_object(
                    'field', field,
                    'before', old_json -> field,
                    'after', new_json -> field
                );
            end if;
        end loop;
        if jsonb_array_length(changed) = 0 then return NEW; end if;
    elsif TG_OP = 'INSERT' then
        changed := jsonb_build_array(
            jsonb_build_object(
                'field','(record created)',
                'before',null,
                'after',key_text
            )
        );
    else
        changed := jsonb_build_array(
            jsonb_build_object(
                'field','(record deleted)',
                'before',key_text,
                'after',null
            )
        );
    end if;

    insert into public.audit_log (
        auth_user_id, person_id, actor_name, actor_email, actor_role,
        table_name, record_key, record_id, operation, changes, row_version
    ) values (
        (select auth.uid()), me.id, me.full_name, me.email, me.access_role,
        TG_TABLE_NAME, key_text,
        case when TG_OP = 'DELETE' then OLD.id else NEW.id end,
        TG_OP, changed,
        case when TG_OP = 'DELETE' then OLD.version else NEW.version end
    );

    return case when TG_OP = 'DELETE' then OLD else NEW end;
exception when others then
    raise warning 'audit: could not record % on %: %',
        TG_OP, TG_TABLE_NAME, sqlerrm;
    return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

drop policy if exists "users can read audit history" on public.audit_log;
create policy "users can read audit history"
on public.audit_log
for select to authenticated
using (
    (select private.has_permission('audit.view'))
    or (
        table_name = 'resource_scenarios'
        and (select private.has_permission('resourceManagement.view'))
    )
    or (
        record_key like 'programme:% / %'
        and (select private.can_access_programme_code(
            split_part(split_part(record_key, ' / ', 1), 'programme:', 2)
        ))
    )
    or (
        record_key not like 'programme:% / %'
        and table_name <> 'resource_scenarios'
        and (select private.can_access_project(split_part(record_key, ' / ', 1)))
    )
);


/* -------------------------------------------------------------------------
   5. Preserve the Stage 9 hard-deny posture.
   ------------------------------------------------------------------------- */
do $$
declare
    t text;
begin
    foreach t in array array[
        'project_plans', 'project_milestones', 'project_raid', 'project_actions', 'project_decisions', 'project_financials', 'project_benefits', 'project_documents', 'status_reports', 'stage_gates', 'plan_baselines', 'plan_baseline_requests', 'rag_history', 'financial_entries', 'financial_approval_requests', 'resource_demand', 'resource_scenarios'
    ]
    loop
        execute format('revoke delete, truncate, trigger, references on public.%I from authenticated', t);
        execute format('revoke all on public.%I from anon', t);
    end loop;
end $$;

commit;


/* -------------------------------------------------------------------------
   VALIDATION — every row should say PASS / false where noted.
   ------------------------------------------------------------------------- */

select 'soft-delete columns' as check,
       case when count(*) = 17 then 'PASS' else 'FAIL: '||count(*) end as result
from information_schema.columns
where table_schema = 'public'
  and column_name = 'deleted_at'
  and table_name = any(array[
      'project_plans', 'project_milestones', 'project_raid', 'project_actions', 'project_decisions', 'project_financials', 'project_benefits', 'project_documents', 'status_reports', 'stage_gates', 'plan_baselines', 'plan_baseline_requests', 'rag_history', 'financial_entries', 'financial_approval_requests', 'resource_demand', 'resource_scenarios'
  ]);

select 'benefit programme column' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as result
from information_schema.columns
where table_schema='public'
  and table_name='project_benefits'
  and column_name='programme_code';

select 'can_access_programme_code function' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as result
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='private'
  and p.proname='can_access_programme_code';

select 'authenticated DELETE privileges' as check,
       count(*) as should_be_zero
from information_schema.role_table_grants
where grantee='authenticated'
  and table_schema='public'
  and privilege_type='DELETE'
  and table_name = any(array[
      'project_plans', 'project_milestones', 'project_raid', 'project_actions', 'project_decisions', 'project_financials', 'project_benefits', 'project_documents', 'status_reports', 'stage_gates', 'plan_baselines', 'plan_baseline_requests', 'rag_history', 'financial_entries', 'financial_approval_requests', 'resource_demand', 'resource_scenarios'
  ]);

select 'anon child-table privileges' as check,
       count(*) as should_be_zero
from information_schema.role_table_grants
where grantee='anon'
  and table_schema='public'
  and table_name = any(array[
      'project_plans', 'project_milestones', 'project_raid', 'project_actions', 'project_decisions', 'project_financials', 'project_benefits', 'project_documents', 'status_reports', 'stage_gates', 'plan_baselines', 'plan_baseline_requests', 'rag_history', 'financial_entries', 'financial_approval_requests', 'resource_demand', 'resource_scenarios'
  ]);
