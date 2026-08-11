# Portfolio Manager — Technical Handover

**Current build:** `2026.08.09.11`
**Handover date:** 9 August 2026
**Supersedes:** `the organisation_Portfolio_Claude_Handover_Post_Stage11D_v23.md`, which described the state at build `2026.08.07.23` and is now substantially wrong.
**Supabase project:** `qmfigesgkoirirgpgmse` (eu-west-1, PostgreSQL 17.6)
**Live pilot:** hosted on GitHub Pages from a public repository

> **Read `DEVELOPER-SPECIFICATION.html` first.** It is generated from source, so its
> permission matrix and collection registry cannot drift, and it now carries the
> architecture, the write seams, the traps and the backlog in more detail than this file.
> This document is kept for the parts a generator cannot know — the reasoning below — and
> section 1 is refreshed each delivery.

---

## 0. Read this first

**The migration is finished.** Every business collection is database-authoritative. The previous handover described a mid-migration state with 16 of 18 child tables cut over and localStorage still holding people, programme data, configuration and audit history. All of that is now in PostgreSQL.

**The most important thing in this document is section 4.** It describes the write seams. They are not obvious from reading any single file, they have caused two real bugs, and getting them wrong means writes silently never reach the database.

**Where files and reality disagree, reality wins — and there is one known disagreement**, documented in section 9.1. Verify against the live database rather than trusting the SQL files. That principle found four real bugs in the last few stages.

---

## 1. Current state in one page

