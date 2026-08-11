# Stage 11E — Recorded project status history (append-only cutover)

**Build:** `2026.08.08.1` (previous tested baseline `2026.08.07.23`)
**Collection:** `ppmRagHistory` → `public.rag_history`
**Files added:** `STAGE-11E-RAG-HISTORY-MIGRATION.sql`, `STAGE-11E-VERIFY.sql`, this document
**Files changed:** `ppm-child-database.js`, `ppm-planning-utils.js`, `VERSION`, all 19 application pages (cache-bust only)

---

## 1. What this stage does, and why it is different

Every collection migrated in Stages 10B to 11D is editable business data. A milestone date moves; a RAID entry is reworded; a demand line is re-planned. Recorded project status is not like that.

`PPMPlanning.recordRagHistory()` only ever appends a snapshot, and `PPMPlanning.getRagHistory()` only ever reads. There is no screen — and no business reason — for editing or deleting a status that has already been reported. Reported status is evidence.

That makes the generic write-through mechanism the wrong shape for this table. Left alone it reads a changed payload as "the user edited this record" and a missing key as "the user deleted it", and acts on both. Applied to recorded history those readings are simply wrong, and acting on them would issue exactly the two statements this stage exists to remove.

So Stage 11E is narrower than its predecessors on the database side and takes a separate path on the browser side.

| | Stages 10B–11D child tables | Stage 11E `rag_history` |
| --- | --- | --- |
| SELECT | module view permission + scope | `projects.view` + scope |
| INSERT | module edit permission + scope | `projects.status` + scope |
| UPDATE | granted | **revoked** |
| DELETE | revoked (soft delete instead) | revoked, and no soft delete either |
| Optimistic locking | yes | not applicable — `version` never leaves 1 |
| Browser write path | generic `syncStore()` | `appendOnlySync()` |

---

## 2. Append-only is enforced three times over

Deliberately redundant, so removing any single layer does not open the table.

1. **The grant.** `authenticated` has no `UPDATE` privilege on `public.rag_history`.
2. **The policy.** There is no `UPDATE` policy, so there would be nothing to satisfy even with the grant.
3. **The trigger.** `private.rag_history_immutable()` refuses `UPDATE` and `DELETE` at row level, and would still refuse if a future migration or a restored default privilege handed the grant back.

The browser adds a fourth layer that is about honesty rather than security: `appendOnlySync()` refuses the operation locally *and restores the database copy over the local change*, so the screen never shows a version of history PostgreSQL does not hold.

---

## 3. Also in this migration

**Three normalised columns.** `rag_history` was a Stage 9 scaffold table — the backup held no records, so everything lived in `legacy_payload`. Each new column maps 1:1 onto a real legacy field name, so the round trip back to the browser shape stays exact:

| Column | Type | Legacy field |
| --- | --- | --- |
| `recorded_at` | `timestamptz` | `recordedAt` |
| `recorded_by` | `text` | `recordedBy` |
| `dimensions` | `jsonb` | `dimensions` |

**Three derived columns** — `overall_calculated`, `overall_reported`, `override_count` — are maintained by the insert guard and deliberately **not** mapped back into the legacy record. They let status history be queried and reported server-side without unpacking JSON. The browser adapter never reads them, so they cannot affect parity.

**Payload-aware audit.** The generic child audit skips `legacy_payload` to keep diffs small, which on a scaffold table reduces an INSERT to `(record created)` and loses the whole substance of the status report. Stage 11D hit the same problem with resource data. `private.record_rag_history_audit()` records who reported what and when, the overall calculated and reported RAG, and **every dimension where the reported value was deliberately overridden away from the calculated one, with the justification given**. An override is a human judgement that departs from the arithmetic, so it is the part worth being able to evidence later.

**A chronology fix that mattered.** `queryRows()` had no `ORDER BY`, and PostgREST makes no ordering promise. For a set-shaped collection that is harmless because the UI sorts by date. Recorded status history is read as a *sequence* — `project-details-page.js` reverses the array to show newest first, and `reports-page.js` walks it in order — so scrambled rows would have misrepresented when a status was reported. Fixed in two places: a deterministic database order, plus `sortSequential()` re-sorting on the business `recordedAt` after mapping, because a bulk seed gives every historical row nearly the same `created_at`.

