# Stage 11F — Audit consolidation

**Build:** `2026.08.08.8` (previous `2026.08.08.5`, Stage 12)

> **Already applied to your database.** I ran the migration and the verification directly against project `qmfigesgkoirirgpgmse` — all 14 checks PASS. You do not need to run any SQL for this stage. Just load this build and open the Audit History page. Section 4.3 covers the `column "timestamp" does not exist` error and what it turned out to be; section 6 covers a real security finding that came out of verifying against the live database rather than against the files.

**Files added:** `STAGE-11F-AUDIT-CONSOLIDATION-MIGRATION.sql`, `STAGE-11F-VERIFY.sql`, `STAGE-SQL-LINT.py`, this document
**Files changed:** `audit-history-page.js`, `audit-history.html`, `audit-history-page.css`, `ppm-audit-utils.js`, `ppm-database.js`, `ppm-change-log.js`, `STAGE-11E-12-HARNESS.mjs`, `VERSION`, all 19 pages (cache-bust)

---

## 1. The problem this closes

`public.audit_log` has been the verified trail since Stage 8. Database triggers write it from the authenticated identity, and the browser has no `INSERT`, `UPDATE` or `DELETE` privilege on it.

`audit-history-page.js` line 450 read `PPMAudit.read()` — browser localStorage — the entire time.

So the screen labelled "Audit History" showed the one source that is **not** evidence, and ignored the one that is. Worse, the page carried a notice saying "browser storage is not tamper-proof, so production use still requires server-side authorisation" — which had been untrue for four stages.

---

## 2. Run it — one step

**Load this build and open the Audit History page.** The migration and verification are already applied to your project; there is no cutover, because the audit tables were already database-owned.

The SQL files are in the folder as the record of what was applied, and both remain safe to re-run — useful for a fresh environment or if you want to confirm the state yourself.

### Optionally import the old browser history

Only if you want your pre-migration local history kept as historical context. As a **System Administrator** (it needs `users.manage`):

```javascript
await PPMAudit.importLegacyToDatabase()
```

Then **drop the import path**, because a privileged route into an audit table should not outlive the job it was built for:

```sql
drop function if exists public.ppm_import_legacy_audit(jsonb);
```

If you don't care about the old local history, skip both. The page will simply show those rows tagged "Unverified" until you clear browser storage.

---

## 3. What the page shows now

Three sources, always distinguishable — for an audit screen the provenance *is* part of the record:

| Tag | Source | What it means |
| --- | --- | --- |
| **Verified** | `public.audit_log` | Written by database triggers from your authenticated identity. The application cannot alter it. This is evidence. |
| **Legacy** | `public.legacy_audit_history` | Pre-migration browser history, imported as historical context. Immutable now, but it was never verifiable. |
| **Unverified** | `ppmAuditHistory` | Still only in this browser. Compatibility history, not evidence. |

There is a new **Evidence** filter and a **Verified by the database** count alongside the existing totals, and the CSV export carries an Evidence column. Blending the three into one undifferentiated list would have been the actual failure, so the distinction is visible per row, filterable, and exported.

The page paints twice on purpose: local history immediately so the screen is never blank, then the merged verified view when the network read returns. If that read fails, the local view stays with every row honestly tagged — failing to a blank audit screen would be worse than showing what is available and saying what it is.

---

## 4. Four things that had to be fixed to make the server trail usable

### 4.1 Every audited table needed a name

`AUDIT_ENTITY` in `ppm-database.js` mapped exactly three tables — `projects`, `programmes`, `portfolios`. Everything else surfaced in the UI as a raw table name like `project_plans`.

That was not cosmetic. `PPMChangeLog.LOCATIONS` is keyed on those display names, so the mapping is what gives an audit row its "Changed in" location, its area, and its link back to the screen where the change happened. Unmapped rows matched no location, landed in "Other", and were unfilterable.

All **37** audited tables are now mapped, and a static check confirms every name resolves to a `LOCATIONS` entry. Three new locations were added — Project status, Saved view, Audit history — rather than approximating with an existing one, so labels stay honest.

### 4.2 Compound keys had to be split

Child and Stage 12 rows carry a compound business key: `PRJ-00001 / TSK-0003`, `PROG-001 / PM-00001`, `GLOBAL / LIFE-00001`. The old mapper put the whole string in the Record ID column and only ever derived a project code for the `projects` table.

