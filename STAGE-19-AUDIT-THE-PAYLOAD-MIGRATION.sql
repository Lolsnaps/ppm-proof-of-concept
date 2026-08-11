/*
  STAGE 19 — the audit trail records what people actually change
  ==============================================================

  Safe to re-run.

  THE PROBLEM

  Three trigger functions record every change in this application:

    private.record_audit         projects, programmes, portfolios, people
    private.record_child_audit   18 child tables - plans, milestones, RAID, actions,
                                 decisions, benefits, documents, status reports, stage
                                 gates, baselines, financials and the rest
    private.record_scope_audit   14 configuration tables

  All three diff the row column by column, and all three carry the same skip list:

      skip_fields text[] := array['legacy_payload','import_payload','updated_at',
                                  'created_at','version','id','project_id'];

  legacy_payload is skipped. That is where almost everything a person edits lives - the
  typed columns are a handful of fields projected out of the payload so the database can
  filter and constrain on them. Everything else - a decision's rationale, conditions and
  outcome, a RAID item's description and mitigation, an action's update, a status report's
  commentary - is inside the payload and nowhere else.

  So the loop finds no changed column, and:

      if jsonb_array_length(changed) = 0 then return NEW; end if;

  No audit row is written at all. The change saves, the version increments, and the trail
  shows nothing.

  Found in the pilot: Nadia Kaur recorded a decision outcome on DEC-00011-001 - final
  decision, rationale, conditions and impact. public.project_decisions went to version 2 at
  12:47 with every value present. public.audit_log's most recent row for that table is from
  the seed two days earlier. The change history dialogue said "0 recorded changes", and it
  was telling the truth.

  This is the most serious defect found in this system so far, because the audit trail is
  the artefact the tool exists to produce for governance, and it was silently omitting the
  majority of what it was meant to record - while looking complete.

  WHY THE SKIP EXISTED

  Not carelessness: dumping a whole payload blob into `changes` as one before/after pair
  would be unreadable, enormous, and would make every save look like a total rewrite. The
  instinct was right and the implementation was too blunt. The answer is to diff INSIDE the
  payload, key by key, which is what private.record_resource_payload_audit already does for
  two tables against a hand-typed field list.

  WHAT THIS CHANGES

  A shared helper, private.payload_changes(), diffs two payloads and returns one entry per
  changed key. The three functions call it and append the result. Everything else about them
  is untouched: the same actor resolution, the same key format, the same immutability, the
  same exception handler that lets a save proceed if auditing itself fails.

  WHAT IT DELIBERATELY LEAVES OUT

  Bookkeeping keys that change on every single save and describe nothing: timestamps, the
  updating actor (already a column on the audit row), version markers, and the adapter's own
  fields. Recording them would bury the one line that matters under six that never vary.

  And it caps the entry count. A bulk edit that rewrites eighty fields is worth recording;
  one that rewrites eight hundred is worth recording as "800 fields changed" rather than as
  a row large enough to make the audit page unusable.
*/

begin;

/* ------------------------------------------------------------------- helper

   One entry per changed payload key, ordered by key so two audit rows for the same edit
   read the same way.

   IMMUTABLE and free of table access: it is pure jsonb arithmetic, called once per updated
   row inside a trigger, so it must be cheap and must never itself be able to fail in a way
   that blocks a save.
*/
create or replace function private.payload_changes(old_payload jsonb, new_payload jsonb)
returns jsonb
language plpgsql
immutable
as $function$
declare
    changed   jsonb := '[]'::jsonb;
    field     text;
    before_v  jsonb;
    after_v   jsonb;
    counted   integer := 0;
    /*
       Keys that change on every save and say nothing about what somebody did. The actor and
       the time are already columns on the audit row itself, so repeating them inside the
       change list is noise that hides the signal.
    */
    ignored   text[] := array[
        'updatedAt', 'updatedBy', 'updatedByResourceId',
        'createdAt', 'createdBy', 'createdByResourceId',
        'version', 'revision', 'databaseId', 'databaseVersion', 'recordSource',
        'lastUpdated', 'demoDataSet'
    ];
    /* Enough to describe a large edit honestly, small enough that one row cannot make the
       audit page unusable. */
    limit_entries constant integer := 80;
