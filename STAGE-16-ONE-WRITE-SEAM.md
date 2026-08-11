# Stage 16 — one write seam

**Status:** design agreed, implementation not started
**Decision owner:** Alex Townsend
**Trigger:** external code review, 10 August 2026, which identified the write seams as the
principal architectural risk in the application.

---

## 1. What the reviewers said, and whether they are right

> "It's clever, but it's risky and not best practice, and it was lazy not to rewrite the pages
> as needed for best practice."

They are right, and the second half is the more important half. The seams are not a clever
solution to a hard problem — they are a way of avoiding a rewrite that should have happened when
the application moved from browser storage to PostgreSQL. Everything below is a consequence of
that avoidance.

This document does not defend the current design. It states precisely what is wrong with it, what
replaces it, and how we will know the replacement is complete.

---

## 2. What is actually there today

A page saves a project like this:

```js
localStorage.setItem("ppmProjects", JSON.stringify(projects));
```

Nothing at that line says a network write is about to happen. But `ppm-database.js` and
`ppm-child-database.js` have both replaced `Storage.prototype.setItem` with their own function,
which parses the JSON back out, diffs the whole collection against a baseline, works out which
rows changed, and enqueues row-level writes to PostgreSQL.

There are **four named ways to write**, and you have to know which is which:

| Call | Reaches the database? | Notes |
| --- | --- | --- |
| `localStorage.setItem()` | yes | via the patched prototype |
| `PPMAuth.writeScoped()` | yes | a wrapper that calls the patched `setItem` |
| `PPMAuth.writeGlobal()` | yes, since Stage 12 | separately patched, because it deliberately bypasses the first |
| `PPMAuth.rawSet()` | **no** | captured before patching; hydration only |

Three of the four reach the database. The fourth silently does not. Nothing in the name of any of
them tells you that.

### 2.1 The six specific defects

**1. Action at a distance.** A browser storage API performs a network write. No reader of a call
site can see this. Both real bugs in this area came from someone reasonably assuming otherwise.

**2. No error can reach the caller.** The write-through is fire and forget:

```js
enqueueSync(moduleName, rawStore).catch((error) => console.error(...));
```

`setItem` returns `undefined`, synchronously, before the database has been asked anything. The
`try/catch` around the call site catches quota errors and nothing else. **So a page can tell the
user "Saved" when PostgreSQL refused the write.** That is the most serious defect here, and it is
invisible in testing because the local copy always succeeds.

**3. Whole-collection read-modify-write.** To change one field on one project, the page rewrites
every project. Two people editing different projects at the same time overwrite each other, and
the loser is never told. The diffing engine in the adapter exists only to undo the damage this
does on the way to the database; it cannot undo the damage done in the browser.

**4. Global prototype patching.** `Storage.prototype.setItem` is replaced for the whole page,
including any third-party script. Behaviour depends on load order, which is why
`ppm-data-safety.js` must load before `ppm-auth-utils.js` and why that ordering has its own gate.

**5. Two patches that must agree.** Stage 12's bug: the child adapter patched only the prototype,
so every configuration store written through `writeGlobal` saved locally and never reached
PostgreSQL, with no error anywhere. A design that needs two independent interceptions to stay in
step will eventually have one of them missing.

**6. Optimistic locking that the caller cannot act on.** The adapter holds the version the browser
loaded and refuses a stale update — correctly — but the call site has no way to learn that it
happened, so it cannot tell the user or offer to reload.

---

## 3. What replaces it

**One module, `ppm-data.js`, exposing `PPMStore`. It is the only code in the application that
writes business data.** No prototype is patched. No write is silent. Every write is a row.

### 3.1 Reads — synchronous, from a store the module owns

Hydration fills an in-memory store, and reads come from it:

```js
PPMStore.projects.all()                    // array, cheap, synchronous
PPMStore.projects.byCode("PRJ-001")        // record or null
PPMStore.plans.forProject("PRJ-001")       // array
PPMStore.ragConfig.get()                   // the singleton
```

