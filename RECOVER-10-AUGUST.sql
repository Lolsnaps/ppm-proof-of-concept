/* =============================================================================
   Recovery for the two collections emptied on 10 August 2026

   WHAT HAPPENED

   replaceAll() in ppm-data.js opened with one line:

       var incoming = Array.isArray(records) ? records.filter(Boolean) : [];

   Eighteen of the thirty-six collections are stored as an object keyed by project
   code, and every caller passes exactly that object. An object is not an array, so
   `incoming` was empty; an empty incoming means every record already held has
   disappeared; so the removal pass soft-deleted the collection - and returned ok.

   Fixed in build 2026.08.11.1. An argument replaceAll does not recognise is now an
   error, never an empty collection, and harness section 35 proves it against a
   project-keyed collection.

   NOTHING WAS LOST PERMANENTLY. Both are soft deletes: the rows and their payloads
   are intact and setting deleted_at back to null restores them. Both statements
   below were run against the live database inside a transaction that was rolled
   back, so their effect is known rather than assumed.

   Run them in the Supabase SQL editor. Then reload the tool.
   ============================================================================= */


/* -----------------------------------------------------------------------------
   1. The six Draft stage gates                                    CONFIRMED DEFECT

   Deleting one Draft gate calls deleteGate(), which rebuilds the whole project-keyed
   store minus that gate and hands the object to replaceAll. Every gate the database
   would let it remove was removed:

       18:36:44.253   SG-00008-02   PRJ-00008   Gate 2 - Requirements and Design
       18:36:45.707   SG-00011-02   PRJ-00011   Gate 2 - Requirements and Design
       18:36:46.220   SG-00012-01   PRJ-00012   Gate 1 - Discovery complete
       18:36:46.550   SG-00013-00   PRJ-00013   Gate 0 - Intake complete
       18:36:46.731   SG-00014-02   PRJ-00014   Gate 2 - Requirements and Design
       18:36:47.214   SG-00015-00   PRJ-00015   Gate 0 - Intake complete

   Six gates across six projects in under three seconds is a loop, not six clicks.

   The 41 submitted, approved and closed gates survived only because
   guard_stage_gate_workflow_write refused to touch them. The database is the reason
   this was six rows rather than forty-seven.

   Restoring returns stage_gates to 47 rows: 35 Approved, 6 Submitted, 6 Draft, which
   is what STAGE-17-WORKFLOWS-UNREACHABLE.md recorded on 10 August.
   -------------------------------------------------------------------------- */

update public.stage_gates
   set deleted_at = null
 where deleted_at is not null;


/* -----------------------------------------------------------------------------
   2. The thirty-six lifecycle mandatory rules              CHECK THIS ONE FIRST

   Deleted in a burst at 18:29:15-18:29:55, at the end of two minutes containing 244
   UPDATEs to the same 58 rows - roughly four full rewrites of the collection, which
   is the read-modify-write clobbering Stage 16 exists to end.

   What is missing:

       Requirements and Design    12 rules      all of them
       Implementation              9 rules      all of them
       Closure                     8 rules      all of them
       Build                       5 rules      all of them
       Discovery                   2 rules      of thirteen

   What survives is Intake (11) and Discovery (11) - the first twenty-two rules in
   order. That is a truncation, not a choice: nobody deliberately removes two of
   thirteen Discovery rules and every rule for four later stages. Restoring returns
   exactly the fifty-eight rules defaultMandatoryRules() defines, stage for stage,
   which is further evidence that the surviving set was never curated.

   The effect while they are missing: stage gates for Requirements and Design, Build,
   Implementation and Closure have no mandatory requirements, so the lifecycle
   readiness section reports nothing outstanding for those stages.

   BEFORE RUNNING THIS ONE: if you were deliberately clearing mandatory rules for
   those four stages on the administration page that evening, skip it - restoring
   would undo your work. If you were not, run it.

   Unlike the stage gates, the exact code path here is not proven. The immediate
   cause is a save that carried only twenty-two rules while replaceAll correctly
   removed the rest, and whether the administration page assembled that set wrongly
   needs to be traced with your answer in hand.
   -------------------------------------------------------------------------- */

update public.lifecycle_mandatory_rules
   set deleted_at = null
 where deleted_at is not null;


/* -----------------------------------------------------------------------------
   3. Check
   -------------------------------------------------------------------------- */

select 'stage_gates' as collection,
       count(*) filter (where deleted_at is null) as live,
       count(*) filter (where deleted_at is not null) as still_deleted
  from public.stage_gates
union all
select 'lifecycle_mandatory_rules',
       count(*) filter (where deleted_at is null),
       count(*) filter (where deleted_at is not null)
  from public.lifecycle_mandatory_rules;

/* Expected after both:  stage_gates 47 live, 0 deleted
                         lifecycle_mandatory_rules 58 live, 0 deleted            */


/* -----------------------------------------------------------------------------
   4. Everything else is untouched

   Every other collection carrying deleted_at was swept: plans, milestones, RAID,
   actions, decisions, benefits, documents, status reports, financial entries and the
   rest all report zero deletions. These two were the only ones.
   -------------------------------------------------------------------------- */
