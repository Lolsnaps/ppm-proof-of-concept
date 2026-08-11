/*
  Database invariants gate.

  Run this in the Supabase SQL editor after any migration, and before any release.
  It raises on the first violation and prints a summary otherwise, so it is safe to
  run any time and tells you something either way.

  WHY THIS EXISTS

  The developer specification's traps section lists security mistakes that have already
  been made in this database. Every one of them was found by hand, late, and each was
  invisible until someone thought to look:

    - Six ppm_* functions were callable by `anon` despite `revoke ... from public`,
      because Supabase grants `anon` explicitly and revoking from PUBLIC does not touch
      an explicit grant.
    - resource_absence had a read policy of literally `true`, so every signed-in person
      could read everyone's long-term absence and contract end dates.
    - A table with RLS enabled and no policy denies everyone, which fails safe but
      presents as an inexplicably empty page.

  A warning in prose does not prevent any of that. This does. Each assertion below is
  a trap turned into a gate.

  Every check currently passes. That is the point: this is a regression gate, not a
  to-do list. If it starts failing, something changed that should not have.
*/

do $$
declare
    v_count    integer;
    v_detail   text;
    v_checks   integer := 0;

    /*
      Global configuration whose read policy is deliberately unconditional. These hold
      dropdown contents, stage definitions, the reporting calendar and the RAG
      tolerances: every signed-in person needs them to render any page, and none of
      them names a project, a person or a number. They remain behind the AAL2
      restrictive policy.

      The test for adding to this list: if a row is about somebody or something, it
      needs a scope. If it is a dropdown option, it does not. resource_absence was
      wrongly in this category and has been narrowed.
    */
    c_open_read_allowed text[] := array[
        'financial_categories',
        'lifecycle_templates',
        'lifecycle_mandatory_rules',
        'reference_data',
        'reporting_calendars',
        'reporting_periods',
        'rag_config',
        'resource_config'
    ];

    /* audit_log cannot audit itself - the trigger would recurse - and it is protected
       by an immutability trigger rather than an optimistic lock. */
    c_no_audit_trigger text[] := array['audit_log'];
    c_no_lock_trigger  text[] := array['audit_log'];

    /* rag_history derives its keys in the append guard, which fires BEFORE INSERT,
       instead of a separate _key trigger that fires BEFORE UPDATE. */
    c_no_key_trigger text[] := array['rag_history', 'projects', 'programmes', 'portfolios', 'people'];

    c_append_only text[] := array['audit_log', 'rag_history'];