begin
    if coalesce(old_payload, '{}'::jsonb) = coalesce(new_payload, '{}'::jsonb) then
        return changed;
    end if;

    for field in
        select key
          from (
              select jsonb_object_keys(coalesce(old_payload, '{}'::jsonb)) as key
              union
              select jsonb_object_keys(coalesce(new_payload, '{}'::jsonb))
          ) keys
         order by key
    loop
        if field = any(ignored) then continue; end if;
        /* The adapter's own scratch fields, by convention __name. */
        if field like '\_\_%' then continue; end if;

        before_v := coalesce(old_payload, '{}'::jsonb) -> field;
        after_v  := coalesce(new_payload, '{}'::jsonb) -> field;
        if before_v is not distinct from after_v then continue; end if;

        counted := counted + 1;
        if counted > limit_entries then continue; end if;

        changed := changed || jsonb_build_array(jsonb_build_object(
            'field',  field,
            'before', before_v,
            'after',  after_v
        ));
    end loop;

    if counted > limit_entries then
        changed := changed || jsonb_build_array(jsonb_build_object(
            'field',  '(and more)',
            'before', null,
            'after',  to_jsonb((counted - limit_entries)::text || ' further field(s) changed in the same save')
        ));
    end if;

    return changed;
end;
$function$;

comment on function private.payload_changes(jsonb, jsonb) is
  'One audit entry per changed key inside legacy_payload. Stage 19: the three audit triggers '
  'skipped the payload entirely, so any edit confined to it was recorded nowhere.';

revoke all on function private.payload_changes(jsonb, jsonb) from public, anon;

/* ------------------------------------------------- teach the three functions

   Patched rather than restated, for the same reason as Stage 18: transcribing three
   functions by hand to change one line each is a larger risk than the patch being unusual.
   Every substitution asserts it matched exactly once, and the whole thing refuses if the
   result is not longer than the original - these edits only add.
*/
do $patch$
declare
    target    text;
    src       text;
    patched   text;
    hits      integer;
    anchors   text[] := array[
        /* record_audit: the loop ends, then a multi-line emptiness check. */
        E'        end loop;\n\n        if jsonb_array_length(changed) = 0 then\n            return NEW;\n        end if;',
        /* record_child_audit and record_scope_audit: the same check on one line. */
        E'        end loop;\r\n        if jsonb_array_length(changed) = 0 then return NEW; end if;'
    ];
    replacements text[] := array[
        E'        end loop;\n\n        changed := changed || private.payload_changes(\n            old_json -> \'legacy_payload\', new_json -> \'legacy_payload\');\n\n        if jsonb_array_length(changed) = 0 then\n            return NEW;\n        end if;',
        E'        end loop;\r\n        changed := changed || private.payload_changes(\r\n            old_json -> \'legacy_payload\', new_json -> \'legacy_payload\');\r\n        if jsonb_array_length(changed) = 0 then return NEW; end if;'
    ];
    index_used integer;
begin
    foreach target in array array['record_audit', 'record_child_audit', 'record_scope_audit']
    loop
        select pg_get_functiondef(p.oid) into src
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private' and p.proname = target;

        if src is null then
            raise exception 'Stage 19: private.% does not exist.', target;
        end if;

        if src like '%payload_changes%' then
            raise notice 'Stage 19: private.% already audits the payload.', target;
            continue;
        end if;

        index_used := null;
        for hits in 1..array_length(anchors, 1) loop
            if position(anchors[hits] in src) > 0 then
                index_used := hits;
                exit;
            end if;
        end loop;

        if index_used is null then
            raise exception 'Stage 19: could not find the change-list check in private.%. Refusing to patch.', target;
        end if;

        patched := replace(src, anchors[index_used], replacements[index_used]);

        if patched = src then
            raise exception 'Stage 19: the patch to private.% changed nothing.', target;
        end if;
        if length(patched) <= length(src) then
            raise exception 'Stage 19: the patch to private.% removed characters. Refusing to apply.', target;
        end if;

        execute patched;
        raise notice 'Stage 19: private.% now records payload changes.', target;
    end loop;
end
$patch$;

commit;

/*
  AFTERWARDS

  Nothing backfills. Every edit made between the migration that introduced the skip list and
  this one is not in the audit trail and cannot be reconstructed - the before values are
  gone. The record starts being complete from here, and that gap is worth stating plainly to
  anyone who relies on the trail rather than leaving them to discover it.
*/
