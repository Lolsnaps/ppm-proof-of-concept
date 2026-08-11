/*
  STAGE 21 — record the RLS auto-enable event trigger in the migration set
  =======================================================================

  Safe to re-run. This changes nothing in the current database.

  WHY THIS FILE EXISTS

  public.rls_auto_enable() and the ensure_rls event trigger have been running in production for
  some time. They are the safety net that turns row-level security on for any new table in the
  public schema at the moment it is created, so a table cannot be added and left readable by
  everyone because somebody forgot the alter statement.

  Neither object appears in any migration file. They were created directly against the database,
  and the only record of them was a line in the developer specification describing what they do.

  That is a reproducibility gap rather than a live defect. The database is correct today. But the
  migration set is meant to be the source of record: run the 34 files against an empty database
  and you should get this schema. Without this file you would get the schema minus its RLS safety
  net, and the omission would be silent, because nothing fails when a safety net is absent - it
  simply stops catching things.

  Found by VERIFY-STATIC gate 6k, which checks that every function the developer specification
  names actually exists in the source. It found rls_auto_enable named in the document, present in
  the database, and absent from every .sql file.

  WHAT THIS DOES

  Recreates the function exactly as it currently runs, and recreates the event trigger only if it
  is missing. Against the live database both are no-ops. Against a rebuild they are the point.

  A NOTE ON WHAT THIS IS NOT

  This is a convenience, not a control. Enabling row-level security on a table does nothing on its
  own: a table with RLS enabled and no policy denies everyone, which is a different failure and an
  obvious one. The real protection is the policies themselves and the checks in
  VERIFY-INVARIANTS.sql. What this stops is the specific case of a new table shipping with RLS off
  and therefore readable by any authenticated user.
*/

begin;

/* ------------------------------------------------------------------ function

   Transcribed from the running definition rather than rewritten, so that applying this file
   against production is provably a no-op.

   SECURITY DEFINER with search_path pinned to pg_catalog: it runs as the owner because enabling
   RLS requires ownership of the table, and the pinned path is the standard precaution for a
   definer function - without it, a caller could shadow a function name this one relies on.

   The exception handler is deliberate. An event trigger that raises will abort the DDL that
   fired it, so a failure to enable RLS would become a failure to create the table at all. Logging
   and continuing is the right trade for a safety net: it must never be the reason a migration
   cannot run.
*/
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

comment on function public.rls_auto_enable() is
  'Event trigger helper: enables row-level security on any new table in the public schema. '
  'Stage 21 recorded it in the migration set; it had been running unrecorded since before then.';

/* ------------------------------------------------------------ event trigger

   CREATE EVENT TRIGGER has no IF NOT EXISTS form, so this is guarded by hand rather than left to
   fail. Dropping and recreating would work too, but there is a window during the drop in which a
   concurrent CREATE TABLE would go unprotected, and that is exactly the case this exists for.
*/
do $guard$
begin
  if exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    raise notice 'Stage 21: event trigger ensure_rls already exists, left alone.';
  else
    create event trigger ensure_rls
      on ddl_command_end
      execute function public.rls_auto_enable();
    raise notice 'Stage 21: event trigger ensure_rls created.';
  end if;
end
$guard$;

commit;

/*
  AFTERWARDS

  Confirm the pair is present and attached:

    select p.proname, e.evtname, e.evtenabled
      from pg_event_trigger e
      join pg_proc p on p.oid = e.evtfoid
     where e.evtname = 'ensure_rls';

  evtenabled should be 'O', meaning enabled in origin mode. A disabled event trigger looks
  present in every listing and does nothing, which is the one failure mode worth checking for
  rather than assuming.
*/
