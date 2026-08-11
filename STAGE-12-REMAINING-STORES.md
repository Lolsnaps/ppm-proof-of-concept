# Stage 12 — The remaining fourteen stores, in one go

**Build:** `2026.08.08.5` (previous `2026.08.08.1`, Stage 11E)

> **If you already ran the migration from build `.2`: re-run `STAGE-12-REMAINING-STORES-MIGRATION.sql`.** Two fixes landed. The verify script had a type error (`array_agg` over `pg_attribute.attname` produces `name[]`, and there is no `name[] = text[]` operator) — that one only broke the check, not your database. The migration had a real logic bug: the audit read policy used `table_name <> any(array[...])`, which is true as soon as the value differs from a single element, so the project-scoped branch also applied to the Stage 12 tables. It was fail-safe in practice — `can_access_project('GLOBAL')` returns false — but it was the wrong rule. Now `<> all`. The migration is re-runnable and the policy is dropped and recreated, so re-running is the whole fix.

**Files added:** `STAGE-12-REMAINING-STORES-MIGRATION.sql`, `STAGE-12-VERIFY.sql`, this document
**Files changed:** `ppm-child-database.js`, `STAGE-11E-12-HARNESS.mjs`, `VERSION`, all 19 pages (cache-bust)

---

## 1. Run it — four steps

Local data in these fourteen stores is **discarded, not migrated**, as agreed. A copy is kept for recovery anyway.

1. **Supabase → SQL Editor → New query.** Paste all of `STAGE-12-REMAINING-STORES-MIGRATION.sql`, **Run**. Expect `Success. No rows returned`.
2. **New query.** Paste all of `STAGE-12-VERIFY.sql`, **Run**. Every `check` row must say `PASS`.
3. **In the tool**, signed in with TOTP, open the console (`F12`) and run:

```javascript
await PPMChildDatabase.cutOverStage12()
```

Then **reload the page**.

4. **Signed in as a System Administrator or Portfolio Manager**, from any page, seed the configuration defaults once (see section 3 for why this is a deliberate step rather than automatic):

```javascript
await PPMChildDatabase.seedStage12Defaults()
```

Then one command replaces the old manual test script:

```javascript
await PPMChildDatabase.selfTest()
```

Expect `PASS` on every database-authoritative collection. That is the whole procedure.

Note that `rag_config`, `resource_config` and `reporting_periods` will still show `0` records afterwards — that is correct, not a failure. Section 3 explains why.

If you decide you wanted the local data after all: `await PPMChildDatabase.cutOverStage12({ seedFirst: true })` seeds and gates on parity like earlier stages did.

---

## 2. Why this was faster, and what actually changed

The slow part of Stages 10B–11E was never the SQL. It was the **seed → parity → investigate → cut over** gate, which exists to guarantee no record is lost. With the data declared disposable that gate has nothing to protect, so it is gone: `fastCutOver()` skips it entirely.

Two things had to be built to make one migration possible instead of five.

### 2.1 One scope column instead of four

A Stage 9 child table is identified by `(project_code, record_key)` and scoped by `private.can_access_project()`. None of these fourteen are project data, so `project_code` would be a lie on every row. The alternative — a different scope column per family — would have forked the generic mapper, hydration and write-through four ways.

Instead every Stage 12 table has one uniform `scope_key`, and each table's RLS decides what it means:

| Family | `scope_key` holds | Read gate | Write gate |
| --- | --- | --- | --- |
| `programme_milestones`, `programme_raid` | the programme code | `programmes.view` + `can_access_programme_code()` | `programmes.edit` + same scope |
| `lifecycle_templates`, `lifecycle_mandatory_rules`, `reporting_calendars`, `reporting_periods`, `rag_config`, `resource_config` | `GLOBAL` | any AAL2 user | `administration.edit` |
| `reference_data` | the configuration category (`projectTypes`, `businessAreas`, …) | any AAL2 user | `administration.edit` |
| `financial_categories` | `GLOBAL` | any AAL2 user | `financials.configure` |
| `resource_absence` | `GLOBAL` | any AAL2 user | `resourceManagement.edit` |
| `resource_gantt_views`, `report_views`, `search_views` | `GLOBAL` + `owner_auth_user_id` | your own rows, plus shared rows with the module read permission | own rows; publishing a shared one needs `views.publish` |

`scopeColumn` defaults to `project_code` everywhere else, so nothing already migrated changed behaviour — the harness proves that with regression tests.

**Config reads are deliberately open to any AAL2 user.** Every page needs reference values and lifecycle stages to render a project at all. Gating reads on `administration.view` would break the tool for everyone except administrators. Writes are the administration permissions, so an ordinary project manager reads the configuration and cannot change it.