Reads stay synchronous deliberately. Making them async would push `await` through every render
function on twenty pages for no benefit — the data is already in memory either way. What changes
is where "in memory" lives: an object this module owns, rather than a JSON string in
`localStorage` that any code can rewrite.

**After this stage, no business collection is in `localStorage` at all.** It keeps UI state
(`ppmProjectDetailSections`, `ppmProjectPlanColumnWidths`, `ppmRecentSearches`, notification
state, saved views), the machine-local source selectors, and the pending-write queue. Nothing else.

### 3.2 Writes — asynchronous, one record, explicit result

```js
const result = await PPMStore.projects.save(project);
const result = await PPMStore.raid.remove(raidId, { projectCode });
const result = await PPMStore.plans.saveMany(tasks);     // one batch, one result
```

Every write returns:

```js
{ ok: true,  record }
{ ok: false, reason, message, queued }
```

`reason` is one of:

| reason | Means | Queued? | What the page does |
| --- | --- | --- | --- |
| `offline` | the request could not be made | **yes** | says so, keeps the edit |
| `conflict` | someone else changed this record first | no | offers to reload and reapply |
| `denied` | RLS or workflow rules refused it | no | says the user may not do this |
| `invalid` | the record failed validation before sending | no | shows which field |

**Only `offline` is queued.** A denied write will never succeed on retry, and a queue that keeps
telling somebody their work is pending when it can never land is worse than an error. This follows
from the decision to queue visibly rather than fail fast; if you want denied writes queued too,
say so and I will change it, but I do not recommend it.

### 3.3 Failure is visible

The existing pending-write log stays, and gains a surface. When anything is queued, every page
shows a banner: *"3 changes are saved on this computer but not yet in the database."* It lists
what is outstanding, retries automatically when the connection returns, and states plainly when it
has caught up. Today that queue exists and nobody can see it.

### 3.4 What does not change

The security boundary. RLS on all 37 tables, AAL2 on every read and write, the workflow RPCs, the
append-only enforcement on `rag_history`, and the optimistic-locking version checks are all
unchanged. They are the only things that actually protect the data, and none of them depend on how
the browser decides to call them. `PPMStore` makes the *client* honest; it was never the guard.

---

## 4. The migration surface — smaller than it looks

The raw counts suggest 45 write sites and 45 read sites. In practice almost everything funnels
through eight helpers, each of which writes a whole collection:

| File | Line | Helper | Collections it writes |
| --- | --- | --- | --- |
| `ppm-resource-utils.js` | 17 | `saveResources()` | resources |
| `ppm-planning-utils.js` | 56 | `write(key, value)` | plans, RAG config |
| `ppm-stage-gate-utils.js` | 48 | `rawWrite(key, value)` | stage gates, baselines |
| `ppm-financial-utils.js` | 23 | `writeJson(key, value)` | financials, entries, categories |
| `ppm-register-utils.js` | 352 | `saveRecords(type, ...)` | actions, decisions, benefits, documents, status reports |
| `ppm-governance-utils.js` | 74, 98 | `saveProgrammes()`, `migrateProjectProgrammeReferences()` | programmes, projects |
| `ppm-admin-utils.js` | 113 | `rawWrite(key, value)` | all 11 configuration stores |
| `ppm-notifications.js` | 192 | notification state | UI state — stays in `localStorage` |

Plus **15 direct writes** that bypass the helpers:

```
add-project-page.js         281, 289   ppmProjects
index-page.js               150, 178   ppmProjects
index-page.js               652, 667, 685   ppmProjectPlans, ppmProjectMilestones, ppmProjectRaid
milestones-page.js          55, 63     ppmProjectMilestones
ppm-admin-utils.js          673        ppmProjects
project-details-page.js     133, 901   ppmProjectDocuments, ppmProjects
resource-directory-page.js  403, 419, 442   ppmProjects, ppmProjectPlans, ppmProjectRaid
```

