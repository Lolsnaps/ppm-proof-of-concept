/*
  The module reference and the change map, for the developer specification.

  WHY THIS FILE EXISTS

  The developer guide explained why the system is the way it is and assumed the reader could
  find the code. That is half a guide. Knowing that there is one write seam does not tell
  you which of 40 files to open, and knowing that a field lives in a legacy payload does not
  tell you which four places to change to add one.

  So: what each module owns, what it exposes, where its own decisions live, and what will
  catch you out in it - followed by recipes for the changes people actually make, each naming
  files and functions in the order they need touching.

  WHAT IS DERIVED AND WHAT IS WRITTEN

  Derived from source, so it cannot drift: the global each module defines, the names on that
  global, how many lines it is, and which pages load it. Those are exactly the facts that go
  stale in a hand-maintained document.

  Written by hand, because no generator can know it: what the module is *for*, where to make a
  change inside it, and the thing that has already bitten somebody. NOTES below is that
  writing. VERIFY-STATIC.mjs fails if a script has no entry, so adding a module forces
  documenting it rather than leaving the next reader to guess.
*/

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/* Vendored, not ours, and not documented here. */
const VENDORED = new Set(["pdfmake.min.js", "vfs_fonts.js"]);

/*
  Ours, but not part of the tool: the wiring for a preview page that no page of the application
  links. Documenting it in the module reference would tell a reader to look for something that
  is not in the build. The module it previews - ppm-picklist.js - IS documented, because it is
  going to be part of the tool.
*/
const NOT_THE_APP = new Set(["PREVIEW-CONTROLS.js"]);

const esc = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ------------------------------------------------------------------ derived */

export function scriptFiles() {
  return readdirSync(HERE)
    .filter((file) => file.endsWith(".js") && !VENDORED.has(file) && !NOT_THE_APP.has(file))
    .sort();
}

/*
  Which pages load a script. Both forms count: a <script src> in the head, and an entry in
  ppm-page-loader.js's data-ppm-scripts list. The list is pipe-separated, so entries are
  compared exactly rather than by substring - "ppm-database.js" would otherwise match
  "ppm-child-database.js" and every count would be wrong.
*/
function loadedBy(file, pages) {
  return pages.filter(({ html }) => {
    if (new RegExp(`<script src="${file.replace(/\./g, "\\.")}(\\?|")`).test(html)) return true;
    const list = html.match(/data-ppm-scripts="([^"]*)"/);
    if (!list) return false;
    return list[1]
      .split("|")
      .map((entry) => entry.split("?")[0].trim())
      .includes(file);
  });
}

/*
  The names a module puts on its global. Read from the `window.X = { ... }` literal rather
  than by looking for `function` declarations, because the export list is the module's
  deliberate public surface and everything else is internal.
*/
function publicApi(source, globalName) {
  /*
     The ASSIGNMENT, not the first mention.

     indexOf("window.PPMChildDatabase") found a reference inside the module - a function that
     checks its own exported API - roughly 500 lines before the real assignment, and then parsed
     that function's return object as the module's public surface. The developer guide reported
     the child adapter as exposing three names instead of thirty-four, and the cross-module gate
     started failing on calls that were perfectly correct.

     Second defect found in this function on the same day; the other dropped the final entry of
     every export list. Both misreported the code rather than breaking it, which is why neither
     surfaced until something was checked against them.
  */
  const assignment = new RegExp(`window\\.${globalName}\\s*=\\s*(?:Object\\.freeze\\()?\\{`);
  const found = assignment.exec(source);
  if (!found) return [];
  const start = found.index;
  const open = source.indexOf("{", start);
  if (open === -1) return [];
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  const body = source.slice(open + 1, end);
  const names = new Set();
  /*
     `name,` shorthand and `name: fn` alike, at the literal's top level only.

     The trailing separator is optional, because the LAST entry of an object literal usually has
     no comma after it - so requiring one silently dropped the final export of every module from
     the documented API. Nine modules were each missing one function from the developer guide,
     and an audit of cross-module calls then reported those functions as calls to something that
     did not exist. The code was right both times; the reader was being misinformed.
  */
  [...body.matchAll(/^\s{2,6}([A-Za-z_$][\w$]*)\s*(?:[,:]|$)/gm)].forEach((match) => names.add(match[1]));
  return [...names].sort();
}