begin
    /* ============================================================ 1. RLS is on */

    v_checks := v_checks + 1;
    select count(*), string_agg(c.relname, ', ')
      into v_count, v_detail
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r' and not c.relrowsecurity;

    if v_count > 0 then
        raise exception 'RLS is disabled on % table(s): %', v_count, v_detail;
    end if;

    /* ------------------ 2. RLS on with no policy denies everyone, silently */

    v_checks := v_checks + 1;
    select count(*), string_agg(c.relname, ', ')
      into v_count, v_detail
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and not exists (
           select 1 from pg_policies p
            where p.schemaname = 'public' and p.tablename = c.relname
              and p.permissive = 'PERMISSIVE' and p.cmd in ('SELECT', 'ALL')
       );

    if v_count > 0 then
        raise exception
            '% table(s) have RLS enabled but no readable policy, so they return nothing to everyone: %',
            v_count, v_detail;
    end if;

    /* ------------------------------- 3. AAL2 is required on every table */

    v_checks := v_checks + 1;
    select count(*), string_agg(c.relname, ', ')
      into v_count, v_detail
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and not exists (
           select 1 from pg_policies p
            where p.schemaname = 'public' and p.tablename = c.relname
              and p.permissive = 'RESTRICTIVE' and coalesce(p.qual, '') like '%aal2%'
       );

    if v_count > 0 then
        raise exception
            '% table(s) have no restrictive AAL2 policy, so they are readable before multi-factor completes: %',
            v_count, v_detail;
    end if;

    /* ------------- 4. no unconditional read policy outside the allowlist */

    v_checks := v_checks + 1;
    select count(*), string_agg(tablename || ' (' || policyname || ')', ', ')
      into v_count, v_detail
      from pg_policies
     where schemaname = 'public'
       and permissive = 'PERMISSIVE'
       and cmd in ('SELECT', 'ALL')
       and coalesce(qual, 'true') = 'true'
       and tablename <> all (c_open_read_allowed);

    if v_count > 0 then
        raise exception
            '% policy/policies read as unconditionally true on tables that are not global configuration: %. '
            'If the data is genuinely shared configuration, add the table to c_open_read_allowed with a reason.',
            v_count, v_detail;
    end if;

    /* ------------------------------------- 5. anon reaches nothing at all */

    v_checks := v_checks + 1;
    select count(*), string_agg(distinct table_name, ', ')
      into v_count, v_detail
      from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public';

    if v_count > 0 then
        raise exception 'anon holds % table grant(s) in public: %', v_count, v_detail;
    end if;

    v_checks := v_checks + 1;
    select count(*), string_agg(p.proname, ', ')
      into v_count, v_detail
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     where p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute');

    if v_count > 0 then
        raise exception
            'anon can execute % function(s): %. Note that "revoke ... from public" does NOT remove '
            'the explicit grant Supabase gives anon - revoke from anon by name.',
            v_count, v_detail;
    end if;

    /* -------------------- 6. nothing is hard-deletable by the application */

    v_checks := v_checks + 1;
    select count(*), string_agg(table_name || '.' || privilege_type, ', ')
      into v_count, v_detail
      from information_schema.role_table_grants
     where grantee = 'authenticated' and table_schema = 'public'
       and privilege_type in ('DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES');

    if v_count > 0 then
        raise exception
            'authenticated holds % privilege(s) it must never have: %. Deletion is soft, via deleted_at.',
            v_count, v_detail;
    end if;

    /* ------------------------------- 7. append-only really is append-only */

    v_checks := v_checks + 1;
    select count(*), string_agg(table_name || '.' || privilege_type, ', ')
      into v_count, v_detail
      from information_schema.role_table_grants
     where grantee = 'authenticated' and table_schema = 'public'
       and table_name = any (c_append_only)
       and privilege_type in ('UPDATE', 'DELETE');

    if v_count > 0 then
        raise exception 'append-only table(s) are writable: %', v_detail;
    end if;

    v_checks := v_checks + 1;
    select count(*), string_agg(t.tbl, ', ')
      into v_count, v_detail
      from unnest(c_append_only) as t(tbl)
     where not exists (
           select 1 from pg_trigger tg
             join pg_class c on c.oid = tg.tgrelid
             join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
            where c.relname = t.tbl and not tg.tgisinternal
              and (tg.tgname like '%immutable%' or tg.tgname like '%append%')
       );

    if v_count > 0 then
        raise exception
            'append-only table(s) have no immutability trigger: %. Grants alone are not enough - '
            'the trigger is what refuses the table owner too.',
            v_detail;
    end if;

    /* -------- 8. SECURITY DEFINER without a fixed search_path is exploitable */

    v_checks := v_checks + 1;
    select count(*), string_agg(n.nspname || '.' || p.proname, ', ')
      into v_count, v_detail
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.prosecdef
       and not exists (
           select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'
       );

    if v_count > 0 then
        raise exception
            '% SECURITY DEFINER function(s) do not fix search_path: %. Add: set search_path = ''''',
            v_count, v_detail;
    end if;

    /* ------------------------------------------ 9. trigger coverage */

    v_checks := v_checks + 1;
    select count(*), string_agg(c.relname, ', ')
      into v_count, v_detail
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and c.relname <> all (c_no_audit_trigger)
       and not exists (
           select 1 from pg_trigger tg
            where tg.tgrelid = c.oid and not tg.tgisinternal and tg.tgname like '%_audit%'
       );

    if v_count > 0 then
        raise exception '% table(s) have no audit trigger, so changes to them are unrecorded: %', v_count, v_detail;
    end if;

    v_checks := v_checks + 1;
    select count(*), string_agg(c.relname, ', ')
      into v_count, v_detail
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and c.relname <> all (c_no_lock_trigger)
       and not exists (
           select 1 from pg_trigger tg
            where tg.tgrelid = c.oid and not tg.tgisinternal
              and (tg.tgname like '%_lock%' or tg.tgname like '%immutable%')
       );

    if v_count > 0 then
        raise exception
            '% table(s) have neither an optimistic lock nor an immutability trigger, so concurrent edits '
            'overwrite silently: %', v_count, v_detail;
    end if;

    v_checks := v_checks + 1;
    select count(*), string_agg(c.relname, ', ')
      into v_count, v_detail
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and c.relname <> all (c_no_key_trigger)
       and c.relname <> 'audit_log'
       and not exists (
           select 1 from pg_trigger tg
            where tg.tgrelid = c.oid and not tg.tgisinternal and tg.tgname like '%_key%'
       );

    if v_count > 0 then
        raise exception '% child table(s) have no key-maintenance trigger: %', v_count, v_detail;
    end if;

    /* ---------------- 10. every table carries the standard bookkeeping */

    v_checks := v_checks + 1;
    select count(*), string_agg(c.relname, ', ')
      into v_count, v_detail
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r' and c.relname <> 'audit_log'
       and not exists (
           select 1 from information_schema.columns col
            where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'version'
       );

    if v_count > 0 then
        raise exception '% table(s) have no version column, so optimistic locking cannot work: %', v_count, v_detail;
    end if;

    /* ------------------------------------------------------------ summary */

    raise notice '';
    raise notice 'All % invariant group(s) passed.', v_checks;
    raise notice '  tables            : %', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' where c.relkind = 'r');
    raise notice '  policies          : %', (select count(*) from pg_policies where schemaname = 'public');
    raise notice '  triggers          : %', (select count(*) from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' where not tg.tgisinternal);
    raise notice '  public functions  : %', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public' where p.prokind = 'f');
    raise notice '  anon reaches      : nothing';
    raise notice '';
end $$;
