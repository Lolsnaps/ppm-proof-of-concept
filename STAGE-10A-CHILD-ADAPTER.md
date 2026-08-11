# Stage 10A — Child adapter, live seeding tools, and pre-cutover hardening

**Prepared:** 7 August 2026  
**Version stamp:** `2026.08.07.16`  
**Starting point:** `PPM Tool 29.rar`  
**Application cutover in this stage:** **none**

Stage 9 created the 18 child tables. Stage 10A adds the safe tooling needed to
inspect and seed them from the browser's **current** localStorage data, but does
not switch any application page to those tables yet.

That distinction is deliberate: database destination + parity first, cutover
second.

---

## What changed

### New file: `ppm-child-database.js`

Loaded on all 19 application pages immediately after `ppm-database.js`.

It knows all 18 Stage 9 tables and their actual legacy storage shapes:

- 15 object stores keyed by project/programme group
- 3 flat arrays (`ppmResourceDemand`, `ppmResourceScenarios`, `ppmAuditHistory`)

This follows the **current code**, including the Stage 9 correction that
`ppmFinancialEntries` and `ppmFinancialApprovalRequests` are keyed objects rather
than flat arrays.

It provides:

```javascript
PPMChildDatabase.explain()
PPMChildDatabase.status()
PPMChildDatabase.preview("milestones")
await PPMChildDatabase.get("milestones")
await PPMChildDatabase.compare("milestones")
await PPMChildDatabase.compareAll()
await PPMChildDatabase.seed("milestones")
await PPMChildDatabase.seedAll()
```

Nothing executes automatically. Merely loading the file does not read or write
Supabase and does not change localStorage.

### New SQL: `STAGE-10A-CHILD-ADAPTER-MIGRATION.sql`

A pre-cutover hardening migration. It is safe to re-run.

It fixes two Stage 9 assumptions that could not be seen in the old backup because
the relevant collections were empty:

1. **Programme-level benefits are not project-scoped.**
   `ppmProjectBenefits` can store a benefit under `programme:PRG-...` with no
   project. The table now has `programme_code`, and RLS accepts either an
   authorised project or an authorised programme.

2. **Resource scenarios are not one project's record.**
   A scenario contains copies of demand from potentially many projects and has no
   top-level `projectCode`. Its RLS is now based on
   `resourceManagement.view/edit`, rather than inventing a fake project scope.

It also adds `deleted_at` to all 17 writable child tables. Stage 9 correctly
withheld hard DELETE, but the live application does delete child rows. Stage 10B
will represent removal as a versioned/audited soft delete rather than granting
hard DELETE.

The audit key/read policy is also updated so programme benefits and resource
scenarios remain readable to the correct users without weakening project-scoped
audit entries.

### Foundation concurrency bug fixed in `ppm-database.js`

Reviewing the actual Stage 6 implementation found an important mismatch between
the documentation and the code.

The database trigger correctly expects **the version the browser originally
loaded**. But the adapter was doing a fresh lookup immediately before every
update and sending that fresh version back. That only protected the tiny interval
between lookup and update; a page that had been stale for ten minutes could still
overwrite somebody else's work.

Stage 10A now carries `databaseVersion` from hydration and sends that loaded
version to the trigger.

Also fixed:

- programme and portfolio records now carry their database lock version;
- successful writes update the local database version metadata;
- a successful row no longer marks unrelated failed rows clean;
- a failed/conflicted row therefore stays dirty for the next retry.

Hard DELETE remains unavailable.

---

# Before running anything

Keep your existing `PPM Tool 29` folder/rar as the rollback copy.

The replacement folder supplied with this stage is `PPM Tool 29 - Stage10A`.

Stage 10A makes no automatic child-table write, so copying the application files
alone does not migrate any child data.

---

# Step 1 — Apply the Stage 10A SQL migration

In Supabase:

**SQL Editor → New query**

Open:

```text
STAGE-10A-CHILD-ADAPTER-MIGRATION.sql
```

Copy all, paste, and run.

At the bottom are validation queries.

Expected:

```text
soft-delete columns              PASS
benefit programme column         PASS
can_access_programme_code        PASS
```

And:

```text
authenticated DELETE privileges  0
anon child-table privileges      0
```

If either privilege count is not `0`, stop before seeding.

---

# Step 2 — Replace/run the Stage 10A application folder

Start the server from the supplied folder:

```bat
py -m http.server 8000
```

Open:

```text
http://localhost:8000/login.html
```

Hard refresh once:

```text
Ctrl+F5
```

Sign in normally and complete TOTP MFA.

---

# Step 3 — Confirm the adapter loaded

In F12 Console:

```javascript
PPMChildDatabase.explain()
```

You should get one row for each of the 18 child collections.

This command is local-only. It does not write the database.

A useful first check:

```javascript
PPMChildDatabase.preview("milestones")
```

This should show the live milestone count in this browser and whether every row
has a stable `milestoneId` and project scope.

---

# Step 4 — Seed milestones only

Do **not** start with `seedAll()`.

Milestones are deliberately the first live test because they are small,
project-scoped, and have a straightforward identity.

Run:

```javascript
await PPMChildDatabase.seed("milestones")
```

The seed function:

1. requires a real Supabase session at AAL2;
2. reads the current localStorage milestone collection;
3. validates stable IDs/project scope;
4. checks what already exists;
5. inserts only missing records;
6. freezes the initial record in `import_payload`;
7. immediately performs a parity comparison;
8. never overwrites an existing row merely because it differs.

Expected result:

```text
refused: []
parity.identical: true
```

If `parity.identical` is false, stop. Nothing is cut over, so the application is
still using localStorage exactly as before.

---

# Step 5 — Verify in Supabase

In Table Editor, `project_milestones` should now contain the same number of rows
reported by:

```javascript
PPMChildDatabase.preview("milestones")
```

The seed inserts will be recorded in the server audit trail. That is expected:
the authenticated administrator performed the migration.

---

# Step 6 — Re-run parity

```javascript
await PPMChildDatabase.compare("milestones")
```

Required verdict:

```text
IDENTICAL
```

At this point the milestone destination has been proven against **current live
browser data**, rather than the older migration backup.

The app is still not reading the milestone table. This is intentional.

---

# Step 7 — Inspect the rest before bulk seed

Run:

```javascript
PPMChildDatabase.status()
```

Any collection with:

```text
valid: false
```

must be inspected with:

```javascript
PPMChildDatabase.preview("<module>")
```

before it is seeded.

If everything is valid, seed other non-empty modules one at a time. Suggested
order:

```text
milestones
plans
raid
decisions
financials
planBaselines
baselineRequests
financialEntries
financialApprovals
```

Empty scaffold tables do not need seeding.

Do not seed `legacyAudit` from the browser. Stage 9 deliberately made
`legacy_audit_history` read-only. It needs a separate historical import once the
current local audit trail is captured.

`seedAll()` exists for controlled testing, but it stops at the first problem by
default. Do not use it as the first live migration command.

---

# What Stage 10A does NOT do

No child collection is database-authoritative yet.

Specifically, this stage does **not**:

- hydrate any child collection from Supabase on page load;
- intercept child writes;
- soft-delete child rows;
- switch milestone reads to the database;
- migrate legacy local audit;
- implement the previously skipped Stage 7 workflow RPCs.

Those belong to Stage 10B onward, after live parity is proven.

---

# Stage 10B prerequisites discovered during review

A child cutover cannot simply copy the Stage 6 top-level pattern blindly.

## 1. Deletes

Milestones, RAID, register rows, stage gates and other child collections can be
deleted in the UI.

Hard DELETE remains intentionally revoked. Stage 10B must convert a disappeared
local record into:

```text
deleted_at = server timestamp
```

using the loaded database version, so removal is optimistic-lock protected and
audited.

## 2. Coupled collections

Several collections must move together:

### Financial group

```text
ppmProjectFinancials
ppmFinancialEntries
ppmFinancialApprovalRequests
```

The financial utility updates them as one workflow.

### Resource planning group

```text
ppmResourceDemand
ppmResourceScenarios
```

Publishing a scenario replaces live demand.

### Stage gate dependency

Stage gate transitions can create:

```text
ppmProjectActions
ppmProjectDecisions
```

So stage gates should not cut over before actions and decisions.

### Baseline group

Baseline approval/request behavior spans:

```text
ppmProjectPlans
ppmPlanBaselines
ppmPlanBaselineRequests
```

It should be tested as a workflow, not as isolated tables.

## 3. Programme benefits

Benefits can be project-level or programme-level. The Stage 10A SQL fixes the
server schema/policies before any benefit cutover.

## 4. Resource scenarios

Scenarios are not project rows. The Stage 10A SQL corrects the policy before
resource-planning cutover.

---

# Verification performed before delivery

## JavaScript parsing

Every JavaScript file in the replacement folder parses with Node.

## Generic adapter against the real August migration backup

The Stage 10A adapter was exercised against the real backup data and a simulated
Supabase API.

Result:

```text
17 / 17 writable child modules:
seed + map + parity passed
```

This covered:

- 3 project plan tasks
- 1 milestone
- 1 RAID record (`projectId` correctly resolved to `project_code`)
- 1 decision
- 1 financial summary
- 1 baseline
- 1 baseline request
- 4 financial entries
- 3 financial approval requests
- all empty scaffold modules

`legacyAudit` correctly refused browser seeding.

## Synthetic shapes missing from the old backup

Additional tests created:

- one programme-level benefit;
- one project-level benefit;
- one resource scenario containing demand for two projects.

All seeded and round-tripped identically using the corrected Stage 10A scope
model.

## Foundation optimistic locking

A simulated stale project edit loaded at version 1 against a current database
version 2 was refused as a conflict.

A correct version 2 update succeeded and advanced the local lock metadata to
version 3.

Programme lock metadata was also verified.

---

# Recommended next step after milestone parity

Stage 10B should implement **milestones-only cutover** using the generic metadata
now established:

1. load milestone rows from the DB into the legacy keyed-object shape;
2. preserve synchronous page callers through the existing storage seam;
3. write changed rows with their loaded `databaseVersion`;
4. soft-delete missing rows through `deleted_at`;
5. keep failed/conflicted writes dirty;
6. verify audit output;
7. test all pages that read milestones;
8. provide an immediate revert-to-local command.

Only after milestones survive real use should the same mechanism be expanded to
the dependency groups above.