export function describeScripts() {
  const pages = readdirSync(HERE)
    .filter((file) => file.endsWith(".html"))
    .map((file) => ({ file, html: readFileSync(join(HERE, file), "utf8") }));

  return scriptFiles().map((file) => {
    const source = readFileSync(join(HERE, file), "utf8");
    const note = NOTES[file] || null;
    /* A module may set several globals; the documented one is authoritative, because a
       module like ppm-resource-management-features.js also parks a confirmation handler on
       window and picking the first match found the wrong one. */
    const globalName =
      note?.global || (source.match(/window\.(PPM[A-Za-z]+)\s*=\s*(?:Object\.freeze\()?\{/) || [])[1] || "";
    return {
      file,
      lines: source.split("\n").length,
      global: globalName,
      api: globalName ? publicApi(source, globalName) : [],
      pages: loadedBy(file, pages).map((page) => page.file),
      note
    };
  });
}

/* ----------------------------------------------------------- written by hand

   owns    what this file is responsible for, in one sentence
   change  where to go inside it for the change people actually make
   gotcha  the thing that has already caught somebody, or will
   global  only where the file sets more than one and the guess would be wrong
*/
const NOTES = {
  /* ---------------------------------------------------------- shared modules */
  "ppm-supabase.js": {
    owns: "Creating the one Supabase client, with the publishable key and the session in sessionStorage.",
    change:
      "The pinned client version and its SRI hash are in every page's <script> tag, not here. To change them, change every page together - VERIFY-STATIC.mjs fails if they disagree.",
    gotcha:
      "The session lives in sessionStorage, which is per tab. That is why a second tab is a fresh sign-in, and - while a localStorage mirror still existed - why one tab sitting below aal2 could empty the data every other tab was reading."
  },
  "ppm-core.js": {
    owns:
      "The small helpers every other file needs: HTML escaping, JSON parsing, local-time dates, computed styles, and the loading-state failsafe.",
    change:
      "Add a helper here only when the copies you are replacing were genuinely identical. The list of things deliberately NOT shared is at the bottom of the file, with the reason for each.",
    gotcha:
      "escapeHtml also escapes quotes, so it is safe inside an attribute. An earlier copy in the resource module did not, and could break out of one."
  },
  "ppm-data-safety.js": {
    owns: "Backup, restore, comparison, and the storage-limit warnings. The last file in the application that patches Storage.prototype, and only to notice a quota failure.",
    change:
      "buildBackup() and restoreAll() are the two entry points. A backup has two halves and they are not the same thing: `data` is the eight browser-only settings keys, which a restore writes back, and `collections` is a read-only copy of the portfolio taken from PPMStore. Restore never writes the second.",
    gotcha:
      "It loads third, before ppm-auth-utils.js, and used to have to: it captured the genuinely native Storage functions before the project-scoping filter replaced them, and loading it later meant a scoped user's 'full backup' held only their own projects - which a restore then wrote over everything. That filter is gone, so the hazard is gone with it; the order is still checked because the next patch somebody adds will have the same problem."
  },
  "ppm-auth-utils.js": {
    owns:
      "Identity, roles, permissions, project scope, the signed-in person's own record, and requireAuth() on every page.",
    change:
      "ROLE_DEFINITIONS and ALL_PERMISSIONS near the top are the role model. can() is the permission question for a project; holdsPermission() is the question about the person. Page-level rules are in PAGE_EDIT_RULES and applyControlPermissions().",
    gotcha:
      "This is UX, not security. Every answer here is also enforced by RLS and the workflow RPCs, and the database wins. If the two disagree the user gets a button that fails, so change both together - see private.person_has_permission()."
  },
  "ppm-database.js": {
    owns:
      "The foundation adapter: projects, programmes, portfolios and people. Hydration into PPMStore, row-level saves, optimistic locking, the pending ledger and the audit entity map.",
    change:
      "MODULES and WRITERS define the four collections. To add a normalised column, change the mapper and the toColumns writer together, then regenerate SCHEMA-MANIFEST.json.",
    gotcha:
      "A read below aal2 returns zero rows with no error. query() refuses in that case rather than treating it as 'no data', because hydration used to write [] over all 36 collections and report success."
  },
  "ppm-child-database.js": {
    owns:
      "The child adapter: 32 collections, both key shapes, the append-only rag_history path, and the clients for the four transactional workflows.",
    change:
      "MODULES is the registry - one entry per collection. Adding one means an entry here, a table, RLS policies, an AUDIT_ENTITY name in ppm-database.js and a PPMChangeLog.LOCATIONS entry.",
    gotcha:
      "saveOne() skips a record that is byte-for-byte what the database already holds. That is not an optimisation: writing it anyway bumps the row version, so somebody else editing the same record gets a conflict caused by a save that changed nothing."
  },
  "ppm-page-loader.js": {
    owns:
      "Waiting for both adapters, loading each page's scripts in order, and the loading state that hides the pop-in.",
    change:
      "The script list is per page, in data-ppm-scripts. The three timings (skeleton delay, minimum, slow threshold) are constants at the top.",
    gotcha:
      "<html class=\"ppm-loading\"> hides the page, so the class must always come off - on success, on a slow load, on a failed script and in the catch. ppm-core.js carries a 20-second failsafe for the one case this file cannot cover: itself failing to load."
  },
  "ppm-notifications.js": {
    global: "PPMNotifications",
    owns: "The notification centre: 30 builders, one per thing that can be waiting for somebody.",
    change:
      "Add a builder inside the same pass as the others, using add({ id, category, severity, title, detail, meta, href }). stableId() keeps a notification identifiable across refreshes so 'read' sticks.",
    gotcha:
      "Target the person, not the role. Every builder must test a named field - assignedTo(record, 'taskOwner', user) or an approver id - because a permission test alone tells 30 people about one person's work. blockedNote() adds 'ask an administrator' where the role genuinely still decides; do NOT use it for stage gates, where being named as an approver is itself the authority - it told a named approver to go and get a permission they did not need, on the notification asking them to use it."
  },
  "ppm-admin-utils.js": {
    owns:
      "All configuration: lifecycle templates, mandatory rules, reference data, reporting calendars and periods, RAG thresholds, portfolios.",
    change: "seedDefaults() is what runs on load. Each getX()/saveX() pair is one configuration store.",
    gotcha:
      "Its getters are pure - they derive defaults rather than persisting them. One of them lost its return statement to a brace-less `if` whose body was replaced with a comment, and returned undefined on every populated portfolio; the projects page and the lifecycle readiness section both died on it."
  },
  "ppm-audit-utils.js": {
    owns: "Reading the three audit sources and labelling each row Verified, Legacy or Unverified.",
    change: "readAll() merges the sources. Provenance is part of the record; do not flatten it away.",
    gotcha:
      "The browser cannot write public.audit_log - database triggers do, from the authenticated identity. Anything recorded from here is unverified by definition."
  },
  "ppm-change-log.js": {
    owns: "Turning an audit row into a human sentence, linking it back to where the change happened, and the per-record History dialogue.",
    change:
      "LOCATIONS maps an entity name to a page, area and link. Add a collection and add an entry, or its history has nowhere to point. historyFor() merges public.audit_log with the pre-migration browser rows and is asynchronous, so openHistory() awaits it.",
    gotcha:
      "It used to RECORD as well as read - recordRow(), recordDeletion(), trackCollection() - through PPMAudit functions Stage 14 had deleted, reached by a local alias no gate could see. Every save that recorded a change threw after the row had reached the database, killing the rest of the handler: the modal stayed open, the list never refreshed, and it was reported a month later as a button that did nothing."
  },
  "ppm-governance-utils.js": {
    owns: "Archive state, programme membership, and the small shared governance questions.",
    change: "isArchived() is the single definition of archived. Use it rather than testing the status string.",
    gotcha:
      "Archiving is a soft state - archived plus archiveHistory - never a delete. Reopening restores preArchiveStatus."
  },
  "ppm-planning-utils.js": {
    owns:
      "The calculated side of delivery: RAG rules, critical path, slippage, plan normalisation, and the append-only RAG history.",
    change:
      "RAG_DIMENSIONS is the list of nine. calculateProjectRags() is the rule set; getRagConfig() holds the thresholds an administrator can change.",
    gotcha:
      "recordRagHistory() appends. There is no edit and no delete, enforced three ways in the database. The correction for a wrong status is another snapshot."
  },
  "ppm-stage-gate-utils.js": {
    owns: "Stage-gate state, required approvers, segregation rules, and the client for the governance workflow.",
    change:
      "The permitted transitions and who may make them are here and mirrored in ppm_commit_stage_gate_workflow. Change both. validate() answers two questions separately: `errors` are statements about the record and refuse, `advice` is what the readiness rules noticed and blocks nothing.",
    gotcha:
      "Being named as a required approver IS the authority to decide, whatever the person's role - see is_named_gate_approver() in the database. And readiness never refuses: a gate is the decision, so approving with items outstanding is a call somebody is accountable for, and what was outstanding is recorded on the decision instead."
  },
  "ppm-resource-utils.js": {
    owns: "The resource directory as the rest of the tool sees it: lookup, legacy reconciliation, team membership.",
    change: "findResource() resolves a person from an id or a name. Use it rather than matching names yourself.",
    gotcha:
      "legacy_resource_id (RES-000NN) is the join key for every denormalised owner name in projects, plans and RAID. It is immutable once set, and the database enforces that."
  },
  "ppm-resource-management-features.js": {
    global: "PPMResourceFeatures",
    owns: "Capacity, utilisation, absence and the resource-scenario workflow client.",
    change: "Utilisation thresholds come from PPMPlanning.getResourceConfig(), not from constants here.",
    gotcha:
      "A resource scenario is cross-project: publishing one needs access to every project in it, and RLS enforces that. It also calls a bare global showMessage() provided by whichever page hosts it."
  },
  "ppm-register-utils.js": {
    owns: "The four registers - actions, decisions, documents, status reports - and their shared field schemas.",
    change: "The schema per register type is the thing to change; the table renders itself from it.",
    gotcha:
      "Column widths come from the schema and are applied through PPMCore.styleAttribute(), because style-src 'self' blocks a style attribute."
  },
  "ppm-financial-utils.js": {
    owns: "Money: budget, forecast, actuals, variance, cost categories and the budget-approval client.",
    change: "Category configuration is a collection like any other; the calculations are here.",
    gotcha:
      "Financial entries and approval requests are objects keyed by project code, not arrays. Treating them as arrays leaked every project on a scoped read and could wipe the collection on a scoped save."
  },
  "ppm-report-pdf.js": {
    owns: "Building the PDF report document definition for pdfmake.",
    change: "One function per report block. The fonts are vendored in vfs_fonts.js and carry no cache-bust.",
    gotcha: "Loaded on demand by the reports page rather than listed on every page, so it has no page entry."
  },
  "ppm-project-fields.js": {
    owns: "GENERATED. Every editable project field, grouped into the three editors on the details page.",
    change:
      "Do not edit it. Change the field markup in add-project.html, or the grouping in BUILD-PROJECT-FIELDS.mjs, and regenerate.",
    gotcha:
      "VERIFY-STATIC.mjs regenerates it in memory and fails if the file differs, so a half-applied change cannot ship."
  },
  "ppm-project-forms.js": {
    owns: "Rendering, populating, reading and validating the three project editors from that registry.",
    change:
      "render() builds the markup, read() returns a patch of only that form's fields, validate() returns the problems. explain() is the diagnostic to reach for first.",
    gotcha:
      "Field ids are prefixed ppmField-. A control called projectName would collide with an element of that name on the page, and getElementById returns whichever comes first - which has happened."
  },
  "ppm-data.js": {
    owns: "The one read and write seam. Exposes PPMStore - the only code that reads or writes business data, and the only copy of it in the page. Loaded by every page, after both adapters.",
    change:
      "PPMStore.<collection>.save(record) / .remove(record) / .replaceAll(records) return { ok } or { ok:false, reason, message, queued }. Reads - all(), byId(), forProject(), get() - are synchronous, from the store this module owns. Collections are generated from both adapters' registries, so adding one to an adapter is enough. explain() prints every collection and anything outstanding.",
    gotcha:
      "It is PPMStore, NOT PPMData - ppm-data-safety.js owns window.PPMData, and this file was called PPMData long enough to silently replace it and delete every backup and restore function on the administration page. VERIFY-STATIC.mjs section 2a now fails if two files claim one global. Also: the store updates only after the database confirms, and only reason 'offline' is queued."
  },
  "ppm-unsaved.js": {
    owns: "The banner that shows changes saved on this computer but not yet in the database.",
    change:
      "It subscribes to PPMStore.onChange() and renders whatever is outstanding. Nothing else needs to call it. The styling is section 7 of ppm-controls.css.",
    gotcha:
      "Amber, not red - nothing is lost, and it retries when the connection returns. It never uses the word 'saved' for queued work, and its two buttons carry data-permission=\"none\" so PPMAuth does not fail them closed."
  },
  "ppm-picklist.js": {
    owns: "Turning a <select multiple> into a list of tick boxes. Self-starting; loaded by administration.html and resource-directory.html, the only pages with one.",
    change:
      "It enhances every select[multiple] itself on load, so no page script calls it. To add it to another page: link ppm-controls.css last, then add this before the page script. explain() prints what each list holds.",
    gotcha:
      "The select is not replaced. It stays hidden in the DOM and remains the only record of what is chosen, so existing selectedOptions reads and PPMAuth's disabling both keep working. Pages repopulate these selects with innerHTML, which is why a MutationObserver rebuilds rather than reconciles."
  },

  /* ------------------------------------------------------------- page scripts */
  "login-page.js": {
    owns: "Sign-in: password, authenticator enrolment and verification, first-run password change.",
    change: "The select list of people columns is here; add a column to it when you add one to the table.",
    gotcha: "The only page without ppm-page-loader.js, because there is no hydrated data to wait for yet."
  },
  "home-page.js": {
    owns: "The dashboard, which is almost entirely the notification centre.",
    change: "Most changes belong in ppm-notifications.js rather than here.",
    gotcha: "Small on purpose. Resist adding page-specific logic that other pages will then want."
  },
  "index-page.js": {
    owns: "The project register: filter, sort, create, duplicate, archive, reopen.",
    change: "getFilteredProjects() is the filter. Note that archived projects are hidden unless you search.",
    gotcha:
      "projects is captured once at load; the filter re-reads the variable, not storage. A storage event from another tab re-reads it."
  },
  "add-project-page.js": {
    owns: "Creating a project: the form, validation, RAG preview, lifecycle readiness and the save.",
    change:
      "This page creates. Editing happens on project-details.html through ppm-project-forms.js - do not add an edit path back here.",
    gotcha:
      "The RAG badges and override-justification boxes are created at runtime by setupRagAssessment(), not present in the markup, so they will not be in the field registry."
  },
  "project-details-page.js": {
    owns: "One project in full, read-only, plus the three editors and the save that backs them.",
    change:
      "loadProject() renders through a per-step list so one failure cannot disable the page. bindEditorControls() wires the six editor triggers; startEditing() and saveEditor() are the editors.",
    gotcha:
      "The heading is #projectHeading, not #projectName - the form's project-name input owns that id. Binding happens at load, before rendering, because it used to sit seventh in the render list and any earlier error killed every button on the page."
  },
  "project-plan-page.js": {
    owns: "The task plan: inline grid, dependencies, critical path, slippage, timeline and baseline requests.",
    change: "renderTimeline() draws the timeline; the dependency overlay is timelineDependencySvg().",
    gotcha:
      "All bar and overlay geometry goes through PPMCore.styleAttribute(). Emitting a style attribute directly gets it dropped, and the dependency SVG then draws its links across the whole page."
  },
  "milestones-page.js": {
    owns: "Milestones for a selected project, baseline against forecast.",
    change: "Project selection drives everything; loadSelectedProject() is the entry point.",
    gotcha: "Programme-level milestones are a different collection (programme_milestones, keyed by scope_key)."
  },
  "stage-gates-page.js": {
    owns: "Submitting and deciding stage gates, and the decision history.",
    change: "Every decision goes through the workflow RPC. Do not write gate rows directly.",
    gotcha:
      "Self-approval and segregation are enforced in the database. Do not relax the screen's version because only one test account exists."
  },
  "raid-log-page.js": {
    owns: "Risks, assumptions, issues and dependencies, with scoring, review dates and escalation.",
    change: "The scoring model and review frequencies are here; the fields are a child collection.",
    gotcha: "Closing a RAID item is a status and closure evidence, never a delete."
  },
  "registers-page.js": {
    owns: "Actions, decisions, documents and status reports in one page, driven by the register schemas.",
    change: "Change the schema in ppm-register-utils.js; this page renders whatever it is given.",
    gotcha: "Locked status reports are read-only rows, marked by a class rather than removed."
  },
  "benefits-management-page.js": {
    owns: "Benefits at both project and programme level.",
    change: "The programme/project filter pair is the thing most changes touch.",
    gotcha: "A benefit can belong to a programme rather than a project. Do not force every one to a project."
  },
  "financial-management-page.js": {
    owns: "Budgets, forecasts, actuals, cost lines, categories and budget approval requests.",
    change: "Approval requests go through the financial workflow RPC; the entries are a child collection.",
    gotcha:
      "financials.viewRag and financials.viewDetail are different permissions. A team member sees the colour and not the numbers."
  },
  "programme-page.js": {
    owns: "Programmes, their projects, and programme-level milestones and RAID.",
    change: "Programme child collections are keyed by scope_key holding a programme code.",
    gotcha: "Programme membership is reconciled by ppm-governance-utils.js; do not set it in two places."
  },
  "resource-directory-page.js": {
    owns: "People: profiles, teams, capacity, and the access controls for those who sign in.",
    change:
      "The access block is where roles, additional roles, scope and overrides are set. syncResourceReferences() denormalises names into projects, plans and RAID.",
    gotcha:
      "Changing a person's name updates denormalised copies elsewhere, matched on legacy_resource_id. That is why the id must never change."
  },
  "resource-management-page.js": {
    global: "PPMResourceGantt",
    owns: "The allocation timeline: day to year zoom, one block per person, an assignment per line, spare capacity, merged over-allocation runs, the hover card and editing an allocation.",
    change:
      "ZOOM_CONFIG at the top defines the levels and column widths; every button in the markup must have an entry and the reverse. resourceBlock() writes the person once and stacks the lines beside it. The daily arithmetic - allocationOnDay(), overAllocationRuns(), availabilityRuns() - works a day at a time whatever the zoom, because 'is this person over-committed' is a daily question and the columns are only how it is drawn.",
    gotcha:
      "Nothing here is stored. Every bar is derived on each render from a project-plan task with an owner and dates, which is why editing an allocation writes to the PLAN and needs plan.edit rather than resourceManagement.edit. Durations come from PPMPlanning.workingDaysBetween - a local copy was written here once and deleted, because two definitions of a working day is how this view starts disagreeing with the capacity tab."
  },
  "reports-page.js": {
    owns: "Reports, dashboards, saved views, drill-downs and CSV export.",
    change: "One builder per report block; saved views are a child collection with an owner.",
    gotcha:
      "The largest page script in the tool. Publishing a saved view needs views.publish; a personal view is only ever the owner's."
  },
  "search-page.js": {
    owns: "Global search across collections, with saved searches and recent history.",
    change: "The list of searched collections is the thing to extend.",
    gotcha: "Results are scoped by the same filter as everything else, so two people see different results."
  },
  "audit-history-page.js": {
    owns: "The change record, from all three sources, with provenance on every row.",
    change: "Filters and the row renderer. The sources come from PPMAudit.readAll().",
    gotcha: "It can offer to clear unverified browser residue, but only after archiving it to a file first."
  },
  "administration-page.js": {
    owns: "Configuration: lifecycle templates, mandatory rules, reference data, calendars, periods, RAG thresholds.",
    change: "Each block is one configuration store from ppm-admin-utils.js.",
    gotcha:
      "Everything here goes through PPMStore like every other save. It is also the page that breaks first if window.PPMAdmin fails to load, because every panel on it reads a getter from that global."
  }
};

/* --------------------------------------------------------------- the recipes */

const CHANGE_MAP = [
  {
    title: "Add a field to the project record",
    steps: [
      ["add-project.html", "Add the field markup inside the right <section>, with a <label for>."],
      ["BUILD-PROJECT-FIELDS.mjs", "Add its id to a group in GROUPS, choosing which of the three editors it belongs to."],
      ["node BUILD-PROJECT-FIELDS.mjs", "Regenerate ppm-project-fields.js."],
      ["add-project-page.js", "Read and write it in projectFromForm and loadProjectForEditing, if creation needs it."],
      ["project-details.html", "Add a read-only line for it if it should show on the details page."],
      ["node VERIFY-ALL.mjs", "The generator refuses if no group claims the field; the harness proves coverage."]
    ],
    note:
      "The field is stored inside legacy_payload automatically. Normalise it into a typed column only if something needs to query or sort by it - see the next recipe."
  },
  {
    title: "Normalise a field into a typed database column",
    steps: [
      ["a new STAGE-*.sql", "alter table ... add column if not exists, and backfill from legacy_payload."],
      ["ppm-database.js or ppm-child-database.js", "Map the column in the record mapper, and write it in the toColumns writer."],
      ["SCHEMA-MANIFEST.json", "Regenerate - the query to do it is in the header of SCHEMA-DRIFT-CHECK.mjs."],
      ["node VERIFY-ALL.mjs", "Schema drift fails until the manifest, the adapter and the migration all agree."]
    ],
    note:
      "Normalised columns win over legacy_payload where they are not null. null means 'not normalised, keep the legacy value'; an empty string is a real value."
  },
  {
    title: "Add a permission",
    steps: [
      ["ppm-auth-utils.js", "Add the key to ALL_PERMISSIONS and to each role in ROLE_DEFINITIONS that should hold it."],
      ["a new STAGE-*.sql", "Insert it into private.permissions, and into private.role_permissions for each role."],
      ["BUILD-SPEC-USER.mjs", "Add a plain-language line to PERMISSION_MEANING and put the key in a PERMISSION_GROUPS group."],
      ["the pages", "Tag the controls it governs with data-permission, or PPMAuth will disable them for everybody."],
      ["node VERIFY-ALL.mjs", "Then regenerate both specifications."]
    ],
    note:
      "The browser and the database each keep their own copy of the role model, and both are used. If they disagree the database wins and the user gets a button that fails."
  },
  {
    title: "Give somebody permissions their role does not include",
    steps: [
      ["Resources page", "First ask whether they simply do two jobs. If so, add the second role - permissions are the union."],
      ["Resources page", "If it is a genuine one-off, set a permission override on that person: allow or deny, one key."],
      ["nothing else", "Both are honoured identically by the browser and by private.person_has_permission in the database."]
    ],
    note:
      "Prefer a role. An override is invisible six months later; a role explains itself. Nobody can change their own roles or overrides, including a System Administrator."
  },
  {
    title: "Add a notification",
    steps: [
      ["ppm-notifications.js", "Add a builder in the same pass as the others, guarded by the permission that governs seeing that kind of record at all."],
      ["the same builder", "Test a named person - assignedTo(record, 'owner', user) or an approver id. A permission test alone tells everybody about one person's work."],
      ["the same builder", "If they can be named but unable to act, add blockedNote() to the meta line rather than staying silent."],
      ["stableId([...])", "Give it a stable id from the fields that identify the record, so 'read' survives a refresh."]
    ],
    note: "Categories drive grouping and severity drives ordering; both are read by home-page.js as they are."
  },
  {
    title: "Add a collection",
    steps: [
      ["a new STAGE-*.sql", "Create the table with its key shape, RLS enabled, a restrictive AAL2 policy, and an audit trigger."],
      ["ppm-child-database.js", "Add a MODULES entry: localKey, table, idField, shape, and scopeColumn if it is not project_code."],
      ["ppm-database.js", "Add the table to AUDIT_ENTITY with its display name."],
      ["ppm-change-log.js", "Add that same display name to LOCATIONS, or its history has nowhere to link to."],
      ["SCHEMA-MANIFEST.json", "Regenerate."],
      ["STAGE-14-HARNESS.mjs", "Extend it rather than replacing it."]
    ],
    note:
      "An empty table with the wrong shape reports IDENTICAL, because compare() only diffs records present on both sides. Check the columns explicitly."
  },
  {
    title: "Add a page",
    steps: [
      ["the new .html", "Copy an existing page's head exactly: CSP, the pinned client, then the six shared scripts in order."],
      ["the same file", 'Add class="ppm-loading" to <html> and load ppm-page-loader.js, with the page scripts in data-ppm-scripts.'],
      ["ppm-auth-utils.js", "Add the page to the page-access list and, if it edits anything, to PAGE_EDIT_RULES."],
      ["node VERIFY-ALL.mjs", "Load order, cache-busts, CSP and the loading state are all asserted per page."]
    ],
    note:
      "A page that carries the loading class but does not load the page loader stays blank for ever. The gate checks that pairing in both directions."
  },
  {
    title: "Change a workflow rule (stage gate, baseline, budget, resource scenario)",
    steps: [
      ["the live function", "Read it first with pg_get_functiondef - the file and the database have disagreed before."],
      ["a new STAGE-*.sql", "Recreate the RPC, or patch its definition textually if the change is one line in 35,000 characters."],
      ["the matching *-utils.js", "Mirror the rule in the browser so the screen offers only what the database will accept."],
      ["a STAGE-*-VERIFY.sql", "Prove the rule, and prove what you did not intend to change is unchanged."],
      ["get_advisors", "Five authenticated_security_definer_function_executable warnings are expected. Anything else is new."]
    ],
    note:
      "These four are single PostgreSQL transactions on purpose: they cannot be half-applied, and they cannot be bypassed by writing to the tables directly."
  },
  {
    title: "Diagnose 'the page is empty'",
    steps: [
      ["the browser console", "await PPMDatabase.explain() - almost every report is one of its first three lines: no client, not signed in, or not yet at aal2."],
      ["the console", "PPMDatabase.pendingWrites() for unsaved changes blocking a refresh."],
      ["the console", "await PPMChildDatabase.selfTest() to exercise every child collection."]
    ],
    note:
      "Below aal2 every table returns zero rows with no error. That is indistinguishable from having no data, which is why hydration now refuses rather than believing it."
  },
  {
    title: "Diagnose 'the button does nothing'",
    steps: [
      ["the page", "Look for a red message at the top - handlers report their failures rather than dying silently."],
      ["the console", "PPMProjectForms.explain() on the project details page prints every trigger and whether it is bound or disabled."],
      ["the console", "A script that failed to load names itself, and the rest of the page loads anyway."]
    ],
    note:
      "A control with no data-permission is disabled by PPMAuth, on purpose. That is the most common cause of a dead control that looks correctly written."
  },
  {
    title: "Release",
    steps: [
      ["node VERIFY-ALL.mjs", "Five gates. Each corresponds to a bug that has already happened here."],
      ["bump-version.cmd", "Bumps VERSION and every cache-bust together, by running BUMP-VERSION.mjs. The gate fails if they disagree, or if any reference is unstamped."],
      ["node BUILD-SPEC-USER.mjs && node BUILD-SPEC-DEVELOPER.mjs", "Regenerate both documents."],
      ["VERIFY-INVARIANTS.sql", "In the SQL editor, if anything touched the database."],
      ["GitHub Desktop", "Commit and push. Pages redeploys on its own."]
    ],
    note: "A gate that has never failed is not known to work; it is only known to be quiet. Break it once deliberately."
  }
];

/* ------------------------------------------------------------------ rendering */

export function moduleReference() {
  const described = describeScripts();
  const shared = described.filter((entry) => entry.file.startsWith("ppm-"));
  const pageScripts = described.filter((entry) => !entry.file.startsWith("ppm-"));

  const block = (entry) => {
    const note = entry.note;
    const api = entry.api.length
      ? `<div class="module-api"><b>Exposes</b> <code>${esc(entry.global)}</code>: ${entry.api
          .map((name) => `<code>${esc(name)}</code>`)
          .join(", ")}</div>`
      : entry.global
        ? `<div class="module-api"><b>Exposes</b> <code>${esc(entry.global)}</code></div>`
        : "";
    const pages =
      entry.pages.length === 0
        ? "loaded on demand"
        : entry.pages.length > 12
          ? `every page (${entry.pages.length})`
          : entry.pages.map((page) => esc(page)).join(", ");

    return (
      `<div class="module">` +
      `<h4><code>${esc(entry.file)}</code> <span class="module-size">${entry.lines} lines</span></h4>` +
      (note
        ? `<p class="module-owns">${esc(note.owns)}</p>` +
          api +
          `<dl class="module-detail">` +
          `<dt>Where to change it</dt><dd>${esc(note.change)}</dd>` +
          `<dt>What will catch you out</dt><dd>${esc(note.gotcha)}</dd>` +
          `<dt>Loaded by</dt><dd>${pages}</dd>` +
          `</dl>`
        : `<p class="module-owns undocumented">Undocumented. Add an entry to NOTES in BUILD-SPEC-MODULES.mjs.</p>`) +
      `</div>`
    );
  };

  return (
    `<p>` +
    `Every script in the folder: what it owns, what it puts on the window, where to go inside it, ` +
    `and the thing that has already caught somebody. The line counts, the exposed names and the ` +
    `pages that load each file are read from the source when this document is built, so they ` +
    `cannot drift; the prose is written by hand, because none of it can be derived.` +
    `</p>` +
    `<h3>Shared modules <span class="module-size">${shared.length}</span></h3>` +
    `<p>Loaded by many pages. Anything here is a decision made once for the whole tool.</p>` +
    shared.map(block).join("") +
    `<h3>Page scripts <span class="module-size">${pageScripts.length}</span></h3>` +
    `<p>One per page, and only that page loads it. A change confined to one screen belongs here.</p>` +
    pageScripts.map(block).join("")
  );
}

export function changeMap() {
  return (
    `<p>` +
    `The changes people actually make, in the order the files need touching. Every step names a ` +
    `file or a command, because "add a field" touching four files in a particular order is ` +
    `exactly the knowledge that is otherwise only in somebody's head.` +
    `</p>` +
    CHANGE_MAP.map(
      (recipe) =>
        `<div class="recipe">` +
        `<h4>${esc(recipe.title)}</h4>` +
        `<ol class="recipe-steps">` +
        recipe.steps
          .map(([where, what]) => `<li><code>${esc(where)}</code><span>${esc(what)}</span></li>`)
          .join("") +
        `</ol>` +
        `<p class="recipe-note">${esc(recipe.note)}</p>` +
        `</div>`
    ).join("")
  );
}

/* For VERIFY-STATIC.mjs: every script must be documented. */
export function undocumentedScripts() {
  return scriptFiles().filter((file) => !NOTES[file]);
}