So the work is **eight chokepoints and fifteen call sites**, not ninety scattered ones. That is
what makes doing this in one cutover defensible.

### 4.1 The hard part: synchronous becomes asynchronous

Every one of those helpers is synchronous today, and so is every function that calls them —
`saveProjects()`, `saveProjectDocuments()`, `savePlan()` and so on, up to the event handlers.
Making the write async ripples all the way up each chain.

The rule for the migration: **push `async` up to the event handler and stop there.** Handlers
already run independently, so that is where the chain naturally ends, and it is where the failure
message belongs anyway. Any function that saves and then re-renders must await the save first, so
the screen never shows a state the database has refused.

---

## 5. How we will know it is done

Absence has to be enforced, not asserted. New gates in `VERIFY-STATIC.mjs`:

1. **No prototype patching.** Any assignment to `Storage.prototype.*` fails the build.
2. **No business key in `localStorage`.** The 36 business keys come from the adapters' own
   registry, so the list cannot drift; writing one from anywhere outside `ppm-data.js` fails.
3. **One writer.** Only `ppm-data.js` may call `.from(...).insert/update/delete` on Supabase for
   business tables.
4. **No fire-and-forget saves.** A `PPMStore` write whose result is discarded fails the build —
   this is the defect that let "Saved" lie, and a comment will not stop it coming back.
5. **`rawSet` is gone**, in the same style as the existing retired-identifier gate.

And in `STAGE-14-HARNESS.mjs`: a denied write returns `denied` and does not queue; a conflicting
write returns `conflict` and leaves the store untouched; an offline write queues and is visible;
a successful write updates the store; append-only collections still refuse updates.

---

## 6. Sequencing, and the risk of it

Agreed approach: **one cutover, before UAT starts.**

The risk is stated plainly: this replaces the write path of the entire application in a single
change, and the first time it all runs together will be shortly before colleagues use it. The
mitigations are the five gates, the harness, and a live smoke test of one save per collection
before anyone else is invited in.

If a defect does appear during UAT, the recovery is a single revert to the previous commit in the
public repository — which is now cheap, because the private repository holds the full history and
the deploy folder is derived rather than hand-built.

---

## 7. Order of work

1. `ppm-data.js` — the layer, with the store, the four reason codes and the queue.
2. Migrate the eight helpers, one collection group at a time, gates green after each.
3. Migrate the fifteen direct call sites.
4. Push `async` up to the event handlers, with failure messages.
5. Delete the patches, `rawSet`, and the write-through from both adapters.
6. Add the five gates and the harness sections.
7. Live verification: one save, one delete, one conflict and one denial per collection group.
8. Regenerate both specifications and rewrite section 4 of `HANDOVER.md`, which currently
   describes the seams as a feature.


---

## 8. Defects introduced by this stage, and what now catches them

Recorded here rather than in the shipped source, because this document is private and the
application files are not.

### 8.1 A global name collision that deleted the backup module (fixed)

`ppm-data.js` was written exposing `window.PPMData`. `ppm-data-safety.js` has always owned that
name, and the new file loads after it — so it replaced it outright. Every backup, restore,
storage-warning and `databaseBackedKeys()` function stopped existing, with no error and no
warning anywhere. Load order decided it silently.

`databaseBackedKeys()` is the serious one: restore uses it to know which collections are held in
PostgreSQL and must not be overwritten from a file. Gone, it returns nothing, and a restore
writes a backup over live database rows. That is the one failure in this area that destroys data
rather than throwing.

**Found by** the behavioural harness, and only because a test happened to call one of the missing
functions. Nothing else would have noticed until somebody clicked Restore.

**Fixed** by renaming the new module's global to `PPMStore`.