**No new permission IDs.** All fourteen map onto the existing 47.

### 2.2 A second write seam — the bug that would have silently eaten every config change

`ppm-admin-utils.js` does not write configuration through `localStorage.setItem`. It writes through `PPMAuth.writeGlobal()`, which exists specifically to bypass the patched localStorage — it calls the original `setItem` captured before patching.

The adapter's write-through has only ever hooked `Storage.prototype.setItem`. So lifecycle templates, reference data, mandatory rules, RAG config, calendars and periods would have saved locally and **never reached PostgreSQL**, with no error anywhere. Stage 12 wraps `PPMAuth.writeGlobal` as a second seam. Hydration keeps using the unpatched `PPMAuth.rawSet`, so loading from the database cannot recurse into a write.

Worth flagging: **`ppmRagConfig` is written from both paths** — `ppm-admin-utils.js` via `writeGlobal`, `ppm-planning-utils.js` via plain `setItem`. It needs both seams, which is exactly the two-writer split the handover warns about.

### 2.3 Two new container shapes

`ppmRagConfig` and `ppmResourceConfig` are single configuration objects, not collections. `shape: "singleton"` maps the whole store to one row keyed `GLOBAL`. An empty table maps back to `{}` rather than `[]`, which matters: it makes the application's own "nothing stored yet" branch run rather than handing it an array it does not expect.

`ppmReferenceData` is an object keyed by category, each holding an array of values with `referenceId`. That reuses the existing `object` shape with the category as the container key — so it needed no new code, only the right `scope_key` meaning.

---

## 3. Populating the configuration tables

I originally said "empty table plus one page load populates itself". That was too optimistic, and the corrected picture matters.

**Five stores do write their own defaults** when they find nothing stored — `getLifecycleTemplates()`, `getReferenceData()`, `getMandatoryRules()`, `getReportingCalendars()` and `PPMFinancial.getCategories()` all save on first read. But only when something calls them, which means only when a user visits a page that needs them.

Left to happen by itself, that has a sharp edge. The write requires `administration.edit` (or `financials.configure`), so **whoever lands on such a page first decides what happens**:

- an administrator → defaults are written and everyone is fine afterwards;
- anyone else → RLS refuses the insert, it lands in *their* pending-write log, and it repeats on every page load until an administrator finally seeds it.

So do it deliberately, once, signed in as a System Administrator or Portfolio Manager. From **any** protected page:

```javascript
await PPMChildDatabase.seedStage12Defaults()
```

It calls the application's own getters rather than duplicating their defaults, so there is no second copy of the configuration to drift out of step. Running it twice is a no-op, and it reports `ok: false` if it could not complete rather than claiming success.

**Why it works from any page.** The getters live in two modules and **no single page loads both** — `administration.html` has the admin utilities but not the financial ones, and `financial-management.html` is the reverse. So "open the right page" was never going to work; there isn't one. Both modules need only `PPMCore` and `PPMAuth` at load time, and both are on every protected page, so whichever is missing is loaded on demand. The cache-bust is copied off an existing script tag rather than hardcoded, so it cannot drift from the build.

Worth knowing: `ppm-admin-utils.js` calls `seedDefaults()` at the end of its own load, which is what materialises these defaults. That means the nine pages that already load it — including the projects list and Administration — write the configuration as a side effect of being visited. Loading it on demand produces exactly the same behaviour those pages already produce.

**Three stores stay empty on purpose:**

| Store | Why |
| --- | --- |
| `rag_config` | Both `PPMAdmin.getRagConfig()` and `PPMPlanning.getRagConfig()` merge the built-in defaults in memory and never save. "No row" correctly means "using the built-in thresholds". A row appears the first time someone changes one. |
| `resource_config` | Same pattern in `PPMPlanning.getResourceConfig()`. |
| `reporting_periods` | Genuinely empty until periods are generated from a calendar. There is no default period. |

`selfTest()` reporting `0` records for those three is the correct result, not a failure.

---

## 4. Recovery, if "I didn't need that data" turns out to be wrong

`fastCutOver()` writes every store it is about to drop into localStorage under **`ppmStage12Discarded`**, keyed by timestamp, before dropping it. It also prints a table of exactly what was discarded and how many records.

To get a store back:

```javascript
const snapshots = JSON.parse(localStorage.getItem("ppmStage12Discarded"));
Object.keys(snapshots);                       // pick the timestamp
const snap = snapshots["<timestamp>"];
Object.keys(snap);                            // which stores were held
```

Then either restore it locally and re-run `cutOverStage12({ seedFirst: true })`, or write the records back through the normal UI. This is a convenience net held in browser storage, not a backup — it does not survive clearing site data.

---

## 5. What I deliberately did not do

