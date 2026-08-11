# Stage 12F — Backup and restore, for a database-backed application

**Build:** `2026.08.08.12` (previous `2026.08.08.11`, Stage 12A)
**Files added:** this document
**Files changed:** `ppm-data-safety.js`, `administration-page.js`, `STAGE-11E-12-HARNESS.mjs`, `VERSION`, all 19 pages (cache-bust)

> **No database changes and no SQL to run.** This stage is entirely browser-side. Load the build and it applies.

---

## 1. The sentence that had to go

`ppm-data-safety.js` opened with:

> *Everything in this tool lives in the browser's local storage … there is no server copy.*

True when it was written. False for the last several stages, and by some distance the most misleading sentence in the codebase — it told anyone reading the module that the browser export was the only thing standing between you and total loss, at a point when PostgreSQL held every business record and localStorage held a mirror of it.

Two things followed from that stale premise, and both were real.

---

## 2. Bug one: scoped users took partial backups that would destroy data on restore

`sizeOf()` and `buildBackup()` read with `localStorage.getItem()`. `ppm-auth-utils.js` replaces that function with the project-scoping filter.

So a user whose access is limited to certain projects took a backup containing **only those projects**. `restoreAll()` then writes with `nativeSetItem`, captured before any patching and therefore genuinely unfiltered — so restoring that file would replace the full store with the partial copy and permanently destroy every record the person taking the backup could not see.

The most uncomfortable part: the old code *documented the right intent*. There was a helper called `nativeGetItem` with the comment *"Read past the permission filter so the size reflects what is really stored"* — and a body whose two branches were identical and both filtered:

```javascript
return window.PPMAuth && typeof window.PPMAuth.rawRead === "function"
  ? localStorage.getItem(key)     // "past the filter"
  : localStorage.getItem(key);    // ...identical
```

Intent in a comment is not a safeguard. The native `getItem` is now captured alongside `nativeSetItem`, and every read in the module goes through it.

---

## 3. Bug two: restore had quietly become a way to overwrite the database

Restore writes past every write-through seam. For a database-backed collection that means it loads stale records PostgreSQL knows nothing about, pushes nothing up, and is then discarded by the next page load's hydration.

Which sounds harmless, and is the part that makes it dangerous. **In the window before that reload, the screen shows old data — and any edit made against it *is* written through.** So a restore could overwrite newer database state indirectly, through the user, one record at a time. A loud failure would have been better.

### What restore does now

| Situation | Behaviour |
| --- | --- |
| Backup contains database-backed collections | **Refused**, with a report naming them and what to do instead |
| Backup contains browser-only keys | Restored directly — for these a file genuinely is the only copy |
| You have deliberately reverted collections to local first | `restoreAll(backup, { force: true })` still works |

Three new calls:

```javascript
PPMData.compareBackup(backup)      // what this file would change, against live data
PPMData.restoreLocalOnly(backup)   // restore only the browser-only keys — always safe
PPMData.partitionBackup(backup)    // { restorable, databaseBacked }
```

Which collections count as database-backed is **asked of the adapters**, not hardcoded — a key is database-backed if its module currently reads from the database. That is also precisely the condition under which restoring it would be wrong, so the two can never drift apart as collections move.

The Administration → data and backup screen reflects this too. It previously offered *"Replace all data"* and would now have refused on click; it now says up front which data sets cannot be restored and why, and its confirmation no longer promises to replace projects and plans that it will actually leave alone.

---

## 4. The backup file is now honest about what it is

Format bumped to **2**, and format 1 is still readable. The new fields exist because a format-1 file cannot be told apart from a genuine full backup, and that is exactly the distinction a restore turns on:

```json
"snapshotOnly": true,
"databaseBackedKeys": ["ppmProjects", "ppmProjectPlans", "..."],
"databaseProject": "qmfigesgkoirirgpgmse.supabase.co",
"note": "Snapshot of a database-backed application. PostgreSQL is the authoritative copy..."
```

`ppmStage12Discarded` was also added to the excluded keys — it is the recovery copy `fastCutOver()` keeps for one machine's cutover, not portfolio content.