Now the scope and record id are separated, and a scope that is **not** a project code — a programme, a configuration category, or `GLOBAL` — deliberately yields no project, so those entries read as portfolio-wide instead of being filed under a project that does not exist.

### 4.3 The `column "timestamp" does not exist` error

`timestamp` is a legal column name in PostgreSQL — `TIMESTAMP` is a *col_name_keyword*, usable bare — and the real parser confirms Stage 9's definition produces a column called exactly that. So the SQL was right and the table was different.

My first explanation was that `create table if not exists` had let an earlier draft's shape survive. **That was wrong.** Querying the live database settled it: the column is `timestamp_value`. It was renamed when Stage 9 was applied — sensibly, since `timestamp` is a type name and reads badly as a column — and `STAGE-9-CHILD-TABLES.sql` was never updated to match. The file and the database had disagreed since Stage 9, and nothing noticed because the application never read this table until now.

I then checked **all 352 columns across all 18 child tables** against the live database. `legacy_audit_history.timestamp` is the only difference; everything else matches exactly. So this was one naming drift, not a structural pattern.

Three changes:

- Stage 11F uses `timestamp_value`, and **verifies** the shape rather than patching it. My interim fix would have added an empty `timestamp` column alongside the populated `timestamp_value`, leaving two columns where there should be one — worse than the original error.
- `STAGE-9-CHILD-TABLES.sql` now says `timestamp_value`, so the file and the database agree from here on.
- The `legacyAudit` mapping in `ppm-child-database.js` was pointing at the non-existent `timestamp` column. That was a live bug — imported rows would have come back with no timestamp — now fixed.

**A caveat worth keeping in mind:** an empty table with a wrong shape is invisible to the parity check. `compare()` only diffs records present on both sides, so zero rows means zero comparisons, and it reports `IDENTICAL` regardless. Your `selfTest()` showed `IDENTICAL` for fourteen empty collections; that told us nothing about their shapes. It does now — the 352-column check is in `STAGE-11F-VERIFY.sql`, and it passes.

### 4.4 Column names had to become readable

The audit functions record real column names, which is right for the trail and wrong for a screen. `task_owner_email` now renders as "Task owner email". Bracketed markers the audit writes itself, like `(record created)`, pass through untouched.

---

## 5. Why the import is an RPC and not an insert

`public.legacy_audit_history` has no `INSERT` grant for `authenticated`, and this migration does not give it one. A browser that can write rows into an audit table — even a clearly-labelled legacy one — is precisely what an audit trail exists to rule out.

So there is one `SECURITY DEFINER` function, `public.ppm_import_legacy_audit()`, which:

- requires AAL2, a linked **active** person, and `users.manage` — all checked server-side;
- pins `search_path = ''` so nothing can be resolved out from under it;
- is idempotent on `(project_code, record_key)`, so re-running after a partial failure imports only the remainder and can never rewrite history already in the table;
- stamps every row in `import_payload` with `verified: false` and where it came from, so provenance lives in the row rather than depending on an application remembering which table means what;
- records its own use in `audit_log`, because a bulk import of historical evidence is itself an event worth evidencing;
- is designed to be dropped afterwards.

Stage 9 had also given this table an `audit.view`-only read policy, which meant a Project Manager could see none of their own project's history. It now follows the same rule as `audit_log`: `audit.view` sees everything, everyone else sees entries for records they could already read.

---

## 6. A real security finding, from verifying against the live database

Running the verification against your actual project rather than reasoning about the files turned up something the files could never have shown.

**Six `public.ppm_*` functions were callable by the `anon` role** — two of them `SECURITY DEFINER`:

- `ppm_commit_resource_scenario_workflow` (SECURITY DEFINER)
- `ppm_import_legacy_audit` (SECURITY DEFINER)
- `ppm_stage11d_ready`, `ppm_stage11e_ready`, `ppm_stage11f_ready`, `ppm_stage12_ready`

**Why.** Supabase's default privileges grant `EXECUTE` on new functions in `public` to `anon`, `authenticated` and `service_role`. Stages 11D onward wrote `revoke all on function X from public`. `PUBLIC` is a pseudo-role, so that removes the implicit "everyone" grant but leaves the **explicit** grant to `anon` untouched. Stages 11A–11C had revoked from `anon` by name and were unaffected — the pattern drifted from 11D on.