---

## 4. Run it — step by step

Everything in section 4.1 happens in the **Supabase dashboard**. Everything in 4.2 onward happens in **your browser's developer console** (press `F12`, then click the **Console** tab).

### 4.1 Apply the migration

1. Keep a copy of the previous working folder or ZIP before starting. `PPM-Tool-33-Stage11D-v23-full.zip` is your rollback point.
2. Open your Supabase project → **SQL Editor** → **New query**.
3. Open `STAGE-11E-RAG-HISTORY-MIGRATION.sql` from this folder, copy all of it, paste it in, and click **Run**.
   Expect `Success. No rows returned`. If it raises an exception instead, it has refused to install and changed nothing — read the message, fix that, and run the whole file again. It is safe to re-run.
4. **New query** again. Paste all of `STAGE-11E-VERIFY.sql` and **Run**.
   Every `check` row must say `PASS`. The two that matter most are *No UPDATE or DELETE policy exists* and *authenticated cannot change or remove history*.

### 4.2 Sign in and check the server is ready

5. Start the local server as usual (`localhost.cmd`, or `py -m http.server 8000`) and open the tool.
6. Sign in with email/password **and complete the TOTP step**. Protected data needs AAL2; the checks below will refuse without it.
7. Open the console and run:

```javascript
await PPMChildDatabase.stage11EServerReady()
```

Expect `{ ready: true, reason: "" }`. If `ready` is `false`, read `reason` — the usual cause is that the migration has not been run in this project.

### 4.3 Look at what you have locally, then seed it

8. Inspect the current browser data before sending anything:

```javascript
PPMChildDatabase.preview("ragHistory")
```

Check `valid: true` and that `localRecords` is the number of status snapshots you expect. If `valid` is `false`, stop and read the reported problems.

9. Seed the existing history into PostgreSQL. This is insert-only:

```javascript
await PPMChildDatabase.seedStage11E()
```

10. Prove the two sides are identical:

```javascript
await PPMChildDatabase.compareStage11E()
```

You need `identical: true` and verdict `IDENTICAL`. **Do not continue on anything else.** For this collection specifically, cutting over with snapshots that exist only in the browser would lose them permanently — append-only history cannot be re-created afterwards with its original timestamp and actor. `cutOverStage11E()` checks for exactly that and refuses even if you pass `{ force: true }`.

### 4.4 Cut over

11.
```javascript
await PPMChildDatabase.cutOverStage11E()
```

12. **Reload the page.** Then confirm:

```javascript
PPMChildDatabase.status().ragHistory
```

Expect `source: "database"`, `stage: "11E"`, `appendOnly: true`.

### 4.5 Test it for real in the UI

13. Open a project → **Update project status**. Set the reported RAG on at least one dimension to something different from the calculated value, enter a justification, and save.
14. Open the project's **Project status history** and confirm the new snapshot appears, in the right chronological position, with your override and justification shown.
15. **Reload** and confirm it is still there — that proves it came back from the database, not from local storage.
16. Confirm nothing is stuck and the two sides still agree:

```javascript
PPMChildDatabase.pendingWrites("ragHistory")   // expect: no unsaved changes
await PPMChildDatabase.compareStage11E()       // expect: IDENTICAL
```

17. Confirm the server recorded it, with the override captured:

```javascript
await PPMDatabase.auditReport()
```

Look for a `rag_history` INSERT entry naming you as actor, and a `… (reported override)` line carrying your justification.

### 4.6 Prove history cannot be rewritten

This is the point of the stage, so it is worth seeing for yourself. Paste this into the console, substituting a real project code:

```javascript
// Attempt to rewrite a recorded status snapshot.
const code = "PRJ-00001";                                  // <-- your project code
const store = JSON.parse(localStorage.getItem("ppmRagHistory"));
store[code][0].dimensions.overall.reported = "Green";       // tamper with the oldest snapshot
localStorage.setItem("ppmRagHistory", JSON.stringify(store));
await PPMChildDatabase.flushStage11E();

// What should have happened:
PPMChildDatabase.pendingWrites("ragHistory");               // one refused "change-blocked" entry
JSON.parse(localStorage.getItem("ppmRagHistory"))[code][0]; // the original value, restored
```