| | |
| --- | --- |
| Build | `2026.08.09.11` |
| Application pages | 19 (plus `404.html`, and the two generated specification documents) |
| JavaScript files | 42 (all documented in the developer guide's module reference) |
| Migrations | 30 `STAGE-*.sql`, each safe to re-run |
| Public tables | 37, all with RLS, all requiring AAL2 |
| `private` helper functions | 36 |
| Permission IDs / roles | 47 / 9 — unchanged since Stage 3F |
| Release gate | `node VERIFY-ALL.mjs` — run this, not the individual scripts |
| Offline test harness | 295 assertions, `node STAGE-14-HARNESS.mjs` |
| Static verification | 2,234 assertions, `node VERIFY-STATIC.mjs` |
| Migration lint | `node STAGE-SQL-LINT.mjs` — all 30 pass |
| Demo portfolio | loaded: 17 projects, 24 people, 5 programmes |

**Everything is database-authoritative.** There is no remaining business data in localStorage. What is still there is a hydrated mirror plus genuine per-user UI state (`ppmNotificationState`, `ppmProjectDetailSections`, `ppmProjectPlanColumnWidths`, `ppmRecentSearches`, `ppmReportSessionState`), the machine-local source selectors, the pending-write log, and `ppmStage12Discarded`.

### Adapter inventory

**Foundation** (`ppm-database.js`) — 4 writable modules: `projects`, `programmes`, `portfolios`, `people`.

**Child** (`ppm-child-database.js`) — 32 modules:
- 18 original Stage 9 child tables, keyed `(project_code, record_key)`
- 14 Stage 12 tables, keyed `(scope_key, record_key)`
- `ragHistory` is **append-only**
- `ragConfig` and `resourceConfig` are **singletons** — the whole store is one row
- `legacyAudit` is **read-only** from the browser

---

## 2. Non-negotiable constraints

Unchanged from the previous handover, and all still true:

- **Do not rewrite into a framework.** Deliberately static multi-page HTML/CSS/classic JS. No build step, no package manager.
- **No `service_role` / `sb_secret` in browser code, HTML, backups, logs or documentation.** The browser has only the publishable key. The repository is public, so this is now enforced by circumstance as well as principle.
- **RLS and database functions are the security boundary.** `PPMAuth.can()` and UI hiding are UX only.
- **AAL2/TOTP is mandatory** for every protected read and write. All 37 tables carry a restrictive AAL2 policy. Do not weaken it for testing.
- **Keep the 9 roles and 47 permission IDs compatible** unless a business redesign is explicitly requested.
- **Preserve all four access scopes:** Portfolio-wide, Assigned, Team, Selected.
- **Never mix scoped and global storage APIs casually.** See section 4.
- **No hard DELETE on child tables.** Removal is `deleted_at`, or `active`/`account_status` for people.
- **No TRUNCATE/TRIGGER/REFERENCES to `authenticated`.**
- **Optimistic locking uses the version the browser loaded.** Never re-fetch immediately before updating.
- **Coupled Stage 11A–D groups change source together.**
- **Every delivery bumps `VERSION` and every HTML cache-bust consistently.**

---

## 3. Architecture

Static multi-page application. Shared modules use the `ppm-` prefix. Domain and page code remains largely synchronous and still reads legacy-shaped localStorage.

PostgreSQL is authoritative; rows are hydrated into the legacy shape *before* page scripts execute, so synchronous code keeps working while writes are enforced underneath.

### Boot order — do not change casually

```
<Supabase CDN>
ppm-supabase.js        publishable key only; session in sessionStorage
ppm-core.js
ppm-data-safety.js     LOADS THIRD ON PURPOSE — see section 4
ppm-auth-utils.js      patches Storage; scoping filter; requireAuth()
ppm-database.js        foundation adapter
ppm-child-database.js  child adapter + workflow RPC clients
ppm-page-loader.js     awaits both adapters, then loads page scripts in order
<domain/page scripts>
```

`ppm-page-loader.js` exists to close an async hydration race. Do not replace it with `defer`, `async` or ES modules.

### Editing a project happens on the project details page

Three buttons on `project-details.html` each open one form in a panel on that page:

| Form | Fields | For |
| --- | --- | --- |
| details | 43 | what the project **is** — identity, ownership, scope, strategic context |
| status | 32 | what it is **doing** — stage, dates, progress, nine RAGs, commentary |
| assurance | 38 | the evidence each stage gate expects, grouped by stage |

None of them navigates anywhere, and none of them involves `add-project.html`, which creates
projects and does nothing else.

`BUILD-PROJECT-FIELDS.mjs` reads the field markup in `add-project.html` and writes
`ppm-project-fields.js`; `ppm-project-forms.js` renders, populates, reads and validates from
that registry. Generated rather than typed because there are 113 fields, and a missed one
would exist on every new project and then be silently uneditable.

**Four gates hold it together:** coverage of every field against the markup, no field in two
forms, the registry not drifting from the markup, and all four editor triggers being buttons
with no `href="add-project.html"` left on the page. Adding a field to the creation form and
not saying which form it belongs to fails the build with the field's name in the message.

Saving merges the patch over the record the page already loaded, which is what preserves
`databaseVersion` and optimistic locking. A status save also appends a RAG history snapshot,
and refuses until any reported RAG that differs from the calculated one is explained.

---

## 4. One write seam — the most important section

Everything that changes portfolio data goes through `ppm-data.js`, which exposes `window.PPMStore`.
There is no other way, and the release gates enforce that rather than describing it.

```js
const saved = await PPMStore.milestones.save(milestone);
if (!saved.ok) showMessage(saved.message, saved.queued ? "warning" : "error");
```

### 4.1 Every write answers

A write returns `{ ok: true }`, or `{ ok: false, reason, message, queued }` where `reason` is one of:

| Reason | Means | Queued? |
| --- | --- | --- |
| `offline` | could not reach the database; kept on this computer and retried | yes |
| `conflict` | somebody else changed the record since it was loaded | no |
| `denied` | row-level security or a workflow guard refused it | no |
| `invalid` | the record cannot be saved as asked — no identifier, wrong shape | no |
| `failed` | anything else | no |

**The store is updated only after PostgreSQL confirms.** That is the rule the whole design rests on:
the screen can never show a state the database refused. A queued write is visible in the amber
banner (`ppm-unsaved.js`), because a queue nobody can see is no better than a silent failure.

### 4.2 Reads come from the store, not from localStorage

`PPMStore.<collection>.all()` flattens the project-keyed collections and fills a row's project code
or programme id from the key it is filed under. `.read()` returns the collection in its stored
shape, `.byId()` and `.forProject()` do the obvious thing. Nothing crosses the boundary by
reference — a caller gets its own copy, so sorting a list in place cannot make the store disagree
with the database.

### 4.3 What this replaced

Four ways to write, three of which looked like ordinary browser code:

| Old path | What it really did |
| --- | --- |
| `localStorage.setItem()` | reached PostgreSQL because both adapters had replaced `Storage.prototype.setItem` |
| `PPMAuth.writeScoped()` | the same, through a wrapper |
| `PPMAuth.writeGlobal()` | reached PostgreSQL through a *second*, separate patch |
| `PPMAuth.rawSet()` | bypassed everything — hydration only |

All of them returned before the database had been asked anything, so a refusal reached the console
and the page said "saved". Two production bugs came directly from it: configuration that saved
locally and never reached PostgreSQL for an entire stage, and a scoped user's backup that would
have destroyed every record they could not see on restore. The four governance workflows were
unreachable for months for the same reason (`STAGE-17-WORKFLOWS-UNREACHABLE.md`).

All three `Storage.prototype` patches are gone — the two write-through seams and the
project-scoping filter — and with them `readScoped`, `writeScoped`, `readGlobal`, `writeGlobal`,
`rawRead` and `rawSet`. Every one is on the retired-identifier list.

**There is no localStorage mirror.** Hydration hands each collection straight to `PPMStore`, so the
page holds one copy of the data and the browser holds none. `ppm-page-loader.js` is what makes that
sufficient: it waits for both adapters' `ready` promises before loading a single page script, so by
the time anything reads, hydration has finished. Seven keys remain in `localStorage`, all of them
genuine per-person browser state — expanded sections, column widths, recent searches, dismissed
notifications, the configuration schema marker and the two pending-write ledgers — and each is
listed by name in `VERIFY-STATIC.mjs`.

Removing the mirror also settled a question that had been answered wrongly twice. Hydration used to
refuse to refresh a collection with an unsaved change, to avoid overwriting it; that reasoning
depended on the mirror holding the change. Nothing holds it now, so refusing to refresh only
guarantees an empty page. The database copy always wins, and the ledger is for reporting.

### 4.4 What the gates enforce

`VERIFY-STATIC.mjs` fails the build if any of these appear:

- a business collection's key read from or written to `localStorage` outside `ppm-data.js` and the
  two adapters — the 36 keys come from the adapters' own `MODULES`, so the list cannot drift
- a `localStorage` key that resolves to no literal, so the gate can always decide
- a key that is neither a collection nor on the written-down browser-only list
- an assignment to `Storage.prototype`
- a `PPMStore` write whose result nobody looks at
- a collection name that no adapter registers

The behavioural harness covers the rest: what each reason code does, that a refused write leaves
the store alone, that a queued write later refused is dropped rather than retried for ever, and
that `replaceAll` handles both the list-shaped and project-keyed collections.

---

## 5. Identity and authentication

- Supabase Auth, **email + password + TOTP**. Entra is deferred (see section 11).
- AAL2 is required before any protected data is returned.
- Identity link: `auth.users.id → public.people.auth_user_id`. **Never fall back to email matching.**
- `auth_user_id` is **not writable from the browser at any permission level** — a trigger refuses it. Linking a person to a login is a deliberate administrative act performed in the Supabase dashboard.
- `ppmAuthSession` / `ppmCurrentUser` remain in sessionStorage as a compatibility layer. Not a security boundary.
- 8-hour compatibility session with 30-minute idle logic. Supabase holds the real session.
- All sign-out paths must sign out Supabase as well as clearing the compatibility session.

### Adding a person with a login

**Corrected in Stage 13A.** The version of this section in the previous handover was wrong twice: it omitted that the password is set in the dashboard, and the `UPDATE` it gave **does not work** — the Stage 12A guard refused `auth_user_id` changes even for the table owner, which was the one place it told you to make them. Verified by attempting it.

1. Supabase dashboard → Authentication → Users → **Add user**. Enter the email and a temporary password you invent; tick **Auto Confirm User**.
2. In the tool: **Resources** → add the person, set access role and scope. Note the `RES-000NN` it assigns.
3. In the SQL editor:

```sql
select public.ppm_link_person_login('person@example.com', 'RES-00NN');
```

That validates both sides, links them, and flags the password for replacement. It refuses an unknown email or resource, an already-linked login, and a person with no access role. It is **not** granted to `authenticated`, so the browser cannot call it.

4. Send them the URL, email and temporary password. On first sign-in the tool takes them through authenticator enrolment and then a password of their own. No further administration.

To reset somebody's authenticator (lost phone), remove their factor in the dashboard under Authentication → Users; the tool will walk them through enrolment again on next sign-in.

---

## 6. Data architecture

Migrated rows keep the full original browser record in `legacy_payload` while selected fields are normalised into typed columns. Mapping back:

```javascript
{ ...legacy_payload, ...normalised_non_null_columns }
```

Normalised columns win where present. `null` means "not normalised, keep the legacy value"; an empty string is a real value. Adapter metadata (`databaseId`, `databaseVersion`, `recordSource`, `supabaseUserId`, `managerUuid`, storage-group bookkeeping) **must not** be persisted inside `legacy_payload`.

### Two key shapes

**`(project_code, record_key)`** — 19 tables. Project child data, scoped by `private.can_access_project()`.

**`(scope_key, record_key)`** — 14 tables, introduced in Stage 12. None of them are project data, so `project_code` would be a lie on every row. One uniform column whose meaning each table's RLS decides:

| `scope_key` holds | Tables | Scoped by |
| --- | --- | --- |
| a programme code | `programme_milestones`, `programme_raid` | `can_access_programme_code()` |
| a configuration category | `reference_data` | permission only |
| `'GLOBAL'` | the other configuration tables | permission only |
| `'GLOBAL'` + `owner_auth_user_id` | `report_views`, `search_views`, `resource_gantt_views` | own rows, plus shared rows |

One column rather than four is what keeps the generic mapper, hydration and write-through reusable instead of forked per family. `scopeColumn` defaults to `project_code`, so nothing older changed behaviour.

### Two special tables

**`rag_history` is append-only.** Enforced three independent ways: no UPDATE grant, no UPDATE policy, and `private.rag_history_immutable()` refusing UPDATE and DELETE at row level. The browser routes through `appendOnlySync()`, which inserts new snapshots and **refuses** rewrites, restoring the database copy over the local change. Never add an edit or delete path — the correction for a wrong status is a new snapshot.

**`people` is the identity table.** See section 7.

---

## 7. `public.people` — handle with care

The last thing migrated (Stage 12A) and the one with the most to get wrong. Four things were found by inspecting the live database rather than the files:

1. **Nobody could see the whole directory.** `can_access_person()` had no portfolio-wide branch — not even a System Administrator saw all five people, and three of five would have vanished on cutover. Hydration replaces the whole local array with what the reader can see, and `nextResourceId()` takes `max(RES-nnn)` of the *visible* list, so it would have reissued an identifier already in use. Fixed with a `has_portfolio_wide_access()` branch.
2. **No `version` column** — no optimistic locking on the table holding roles and permissions.
3. **No audit trigger, zero `audit_log` entries.** Role changes, scope changes and suspensions were unrecorded.
4. **`supabaseUserId` would have been written into `legacy_payload`** — a copy of the identity link inside a JSON blob.

### `private.guard_person_identity()` — three rules

| Rule | Why |
| --- | --- |
`auth_user_id` never writable from the browser | it decides who someone *is* |
`legacy_resource_id` immutable once set | every denormalised owner name and email in projects, plans and RAID joins on it |
Access-control fields need `users.manage`, and **cannot** be changed on your own row | granting yourself permissions is the same shape of problem as approving your own budget |

`active` counts as access-significant only when the person has a login or access role.

**If you lock yourself out**, the SQL editor is the escape hatch — it runs as table owner and bypasses both policy and guard, which is why it is the documented route rather than something the app can do.

### The cascade

`resource-directory-page.js → syncResourceReferences()` denormalises `fullName` and `email` into `ppmProjects`, `ppmProjectPlans` and `ppmProjectRaid`, matching on `*ResourceId`. Those writes go through the patched seam and reach the database. This is why `legacy_resource_id` must never change.

---

## 8. Audit

- **`public.audit_log` is the verified trail.** Written by AFTER triggers from the authenticated identity. The browser has **no** INSERT/UPDATE/DELETE privilege. Covers all 37 tables.
- **`public.legacy_audit_history`** holds pre-migration browser history as tagged unverified context. No INSERT grant; the only way in is `public.ppm_import_legacy_audit()`, a gated `SECURITY DEFINER` RPC requiring AAL2 + an active linked person + `users.manage`. **Drop that function after importing.**
- The Audit History page reads **all three sources** and labels every row: Verified (database), Legacy (imported), Unverified (this browser). Provenance is part of the record for an audit screen.
- `AUDIT_ENTITY` in `ppm-database.js` maps all 37 table names to display names. **Those strings are keys into `PPMChangeLog.LOCATIONS`** — that mapping is what gives a row its location, area and link back. Add a table, add both.
- `PPMAudit.record()` still writes local compatibility history. Retiring it is Stage 14.

---

## 9. Traps discovered — read before touching SQL

### 9.1 The file and the database disagree, in one place

`STAGE-9-CHILD-TABLES.sql` as originally written defined `legacy_audit_history.timestamp`. The column actually in the database is **`timestamp_value`** — renamed when Stage 9 was applied, and the file was never updated. The file has since been corrected, but the lesson stands: **verify against the live database.**

All 352 other columns across the 18 child tables match exactly. This was the only drift.

### 9.2 An empty table with the wrong shape is invisible

`compare()` only diffs records present on both sides. Zero rows means zero comparisons, so it reports `IDENTICAL` against a table of entirely the wrong shape. `selfTest()` showed `IDENTICAL` for fourteen empty collections and that told us nothing. `STAGE-11F-VERIFY.sql` now checks all 352 columns explicitly.

### 9.3 `revoke ... from public` does not remove Supabase's grant to `anon`

Supabase's default privileges grant EXECUTE on new `public` functions to `anon` explicitly. `PUBLIC` is a pseudo-role, so revoking from it leaves the explicit `anon` grant. Six functions were callable unauthenticated, two `SECURITY DEFINER`. Not exploitable — each checks AAL2 first — but the internal check should not be the only thing standing there. Stage 11F ends with a sweep over every `public.ppm_*` function; use `revoke ... from public, anon`.

### 9.4 `x <> any(array[...])` is almost always a bug

True as soon as `x` differs from *one* element. Intended exclusions silently stop excluding. Use `<> all`. Found in the Stage 12 audit read policy.

### 9.5 `array_agg(catalog_column) = array['a','b']` fails at runtime

Catalog columns like `pg_attribute.attname` are type `name`, so this raises `operator does not exist: name[] = text[]`. Cast with `::text`.

**9.4 and 9.5 are both caught by `node STAGE-SQL-LINT.mjs`.** A successful PostgreSQL parse cannot see either — plpgsql bodies are string literals to the parser. Run the lint.

### 9.6 A record never loaded has no version to send

`saveRecord` treated a missing `databaseVersion` as a conflict and reported "changed by someone else", which sent the reader off to reload — which cannot help. Distinct message now, and `saveRecords(..., { seed: true })` is the deliberate reconciliation path for records predating the database.

### 9.7 Cutover must not switch the source if hydration did not run

`cutOver` set the source to database and reported success even when hydration was skipped, leaving reads pointed at the database while localStorage held the stale copy. It now reverts the source. Cutting over is one operation, not two.

### 9.8 Pending conflicts must not block hydration

Foundation `hydrate()` blocked on any pending entry including conflicts — but a conflict *means* the local copy is stale, and reloading is how you resolve it. Permanently blocked by the thing it fixes. Conflicts are now cleared and reloaded; network failures and refusals still block.

### 9.9 A successful zero-row read is only security truth *at AAL2*

Below AAL2 the restrictive policy on every table filters every row out, and PostgREST
reports that as a perfectly successful empty result. Every write path checked the
assurance level; the read path checked only that a session existed. So hydration wrote
`[]` over all 36 collections and reported success.

The blast radius came from where the two halves live: the Supabase session is per **tab**
in `sessionStorage`, the mirror is per **profile** in `localStorage`. One tab sitting
between password and authenticator code emptied the data every other tab was showing,
then refilled it on the next hydration. It reads as "data everywhere is missing until I
go and do something first".

Both adapters now skip hydration below AAL2 with a single warning, and the harness
asserts both directions — a guard that also refuses at AAL2 would pass a refusal test
and take the application down.

### 9.10 `style-src 'self'` blocks style attributes in markup the *scripts* build

The CSP tightening moved inline styles out of the HTML files. Eight page scripts were
still emitting `style="left:…px"` into template strings, and a style attribute is
governed wherever it is parsed — including markup assigned to `innerHTML`. The browser
dropped all of them: the Allocation Gantt collapsed to one coloured block, the project
plan's dependency SVG lost its box and drew its links across the whole page, and register
columns lost their widths.

`VERIFY-STATIC.mjs` read only the HTML, so 1,916 assertions passed while the pages were
visibly broken. **A gate that checks one of two places is worse than no gate, because it
reads as reassurance.** It now scans the JavaScript too.

Computed geometry goes through `PPMCore.styleAttribute()` and `PPMCore.applyComputedStyles()`,
which write it with CSSOM — outside what CSP governs. Fixed declarations belong in a class.

### Earlier traps, still true

- Financial entries and approval requests are **objects keyed by project code**, not arrays. The old mismatch leaked every project on scoped read and could wipe the collection on scoped save.
- Benefits can be **programme-level**. Do not force every benefit to a project.
- Resource scenarios are **cross-project**. RLS requires access to every project in one.
- A successful zero-row RLS query is **security truth**, not a failure needing local fallback.
- Seed current data **before** installing restrictive workflow guards.
- Do not weaken self-approval or segregation rules because only one test account exists.

---

## 10. Backup and restore — what actually protects the data

`ppm-data-safety.js` was written when localStorage *was* the database. Its original opening line said there was no server copy; that is now false and the module has been rewritten to say so.

- **PostgreSQL is the backup.** Supabase automatic backups plus PITR (`wal_level` is `logical`, so the WAL exists; confirm your plan's window). Take your own `pg_dump` too — the database is ~14 MB.
- **The browser export is a snapshot, not a backup.** Format 2 declares `snapshotOnly` and lists which collections were database-backed.
- **Restoring database-backed collections is refused.** It writes past every seam, so the next hydration discards it — but in the window before that, the screen shows stale data and any edit made against it *is* written through. That is how a restore could overwrite newer database state indirectly, through the user. `compareBackup()` and `restoreLocalOnly()` are the safe paths; `{ force: true }` exists for when you have deliberately reverted to local first.

---

## 11. Remaining work

### Stage 14 — cleanup and documentation (recommended next, after the pilot settles)

- **Rewrite `TECHNICAL-SPECIFICATION.html`.** It still describes localStorage-as-database and browser password hashing. It is now in a public repository, so a reader draws the opposite conclusion about the security model. Highest-value item here.
- Retire `PPMAudit.record()` as primary evidence now that verified server audit covers all 37 tables.
- Retire shadow mode, the source switches and panic modes once the cutovers are trusted.
- Consider retiring the `ppmAuthSession` / `ppmCurrentUser` compatibility layer.

### Stage 15 — production identity and hosting, when the tool is ready for an employer

- Microsoft Entra. Preserve `people.auth_user_id` or a deliberate successor as the identity link, and keep an AAL2-equivalent assurance requirement.
- A host that can set HTTP headers — GitHub Pages cannot, so `frame-ancestors` and CSP reporting are currently unavailable. Cloudflare Pages or similar.
- Custom domain and TLS, error monitoring, operational logging.
- Review Supabase Auth production settings. **Leaked-password protection is currently off** — a two-click change now that colleagues will choose passwords.

### Smaller carried-over items

- Tighten `resource_absence` from permission-only to person/team scope. Unblocked by Stage 12A; it was left broad because no server-side person link existed at the time.
- Close the foundation `writeGlobal` seam gap (section 4.4).
- **Pin `supabase-js`.** Every page loads `@2`, so jsDelivr can serve a different build tomorrow — a supply-chain surface and a reproducibility problem for a public pilot. Pin an exact version and add an `integrity` hash.
- The optimistic-lock message reads "This people was changed by someone else" — a shared string wanting a per-table label.

---

## 12. Console cheat sheet

```javascript
// Foundation
PPMDatabase.explain()
await PPMDatabase.compare("people")
await PPMDatabase.compareAll()
PPMDatabase.pendingWrites()
PPMDatabase.clearPending("people")          // per-module since Stage 12A
await PPMDatabase.auditReport()
await PPMDatabase.saveRecords("people", records, { seed: true })   // deliberate reconciliation

// Child inventory
PPMChildDatabase.explain()
PPMChildDatabase.status()
PPMChildDatabase.pendingWrites()

// One call instead of the old manual script
await PPMChildDatabase.selfTest()
await PPMChildDatabase.selfTest(["referenceData"], { write: true })

// Stage readiness
await PPMChildDatabase.stage11EServerReady()
await PPMChildDatabase.stage12ServerReady()

// Configuration defaults — run once as an administrator, from any page
await PPMChildDatabase.seedStage12Defaults()

// Audit
await PPMAudit.readAll()
PPMAudit.sourceCounts(rows)
await PPMAudit.importLegacyToDatabase()      // then drop the RPC

// Backup
PPMData.compareBackup(backup)
PPMData.restoreLocalOnly(backup)
PPMData.partitionBackup(backup)              // { restorable, databaseBacked }
```

---

## 13. Testing expected of every future delivery

**Static:** every `.js` parses; every page carries the new `VERSION` cache-bust consistently; `ppm-page-loader.js` order intact; no `service_role`/`sb_secret` in any browser source; no new direct localStorage business access outside the scoped facade; both SQL files parse; `node STAGE-SQL-LINT.mjs` passes.

**Behavioural:** `node VERIFY-ALL.mjs`, which runs the 197-assertion harness plus every other offline gate. All of it is offline, never touches the real project. Extend it rather than replacing it. It has caught real defects in new code, including an API where a spread overwrote a boolean flag with an array of the same name.

**Live, where a database change is involved:** apply, run the matching `STAGE-*-VERIFY.sql`, and check `get_advisors` for security. Five `authenticated_security_definer_function_executable` warnings are **expected and correct** — that is the architecture, a signed-in user calling an RPC that enforces AAL2, permissions and scope internally so it can write to tables they cannot.

---

## 14. Paste-ready instruction for a new session

```text
You are taking over the Portfolio Manager application. The Supabase migration is
COMPLETE — every business collection is database-authoritative. The tool is live on
GitHub Pages from a public repository for pilot testing.

Read HANDOVER.md first, then inspect the actual code and the live database before
changing anything. Section 4 (write seams) and section 9 (traps) are the two that
will cost you if skipped.

Current build must be 2026.08.09.11. Supabase project qmfigesgkoirirgpgmse.

Hard constraints:
- static multi-page classic JS; no framework, no build step;
- never put a service_role/sb_secret in browser code — the repo is PUBLIC;
- Supabase Auth + TOTP AAL2 mandatory; auth_user_id -> people identity;
- auth_user_id is never writable from the browser, at any permission level;
- 9 roles / 47 permissions / four scopes stay compatible;
- RLS and database RPCs are the only security boundary;
- preserve scoped-vs-global storage semantics — there are THREE write paths and
  they differ (section 4);
- optimistic locking uses the version the browser loaded, never a re-fetch;
- child hard DELETE stays revoked; use deleted_at / active;
- rag_history is append-only — never add an edit or delete path;
- every delivery: node VERIFY-ALL.mjs (all five offline gates), migration plus
  verification, live-test steps, rollback, VERSION and cache-bust bump.

Where documentation conflicts with the live database, the database wins. Say so
rather than guessing — that principle found four real bugs in the last four stages.

Next recommended work: Stage 14 cleanup, starting with rewriting
TECHNICAL-SPECIFICATION.html, which is public and describes an architecture that no
longer exists.
```

---

## 15. Final note

The risky phase is over. Foundation data, all 18 child collections, programme data, every configuration store, saved views, the resource directory and audit history are all database-backed, with RLS as the only boundary, verified server audit on 37 tables, and four coupled approval workflows running as single PostgreSQL transactions.

What remains is tidying and production readiness, not migration. The two things most likely to cause trouble are both documentation rather than code: the specification file that describes an architecture that no longer exists, and this handover going stale the way the last one did. Keep both current.