---

## 5. What actually protects your data now

This is the part Stage 12F exists to state plainly, because the tool no longer does.

**PostgreSQL is the backup.** Your project is `qmfigesgkoirirgpgmse` (eu-west-1, PostgreSQL 17.6), currently 14 MB with 36 business rows across 37 audited tables. At that size, recovery options are cheap and fast.

| Layer | What it protects against | Where |
| --- | --- | --- |
| **Supabase automatic backups** | project-level loss, bad migration, mass deletion | Supabase dashboard → Database → Backups |
| **Point-in-time recovery** | "undo the last 20 minutes" — `wal_level` is already `logical`, so the WAL needed for PITR is being produced. Availability depends on your plan; check the Backups page | dashboard, plan-dependent |
| **Your own `pg_dump`** | provider-independent copy you hold | `supabase db dump`, or pg_dump against the connection string |
| **`audit_log`** | *who changed what* — not a backup, but the only thing that answers "when did this value change and who did it" | in the database, append-only, browser cannot write it |
| **Browser snapshot** (`exportAll`) | nothing, on its own. A readable point-in-time extract for diffing and archiving | this tool |

**If you lose data, the order to work in:**

1. Don't restore a browser backup. It cannot repair the database and can make things worse via the edit window described above.
2. Check `audit_log` — for a wrong value rather than a lost row, the trail holds the before value and you can correct it in the application, versioned and audited.
3. For a lost row or a bad bulk change, use Supabase PITR or a backup, which restores the whole database to a consistent point.
4. Use the browser snapshot only as a reference for what a value *used to be*, then re-enter it through the application.

**Worth doing before production:** confirm on the Backups page which retention and PITR window your plan gives you, and take one `pg_dump` you hold yourself so recovery does not depend solely on the provider. At 14 MB that is seconds.

---

## 6. Tests

**Harness — 97 assertions, all passing** (`node STAGE-11E-12-HARNESS.mjs`, offline). Stage 12F additions load the real `ppm-data-safety.js` with the adapters present and cut over, and prove:

- database-backed keys are discovered from the adapters, not hardcoded;
- `partitionBackup` separates them and excludes personal keys from both lists;
- `restoreAll` **refuses** a stale backup, leaves the local store untouched, and sends **nothing** to the database;
- the refusal flag is a boolean and is not shadowed by the key list (see below);
- `restoreLocalOnly` restores browser-only keys, skips database-backed ones, sends nothing to the database;
- `{ force: true }` still works, so the deliberate path survives;
- a backup taken now declares `snapshotOnly` and lists its database-backed keys;
- machine-local recovery state is excluded from backups;
- the module reads past the project-scoping filter — the fix for bug one, asserted against the source so it cannot silently regress.

**One defect the tests caught in my own new code.** `restoreAll` returned `{ refused: true, ...split }`, and `split` contained a `refused` **array** of key names. The spread overwrote the boolean, so a caller testing `result.refused === true` got a truthy array — two different meanings on one name in one object. The partition now returns `databaseBacked`, named for what those keys *are* rather than what happened to them.

**Static:** all 40 JS files parse; all 19 pages stamped `2026.08.08.12`; no server secret in any browser source; all 25 migrations still pass `STAGE-SQL-LINT.py`.

---

## 7. What's left

Migration is finished. Both remaining items are hardening rather than data work:

1. **Stage 13 — production.** Entra integration, hosting/TLS, CSP and security headers, error monitoring, and confirming Supabase Auth production settings. Leaked-password protection is still off in Auth settings — worth rechecking whether your plan now allows it.
2. **Stage 14 — cleanup.** Retire the local `PPMAudit.record()` write path now that verified server audit covers every table; retire shadow mode and the source switches once you are confident; and rewrite `TECHNICAL-SPECIFICATION.html`, which still describes the original localStorage architecture throughout.

Smaller carried-over items: tighten `resource_absence` to person/team scope (unblocked by 12A), close the dormant foundation `writeGlobal` seam gap, and the optimistic-lock conflict message reads "This people was changed by someone else" — a shared string that could use a per-table label.
