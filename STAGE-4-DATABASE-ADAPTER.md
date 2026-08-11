# Stage 4 — The database adapter (`ppm-database.js`)

**Completed:** 7 August 2026
**Rollback copy:** `PPM Tool 28 - pre-4-backup`

Stage 4 adds the layer that Stage 5 will move modules onto. **Nothing reads from
the database yet.** Every module still reads localStorage exactly as before, so
the application behaves identically today.

---

## Why this exists

Every module currently reads localStorage synchronously:

```javascript
const projects = PPMAuth.readScoped("ppmProjects", []);
```

The database is asynchronous and returns snake_case columns. Changing every
module at once would be a rewrite, which the specification forbids. The adapter
sits in between and hands back records in the shape the app already understands:

```javascript
const projects = await PPMDatabase.getProjects();
```

So Stage 5 becomes a sequence of small, reversible edits rather than a redesign.

---

## How a record is assembled

Every imported row kept its complete original object in `legacy_payload`, and the
Stage 2B import normalised only some fields into real columns. A record is built as:

```
{ ...legacy_payload, ...normalised columns that are not null }
```

Columns win where they exist, because they are what the database enforces and
what row-level security filters on. `legacy_payload` supplies everything that was
never normalised.

That last part matters more than it sounds. Your projects carry `workstream`,
`lifecycleTemplateId`, `lifecycleTemplateVersion`, `lifecycleAssignmentSource`,
`programmeId`, `archiveHistory`, and both `archiveReason` **and** `archivedReason`
— none of which exist as columns. Spreading `legacy_payload` first means fields
nobody remembered still survive the round trip.

A `null` column never overwrites a legacy value, because `null` means "was never
normalised", not "is empty". An empty string is a real value and is kept.

---

## Using it

Everything starts on localStorage. Nothing changes until you say so.

```javascript
// See where you stand — run this first if anything looks odd
await PPMDatabase.explain()

// Compare database against localStorage before switching anything
await PPMDatabase.compare("projects")
await PPMDatabase.compareAll()

// Switch one module over
PPMDatabase.useDatabaseFor("projects", true)

// Put it back
PPMDatabase.useDatabaseFor("projects", false)

// Panic button — everything back to localStorage
PPMDatabase.useLocalForEverything()
```

The setting is stored per browser and survives a reload. It is excluded from
backups, so restoring a backup cannot silently switch someone else's data source.

### Reads available

| Call | Returns |
|---|---|
| `await PPMDatabase.getProjects()` | all readable projects, legacy shape |
| `await PPMDatabase.getProject(code)` | one project or `null` |
| `await PPMDatabase.getProgrammes()` | all readable programmes |
| `await PPMDatabase.getProgramme(id)` | one programme or `null` |
| `await PPMDatabase.getPortfolios()` | all readable portfolios |
| `await PPMDatabase.getPortfolio(id)` | one portfolio or `null` |
| `await PPMDatabase.getCurrentPerson()` | the signed-in person only |

Records from the database carry `recordSource: "database"`, plus `databaseId`,
`version` and the `*Uuid` fields that Stage 6 will need for writes.

---

## What happens when things go wrong

This distinction is deliberate and worth understanding.

**A query that FAILS** — offline, signed out, session expired — falls back to
localStorage and warns loudly in the console. The page keeps working and you are
told it happened.

**A query that SUCCEEDS but returns nothing** is *not* a failure. Row-level
security legitimately returns no rows to someone with no project scope. Quietly
substituting local data would hide exactly what Stage 5 needs to detect, so the
empty result is returned as-is. If localStorage disagrees, the adapter says so in
the console rather than papering over it.

---

## Two real problems the parity checker caught

Both were found by running the adapter against your actual database rows, and
both are fixed.

**1. Timestamp formats did not match.** PostgreSQL returns
`2026-08-06T14:10:59.789+00:00`; the application writes
`2026-08-06T14:10:59.789Z`. The same instant, different text. Any code comparing
or displaying the raw string would have seen a phantom change on PRJ-00003. The
adapter now normalises timestamps to the form the application already uses, and
the comparator treats two spellings of the same instant as equal.

**2. Absent boolean flags looked like differences.** The `archived` column
defaults to `false`, but a legacy record simply omits the key when a project is
not archived. The application treats an absent flag as false, so these mean the
same thing. The comparator no longer reports it — but only for booleans; `""`
versus `false` is still a genuine difference.

After both fixes, `compare("projects")` reports **IDENTICAL** against your three
real projects.

---

## A limitation Stage 5 must plan around

**The browser can only read its own `people` row.**

The policy is `people.auth_user_id = auth.uid()`, so a signed-in user genuinely
cannot read anybody else's person record. Consequences:

- The adapter cannot turn `project_manager_id` into a name. Person names keep
  coming from `legacy_payload` (`projectManager`, `sponsorEmail`, and so on),
  which is why those fields are preserved so carefully.
- There is deliberately **no `getPeople()`**. It could only ever return one row,
  which would be actively misleading. Use `PPMAuth.getResources()` for the
  directory.
- **The Resources module cannot move to the database in Stage 5** without first
  widening people access — for example, letting a user read people within their
  project scope, or those on their own team.

The UUIDs are exposed as `projectManagerUuid`, `sponsorUuid` and so on, so this
becomes a straightforward change once that policy is widened.

---

## Verification

**45 of 45 adapter tests passed**, run against real rows exported from your
database — including the archived project with its unusual legacy fields:

- default sources are all local; default reads are unchanged
- switching one module does not affect the others
- values come from columns where they exist
- `workstream`, `lifecycleTemplateId`, `programmeId`, `archiveHistory`,
  `archivedReason`, `projectManagerResourceId`, `sponsorEmail` all survive
- a `null` column does not wipe a legacy value
- `databaseId`, `version` and the `*Uuid` fields are exposed for Stage 6
- a failed query falls back to localStorage **and warns**
- an empty database result is **not** replaced by local data, but is flagged
- being signed out falls back safely
- the reset button clears the setting completely
- the parity checker reports IDENTICAL for your real data

**All 19 pages** were loaded headlessly: no console errors, `PPMDatabase` present
on every one, and every module still defaulting to localStorage.

**Backup regression re-run: 21/21 passed.** The new `ppmDatabaseSources` key is
excluded from backups, and no credential material has crept back in.

---

## Stage 5 playbook

For each module, in the order the handoff recommends — Projects, then
Portfolio/Programme, then the rest:

1. Sign in and open the console.
2. `await PPMDatabase.compare("projects")` — do not proceed unless it says
   IDENTICAL, or you understand and accept every difference listed.
3. `PPMDatabase.useDatabaseFor("projects", true)`
4. Change that module's read calls from
   `PPMAuth.readScoped("ppmProjects", [])` to `await PPMDatabase.getProjects()`,
   making the containing function `async`.
5. Exercise the pages that use it. Watch the console for adapter warnings.
6. If anything looks wrong: `PPMDatabase.useDatabaseFor("projects", false)` and
   the old path is back immediately.

Do not move Resources until the people policy is widened. Writes stay in Stage 6.

---

## Not in this stage

- **No writes.** The browser still has SELECT only; INSERT/UPDATE/DELETE remain
  revoked at the database. Writes arrive in Stage 6 with optimistic locking
  through `projects.version`, which the adapter already carries.
- **No module has been switched over.** That is Stage 5, one module at a time.
- **No caching beyond the current page.** The cache is cleared on reload and
  whenever a source is switched.