**Now caught two ways.** `VERIFY-STATIC.mjs` §2a fails if any two files assign the same
`window.PPM*` — that catches the cause. `STAGE-14-HARNESS.mjs` §30 asserts that `PPMData` is
still the backup module, that it is a different object from `PPMStore`, that its five key
functions answer, and that `databaseBackedKeys()` returns a non-empty set — that catches the
consequence. Reintroducing the collision deliberately produces seven failures.

**Why it belongs in the same category as the write seams.** It is invisible, decided by load
order, produces no error, and is only discovered by whoever next uses the feature that quietly
disappeared. That is the same shape of defect this stage exists to remove, introduced while
removing it.

### 8.2 replaceAll emptied every project-keyed collection (fixed)

The worst defect of the stage, and it shipped.

```js
async function replaceAll(name, records, options) {
  ...
  var incoming = Array.isArray(records) ? records.filter(Boolean) : [];
```

Eighteen of the thirty-six collections are stored as an object keyed by project code. Every
migrated caller passes exactly that object — `saveMilestones()` rebuilds the whole store with one
project's rows replaced and hands over the lot, which is the collection-shaped signature
`replaceAll` exists to keep.

An object is not an array. So `incoming` was empty; an empty incoming means every record already
held has disappeared; so the removal pass soft-deleted the entire collection — and returned `ok`.

**Saving one milestone would have removed every milestone in the portfolio.** Duplicating a project
would have removed every plan task in it. The same for RAID, actions, decisions, benefits,
documents, status reports, stage gates, baselines, financial entries and approvals.

**Why nothing caught it.** Section 29 of the harness exercises `replaceAll` five ways — changed,
removed, added, unchanged, refused. Every one of them uses `resourceScenarios`, which is one of the
array-shaped collections. The coverage looked thorough and tested one half of the behaviour.

**Fixed** by resolving the argument against the collection's registered shape, and by a rule that
matters more than the fix: *a shape `replaceAll` does not recognise is an error, never an empty
collection*. Emptiness and "I did not understand you" must not produce the same behaviour when one
of them deletes everything. Passing a string, a number, `null`, `undefined`, or an object to a
list-shaped collection now returns `invalid` and writes nothing.

**Now caught** by harness section 35, against `benefits`. Reverting the fix produces eleven
failures, including `{"ok":true,"saved":0,"removed":3}` where three records should have survived.

### 8.3 Four writes that reached the browser and nowhere else (fixed)

The write-seam ratchet asked *does this file contain `localStorage.setItem`?* and carried a list of
files excused as UI-state-only. But a page writes both kinds. `raid-log-page.js` saved its column
choices **and** the RAID log; `search-page.js` its recent searches **and** its saved views.
Excusing the file excused everything in it.

Once the prototype patch was deleted and `localStorage.setItem` stopped reaching PostgreSQL:

| File | Key | Effect |
| --- | --- | --- |
| `raid-log-page.js` | `ppmProjectRaid` | every RAID save lost at the next reload |
| `search-page.js` | `ppmSearchViews` | saved searches lost |
| `reports-page.js` | `ppmReportViews` | saved report views lost |
| `resource-management-page.js` | `ppmResourceGanttViews` | saved resource views lost |

All four wrote to the browser, said "saved", and were replaced by the database's copy at the next
hydration. All four were green.

**Fixed** in all four files, and the gate rewritten to ask about the **key** rather than the file —
which is what section 5.2 of this document said in the first place. The 36 business keys come from
the adapters' own `MODULES` registries. A key that cannot be resolved to a literal fails too: the
gate has to be able to decide, and "I could not tell" must not read as "fine".

The same gate now covers reads, for the same reason: a page reading `ppmProjects` out of
`localStorage` is reading the mirror hydration happened to leave there, which is absent before
hydration finishes and stale when a change is pending.

### 8.4 The store handed out live references (fixed before it bit)

`read()`, `all()`, `byId()` and `get()` returned the store's own objects. The store is only updated
once PostgreSQL confirms — hand out the live object and any caller defeats that with one line:

```js
var projects = PPMStore.projects.read();
projects[0].status = "Closed";     // the store now disagrees with the database, silently
```

Sorting a list in place, splicing a row out before saving, or keeping a reference and editing it
later all do the same damage by accident. Found while planning the read migration, which was about
to put sixty call sites on those four functions. Fixed by copying in and out, and asserted in
harness section 34 — seven failures if the copying is removed.

### 8.5 An unreachable function, noted rather than deleted

`reopenRaidItem()` in `raid-log-page.js` has no caller and no wiring in the HTML. It is complete,
sensible code for reopening a closed RAID item after a recurrence, and nothing can invoke it.

Left in place deliberately: deleting it removes a capability that may simply never have been wired
up, and that is Alex's call rather than a cleanup. It is the same shape as Stage 17 — a feature
that reads as implemented and cannot be reached.

---

## 9. The mirror is gone

Hydration hands each collection straight to `PPMStore.adopt()`. Nothing writes a legacy key, and
`readMirror()` — the bridge this document described in section 4 as "a bridge, not the design" —
has been deleted.

What made it removable was `ppm-page-loader.js`, which already waited for both adapters' `ready`
promises before loading any page script. Hydration had always finished before anything read; the
mirror was never the reason reads worked. It was a second copy of the data with no owner, absent
before hydration finished, stale when a change was pending, and indistinguishable at the call site
from the real thing.

Four things fell out of removing it, and each was a defect rather than a tidy-up.

### 9.1 Hydration refused to refresh, to protect a copy that no longer existed

Both adapters skipped a collection that had unsaved changes, so a pending edit was not overwritten.
That depended on the mirror holding the edit. `PPMStore` only changes once PostgreSQL confirms, so
a failed save updates nothing — there was nothing left to protect, while refusing to refresh now
guarantees an empty collection, because the database copy is the only copy.

It had already been the wrong trade twice: a conflict blocked hydration until conflicts were
excused, then a refusal blocked it for two days until refusals were excused. Each fix excused one
more kind. It always refreshes now.

### 9.2 No failed write had been recorded since the cutover

`recordProblem()` was only ever called from `syncStore()` and `appendOnlySync()` — the
collection-level path the write-through used. Once that path stopped being reached, nothing
recorded a failure, and `pendingWrites()` answered "nothing outstanding" however much had gone
wrong. The same gap existed in the foundation adapter, where `saveRecords()` recorded failures but
`saveRecord()` — which is what `PPMStore` actually calls — did not.

Worse than not having the diagnostic, because it answered confidently. Both adapters now record
each row-level outcome and clear the entry when a later attempt succeeds.

### 9.3 Two hundred lines of unreachable sync machinery

`diffStore()`, `syncStore()`, `appendOnlySync()`, `enqueueSync()`, `syncFromRawValue()` and
`flush()` were the engine behind the write-through. Deleting the patch made every one of them
unreachable — but `flush()` was still being awaited in five places in the workflow commits and in
the scenario publisher, where `await flush(...)` read as "make sure pending writes have landed" and
did nothing at all.

The `pendingFor()` check underneath each one is what was ever load-bearing. All of it is deleted.

### 9.4 A scenario save that was never awaited

`PPMPlanning.saveScenarios(rows);` — no `await`, no result checked. The guard below it called
`flush()` and then asked whether anything was pending, which could not work: the write had not been
given a chance to finish or fail. Two mechanisms, neither working, reading as a safeguard.

### 9.5 What the backup means now

`buildBackup()` enumerated every `ppm*` key, which happened to include every collection because
hydration left a copy of each one there. With the mirror gone it would silently have stopped
containing the portfolio. It now reads the collections from `PPMStore` and puts them in their own
`collections` section, distinct from the `data` section a restore writes back — so the file is as
useful as it was, and its status is stated rather than implied.