Expected: the console reports the write did not reach the database, `pendingWrites` shows one `change-blocked` refusal, and the tampered value has been replaced with the database copy. Reload the page and the pending entry clears itself, because local and database now agree again.

If you have a second linked AAL2 account with narrower access, also confirm it cannot see status history for projects outside its scope.

---

## 5. Rollback

To put the browser back on local data:

```javascript
PPMChildDatabase.revertStage11E()
```

Then reload. This changes the source selection only. Every recorded row stays in PostgreSQL for inspection, and the database guards stay installed.

Undoing the append-only posture in the database is deliberately **not** scripted. Handing `UPDATE` back to `authenticated` would make already-reported status history editable, which is the specific risk this stage removes. If it is ever genuinely needed for a data-correction exercise, do it as a considered, audited, one-off statement — not from a file that can be run by accident.

---

## 6. One interaction worth knowing about

`STAGE-9-CHILD-TABLES.sql` is itself safe to re-run, and its policy loop would hand `rag_history` back its `UPDATE` policy and `UPDATE` grant.

**If Stage 9 is ever re-run, re-run `STAGE-11E-RAG-HISTORY-MIGRATION.sql` afterwards.**

Nothing breaks silently in the meantime: `public.ppm_stage11e_ready()` checks for precisely that state, `stage11EServerReady()` will start returning `false`, and `STAGE-11E-VERIFY.sql`'s *No UPDATE or DELETE policy exists* check will fail.

Stage 11E also retires two Stage 9 triggers on this table — `trg_rag_history_lock` (optimistic lock) and `trg_rag_history_key` (business-key protection). Both become unreachable once every `UPDATE` is refused outright, and leaving them would imply the table has a concurrency model it does not have. Neither is load-bearing: they constrain *how* a row may be updated, whereas the immutability trigger removes updating altogether, which is strictly stronger.

---

## 7. Tests run before delivery

**Static checks**

- Every `.js` file in the folder parses (`node --check`).
- All 19 application pages carry the `2026.08.08.1` cache-bust consistently; `pdfmake.min.js` and `vfs_fonts.js` remain deliberately unstamped.
- `ppm-page-loader.js` load order unchanged; no `defer`, `async` or module conversion introduced.
- No `service_role` / `sb_secret` or other server secret in any browser source.
- No new direct `localStorage` business access outside the scoped facade.
- Both SQL files parse against the real PostgreSQL grammar (`pglast`); all four `plpgsql` bodies verified block-balanced.

**Behavioural harness** — 30 assertions, all passing, covering:

- `recordedAt` / `recordedBy` / `dimensions` round-trip exactly, including `timestamptz` rendered back to the precise ISO string the browser wrote;
- derived server columns never leak into the legacy record;
- scrambled database rows are restored to chronological order;
- appending a snapshot issues exactly one `INSERT`, carrying the normalised columns;
- editing a recorded snapshot issues **no** `UPDATE`, is logged as `change-blocked`, and the database copy is restored;
- deleting a recorded snapshot issues **no** soft delete, is logged as `removal-blocked`, and the snapshot is restored;
- cutover is refused when a snapshot exists only locally, **even with `{ force: true }`**;
- **regression:** milestones still cut over through the generic path, still issue an `UPDATE` carrying the version originally loaded, and still soft-delete — the shared code changes did not alter editable collections.

---

## 8. Where this leaves the migration

Recorded status history was one of the two collections Stage 9 created but deliberately left deferred. With it done, **17 of the 18 child tables are database-authoritative**, and the only one remaining is `legacy_audit_history`.

That is the next recommended stage, **11F**, and it is a bigger job than this one: importing `ppmAuditHistory` as clearly-tagged unverified historical evidence, and rewriting `audit-history-page.js` so the Audit History screen presents verified `public.audit_log` as its primary source instead of `PPMAudit.read()`. Stage 11E contributes to it — recorded status now produces meaningful verified server audit entries, which is part of what makes an audit-first UI worth building.