**The Resource Directory (`ppmResources` → `public.people`) is untouched.** It is not disposable:

- login does `people.eq("auth_user_id", …)` — no people row, no sign-in;
- `resourceId` references appear across twelve files including `ppm-stage-gate-utils.js`, `project-plan-page.js` and `ppm-resource-management-features.js`, pointing at resource records from data you have **already** migrated. Wiping the directory would orphan task owners, gate approvers and demand lines in your live database.

That stays Stage 12A, with the full careful treatment.

**`resource_absence` is gated on permission, not on person.** Absence is business data about a person and ought to be scoped to that person and their team. There is no server-side person link to scope by until the directory migrates, and inventing a half-link now would be worse than waiting. `resourceManagement.edit` is the same gate the UI already applies. Tighten this in 12A.

**One related gap I found but did not fix.** `PPMAdmin.migrateLegacyProjectLifecycleAssignments()` writes `ppmProjects` through `rawWrite()` → `PPMAuth.writeGlobal`. `ppmProjects` is a *foundation* collection owned by `PPMDatabase`, not a child collection, so neither the old `setItem` seam nor the new `writeGlobal` seam picks it up — meaning a lifecycle-template assignment made by that helper reaches localStorage but never PostgreSQL. This is pre-existing, not introduced here, and it is dormant in your data: the helper only writes when a project is missing a `lifecycleTemplateId` or version, and yours have them. Closing it properly means extending the same seam to the foundation adapter, which belongs with Stage 12A. Say the word and I will do it.

**Nothing was normalised.** All fourteen use the scaffold shape — full record in `legacy_payload`, no typed columns. There is no data to derive typed columns from, and guessing would be exactly what Stage 9 avoided. Normalise later if querying needs it.

---

## 6. Tests run before delivery

**Static checks:** all 40 JS files parse; all 19 pages carry `2026.08.08.2` consistently; `pdfmake.min.js` and `vfs_fonts.js` remain unstamped; adapter load order intact on every page; no `service_role`/`sb_secret` anywhere in browser sources; both SQL files parse against the real PostgreSQL grammar, and all plpgsql and `do` blocks verified block-balanced.

**Harness — 62 assertions, all passing** (`node STAGE-11E-12-HARNESS.mjs`, offline, never touches your project). Stage 12 additions cover:

- all 14 collections registered and using `scope_key`, never `project_code`;
- programme stores resolve `scope_key` from the container key, and a programme record with no programme is **rejected** rather than filed under `GLOBAL`;
- `programmeId` confirmed to be the same value as `programmes.programme_code`, so `can_access_programme_code()` actually matches — had it not, programme RLS would have rejected every row;
- global array stores map back to plain arrays; reference data is refiled under its category; scope bookkeeping never leaks into the record;
- singletons flatten to one record, validate without an id field, map back to the object rather than an array, and an empty one is treated as no record instead of a blank row;
- an empty singleton table maps back to `{}` so the app writes its defaults;
- fast cutover sends **no** inserts, keeps a recovery copy, and replaces the local store with the database view;
- writes reach the database through **both** seams — plain `setItem` and `PPMAuth.writeGlobal`;
- updates and soft deletes filter on `scope_key`, not `project_code`;
- optimistic locking still sends the version the browser loaded, and a newer database version is **not** silently adopted (the Stage 10A bug, re-asserted);
- `fastCutOver` refuses any collection outside Stage 12, so the parity gate cannot be skipped for already-migrated data;
- **regression:** milestones still cut over through the generic path, still update with the loaded version, still soft-delete.

---

## 7. Where this leaves the migration

Every business store is now database-backed except **`ppmResources`**, plus `ppmAuditHistory` which is a UI consolidation job rather than a data one.

Remaining, in order:

1. **Stage 12A — Resource Directory / `public.people` writes.** The last real data migration and the biggest remaining security gap: account status, role, scope and permission overrides need stricter protection than ordinary contact fields, and account provisioning must not put a service-role key in the browser.
2. **Stage 11F — Audit History.** Point `audit-history-page.js` at verified `public.audit_log` instead of `PPMAudit.read()`, and import `ppmAuditHistory` as clearly-tagged unverified history.
3. **Stage 12F — backup/restore.** `ppm-data-safety.js` was written when localStorage *was* the database. A restored old browser backup must not be able to overwrite newer database state through write-through.
4. **Stage 13/14 —** Entra, production hosting/CSP/monitoring, then retire the migration-only compatibility machinery.

Pure UI state stays local and is now explicitly classified as such: `ppmNotificationState`, `ppmProjectDetailSections`, `ppmProjectPlanColumnWidths`, `ppmRecentSearches`, `ppmReportSessionState`, plus the source selectors and pending-write diagnostics.