**Impact: none in practice.** Every one of those functions checks AAL2 before doing anything, and `anon` carries no `aal2` claim, so every call raised or returned false. No data was reachable. But an unauthenticated caller reaching a `SECURITY DEFINER` function means its internal check is the *only* thing standing there, which is not where a security boundary should sit. It is the same shape of mistake Stage 9 found when Supabase's defaults turned out to include `TRUNCATE`.

**Fixed** in the live database and in the files. Stage 11F now ends with a sweep over every `public.ppm_*` function rather than a hard-coded list, so a function added later cannot quietly miss it, and it raises if anything is still reachable. The four earlier migrations were corrected to `revoke ... from public, anon`.

Also confirmed while connected: **no table in `public` or `private` is reachable by `anon`**, RLS is enabled on every public table, and the `private` trigger functions that show an `anon` EXECUTE grant are unreachable anyway because `anon` has no `USAGE` on that schema.

### The two advisor warnings that remain, and why they stay

Supabase's security advisor reports five `authenticated_security_definer_function_executable` warnings — the four workflow RPCs plus the import function. **These are the architecture working as intended.** The design is that a signed-in user calls a `SECURITY DEFINER` RPC which enforces AAL2, permissions, scope and segregation of duties internally, precisely so it can write to tables the user cannot write to directly. Switching them to `SECURITY INVOKER` would break them. The `ppm_import_legacy_audit` warning disappears when you drop that function after importing.

It also reports **leaked password protection disabled**. That is an Auth dashboard setting, not application code — Authentication → Providers → Password. Your handover noted it was unavailable on the plan at the time; worth rechecking now if it matters to you.

---

## 7. New tool: `STAGE-SQL-LINT.py`

> **Since 9 August 2026 this is `STAGE-SQL-LINT.mjs`, run with `node STAGE-SQL-LINT.mjs`.**
> Same checks, same output; ported off Python because Python is not installed on the
> publishing machine, which made this gate fail rather than skip. The rest of this section
> still describes what it does.

Optional, and it connects to nothing. Run `py STAGE-SQL-LINT.py` from this folder.

It exists because a successful PostgreSQL parse cannot catch two classes of mistake, and **both were real bugs in this project**:

- `x <> any(array[...])` is true as soon as `x` differs from *one* element, so intended exclusions silently stop excluding. Found in the Stage 12 audit read policy.
- `array_agg(catalog_column) = array['a','b']` fails at runtime with `operator does not exist: name[] = text[]`, because catalog columns like `pg_attribute.attname` are type `name`. Found in `STAGE-12-VERIFY.sql` — the error you hit.

It also checks that every `BEGIN`/`IF`/`LOOP`/`CASE` in a plpgsql or `DO` block is closed. All 22 migration files currently pass.

Worth being straight about: writing this lint took two attempts, because my first two versions produced false positives — one discarded commas, so `end,` followed by `case` read as `end case`; the other did not strip nested `$f$…$f$` literals, so `create table if not exists` inside a `format()` template read as an unclosed `IF`. The version shipped handles both.

---

## 8. Tests

**Static:** all 40 JS files parse; all 24 element IDs the page references exist in the HTML; page load order intact; all 19 pages stamped `2026.08.08.8`; no server secret in any browser source; both SQL files parse; all 22 migrations pass the lint; all 37 audited tables have a friendly name that resolves to a location.

**Harness — 79 assertions, all passing** (`node STAGE-11E-12-HARNESS.mjs`, offline). Stage 11F additions:

- local rows tagged unverified, server rows tagged verified, imported rows tagged imported — and never confused;
- `readAll` merges all three newest-first;
- a local row already imported is **not** shown twice, and the database copy wins because it can no longer be edited;
- a local row not yet imported is still shown;
- `sourceCounts` separates evidence from legacy;
- a failed verified read degrades to legacy rather than throwing;
- the import goes through the gated RPC, never a table insert.

---

## 9. What's left

`ppmResources` → `public.people` is now the only business store outside the database. That's **Stage 12A**, next.

After that: `Stage 12F` backup/restore (`ppm-data-safety.js` predates the database), `Stage 13` production hardening, `Stage 14` cleanup — including retiring the local `PPMAudit.record()` write path, which is still in use and should stop being the primary evidence once every module's changes are covered by database triggers.

Two carried-over items: the dormant foundation `writeGlobal` seam gap, and tightening `resource_absence` from permission-only to person/team scope, which needs 12A first.
