/*
  Portfolio Manager - Stage 14 behavioural harness

  Replaces STAGE-11E-12-HARNESS.mjs, which tested the migration machinery this
  stage removed. Roughly half of that harness asserted things like "cutover
  refuses at imperfect parity" and "the source flag records LOCAL rather than
  deleting the key" - all true statements about code that no longer exists.

  What this checks instead:

    1. The retirement actually happened. A retired function that is merely
       undocumented is still a way to point the application at stale browser data,
       so absence is asserted rather than assumed.
    2. The behaviours that survived still work: append-only status history,
       optimistic locking, the mapping round trip, both write-through seams, and
       the workflow module groupings.
    3. The safety properties that depended on retired code still hold. The most
       important is databaseBackedKeys(): it used to ask for a per-collection
       source flag, and if that had been left to return an empty set, restore would
       have silently overwritten live database data. That is tested explicitly,
       because it is the one regression in this cleanup that would have destroyed
       data rather than merely thrown.

  Node only. Never touches the real Supabase project.

    node STAGE-14-HARNESS.mjs

  Exits non-zero on any failure, so it is safe as a release gate.
*/
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
const SECTION_COUNT = (
  fs.readFileSync(path.join(here, "STAGE-14-HARNESS.mjs"), "utf8").match(/^\/\* -+ \d+\./gm) || []
).length;

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail: condition ? "" : detail || "" });
  if (!condition) failures += 1;
}

/* ------------------------------------------------------------------- mocks */

class MockStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(String(k)) ? this.map.get(String(k)) : null;
  }
  setItem(k, v) {
    this.map.set(String(k), String(v));
  }
  removeItem(k) {
    this.map.delete(String(k));
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

/* The prototype seam both adapters patch, exactly as a browser exposes it. */
const StorageProto = {
  getItem: MockStorage.prototype.getItem,
  setItem: MockStorage.prototype.setItem
};
MockStorage.prototype.getItem = function (k) {
  return StorageProto.getItem.call(this, k);
};
MockStorage.prototype.setItem = function (k, v) {
  return StorageProto.setItem.call(this, k, v);
};

const localStorage = new MockStorage();

/* A Supabase stand-in that records what it was asked to do, so a test can assert
   on the attempt and not only on the outcome. */
const db = { rows: [], statements: [] };
let updateResult = { data: null, error: { code: "42501", message: "permission denied" } };

function makeQuery(table) {
  const q = {
    _filters: {},
    _result: table === "projects" ? { data: { id: "project-uuid-1" }, error: null } : { data: null, error: null },
    select() {
      return q;
    },
    order() {
      return q;
    },
    is() {
      return q;
    },
    eq(col, val) {
      q._filters[col] = val;
      return q;
    },
    insert(columns) {
      db.statements.push({ op: "insert", table, columns });
      const row = {
        id: `uuid-${db.rows.length + 1}`,
        project_code: columns.project_code,
        scope_key: columns.scope_key,
        record_key: columns.record_key,
        legacy_payload: columns.legacy_payload,
        recorded_at: columns.recorded_at,
        recorded_by: columns.recorded_by,
        dimensions: columns.dimensions,
        version: 1,
        deleted_at: null
      };
      db.rows.push(row);
      q._result = { data: row, error: null };
      return q;
    },
    update(columns) {
      q._statement = { op: "update", table, columns, filters: null };
      db.statements.push(q._statement);
      q._result = updateResult;
      return q;
    },
    _finish() {
      if (q._statement) q._statement.filters = { ...q._filters };
      return q._result;
    },
    single() {
      return Promise.resolve(q._finish());
    },
    maybeSingle() {
      return Promise.resolve(q._finish());
    },
    then(resolve) {
      return Promise.resolve({ data: db.rows.slice(), error: null }).then(resolve);
    }
  };
  return q;
}

/* Mutable so a test can put the session below aal2 and back again. Section 18 needs
   both, because a guard that refuses everything passes a refusal test for the wrong
   reason. */
let currentAssuranceLevel = "aal2";

const supabase = {
  from(table) {
    return makeQuery(table);
  },
  auth: {
    getSession: async () => ({ data: { session: { access_token: "x" } }, error: null }),
    mfa: {
      getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: currentAssuranceLevel } })
    }
  },
  rpc: async () => ({ data: true, error: null })
};

const quietConsole = {
  ...console,
  info() {},
  log() {},
  warn() {},
  error() {},
  group() {},
  groupEnd() {},
  table() {}
};

const sandbox = {
  console: quietConsole,
  Storage: { prototype: StorageProto },
  localStorage,
  setTimeout,
  clearTimeout,
  Promise,
  JSON,
  Math,
  Date,
  Number,
  String,
  Object,
  Array,
  Boolean,
  Set,
  Map,
  Error,
  isNaN,
  encodeURIComponent,
  crypto: { randomUUID: () => "r-" + Math.random().toString(16).slice(2) },
  location: { pathname: "/administration.html", search: "" },
  document: {
    readyState: "complete",
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, click() {}, appendChild() {}, addEventListener() {}, setAttribute() {}, remove() {}, querySelector: () => null }),
    head: { appendChild() {} },
    body: { appendChild() {} },
    addEventListener() {}
  },
  URL: { createObjectURL: () => "blob:mock", revokeObjectURL() {} },
  Blob: class { constructor() {} }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.PPMSupabase = supabase;
/*
  PPMCore is loaded for real rather than stubbed.

  It used to be a three-function mock: parseJson, todayIso, numeric. Anything reaching for one
  of the other ten helpers threw "clone is not a function", so no test could load
  ppm-admin-utils.js at all - and a defect in one of its getters was therefore invisible to this
  harness. One duly shipped: a brace-less `if` whose body was replaced by a comment swallowed the
  return statement below it, and getMandatoryRules() returned undefined for every populated
  portfolio. The project list and the lifecycle readiness section both broke.

  A stub that is missing what the code under test needs does not fail honestly - it fails as
  "cannot test this", which reads as "nothing to test here". The real module has no dependencies
  beyond document and window, both of which this sandbox provides.
*/
/* Loaded below with the other modules - the sandbox is not a vm context until createContext. */

/*
  What the loaded modules need from PPMAuth, and nothing more.

  This stub used to carry rawRead, rawSet, readGlobal and writeGlobal, with a note about
  capturing the original setter before the adapters patched Storage.prototype so that a
  writeGlobal did not reach the write-through twice. Every one of those functions has been
  deleted from ppm-auth-utils.js, and neither adapter calls PPMAuth for storage at all now -
  they hand their collections to PPMStore. The stub shrinking to one function is itself the
  measure of how much coupling went.
*/
sandbox.PPMAuth = {
  getCurrentUser: () => ({ resourceId: "RES-0001", fullName: "A Tester" })
};

vm.createContext(sandbox);

/* Load order matters and mirrors the pages: data safety first so it captures the
   genuinely native Storage functions, then the adapters. */
function load(file) {
  vm.runInContext(fs.readFileSync(path.join(here, file), "utf8"), sandbox, { filename: file });
}
load("ppm-core.js");
if (typeof sandbox.PPMCore?.clone !== "function") {
  throw new Error("PPMCore did not load; the harness cannot trust anything that depends on it.");
}
load("ppm-data-safety.js");
load("ppm-audit-utils.js");
/* The load order on every page: the foundation adapter, then the child adapter, then the data
   layer. It matters. Hydration in both adapters hands its collections to PPMStore, which is
   defined by the third file - so the order is part of what is being tested, and a rig that loaded
   ppm-data.js later than the page does would prove nothing about the page.

   The sandbox models document but not window.addEventListener; a real page has both. */
sandbox.addEventListener = () => {};
load("ppm-database.js");
load("ppm-child-database.js");
load("ppm-data.js");

const A = sandbox.PPMChildDatabase;
const F = sandbox.PPMDatabase;
const Audit = sandbox.PPMAudit;
const Data = sandbox.PPMData;

/*
  Wait for boot hydration exactly as ppm-page-loader.js does before it loads any page
  script.

  This was missing, and its absence was not visible while it happened to work. Both
  adapters start hydrating the moment they load, so the assertions below were racing
  that hydration and the winner was decided by how many microtask turns the adapter
  code happened to take. Adding two awaits inside hydrate() - not changing what it
  does - was enough to reorder a snapshot against a test write and produce a spurious
  soft delete three hundred lines later.

  A test suite whose result depends on the await count of the code under test is not
  measuring that code. The page loader waits; the harness must wait the same way.
*/
await Promise.allSettled([F?.ready, A?.ready].filter(Boolean));

/* ------------------------------------------------------------- 1. retirement

   Absence is the assertion. A retired switch that still exists is still a way to
   run the application against stale browser data.
*/
const RETIRED_CHILD_API = [
  "sourceFor",
  "setSource",
  "sources",
  "cutOver",
  "cutOverBatch",
  "revertToLocal",
  "revertBatch",
  "fastCutOver",
  "seed",
  "seedAll",
  "seedBatch",
  "seedStage12Defaults",
  "compareBatch",
  "flushBatch",
  "preview",
  "cutOverStage11A",
  "cutOverStage11B",
  "cutOverStage11C",
  "cutOverStage11D",
  "cutOverStage11E",
  "cutOverStage12",
  "stage11AReady",
  "stage12Ready",
  "stage12ServerReady",
  "LOCAL",
  "STAGE_10C_BATCH",
  "STAGE_11A_BATCH",
  "STAGE_12_BATCH",
  "DEFERRED_WORKFLOW_MODULES"
];
RETIRED_CHILD_API.forEach((name) => {
  check(`child adapter no longer exposes ${name}`, A[name] === undefined, typeof A[name]);
});

const RETIRED_AUDIT_API = ["record", "recordMany", "compareAndRecord", "diff", "importLegacyToDatabase"];
RETIRED_AUDIT_API.forEach((name) => {
  check(`PPMAudit no longer exposes ${name}`, Audit[name] === undefined, typeof Audit[name]);
});

/* The source flag key must not be written at all any more. */
check(
  "no child source flag is persisted",
  localStorage.getItem("ppmChildDatabaseSources") === null,
  String(localStorage.getItem("ppmChildDatabaseSources"))
);

/* ------------------------------------------------------- 2. surviving surface */

const KEPT_CHILD_API = [
  "get",
  "queryRows",
  "hydrate",
  "hydrateModule",
  "compare",
  "compareAll",
  "selfTest",
  "status",
  "explain",
  "validateLocal",
  "flattenLocal",
  "pendingWrites",
  "clearPending",
  "commitStageGateWorkflow",
  "commitBaselineWorkflow",
  "commitFinancialWorkflow",
  "commitResourceScenarioWorkflow",
  "versionSnapshot",
  "resourceDemandVersionSnapshot",
  "assuranceLevel"
];
KEPT_CHILD_API.forEach((name) => {
  check(`child adapter still exposes ${name}`, typeof A[name] === "function", typeof A[name]);
});

const KEPT_AUDIT_API = ["read", "readVerified", "readImported", "readLocal", "readAll", "sourceCounts", "serialise", "humanise", "forProject"];
KEPT_AUDIT_API.forEach((name) => {
  check(`PPMAudit still exposes ${name}`, typeof Audit[name] === "function", typeof Audit[name]);
});
check("PPMAudit keeps its provenance tags", Audit.VERIFIED === "verified" && Audit.IMPORTED === "imported" && Audit.LOCAL === "local");

/* --------------------------------------------------- 3. collection registry */

check("32 collections are registered", Object.keys(A.MODULES).length === 32, String(Object.keys(A.MODULES).length));
check("the database owns 31 of them", A.DATABASE_MODULES.size === 31, String(A.DATABASE_MODULES.size));
check("legacyAudit is the only read-only collection", JSON.stringify(A.READ_ONLY_MODULES) === JSON.stringify(["legacyAudit"]), JSON.stringify(A.READ_ONLY_MODULES));
check("legacyAudit is not database-owned", A.DATABASE_MODULES.has("legacyAudit") === false);
check("ragHistory is the only append-only collection", A.APPEND_ONLY_MODULES.size === 1 && A.APPEND_ONLY_MODULES.has("ragHistory"));

/* Workflow groupings survived the rename and still describe real transactions. */
check("stage-gate workflow spans actions, decisions and stageGates",
  JSON.stringify(A.STAGE_GATE_WORKFLOW_MODULES) === JSON.stringify(["actions", "decisions", "stageGates"]),
  JSON.stringify(A.STAGE_GATE_WORKFLOW_MODULES));
check("baseline workflow spans planBaselines and baselineRequests",
  JSON.stringify(A.BASELINE_WORKFLOW_MODULES) === JSON.stringify(["planBaselines", "baselineRequests"]));
check("financial workflow spans financials, entries and approvals",
  JSON.stringify(A.FINANCIAL_WORKFLOW_MODULES) === JSON.stringify(["financials", "financialEntries", "financialApprovals"]));
check("resource workflow spans resourceDemand and resourceScenarios",
  JSON.stringify(A.RESOURCE_WORKFLOW_MODULES) === JSON.stringify(["resourceDemand", "resourceScenarios"]));

/* Every workflow group member must be a real, database-owned collection. */
[...A.STAGE_GATE_WORKFLOW_MODULES, ...A.BASELINE_WORKFLOW_MODULES, ...A.FINANCIAL_WORKFLOW_MODULES, ...A.RESOURCE_WORKFLOW_MODULES].forEach((name) => {
  check(`workflow member ${name} is a registered database collection`, Boolean(A.MODULES[name]) && A.DATABASE_MODULES.has(name));
});

/* --------------------------------------------------------- 4. status report */

const status = A.status();
check("status reports a table for every collection", Object.values(status).every((row) => Boolean(row.table)));
check("status reports a browser mirror key for every collection", Object.values(status).every((row) => Boolean(row.browserMirrorKey)));
check("status no longer reports a migration stage", Object.values(status).every((row) => row.stage === undefined));
check("status no longer reports a source", Object.values(status).every((row) => row.source === undefined));
check("status marks ragHistory append-only", status.ragHistory.appendOnly === true);
check("status marks legacyAudit read-only", status.legacyAudit.readOnly === true);
check("status marks legacyAudit as not database-owned", status.legacyAudit.databaseOwned === false);

/* ------------------------------------------- 5. append-only status history */

const dims = (overall, override) => ({
  overall: { calculated: overall, reported: overall, override: false, justification: "" },
  schedule: {
    calculated: "Green",
    reported: override ? "Amber" : "Green",
    override: Boolean(override),
    justification: override ? "Supplier slippage" : ""
  }
});
const snap = (id, when, overall, override) => ({
  statusId: id,
  projectCode: "PRJ-00001",
  recordedAt: when,
  recordedBy: "A Tester",
  dimensions: dims(overall, override)
});

/*
  How a test sets up a starting state.

  seed() puts a collection into PPMStore exactly the way hydration does, without asking the
  database anything - so the setup is never itself the thing under test. It replaced rawWrite(),
  which wrote the localStorage mirror; there is no mirror, and a test that seeded one would now
  be asserting against a copy nothing reads.
*/
function seed(collection, store) {
  sandbox.PPMStore.adopt(collection, store);
}

/*
  Writes a business collection's old localStorage key directly. Used only to assert that doing so
  now reaches nothing at all - it was how a page saved when Storage.prototype.setItem was patched,
  and a test that still passed after the patch came back would be worthless.
*/
function writeTheOldWay(key, store) {
  localStorage.setItem(key, JSON.stringify(store));
}

db.rows.length = 0;
db.statements.length = 0;
seed("ragHistory", {});
/* Stage 16: through the one seam. It used to be written to localStorage and picked up by the
   patched setItem; that patch is gone, so the append is made the way the application makes it. */
await A.saveOne("ragHistory", snap("STATUS-1", "2026-01-10T09:00:00.000Z", "Green", false), {
  storageGroup: "PRJ-00001"
});

const inserts = db.statements.filter((s) => s.op === "insert" && s.table === "rag_history");
check("appending a status snapshot inserts one row", inserts.length === 1, JSON.stringify(db.statements));
check("the append carries the dimensions object", Boolean(inserts[0]?.columns?.dimensions?.overall));
check("the append never issues an update", db.statements.every((s) => s.op !== "update"), JSON.stringify(db.statements));

/* Editing an existing snapshot must not become an update: the table has no UPDATE
   grant, so the only honest outcome is a refusal recorded as a pending write. */
db.statements.length = 0;
const edited = snap("STATUS-1", "2026-01-10T09:00:00.000Z", "Red", false);
writeTheOldWay("ppmRagHistory", { "PRJ-00001": [edited] });
check("editing recorded history issues no update statement",
  db.statements.every((s) => s.op !== "update"),
  JSON.stringify(db.statements));

/* ------------------------------------ 6. Stage 16: there are no write-through seams

   This section used to prove that writing to localStorage reached PostgreSQL, through two
   separate patches - Storage.prototype.setItem and PPMAuth.writeGlobal. Both are deleted, and so
   are the four functions that made a localStorage write into a database write. The property
   worth asserting is the opposite one: writing to localStorage must now reach nothing, and must
   not reach the store either, because either would mean a patch had come back.

   It asserts on db.statements directly. It used to await A.flush() first, which was correct
   while a queue existed and became theatre once the write-through went - flush() returned an
   empty outcome to anyone who awaited it, so the assertion was passing on a promise that never
   had anything to wait for. The queue and flush() are gone; nothing needs waiting for.
*/
db.statements.length = 0;
seed("milestones", {});
writeTheOldWay("ppmProjectMilestones", {
  "PRJ-00001": [{ milestoneId: "MST-1", milestoneName: "Design complete", status: "Not Started" }]
});
check(
  "a localStorage write no longer reaches the database",
  db.statements.every((statement) => statement.table !== "project_milestones"),
  JSON.stringify(db.statements)
);
check(
  "and does not reach the store either",
  sandbox.PPMStore.milestones.all().length === 0,
  JSON.stringify(sandbox.PPMStore.milestones.all())
);


/* And the row-level path does what the seams used to, but on purpose and with an answer. */
db.statements.length = 0;
const seamless = await A.saveOne("milestones", {
  milestoneId: "MST-2",
  projectCode: "PRJ-00001",
  milestoneName: "Build complete"
});
check(
  "PPMStore's row-level save is what reaches the database now",
  seamless.status === "saved" && db.statements.some((statement) => statement.table === "project_milestones"),
  `${seamless.status}: ${seamless.message || ""}`
);

/* ---------------------------------------------------- 7. mapping round trip */

const record = {
  taskId: "TSK-1",
  taskName: "Write the specification",
  phase: "Discovery",
  status: "In Progress",
  percentageComplete: 40,
  criticalPath: true,
  dependencies: ["TSK-0"],
  baselineStartDate: "2026-01-05",
  notes: ""
};
seed("plans", { "PRJ-00001": [record] });
const flat = A.flattenLocal("plans");
check("flattenLocal finds the task", flat.length === 1 && flat[0].recordKey === "TSK-1", JSON.stringify(flat));
check("flattenLocal derives the project code from the container key", flat[0].projectCode === "PRJ-00001", flat[0].projectCode);
const validation = A.validateLocal("plans");
check("a well-formed plan validates", validation.valid === true, JSON.stringify(validation.invalid));

/* A record with no identifier must be reported, not silently dropped: it would
   otherwise be a row the database never receives and nobody is told about. */
seed("plans", { "PRJ-00001": [{ taskName: "Nameless" }] });
const bad = A.validateLocal("plans");
check("a task with no identifier is reported as invalid", bad.valid === false && bad.invalid.length === 1, JSON.stringify(bad));
check("the reported problem names the missing field",
  JSON.stringify(bad.invalid[0]).includes("taskId"),
  JSON.stringify(bad.invalid[0]));

/* ------------------------------------------ 8. restore safety (fail closed)

   This is the most important group in the file.

   databaseBackedKeys() used to ask each adapter for a per-collection source flag.
   Those flags are gone. Had the function been left as it was, the typeof check
   would have failed, it would have returned an empty set, and restoreAll() would
   have concluded that nothing was database-backed - overwriting live mirrored
   collections from a stale file without so much as a warning. Failing open here
   destroys data, so it is asserted directly.
*/
check("PPMData is loaded", Boolean(Data), "not loaded");
const backed = Data.databaseBackedKeys();
check("database-backed keys are non-empty", backed.size > 0, String(backed.size));
check("project plans are recognised as database-backed", backed.has("ppmProjectPlans"));
check("milestones are recognised as database-backed", backed.has("ppmProjectMilestones"));
check("configuration is recognised as database-backed", backed.has("ppmFinancialCategories"));
check("historical browser audit is NOT database-backed", backed.has("ppmAuditHistory") === false);
check("every database collection contributes a key",
  [...A.DATABASE_MODULES].every((name) => backed.has(A.MODULES[name].localKey)),
  [...A.DATABASE_MODULES].filter((name) => !backed.has(A.MODULES[name].localKey)).join(", "));

/* restoreAll must refuse a file containing database-backed collections unless
   forced, and must say so in a way a caller can test rather than parse. */
const staleBackup = {
  format: 2,
  application: "Portfolio Manager",
  createdAt: "2026-01-01T00:00:00.000Z",
  data: {
    ppmProjectPlans: JSON.stringify({ "PRJ-00001": [{ taskId: "TSK-OLD", taskName: "Stale" }] }),
    ppmAuditHistory: JSON.stringify([{ auditId: "AUD-OLD", summary: "an old browser event" }])
  }
};
const refusal = Data.restoreAll(staleBackup);
check("restoreAll refuses a backup holding database-backed data", refusal.refused === true, JSON.stringify(refusal).slice(0, 200));
check("the refusal names the database-backed keys it objected to",
  Array.isArray(refusal.databaseBacked) && refusal.databaseBacked.includes("ppmProjectPlans"),
  JSON.stringify(refusal.databaseBacked));
check("the refusal flag is a boolean, not shadowed by the key list", typeof refusal.refused === "boolean", typeof refusal.refused);

/* The browser-only path stays available, because those keys have no database copy
   and refusing them would leave no way to restore a saved view or preference. */
const split = Data.partitionBackup(staleBackup);
check("partitionBackup treats plans as database-backed", split.databaseBacked.includes("ppmProjectPlans"), JSON.stringify(split));
check("partitionBackup treats historical browser audit as restorable", split.restorable.includes("ppmAuditHistory"), JSON.stringify(split));

const localOnly = Data.restoreLocalOnly(staleBackup);
check("restoreLocalOnly restores exactly the browser-only keys", localOnly.restored === 1, JSON.stringify(localOnly));
check("restoreLocalOnly reports what it skipped", localOnly.skipped.includes("ppmProjectPlans"), JSON.stringify(localOnly.skipped));
check("the restored browser-only key is in storage",
  String(localStorage.getItem("ppmAuditHistory")).includes("AUD-OLD"),
  String(localStorage.getItem("ppmAuditHistory")));

/* The critical assertion: the stale plan must NOT have been written. If
   databaseBackedKeys() ever fails open again, this is the test that catches it. */
const plansNow = JSON.parse(localStorage.getItem("ppmProjectPlans") || "{}");
check("a stale database-backed collection is never written by restoreLocalOnly",
  JSON.stringify(plansNow).includes("TSK-OLD") === false,
  JSON.stringify(plansNow).slice(0, 160));

/* ------------------------------------------------------- 9. backup contents */

const snapshot = Data.buildBackup();
check("a backup declares its format", snapshot.format === 2, String(snapshot.format));
check("a backup declares itself a snapshot rather than a recovery artefact", snapshot.snapshotOnly === true, String(snapshot.snapshotOnly));
check("a backup lists which collections were database-backed", Array.isArray(snapshot.databaseBackedKeys) && snapshot.databaseBackedKeys.length > 0);
check("a backup excludes unsaved pending writes", Object.keys(snapshot.data).includes("ppmDatabasePending") === false);
check("a backup contains no credentials", JSON.stringify(snapshot).includes("ppmAuthCredentials") === false);

/* ------------------------------------------------- 10. pending write ledger */

A.clearPending();
check("the pending ledger starts empty", A.pendingWrites().length === 0, JSON.stringify(A.pendingWrites()));

/* A refused write must be recorded so the user can be told, rather than disappearing into a
   console warning nobody reads. Through saveOne, which is how a write is made now - the old
   version wrote localStorage and awaited flush(), and once neither did anything it was asserting
   that an empty array is an array. */
db.rows.length = 0;
db.rows.push({
  id: "uuid-ms-refused",
  project_code: "PRJ-00001",
  record_key: "MST-REF",
  legacy_payload: { milestoneId: "MST-REF", projectCode: "PRJ-00001", milestoneName: "Before" },
  version: 1,
  deleted_at: null
});
await A.hydrateModule("milestones");
db.statements.length = 0;
updateResult = { data: null, error: { code: "42501", message: "permission denied for table project_milestones" } };
const refusedSave = await A.saveOne("milestones", {
  milestoneId: "MST-REF",
  projectCode: "PRJ-00001",
  milestoneName: "After"
});
check("a refused write reports the refusal", refusedSave.status === "refused", JSON.stringify(refusedSave));
const pendingAfter = A.pendingWrites("milestones");
check("and is visible in the pending ledger",
  pendingAfter.length === 1 && pendingAfter[0].kind === "refused",
  JSON.stringify(pendingAfter));

/* And a later success takes it back out, or the ledger only ever grows and stops meaning
   "what is outstanding". */
updateResult = { data: { id: "uuid-ms-refused", version: 2 }, error: null };
const nowSaved = await A.saveOne("milestones", {
  milestoneId: "MST-REF",
  projectCode: "PRJ-00001",
  milestoneName: "After"
});
check("a later success clears the entry", nowSaved.status === "saved" && A.pendingWrites("milestones").length === 0,
  JSON.stringify(A.pendingWrites("milestones")));

check("clearPending only clears the collection it is given", (() => {
  A.clearPending();
  return A.pendingWrites().length === 0;
})());

/* ------------------------------------------------------------ 11. explain() */

check("explain returns one row per collection", (() => {
  const rows = A.explain();
  return Array.isArray(rows) && rows.length === Object.keys(A.MODULES).length;
})());

/* ------------------------------------- 12. the foundation adapter's row-level save

   This section used to probe a dormant gap: ppm-database.js patched Storage.prototype.setItem
   but not PPMAuth.writeGlobal, which deliberately used the setter captured before patching, so a
   write through that path updated the browser mirror and never reached PostgreSQL - no error, no
   pending entry, gone on the next load.

   Both halves of that are now gone: the patch, and writeGlobal itself. Probing it would mean
   calling a function the application does not have, through a stub written here, which proves
   something about this file rather than about the tool. VERIFY-STATIC.mjs carries that check
   instead - writeGlobal is on the retired-identifier list, so naming it anywhere fails the build.

   What is worth asserting is the path that replaced it.
*/
check("the foundation adapter is loaded", Boolean(F), "not loaded");
check(
  "the foundation adapter no longer wraps writeGlobal",
  sandbox.PPMAuth.__ppmFoundationWriteGlobalWrapped !== true,
  String(sandbox.PPMAuth.__ppmFoundationWriteGlobalWrapped)
);

/*
  The record carries a databaseVersion, as one loaded from the database would. That matters: a
  record with no version is deliberately refused by the optimistic lock, so using one here would
  test the lock rather than the save.
*/
db.statements.length = 0;
seed("projects", []);
const foundationSave = await F.saveRecord("projects", {
  projectCode: "PRJ-90001",
  projectName: "Seam probe",
  projectStatus: "Active",
  databaseId: "uuid-probe-1",
  databaseVersion: 1,
  version: 1
});
check(
  "the foundation adapter's row-level save reaches the database",
  db.statements.some((entry) => entry.table === "projects"),
  `${foundationSave?.status}: ${foundationSave?.message || ""}`
);

/* ------------------------------------------- 13. human labels in messages

   The conflict message is read at the exact moment somebody has lost work, so
   "This people was changed by someone else" is the worst place to look unfinished.
   Both adapters now carry an explicit label per collection.
*/
const childSource = fs.readFileSync(path.join(here, "ppm-child-database.js"), "utf8");
const foundationSource = fs.readFileSync(path.join(here, "ppm-database.js"), "utf8");

function literalAfter(src, marker, open) {
  const from = src.indexOf(open, src.indexOf(marker));
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === open) depth += 1;
    else if (src[i] === close) {
      depth -= 1;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  throw new Error("unbalanced");
}

const CHILD_LABELS = eval(`(${literalAfter(childSource, "const SINGULAR = Object.freeze(", "{")})`);
const FOUNDATION_LABELS = eval(`(${literalAfter(foundationSource, "const SINGULAR = {", "{")})`);

Object.keys(A.MODULES).forEach((name) => {
  check(`collection ${name} has a human label`, typeof CHILD_LABELS[name] === "string" && CHILD_LABELS[name].length > 0,
    String(CHILD_LABELS[name]));
});
check("no label exists for an unknown collection",
  Object.keys(CHILD_LABELS).every((name) => Boolean(A.MODULES[name])),
  Object.keys(CHILD_LABELS).filter((n) => !A.MODULES[n]).join(", "));
check("no label is left as a raw identifier",
  Object.values(CHILD_LABELS).every((label) => !/^[a-z]+[A-Z]/.test(label)),
  Object.values(CHILD_LABELS).filter((l) => /^[a-z]+[A-Z]/.test(l)).join(", "));
check("people reads as a person, not as \"people\"", FOUNDATION_LABELS.people === "Person", String(FOUNDATION_LABELS.people));
["projects", "programmes", "portfolios", "people"].forEach((name) => {
  check(`foundation collection ${name} has a human label`, typeof FOUNDATION_LABELS[name] === "string");
});

/* ------------------------------- 14. clearing unverified audit residue */

check("PPMData exposes the residue count", typeof Data.localAuditCount === "function");
check("PPMData exposes archive-and-clear", typeof Data.archiveAndClearLocalAudit === "function");

/* Residue: browser-side audit rows written before Stage 14 stopped emitting them. Genuinely a
   localStorage key with no reader, which is exactly what this feature exists to clear. */
localStorage.setItem("ppmAuditHistory", JSON.stringify([
  { auditId: "AUD-1", timestamp: "2026-01-02T09:00:00.000Z", summary: "old browser event" },
  { auditId: "AUD-2", timestamp: "2026-01-03T09:00:00.000Z", summary: "another" }
]));
check("the residue count reflects what is stored", Data.localAuditCount() === 2, String(Data.localAuditCount()));

const cleared = Data.archiveAndClearLocalAudit();
check("archive-and-clear reports what it archived", cleared.archived === 2 && cleared.cleared === true, JSON.stringify(cleared));
check("the key is emptied afterwards", Data.localAuditCount() === 0, String(Data.localAuditCount()));
check("a second call is a harmless no-op",
  (() => { const r = Data.archiveAndClearLocalAudit(); return r.archived === 0 && r.cleared === false; })());

/* ---------------------------------- 15. no inline styles are injected

   style-src no longer allows 'unsafe-inline', so a module creating a <style>
   element would be silently blocked and its component would render unstyled.
*/
["ppm-change-log.js", "ppm-data-safety.js", "ppm-resource-utils.js", "ppm-notifications.js"].forEach((file) => {
  const src = fs.readFileSync(path.join(here, file), "utf8");
  check(`${file} injects no <style> element`, !/createElement\((["'])style\1\)/.test(src));
});

/* ------------------------------- 16. key order must not look like a change

   TRAP: JSON.stringify preserves insertion order, so two records holding identical
   data compared as different whenever something rebuilt one with the keys in another
   order - which the reconciliation cascade does routinely. Every hydrated record
   looked modified, got pushed straight back, and the row version churned for nothing.
   Version churn is exactly what produces false "changed by someone else" conflicts
   once two people edit. Hence stableStringify.

   Asserted behaviourally: the same task written twice with different key order must
   produce no second write.
*/
db.statements.length = 0;
seed("plans", {});
await A.saveOne("plans", { taskId: "TSK-ORDER", taskName: "Order probe", phase: "Build", status: "In Progress" },
  { storageGroup: "PRJ-00001" });
const firstWriteCount = db.statements.length;
check("the first write of a task reaches the database", firstWriteCount > 0, String(firstWriteCount));

/* Same data, keys in a different order - the payload comparison must see no change. */
db.statements.length = 0;
await A.saveOne("plans", { status: "In Progress", phase: "Build", taskName: "Order probe", taskId: "TSK-ORDER" },
  { storageGroup: "PRJ-00001" });
check("re-writing the same record with keys reordered produces no write",
  db.statements.length === 0,
  `${db.statements.length} statement(s): ${JSON.stringify(db.statements).slice(0, 200)}`);

/* And a genuine change must still be detected, or the comparison is simply broken. */
db.statements.length = 0;
await A.saveOne("plans", { taskId: "TSK-ORDER", taskName: "Order probe", phase: "Build", status: "Complete" },
  { storageGroup: "PRJ-00001" });
check("a genuine change is still detected", db.statements.length > 0, String(db.statements.length));

/* ------------------------- 17. a return field must not be shadowed by a spread

   TRAP: restoreAll() returned { refused: true, ...split } where split.refused was an
   array of keys. The spread overwrote the boolean with an array, so the caller's
   `if (result.refused)` was truthy either way and the bug was invisible. The harness
   caught it; this keeps it caught.

   Checked structurally across every result object the safety API returns, because the
   class of mistake is "a name means two things", not "this one field".
*/
const shapes = [
  ["restoreAll refusal", Data.restoreAll({
    format: 2, application: "Portfolio Manager", createdAt: "2026-01-01T00:00:00.000Z",
    data: { ppmProjectPlans: JSON.stringify({}) }
  })],
  ["partitionBackup", Data.partitionBackup({
    format: 2, application: "Portfolio Manager", createdAt: "2026-01-01T00:00:00.000Z",
    data: { ppmProjectPlans: JSON.stringify({}), ppmAuditHistory: JSON.stringify([]) }
  })],
  ["archiveAndClearLocalAudit", Data.archiveAndClearLocalAudit()]
];
shapes.forEach(([label, result]) => {
  check(`${label} returns an object`, result && typeof result === "object", typeof result);
  if (!result || typeof result !== "object") return;
  Object.entries(result).forEach(([key, value]) => {
    /* A field whose name reads as a yes/no question must actually be a boolean. */
    if (/^(refused|cleared|valid|ok|identical|skipped)$/.test(key)) {
      check(
        `${label}.${key} is a boolean, not shadowed by another type`,
        typeof value === "boolean",
        `is ${Array.isArray(value) ? "an array" : typeof value}`
      );
    }
  });
});

/* ------------------- 18. below aal2, hydration must not empty the browser mirror

   TRAP, and a live one: every table carries a restrictive policy requiring aal2, so
   below aal2 a select returns zero rows and no error. Every WRITE path checked the
   assurance level; the read path checked only that a session existed. So an empty
   result was indistinguishable from "this account has no records", and hydration
   wrote [] over all 36 collections and reported success.

   The blast radius came from where the two halves live. The Supabase session is in
   sessionStorage - per tab. The mirror is in localStorage - per profile. So a single
   tab sitting between password and authenticator code emptied the data every other
   tab was displaying, then quietly refilled it on the next hydration. Reported as
   "data everywhere is missing until I go and do something first".

   Both directions are asserted. A guard that refuses at aal2 as well would pass the
   refusal half and break the application.
*/
const mirrorBefore = {
  plans: localStorage.getItem("ppmProjectPlans"),
  projects: localStorage.getItem("ppmProjects")
};

currentAssuranceLevel = "aal1";

const childBelow = await A.hydrate();
check(
  "child hydration is skipped below aal2",
  childBelow.hydrated.length === 0 && childBelow.skipped.length > 0,
  JSON.stringify({ hydrated: childBelow.hydrated.length, skipped: childBelow.skipped.length })
);
check(
  "child hydration below aal2 leaves the browser mirror untouched",
  localStorage.getItem("ppmProjectPlans") === mirrorBefore.plans,
  String(localStorage.getItem("ppmProjectPlans")).slice(0, 120)
);

const foundationBelow = await F.hydrate();
check(
  "foundation hydration is skipped below aal2",
  foundationBelow.hydrated.length === 0 && foundationBelow.skipped.length > 0,
  JSON.stringify({ hydrated: foundationBelow.hydrated.length, skipped: foundationBelow.skipped.length })
);
check(
  "foundation hydration below aal2 leaves the browser mirror untouched",
  localStorage.getItem("ppmProjects") === mirrorBefore.projects,
  String(localStorage.getItem("ppmProjects")).slice(0, 120)
);

/* A single read, to prove the refusal is reported rather than returned as no data. */
const readBelow = await F.compare("projects").catch((error) => ({ error: String(error) }));
check(
  "a read below aal2 reports a reason rather than an empty result",
  readBelow && (readBelow.ok === false || readBelow.error || readBelow.status === "failed"),
  JSON.stringify(readBelow).slice(0, 160)
);

/* The other direction: at aal2 the same call must go through, or the guard is simply
   an outage. */
currentAssuranceLevel = "aal2";
const childAtAal2 = await A.hydrate();
check(
  "child hydration proceeds again at aal2",
  childAtAal2.skipped.every((row) => row.reason !== "multi-factor verification is not complete"),
  JSON.stringify(childAtAal2.skipped).slice(0, 160)
);
const foundationAtAal2 = await F.hydrate();
check(
  "foundation hydration proceeds again at aal2",
  foundationAtAal2.skipped.every((row) => row.reason !== "multi-factor verification is not complete"),
  JSON.stringify(foundationAtAal2.skipped).slice(0, 160)
);

/* ------------------------- 19. the project field registry covers every field

   The project details page edits a project in three forms rendered from
   ppm-project-fields.js. The registry is derived from the field markup in add-project.html
   by BUILD-PROJECT-FIELDS.mjs, and the thing to be certain of is coverage: a field that
   exists on a new project but appears in no form is one nobody can ever edit again, and
   nothing would say so.

   The renderer itself is not exercised here - it is DOM work, and a stub DOM would only be
   testing the stub. What is asserted is the data it renders from, which is where a mistake
   would be silent.
*/
{
  const registrySource = fs.readFileSync(path.join(here, "ppm-project-fields.js"), "utf8");
  const box = { window: {} };
  vm.createContext(box);
  vm.runInContext(registrySource, box, { filename: "ppm-project-fields.js" });
  const forms = box.window.PPMProjectFields?.forms;

  check("the field registry loads and defines three forms", Boolean(forms) && Object.keys(forms).length === 3, JSON.stringify(forms && Object.keys(forms)));

  const fields = forms ? Object.values(forms).flatMap((form) => form.groups.flatMap((group) => group.fields)) : [];
  const ids = fields.map((field) => field.id);

  /* Coverage, against the markup rather than against a number someone typed. */
  const addProject = fs.readFileSync(path.join(here, "add-project.html"), "utf8");
  const formHtml = addProject.slice(addProject.indexOf('<form id="projectForm"'), addProject.indexOf("</form>"));
  const inMarkup = [...formHtml.matchAll(/<(?:input|select|textarea)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);

  const uncovered = inMarkup.filter((id) => !ids.includes(id));
  check(
    "every field in the creation form appears in a form on the details page",
    uncovered.length === 0,
    uncovered.join(", ")
  );

  const unknown = ids.filter((id) => !inMarkup.includes(id));
  check("the registry invents no field the creation form does not have", unknown.length === 0, unknown.join(", "));

  const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
  check(
    "no field appears in more than one form",
    duplicated.length === 0,
    `a field in two forms would be saved twice, and the second save would overwrite the first: ${duplicated.join(", ")}`
  );

  /* The split the design depends on. */
  const count = (name) => (forms[name] ? forms[name].groups.reduce((sum, group) => sum + group.fields.length, 0) : 0);
  check("the details form holds the descriptive fields", count("details") === 43, String(count("details")));
  check("the status form holds the reporting fields", count("status") === 32, String(count("status")));
  check("the assurance form holds the stage evidence", count("assurance") === 38, String(count("assurance")));

  /* The status form is what a weekly update uses, so the fields it needs must be in it. */
  const statusIds = forms.status.groups.flatMap((group) => group.fields.map((field) => field.id));
  ["projectStatus", "currentStage", "percentageComplete", "overallRag", "currentPosition", "nextSteps",
   "forecastEndDate", "deliveryConfidence"].forEach((id) => {
    check(`the status form includes ${id}`, statusIds.includes(id));
  });

  /* And must NOT contain the descriptive fields, or editing a status rewrites the project. */
  ["projectName", "description", "sponsor", "businessProblem"].forEach((id) => {
    check(`the status form leaves ${id} alone`, !statusIds.includes(id));
  });

  /*
    No heading may read like a variable name.

    61 of 113 did. The label lookup wanted a literal `</label>` and the markup is formatted
    `</label\n>` on its own line, so two thirds of the fields silently fell back to their id
    and "proposedStartDate" appeared on screen as a heading. A word containing an internal
    capital is the signature of that failure, and it cannot occur in a formatted heading.
  */
  const rawLooking = fields.filter((field) =>
    String(field.label)
      .split(/\s+/)
      .some((word) => /[a-z][A-Z]/.test(word))
  );
  check(
    "no heading is a raw field id",
    rawLooking.length === 0,
    rawLooking.map((f) => `${f.id} -> "${f.label}"`).join(", ")
  );
  /*
    And no heading may have swallowed the next one.

    The other half of the same fault: read across the whole document, a non-greedy match for
    `</label>` runs past the intended closing tag - which is written `</label\n>` - and keeps
    going until it finds a literal one, taking every label in between with it. That produced
    "Proposed start date Current stage gate Next stage-gate date" as a single heading. It is
    not a raw id, so the check above does not see it; length is what gives it away. The
    longest legitimate heading here is five words.
  */
  const overlong = fields.filter((field) => String(field.label).split(/\s+/).length > 8);
  check(
    "no heading has swallowed the fields after it",
    overlong.length === 0,
    overlong.map((f) => `${f.id} -> "${String(f.label).slice(0, 60)}..."`).join("; ")
  );

  const lowerStart = fields.filter((field) => /^[a-z]/.test(String(field.label)));
  check(
    "every heading starts with a capital",
    lowerStart.length === 0,
    lowerStart.map((f) => `${f.id} -> "${f.label}"`).join(", ")
  );
  /* The two that read wrongly if merely capitalised. */
  const overallRag = fields.find((field) => field.id === "overallRag");
  check("acronyms stay acronyms in a heading", overallRag?.label === "Overall RAG", JSON.stringify(overallRag?.label));
  const slippage = fields.find((field) => field.id === "reasonForSlippage");
  check(
    "small words stay lower case in a heading",
    slippage?.label === "Reason for Slippage",
    JSON.stringify(slippage?.label)
  );

  /* The status form is the weekly one, so what sits at the top of it is a design decision
     rather than an accident of the markup order. */
  const firstStatusGroup = forms.status.groups[0];
  check(
    "the status form opens with the commentary, phase and forecast dates",
    firstStatusGroup.fields.map((field) => field.id).join(",") ===
      "currentPosition,nextSteps,reasonForSlippage,returnToGreen,currentStage,nextStage,forecastStartDate,forecastEndDate",
    firstStatusGroup.fields.map((field) => field.id).join(",")
  );
  check(
    "and the RAG assessment comes after it, not before",
    forms.status.groups[1].fields.some((field) => field.id === "overallRag"),
    forms.status.groups[1].name
  );

  /* Every field needs enough to render: a label, a control, and options if it is a select. */
  const unlabelled = fields.filter((field) => !field.label || !field.control);
  check("every field carries a label and a control type", unlabelled.length === 0, unlabelled.map((f) => f.id).join(", "));
  const emptySelects = fields.filter((field) => field.control === "select" && !(field.options || []).length);
  check("every select carries its options", emptySelects.length === 0, emptySelects.map((f) => f.id).join(", "));

  /* The project code is generated and immutable; offered as an editable value it stops being
     either, and it is the key every child record joins on. */
  const projectCode = fields.find((field) => field.id === "projectCode");
  check("the project code is read-only wherever it appears", Boolean(projectCode?.readOnly), JSON.stringify(projectCode));
}

/* ------------------- 20. the rendered forms are permission-tagged and bound

   PPMAuth fails closed: a control that changes data and carries no data-permission is
   disabled, and reported in the console as untagged. The forms are rendered long after its
   startup pass, so every control the renderer emits has to say which permission it needs -
   otherwise the panel opens with all 43 fields disabled, which reads as "editing does not
   work" and is in fact the permission model doing its job on markup that forgot to speak.

   Rendered here with a stub host that only records the markup: the assertion is about what
   the renderer emits, so a fuller DOM would add nothing but its own bugs.
*/
{
  const box = {
    console: quietConsole,
    JSON,
    String,
    Number,
    Boolean,
    Object,
    Array,
    RegExp,
    Error,
    Math,
    Date
  };
  box.window = box;
  box.globalThis = box;
  box.PPMCore = { escapeHtml: (v) => String(v ?? ""), applyComputedStyles() {} };
  box.PPMPlanning = {
    RAG_DIMENSIONS: [["overall", "Overall health"]],
    calculateProjectRags: () => ({ overall: "Green" })
  };
  box.document = {
    getElementById: () => null,
    createElement: () => ({ dataset: {}, setAttribute() {}, append() {}, classList: { add() {}, remove() {} } }),
    querySelectorAll: () => []
  };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(here, "ppm-project-fields.js"), "utf8"), box, {
    filename: "ppm-project-fields.js"
  });
  vm.runInContext(fs.readFileSync(path.join(here, "ppm-project-forms.js"), "utf8"), box, {
    filename: "ppm-project-forms.js"
  });

  const expected = { details: "projects.edit", status: "projects.status", assurance: "projects.edit" };
  Object.entries(expected).forEach(([formName, permission]) => {
    let markup = "";
    const host = {
      dataset: {},
      set innerHTML(value) {
        markup = value;
      },
      get innerHTML() {
        return markup;
      },
      querySelector: () => null,
      querySelectorAll: () => []
    };
    box.PPMProjectForms.render(host, formName);

    const controls = (markup.match(/data-field=/g) || []).length;
    const tagged = (markup.match(/data-permission=/g) || []).length;
    check(
      `the ${formName} form renders every field`,
      controls === box.PPMProjectForms.fieldCount(formName),
      `${controls} of ${box.PPMProjectForms.fieldCount(formName)}`
    );
    check(
      `every control in the ${formName} form carries a permission`,
      controls === tagged,
      `${tagged} of ${controls} tagged - the untagged ones arrive disabled`
    );
    check(
      `the ${formName} form asks for ${permission}`,
      markup.includes(`data-permission="${permission}"`),
      markup.slice(0, 120)
    );
    /* style-src 'self' blocks style attributes wherever they are parsed, including markup
       assigned to innerHTML. */
    check(`the ${formName} form injects no style attribute`, !/\sstyle="/.test(markup));
  });

  check("the renderer offers a diagnostic", typeof box.PPMProjectForms.explain === "function");
}

/* ------------------- 21. the editors are bound before anything is rendered

   The binding used to sit seventh in loadProject()'s list of render calls, so an error in any
   of the six before it left every button on the page silently dead while the page still
   looked fine. Asserted structurally, because the failure it guards against is an ordering
   one that no unit test of either function would show.
*/
{
  const pageSource = fs.readFileSync(path.join(here, "project-details-page.js"), "utf8");
  const bindAtLoad = pageSource.lastIndexOf("\nbindEditorControls();");
  const loadAtLoad = pageSource.lastIndexOf("\nloadProject();");
  check(
    "bindEditorControls() runs at load, not only from inside loadProject()",
    bindAtLoad !== -1,
    "no top-level call found"
  );
  check(
    "and it runs before loadProject()",
    bindAtLoad !== -1 && loadAtLoad !== -1 && bindAtLoad < loadAtLoad,
    `bind at ${bindAtLoad}, load at ${loadAtLoad}`
  );
  check(
    "a click handler that throws reports it rather than dying silently",
    /catch \(error\)[\s\S]{0,200}showMessage/.test(pageSource),
    "bindOnce must wrap the handler"
  );
  check(
    "each render step is isolated, so one failure cannot disable the page",
    pageSource.includes('["links and editors", configureProjectLinks]'),
    "loadProject must render through the per-step list"
  );
}

/* -------------------- 22. every shared module loads without throwing

   The gate this section exists for, in one line of a real console:

     ppm-admin-utils.js:1537 Uncaught ReferenceError: audit is not defined

   `audit` was listed in PPMAdmin's export object and no function of that name existed in
   the file - a leftover from retiring the local audit helper. A shorthand property naming an
   undefined identifier throws while the object is being built, so window.PPMAdmin was never
   assigned and seedDefaults() never ran. It had been that way for three commits. Nobody
   noticed because most callers write `window.PPMAdmin ? ... : ...`, so the module simply
   appeared not to exist.

   Nothing static catches that: the file parses, and the reference is only evaluated at load.
   The only way to find it is to load the module. So every shared module is loaded here, in
   page order, against a DOM stub generous enough to let them all initialise, and each is
   asserted to define the global the rest of the application looks for.
*/
{
  /* Generous rather than accurate: every element lookup answers, because the question is
     "does this module initialise", not "does it find the right node". */
  const fakeElement = () => {
    const element = {
      style: { setProperty() {}, removeProperty() {} },
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      children: [],
      options: [],
      value: "",
      textContent: "",
      innerHTML: "",
      hidden: false,
      disabled: false,
      appendChild: (child) => child,
      append() {},
      prepend() {},
      insertBefore: (child) => child,
      insertAdjacentElement() {},
      removeChild() {},
      remove() {},
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {},
      getAttribute: () => null,
      removeAttribute() {},
      hasAttribute: () => false,
      focus() {},
      scrollIntoView() {},
      closest: () => null,
      matches: () => false,
      reset() {},
      querySelector: () => fakeElement(),
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 })
    };
    return element;
  };

  class StubStorage {
    constructor() {
      this.map = new Map();
    }
    getItem(k) {
      return this.map.has(String(k)) ? this.map.get(String(k)) : null;
    }
    setItem(k, v) {
      this.map.set(String(k), String(v));
    }
    removeItem(k) {
      this.map.delete(String(k));
    }
    key(i) {
      return [...this.map.keys()][i] ?? null;
    }
    get length() {
      return this.map.size;
    }
  }

  const box = {
    console: quietConsole,
    JSON,
    String,
    Number,
    Boolean,
    Object,
    Array,
    RegExp,
    Error,
    Math,
    Date,
    Set,
    Map,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000000" },
    URL: { createObjectURL: () => "blob:stub", revokeObjectURL() {} },
    Blob: class {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    CSS: { escape: (v) => String(v) },
    /* requireAuth() redirects when there is no session, which in a stub means calling
       location.replace. It has to exist, and has to do nothing. */
    location: {
      search: "?code=PRJ-00001",
      href: "https://stub/project-details.html",
      pathname: "/project-details.html",
      replace() {},
      assign() {},
      reload() {}
    },
    navigator: { userAgent: "stub" },
    addEventListener() {},
    scrollTo() {},
    matchMedia: () => ({ matches: false, addEventListener() {} })
  };
  box.window = box;
  box.globalThis = box;
  box.localStorage = new StubStorage();
  box.sessionStorage = new StubStorage();
  box.Storage = { prototype: { getItem: StubStorage.prototype.getItem, setItem: StubStorage.prototype.setItem } };
  box.document = {
    getElementById: () => fakeElement(),
    querySelector: () => fakeElement(),
    querySelectorAll: () => [],
    createElement: () => fakeElement(),
    createDocumentFragment: () => fakeElement(),
    head: fakeElement(),
    body: fakeElement(),
    documentElement: fakeElement(),
    currentScript: { src: "ppm-stub.js?v=2026.08.09.11", dataset: {} },
    addEventListener() {},
    readyState: "complete"
  };
  box.PPMSupabase = {
    from: () => ({ select: () => ({ eq: () => ({}), is: () => ({}), order: () => ({}) }) }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1" } }) }
    },
    rpc: async () => ({ data: null, error: null })
  };
  vm.createContext(box);

  /* Page order, because these modules depend on each other's globals. */
  const MODULES = [
    ["ppm-core.js", "PPMCore"],
    ["ppm-data-safety.js", "PPMData"],
    ["ppm-auth-utils.js", "PPMAuth"],
    ["ppm-database.js", "PPMDatabase"],
    ["ppm-child-database.js", "PPMChildDatabase"],
    ["ppm-resource-utils.js", "PPMResources"],
    ["ppm-admin-utils.js", "PPMAdmin"],
    ["ppm-governance-utils.js", "PPMGovernance"],
    ["ppm-planning-utils.js", "PPMPlanning"],
    ["ppm-stage-gate-utils.js", "PPMStageGates"],
    ["ppm-audit-utils.js", "PPMAudit"],
    ["ppm-change-log.js", "PPMChangeLog"],
    ["ppm-project-fields.js", "PPMProjectFields"],
    ["ppm-project-forms.js", "PPMProjectForms"]
  ];

  MODULES.forEach(([file, global]) => {
    let thrown = null;
    try {
      vm.runInContext(fs.readFileSync(path.join(here, file), "utf8"), box, { filename: file });
    } catch (error) {
      thrown = error;
    }
    check(`${file} loads without throwing`, thrown === null, thrown ? String(thrown.message) : "");
    check(
      `${file} defines ${global}`,
      Boolean(box[global]),
      thrown ? "it threw before it could" : "loaded, but the global is missing"
    );
  });
}

/* ------------- 23. the loading state, and one script failing

   Two things this file owns, tested together because they interact.

   The loading state: <html class="ppm-loading"> is in the markup, so the page is hidden from
   the first paint and there is no pop-in. That places a hard obligation on this loader - the
   class must come off on every path out, because a page stuck behind a skeleton is worse than
   an ugly one.

   And from a real console:

     ppm-project-forms.js  Failed to load resource: the server responded with a status of 503
     PPM page bootstrap failed. Error: Could not load ppm-project-forms.js

   The file was fine; GitHub Pages returned a transient 503. The loader stopped at the first
   rejection, so every script after it - including the page's own - never loaded. Now it
   retries once and carries on. Both behaviours are asserted, and the class is asserted to
   come off in the failing case as well as the succeeding one.
*/
async function runPageLoader({ failForever } = {}) {
  const attempts = [];
  const root = {
    classes: new Set(["ppm-loading"]),
    classList: {
      remove(name) {
        root.classes.delete(name);
      },
      contains: (name) => root.classes.has(name)
    }
  };
  const node = () => ({
    className: "",
    parentNode: { insertBefore() {} },
    appendChild: (child) => child,
    insertBefore: (child) => child,
    setAttribute() {},
    remove() {},
    querySelector: () => null,
    firstChild: null,
    textContent: ""
  });

  const box = {
    console: quietConsole,
    Promise,
    Error,
    String,
    Date,
    setTimeout,
    clearTimeout
  };
  box.window = box;
  box.globalThis = box;
  box.document = {
    currentScript: { dataset: { ppmScripts: "a.js?v=1|b.js?v=1|page.js?v=1" } },
    documentElement: root,
    querySelector: () => node(),
    createElement: (tag) => {
      if (tag !== "script") return node();
      const script = { async: false, handlers: {} };
      script.addEventListener = (name, handler) => {
        script.handlers[name] = handler;
      };
      Object.defineProperty(script, "src", {
        set(value) {
          attempts.push(value);
          const ok = value !== failForever;
          Promise.resolve().then(() => script.handlers[ok ? "load" : "error"]?.());
        },
        get() {
          return "";
        }
      });
      return script;
    },
    createTextNode: () => ({}),
    body: { appendChild: (n) => n }
  };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(here, "ppm-page-loader.js"), "utf8"), box, {
    filename: "ppm-page-loader.js"
  });

  const outcome = await box.PPMPageReady;
  return { attempts, outcome, stillLoading: root.classes.has("ppm-loading") };
}

{
  const clean = await runPageLoader();
  check(
    "a clean load loads every script",
    clean.outcome.loaded === 3 && clean.outcome.failed.length === 0,
    JSON.stringify(clean.outcome)
  );
  check(
    "and takes the page out of its loading state",
    clean.stillLoading === false,
    "the page would stay hidden behind the skeleton"
  );
}

{
  const broken = await runPageLoader({ failForever: "b.js?v=1" });
  check(
    "a script that cannot be loaded is retried once",
    broken.attempts.filter((src) => src === "b.js?v=1").length === 2,
    `${broken.attempts.filter((src) => src === "b.js?v=1").length} attempt(s)`
  );
  check(
    "the scripts after the failure still load",
    broken.attempts.includes("page.js?v=1"),
    JSON.stringify(broken.attempts)
  );
  check(
    "the failure is reported rather than swallowed",
    broken.outcome.failed.length === 1 && broken.outcome.failed[0] === "b.js?v=1",
    JSON.stringify(broken.outcome)
  );
  check(
    "and the page is still revealed - a hidden page is worse than a broken one",
    broken.stillLoading === false,
    "the loading class survived a failed script"
  );
}

/* ------------------- 24. the loading class has a failsafe of its own

   ppm-page-loader.js cannot remove the class if it never runs - a 503 on that one file, which
   is not hypothetical here. ppm-core.js loads in <head>, long before it, and reveals the page
   after 20 seconds if nothing else has.
*/
{
  const source = fs.readFileSync(path.join(here, "ppm-core.js"), "utf8");
  check(
    "ppm-core.js carries the loading failsafe",
    source.includes("LOADING_FAILSAFE_MS") && /classList\.remove\(LOADING_CLASS\)/.test(source),
    "nothing would reveal the page if the loader never ran"
  );
  const delay = /LOADING_FAILSAFE_MS = (\d+)/.exec(source);
  check(
    "and waits longer than the loader's own slow-load message",
    delay && Number(delay[1]) > 12000,
    delay ? `${delay[1]}ms against the loader's 12000ms` : "no delay found"
  );

  /* Only pages that load the page loader may hide themselves: something has to take the class
     back off. login.html and 404.html deliberately do not. */
  const pages = fs.readdirSync(here).filter((f) => f.endsWith(".html"));
  const wrong = pages.filter((file) => {
    const html = fs.readFileSync(path.join(here, file), "utf8");
    /* The <html> element specifically. A plain substring search also matched the developer
       guide, which documents the class in prose - the question is whether the page hides
       itself, not whether the string appears in it. */
    const hides = /<html[^>]*class="[^"]*ppm-loading/.test(html);
    const hasLoader = /<script src="ppm-page-loader\.js/.test(html);
    return hides !== hasLoader;
  });
  check(
    "every page that hides itself while loading also loads the loader that reveals it",
    wrong.length === 0,
    wrong.join(", ")
  );
}

/* -------------------- 25. more than one access role, unioned

   private.person_has_permission() in the database and basePermissions() here have to answer
   the same question the same way, because the database is the boundary that decides and the
   browser is what decides whether to offer the button. Disagreement means a button that
   fails, or an action nobody is told they can take.

   The case this exists for: an Executive is portfolio-wide and approves nothing; a Project
   Sponsor approves stage gates, baselines and budgets but sees only assigned projects. An
   executive who sponsors projects needs both, and could hold neither combination before.
*/
{
  const box = {
    console: quietConsole,
    JSON,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Set,
    Map,
    RegExp,
    Error,
    Math,
    Date,
    setTimeout,
    clearTimeout,
    encodeURIComponent,
    decodeURIComponent,
    isFinite,
    isNaN,
    parseInt,
    parseFloat,
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000000" },
    MutationObserver: class {
      observe() {}
    },
    location: { search: "", pathname: "/index.html", replace() {}, assign() {}, reload() {} },
    addEventListener() {}
  };
  box.window = box;
  box.globalThis = box;
  box.localStorage = new MockStorage();
  box.sessionStorage = new MockStorage();
  box.Storage = { prototype: { getItem: MockStorage.prototype.getItem, setItem: MockStorage.prototype.setItem } };
  box.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {}, setAttribute() {} }),
    head: { appendChild() {} },
    body: { appendChild() {} },
    documentElement: { classList: { contains: () => false, add() {}, remove() {}, toggle() {} } },
    addEventListener() {}
  };
  box.PPMSupabase = {
    from: () => ({ select: () => ({}) }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1" } }) }
    },
    rpc: async () => ({ data: null, error: null })
  };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(here, "ppm-core.js"), "utf8"), box, { filename: "ppm-core.js" });
  vm.runInContext(fs.readFileSync(path.join(here, "ppm-data-safety.js"), "utf8"), box, { filename: "ppm-data-safety.js" });
  vm.runInContext(fs.readFileSync(path.join(here, "ppm-auth-utils.js"), "utf8"), box, { filename: "ppm-auth-utils.js" });

  const Auth = box.PPMAuth;
  check("PPMAuth exposes the capability test", typeof Auth?.holdsPermission === "function");
  check("PPMAuth exposes the roles a person holds", typeof Auth?.rolesOf === "function");

  const executive = { accessRole: "Executive / Steering User", additionalRoles: [] };
  const both = {
    accessRole: "Executive / Steering User",
    additionalRoles: ["Project Sponsor / Project Lead"]
  };

  check(
    "an executive alone cannot approve a stage gate",
    Auth.holdsPermission(executive, "stageGates.approve") === false
  );
  check(
    "an executive who also holds the sponsor role can",
    Auth.holdsPermission(both, "stageGates.approve") === true,
    "this is the whole point of the change"
  );
  check(
    "and keeps what the executive role gave them",
    Auth.holdsPermission(both, "resourceManagement.view") === true,
    "the union must add without removing"
  );

  /* Every permission of either role, and nothing else. */
  const roleSet = (name) => new Set(Auth.ROLE_DEFINITIONS[name].permissions);
  const expected = new Set([
    ...roleSet("Executive / Steering User"),
    ...roleSet("Project Sponsor / Project Lead")
  ]);
  const actual = Auth.ALL_PERMISSIONS.filter((permission) => Auth.holdsPermission(both, permission));
  check(
    "the union is exactly the two roles' permissions",
    actual.length === expected.size && actual.every((permission) => expected.has(permission)),
    `${actual.length} held, ${expected.size} expected`
  );

  /* An override still wins over every role held - it is the narrower, deliberate instrument. */
  check(
    "a deny override beats a role that grants it",
    Auth.holdsPermission({ ...both, permissionOverrides: { "stageGates.approve": "deny" } }, "stageGates.approve") === false
  );
  check(
    "an allow override beats holding no role that grants it",
    Auth.holdsPermission({ ...executive, permissionOverrides: { "stageGates.approve": "allow" } }, "stageGates.approve") === true
  );

  /*
    Scope takes the widest of the roles held. The narrowest would mean adding a role could
    reduce what somebody sees, which nobody would predict from the word "additional".
  */
  check(
    "scope is the widest default among the roles held",
    Auth.effectiveScope({ accessRole: "Project Sponsor / Project Lead", additionalRoles: ["Executive / Steering User"] }) ===
      "Portfolio-wide",
    Auth.effectiveScope({ accessRole: "Project Sponsor / Project Lead", additionalRoles: ["Executive / Steering User"] })
  );
  check(
    "an explicit scope on the person still wins",
    Auth.effectiveScope({ accessRole: "Executive / Steering User", accessScope: "Selected projects", additionalRoles: [] }) ===
      "Selected projects"
  );
  check(
    "someone with no role at all is given the narrowest scope",
    Auth.effectiveScope({}) === "Selected projects"
  );
  check(
    "a role held twice is counted once",
    Auth.rolesOf({ accessRole: "Project Manager", additionalRoles: ["Project Manager", " Project Manager "] }).length === 1,
    JSON.stringify(Auth.rolesOf({ accessRole: "Project Manager", additionalRoles: ["Project Manager"] }))
  );
}

/* ---------------- 26. no capability is decided by a role's name

   Three places asked whether somebody's single access role was the exact string
   "Resource Manager / Team Manager" or "Project Team Member". That was already wrong -
   anybody who managed a team under a different role got nothing - and it breaks outright once
   a person can hold that role as one of several. A capability answers the question; a job
   title does not.
*/
{
  ["ppm-notifications.js", "ppm-auth-utils.js", "ppm-resource-management-features.js"].forEach((file) => {
    const source = fs.readFileSync(path.join(here, file), "utf8");
    const comparisons = [...source.matchAll(/accessRole\s*(?:===|!==|==|!=)\s*"/g)];
    check(
      `${file} decides nothing by comparing a role name`,
      comparisons.length === 0,
      `${comparisons.length} comparison(s) - use PPMAuth.holdsPermission() or can() instead`
    );
  });
}

/* ------------------- 27. Stage 16: the row-level write primitives

   saveOne() and removeOne() are what ppm-data.js is built on, and the reason the write-through
   patches can be deleted. Until Stage 16 finishes migrating the call sites they are reachable
   but unused, which is exactly when a defect goes unnoticed - so they are asserted now.

   Two of these tests found real bugs the first time they ran, both worth keeping:

     - a record with no identifier was saved anyway, as a row keyed "PRJ-001|". A phantom
       with no identity, which nothing could ever find or update again. flattenStore tolerates
       it because a whole-store diff survives one malformed row; a single save does not.
     - a read-only collection reported "not a database-backed collection", because read-only
       collections are deliberately absent from DATABASE_MODULES. Known-but-unwritable and
       genuinely-unknown are different answers and now give different messages.
*/
{
  const shapes = [
    ["milestones", { milestoneId: "MS-1", projectCode: "PRJ-001", name: "Gate 2" }, "object"],
    ["resourceScenarios", { scenarioId: "SC-1", name: "Peak demand" }, "array"],
    ["ragConfig", { amberDays: 5, redDays: 10 }, "singleton"]
  ];

  for (const [module, record, shape] of shapes) {
    const result = await A.saveOne(module, record);
    check(
      `saveOne identifies a ${shape}-shaped record`,
      result && result.key && result.key !== "(unidentified)",
      JSON.stringify(result)
    );
  }

  const scoped = await A.saveOne("milestones", { milestoneId: "MS-2", projectCode: "PRJ-009" });
  check("saveOne keys a project-scoped record by its project", String(scoped.key).includes("PRJ-009"), scoped.key);

  const noId = await A.saveOne("milestones", { projectCode: "PRJ-001", name: "no identifier" });
  check(
    "saveOne refuses a record with no identifier rather than inventing one",
    noId.status === "invalid",
    `${noId.status}: ${noId.message}`
  );

  const readOnly = await A.saveOne("legacyAudit", { auditId: "A-1", projectCode: "PRJ-001" });
  check(
    "saveOne refuses a read-only collection, and says why",
    readOnly.status === "refused" && /read-only/i.test(readOnly.message),
    `${readOnly.status}: ${readOnly.message}`
  );

  const unknown = await A.saveOne("notAThing", { id: 1 });
  check(
    "saveOne refuses a collection that does not exist",
    unknown.status === "failed" && /not a collection/i.test(unknown.message),
    `${unknown.status}: ${unknown.message}`
  );

  const history = await A.removeOne("ragHistory", { statusId: "RS-1", projectCode: "PRJ-001" });
  check(
    "removeOne refuses to delete append-only recorded history",
    history.status === "refused" && /append-only/i.test(history.message),
    `${history.status}: ${history.message}`
  );

  const absent = await A.removeOne("milestones", { milestoneId: "NEVER-EXISTED", projectCode: "PRJ-001" });
  check(
    "removeOne treats an already-absent record as done, not as an error",
    absent.status === "saved",
    `${absent.status}: ${absent.message}`
  );
}

/* ------------------- 28. Stage 16: PPMData, the one write seam

   The whole design is the answer a write gives back, so that is what is asserted here. Two
   properties matter more than the rest and neither is obvious from reading the file:

     - a refused write must leave the in-memory store alone. If it did not, the screen would
       show a value the database rejected, which is the exact failure this stage exists to end,
       reintroduced one layer higher up.
     - a write queued while offline and then refused must be dropped from the queue. Retrying
       it for ever would keep telling somebody their work is pending when it can never land.
*/
{
  /* PPMStore, not PPMData: ppm-data-safety.js owns window.PPMData, and this module replaced it
     silently for half a day. See section 2a of VERIFY-STATIC.mjs. */
  const D = sandbox.PPMStore;

  check("PPMStore is defined and frozen", D && Object.isFrozen(D));
  check(
    "every collection from both adapters is registered",
    D.collections().length === Object.keys(A.MODULES).length + Object.keys(F.MODULES).length,
    `${D.collections().length} registered`
  );
  check(
    "collections from both adapters are reachable by name",
    typeof D.projects?.save === "function" && typeof D.milestones?.byId === "function"
  );

  seed("milestones", { "PRJ-001": [{ milestoneId: "MS-1", projectCode: "PRJ-001", name: "Gate 2" }] });
  check("reads are synchronous and find a record", D.milestones.byId("MS-1")?.name === "Gate 2");
  check(
    "forProject filters by project",
    D.milestones.forProject("PRJ-001").length === 1 && D.milestones.forProject("PRJ-999").length === 0
  );

  const saved = await D.milestones.save({ milestoneId: "MS-9", projectCode: "PRJ-001", name: "first" });
  check("a successful save reports ok and updates the store", saved.ok === true && D.milestones.byId("MS-9") !== null);

  const noId = await D.milestones.save({ projectCode: "PRJ-001" });
  check("a record with no identifier is invalid and not queued", noId.reason === "invalid" && noId.queued === false);

  const archived = await D.projects.remove({ projectCode: "PRJ-001" });
  check(
    "foundation records are archived rather than deleted, and say so",
    archived.reason === "invalid" && /archived rather than deleted/i.test(archived.message),
    archived.message
  );

  updateResult = { data: null, error: { code: "42501", message: "permission denied for table project_milestones" } };
  const denied = await D.milestones.save({ milestoneId: "MS-9", projectCode: "PRJ-001", name: "second" });
  check("an RLS refusal becomes denied", denied.reason === "denied", JSON.stringify(denied));
  check("a denied write is not queued", denied.queued === false && D.outstanding().length === 0);
  check("a denied write leaves the store alone", D.milestones.byId("MS-9").name === "first");

  updateResult = { data: null, error: { code: "40001", message: "changed by someone else" } };
  const conflict = await D.milestones.save({ milestoneId: "MS-9", projectCode: "PRJ-001", name: "third" });
  check("a version clash becomes conflict, unqueued", conflict.reason === "conflict" && conflict.queued === false);

  updateResult = { data: null, error: { message: "TypeError: Failed to fetch" } };
  const offline = await D.milestones.save({ milestoneId: "MS-9", projectCode: "PRJ-001", name: "fourth" });
  check("a network failure becomes offline and is queued", offline.reason === "offline" && D.outstanding().length === 1);

  let told = null;
  const stop = D.onChange((list) => {
    told = list;
  });
  check("a subscriber is told what is outstanding", told?.length === 1);

  updateResult = { data: { id: "uuid-1", version: 2 }, error: null };
  const drainedOk = await D.retry();
  check("retry drains the queue once the write succeeds", drainedOk.saved === 1 && D.outstanding().length === 0);
  check("subscribers are told when it drains", told?.length === 0);
  stop();

  updateResult = { data: null, error: { message: "Failed to fetch" } };
  await D.milestones.save({ milestoneId: "MS-9", projectCode: "PRJ-001", name: "fifth" });
  updateResult = { data: null, error: { code: "42501", message: "permission denied" } };
  const dropped = await D.retry();
  check(
    "a queued write later refused is dropped and reported, not retried for ever",
    D.outstanding().length === 0 && dropped.dropped.length === 1 && dropped.dropped[0].reason === "denied",
    JSON.stringify(dropped)
  );
}

/* ------------------- 29. Stage 16: replaceAll, the collection-shaped write

   The helpers being migrated are handed a whole collection and write the lot, so replaceAll
   keeps that signature and changes what happens underneath: only records that are new or
   actually different are written, one row at a time, and records that have disappeared are
   removed. The property being asserted is the one that fixes the clobbering - an untouched
   record must not be written at all, because writing it is what let two people editing
   different projects overwrite each other.

   Note updateResult is set to success first. A soft delete is an UPDATE, and the rig's default
   for updates is permission denied - which silently turned three of these into failures the
   first time they were written.
*/
{
  const D = sandbox.PPMStore;
  updateResult = { data: { id: "uuid-1", version: 2 }, error: null };

  seed("resourceScenarios", [
    { scenarioId: "SC-1", name: "Peak" },
    { scenarioId: "SC-2", name: "Trough" },
    { scenarioId: "SC-3", name: "Flat" }
  ]);

  const changed = await D.resourceScenarios.replaceAll([
    { scenarioId: "SC-1", name: "Peak" },
    { scenarioId: "SC-2", name: "Trough revised" },
    { scenarioId: "SC-3", name: "Flat" }
  ]);
  check(
    "replaceAll writes only the record that changed",
    changed.ok && changed.saved === 1 && changed.unchanged === 2,
    JSON.stringify(changed)
  );

  const removed = await D.resourceScenarios.replaceAll([
    { scenarioId: "SC-1", name: "Peak" },
    { scenarioId: "SC-3", name: "Flat" }
  ]);
  check(
    "a record dropped from the array is removed, so deletes are not lost",
    removed.removed === 1 && D.resourceScenarios.byId("SC-2") === null,
    JSON.stringify(removed)
  );

  const added = await D.resourceScenarios.replaceAll([
    { scenarioId: "SC-1", name: "Peak" },
    { scenarioId: "SC-3", name: "Flat" },
    { scenarioId: "SC-4", name: "New" }
  ]);
  check("a new record in the array is added", added.saved === 1 && D.resourceScenarios.all().length === 3);

  const untouched = await D.resourceScenarios.replaceAll(D.resourceScenarios.all());
  check(
    "an unchanged collection writes nothing at all",
    untouched.ok && untouched.saved === 0 && untouched.removed === 0,
    JSON.stringify(untouched)
  );

  updateResult = { data: null, error: { code: "42501", message: "permission denied" } };
  const refused = await D.resourceScenarios.replaceAll([
    { scenarioId: "SC-1", name: "Peak renamed" },
    { scenarioId: "SC-3", name: "Flat" },
    { scenarioId: "SC-4", name: "New" }
  ]);
  check("one refused record makes the whole call not ok", refused.ok === false && refused.reason === "denied");
  check("and the refused value does not reach the store", D.resourceScenarios.byId("SC-1").name === "Peak");
  updateResult = { data: { id: "uuid-1", version: 2 }, error: null };
}

/* ------------------- 30. the two data globals do not collide

   ppm-data-safety.js owns window.PPMData - backup, restore, the storage warnings and the
   database-backed key list that stops a restore writing over live data. ppm-data.js owns
   window.PPMStore. They are different modules with confusingly similar names, and ppm-data.js
   loads second, so if it ever claims PPMData again it replaces the other one outright: no
   error, no warning, and every backup and restore function on the administration page simply
   stops existing.

   That happened. VERIFY-STATIC.mjs section 2a now refuses two files claiming one global, which
   catches the cause. This catches the consequence, which is the thing that actually matters -
   including databaseBackedKeys(), because a restore that cannot see which collections are
   database-backed is the one failure in this area that destroys data rather than throwing.
*/
{
  const safety = sandbox.PPMData;
  const store = sandbox.PPMStore;

  check("ppm-data-safety.js still owns window.PPMData", Boolean(safety));
  check("the two are different objects", safety !== store);
  check(
    "PPMStore is the write seam, not the backup module",
    typeof store?.save === "function" && typeof store?.replaceAll === "function"
  );

  ["buildBackup", "restoreAll", "partitionBackup", "databaseBackedKeys", "usage"].forEach((name) => {
    check(`PPMData.${name}() survived Stage 16`, typeof safety?.[name] === "function");
  });

  /* The specific regression that would destroy data: an empty set here means restore treats
     database-backed collections as restorable and writes the backup over live rows. */
  const backed = typeof safety?.databaseBackedKeys === "function" ? safety.databaseBackedKeys() : null;
  check(
    "databaseBackedKeys() still reports the protected collections",
    backed && (backed.size ?? backed.length ?? 0) > 0,
    `got ${backed && (backed.size ?? backed.length)}`
  );
}

/* ------------------- 31. Stage 17: the workflows are reachable again

   Four modules ask the adapter whether a workflow is available before using it. They asked for
   stage11AReady..stage11DReady, which Stage 14 retired; written as optional calls, a missing
   method yielded undefined, Boolean(undefined) is false, and all four workflows reported
   themselves unavailable for months. Stage gates, plan baselines, budget approvals and scenario
   publishing all fell back to writing rows the database refuses.

   Two things are asserted, because fixing only the first would leave the trap in place:

     1. every workflow reports ready, so the RPCs are reachable
     2. the readiness check is honest - remove the commit function and it must say no

   The second matters more. A probe that cannot report a problem is what caused this.
*/
{
  const WORKFLOWS = ["stageGate", "baseline", "financial", "resourceScenario"];

  check("workflowReady is exported", typeof A.workflowReady === "function");
  check("workflowStatus is exported", typeof A.workflowStatus === "function");

  WORKFLOWS.forEach((name) => {
    check(`the ${name} workflow reports ready`, A.workflowReady(name) === true);
  });

  check("an unknown workflow name reports not ready", A.workflowReady("nonsense") === false);

  const status = A.workflowStatus();
  check("workflowStatus covers all four", status.length === 4 && status.every((row) => row.ready));

  /* Honesty check: hide the commit function and the answer must change. Restored afterwards. */
  const hidden = sandbox.PPMChildDatabase.commitStageGateWorkflow;
  Object.defineProperty(sandbox.PPMChildDatabase, "commitStageGateWorkflow", {
    value: undefined,
    configurable: true,
    writable: true
  });
  check(
    "readiness reports NO when the commit function is missing",
    A.workflowReady("stageGate") === false,
    "a probe that cannot report a problem is how Stage 17 happened"
  );
  Object.defineProperty(sandbox.PPMChildDatabase, "commitStageGateWorkflow", {
    value: hidden,
    configurable: true,
    writable: true
  });
  check("and reports ready again once restored", A.workflowReady("stageGate") === true);

  /* No module may go back to asking a retired probe. */
  ["stage11AReady", "stage11BReady", "stage11CReady", "stage11DReady"].forEach((retired) => {
    const callers = fs
      .readdirSync(here)
      .filter((file) => file.endsWith(".js"))
      .filter((file) => {
        const src = fs
          .readFileSync(path.join(here, file), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        return src.includes(retired);
      });
    check(`nothing calls the retired ${retired}`, callers.length === 0, callers.join(", "));
  });
}

/* ------------------- 32. every configuration getter returns something

   getMandatoryRules() returned undefined for every populated portfolio, and shipped. The cause
   was a brace-less `if` whose body had been replaced with a comment, so the return statement
   below it silently became the body of the condition:

       if (!Array.isArray(stored) || !stored.length || versionMigrationRequired)
       /* comment where the write used to be *\/
       return clone(rows);

   Every caller filters or maps what these return, so undefined is not a quiet degradation - it
   is "Cannot read properties of undefined (reading 'filter')" on the project list and the
   lifecycle readiness section. No static check would catch it: the syntax is valid and the
   behaviour is only wrong at runtime, on the branch that is normal rather than exceptional.

   Both branches are exercised: with data present, and with the store empty.
*/
{
  /* Not loaded with the adapters: it seeds on load, which needs PPMStore to exist first. */
  load("ppm-admin-utils.js");
  const Admin = sandbox.PPMAdmin;
  check("PPMAdmin is loaded", Boolean(Admin), "ppm-admin-utils.js did not define its global");

  const GETTERS = [
    "getPortfolios",
    "getLifecycleTemplates",
    "getReferenceData",
    "getMandatoryRules",
    "getRagConfig",
    "getReportingCalendars",
    "getReportingPeriods"
  ];

  if (Admin) {
    /*
      Populate first, and populate properly.

      The first version of this section asserted the "with data" case against an empty store, so
      every getter took its seeding branch - the branch where the return statement still ran -
      and the assertion passed with the bug present. A test that cannot fail is worse than no
      test, because it is also a claim. Reintroducing the bug now produces a failure; that was
      checked rather than assumed.
    */
    seed("lifecycleRules", [
      { ruleId: "RULE-1", templateId: "LIFE-00001", templateVersion: 1, stage: "Intake", fieldId: "projectName", label: "Project name" }
    ]);
    seed("portfolios", Admin.getPortfolios());
    seed("lifecycleTemplates", Admin.getLifecycleTemplates());
    seed("referenceData", Admin.getReferenceData());
    seed("ragConfig", Admin.getRagConfig());
    seed("reportingCalendars", Admin.getReportingCalendars());
    seed("reportingPeriods", Admin.getReportingPeriods() || []);

    GETTERS.forEach((name) => {
      let value;
      let threw = "";
      try {
        value = Admin[name]();
      } catch (error) {
        threw = String(error && error.message);
      }
      check(
        `${name}() returns something with the store populated`,
        value !== undefined && value !== null,
        threw || String(value)
      );
    });

    /* And again with nothing stored, which is the other branch of every one of these. */
    ["ppmPortfolios", "ppmLifecycleTemplates", "ppmReferenceData", "ppmLifecycleMandatoryRules",
     "ppmRagConfig", "ppmReportingCalendars", "ppmReportingPeriods"].forEach((key) =>
      localStorage.removeItem(key)
    );

    GETTERS.forEach((name) => {
      let value;
      let threw = "";
      try {
        value = Admin[name]();
      } catch (error) {
        threw = String(error && error.message);
      }
      check(
        `${name}() returns something with the store empty`,
        value !== undefined && value !== null,
        threw || String(value)
      );
    });
  }
}

/* ------------------- 33. a pending write must not block hydration, whatever kind it is

   The adapters used to refuse to refresh a collection that had unsaved changes, so that a
   pending edit was not overwritten by the database copy. That reasoning depended on there
   being a local copy: the browser mirror held the edit, so refreshing would have destroyed it.

   There is no mirror. PPMStore only changes once PostgreSQL confirms, so a failed save updates
   nothing and there is nothing left to protect - while refusing to refresh now means the
   collection is simply empty, because the database copy is the only copy there is. The trade
   went from "risk overwriting an edit" to "guarantee a blank page".

   It was already the wrong trade twice over. A conflict blocked hydration until it was excused;
   then a plan baseline refused on 9 August was still blocking every refresh two days later, and
   refusals were excused as well. Each fix excused one more kind. The honest version is that the
   database always wins, and the ledger is for reporting rather than gatekeeping.
*/
{
  /* The adapters' own key. Using the wrong one made the first version of this section pass
     against an empty ledger, which is no test at all. */
  const pendingKey = "ppmDatabasePending";
  const read = () => JSON.parse(localStorage.getItem(pendingKey) || "[]");
  const write = (rows) => localStorage.setItem(pendingKey, JSON.stringify(rows));
  const before = localStorage.getItem(pendingKey);

  /* A refusal, exactly as recordProblem() writes one. */
  write([
    {
      child: true,
      module: "planBaselines",
      key: "PRJ-00008|BASELINE-probe",
      operation: "insert",
      kind: "refused",
      at: "2026-08-09T18:37:40.064Z",
      message: "You do not have permission to save Plan baseline PRJ-00008|BASELINE-probe."
    }
  ]);

  const refusedResult = await A.hydrateModule("planBaselines");
  check(
    "a refused change does not stop the collection refreshing",
    refusedResult && refusedResult.skipped !== true,
    JSON.stringify(refusedResult)
  );
  check(
    "and the refusal is kept, so it can still be reported",
    read().some((row) => row.kind === "refused"),
    JSON.stringify(read())
  );

  /* And a genuine failure does not hold it either, now that holding it would mean showing
     nothing rather than showing an edit. */
  write([
    {
      child: true,
      module: "planBaselines",
      key: "PRJ-00008|BASELINE-probe",
      operation: "insert",
      kind: "failed",
      at: "2026-08-09T18:37:40.064Z",
      message: "Failed to fetch"
    }
  ]);

  const failedResult = await A.hydrateModule("planBaselines");
  check(
    "a failed change does not stop the refresh either",
    failedResult && failedResult.skipped !== true && failedResult.ok === true,
    JSON.stringify(failedResult)
  );
  check(
    "and the failure is kept for reporting rather than acted on",
    read().some((row) => row.kind === "failed"),
    JSON.stringify(read())
  );

  if (before === null) localStorage.removeItem(pendingKey);
  else write(JSON.parse(before));
}

/* ------------------- 34. nothing crosses the store boundary by reference

   The store is only updated once PostgreSQL has confirmed the write. Hand out the live object
   and any caller can defeat that with an ordinary line of code - sort a list in place, splice a
   row out before saving, keep a reference and edit it later - and the store then disagrees with
   the database silently, which is the whole defect this stage removes, one layer up.

   The read migration puts sixty call sites on these four functions, so this is asserted before
   any of them move rather than after.
*/
{
  const D = sandbox.PPMStore;
  const name = "Gate 2";

  /* read() */
  const first = D.milestones.read();
  const second = D.milestones.read();
  check("two reads are not the same object", first !== second);
  first["PRJ-001"] = [{ milestoneId: "MS-1", projectCode: "PRJ-001", name: "vandalised" }];
  check(
    "mutating a read result does not change the store",
    D.milestones.byId("MS-1")?.name === name,
    D.milestones.byId("MS-1")?.name
  );

  /* all() */
  const list = D.milestones.all();
  check("all() returned rows", list.length > 0, String(list.length));
  list.forEach((row) => {
    row.name = "vandalised";
  });
  list.length = 0;
  check(
    "mutating rows from all() does not change the store",
    D.milestones.byId("MS-1")?.name === name && D.milestones.all().length > 0
  );

  /* byId() */
  const one = D.milestones.byId("MS-1");
  one.name = "vandalised";
  one.injected = true;
  const reread = D.milestones.byId("MS-1");
  check("mutating a byId result does not change the store", reread.name === name && reread.injected === undefined);

  /* forProject() */
  const mine = D.milestones.forProject("PRJ-001");
  mine.forEach((row) => {
    row.projectCode = "PRJ-999";
  });
  check(
    "mutating a forProject result does not change the store",
    D.milestones.forProject("PRJ-001").length === mine.length && D.milestones.forProject("PRJ-999").length === 0
  );

  /*
    And the other direction. A form that saves on every keystroke hands the same object over and
    over and edits it in between; if the store kept that object, the third keystroke would be
    visible in the store before - or instead of - the database agreeing to it.
  */
  updateResult = { data: { id: "uuid-copy", version: 2 }, error: null };
  const held = { milestoneId: "MS-COPY", projectCode: "PRJ-001", name: "as saved" };
  const savedCopy = await D.milestones.save(held);
  check("the save under test succeeded", savedCopy.ok === true, JSON.stringify(savedCopy));
  held.name = "edited afterwards";
  held.injected = true;
  const kept = D.milestones.byId("MS-COPY");
  check(
    "editing a record after saving it does not change the store",
    kept.name === "as saved" && kept.injected === undefined,
    JSON.stringify(kept)
  );

  /* A refused write must not leave the caller's object in the store either. */
  updateResult = { data: null, error: { code: "42501", message: "permission denied" } };
  const refusedRecord = { milestoneId: "MS-COPY", projectCode: "PRJ-001", name: "refused value" };
  const refusedSave = await D.milestones.save(refusedRecord);
  check(
    "a refused save leaves the confirmed value in place",
    refusedSave.ok === false && D.milestones.byId("MS-COPY").name === "as saved"
  );
}

/* ------------------- 35. replaceAll against a collection stored by project

   The one that shipped broken. Eighteen of the thirty-six collections are objects keyed by
   project code, and every migrated caller passes exactly that object - saveMilestones() rebuilds
   the whole store with one project's rows replaced and hands over the lot.

   replaceAll opened with `Array.isArray(records) ? ... : []`. An object is not an array, so
   incoming was empty, so every record already held counted as disappeared, so it soft-deleted
   the whole collection and returned ok. Saving one milestone would have emptied the portfolio's
   milestones.

   Section 29 exercises replaceAll in five ways and every one of them uses resourceScenarios,
   which is array-shaped. That is why this is a separate section against an object-shaped
   collection rather than another case added there.
*/
{
  const D = sandbox.PPMStore;
  updateResult = { data: { id: "uuid-1", version: 2 }, error: null };

  seed("benefits", {
    "PRJ-001": [
      { benefitId: "BEN-1", projectCode: "PRJ-001", name: "Cash" },
      { benefitId: "BEN-2", projectCode: "PRJ-001", name: "Time" }
    ],
    "PRJ-002": [{ benefitId: "BEN-3", projectCode: "PRJ-002", name: "Risk" }]
  });
  check("the project-keyed collection loaded", D.benefits.all().length === 3, String(D.benefits.all().length));

  /* Exactly what saveMilestones() does: take the whole store, change one project's rows. */
  const store = D.benefits.read();
  store["PRJ-001"] = [
    { benefitId: "BEN-1", projectCode: "PRJ-001", name: "Cash released" },
    { benefitId: "BEN-2", projectCode: "PRJ-001", name: "Time" }
  ];
  const edited = await D.benefits.replaceAll(store);
  check(
    "editing one row of a project-keyed collection writes one row",
    edited.ok && edited.saved === 1 && edited.unchanged === 2,
    JSON.stringify(edited)
  );
  check(
    "and removes nothing at all",
    edited.removed === 0 && D.benefits.all().length === 3,
    `${edited.removed} removed, ${D.benefits.all().length} left`
  );
  check("the edit is in the store", D.benefits.byId("BEN-1")?.name === "Cash released", D.benefits.byId("BEN-1")?.name);

  /* A row dropped from its group is removed, and only it. */
  const dropped = D.benefits.read();
  dropped["PRJ-001"] = (dropped["PRJ-001"] || []).filter((row) => row.benefitId !== "BEN-2");
  const afterDrop = await D.benefits.replaceAll(dropped);
  check(
    "a row dropped from one group is removed and the others survive",
    afterDrop.removed === 1 && D.benefits.byId("BEN-2") === null && D.benefits.all().length === 2,
    JSON.stringify(afterDrop)
  );

  /* A whole new project appears as a new key. */
  const grown = D.benefits.read();
  grown["PRJ-003"] = [{ benefitId: "BEN-4", projectCode: "PRJ-003", name: "New" }];
  const afterGrow = await D.benefits.replaceAll(grown);
  check(
    "a new project group is added without disturbing the rest",
    afterGrow.saved === 1 && afterGrow.removed === 0 && D.benefits.all().length === 3,
    JSON.stringify(afterGrow)
  );

  /*
    The row is filed back under the key it was found under, not one derived from its own fields.
    A row whose projectCode disagrees with its group is legacy data, and moving it silently would
    make it vanish from the page that lists that project.
  */
  const misfiled = D.benefits.read();
  misfiled["PRJ-003"] = [{ benefitId: "BEN-4", projectCode: "PRJ-999", name: "Misfiled" }];
  await D.benefits.replaceAll(misfiled);
  check(
    "a row stays in the group it was filed under",
    Array.isArray(D.benefits.read()?.["PRJ-003"]) && D.benefits.read()["PRJ-003"].length === 1,
    JSON.stringify(D.benefits.read())
  );

  /*
    And the rule underneath all of it: a shape replaceAll does not understand is an error, not an
    empty collection. Each of these would have wiped the collection before.
  */
  const held = D.benefits.all().length;
  for (const [label, value] of [
    ["a string", "not a collection"],
    ["null", null],
    ["undefined", undefined],
    ["a number", 7]
  ]) {
    const refused = await D.benefits.replaceAll(value);
    check(
      `replaceAll refuses ${label} rather than emptying the collection`,
      refused.ok === false && refused.reason === "invalid" && D.benefits.all().length === held,
      JSON.stringify(refused)
    );
  }

  /* The mirror image: an object handed to a collection stored as a list. */
  const listRefused = await D.resourceScenarios.replaceAll({ "PRJ-001": [{ scenarioId: "SC-9" }] });
  check(
    "replaceAll refuses an object for a list-shaped collection",
    listRefused.ok === false && listRefused.reason === "invalid" && /stored as a list/.test(listRefused.message),
    JSON.stringify(listRefused)
  );

  /* A malformed legacy group is left alone rather than deleting the collection or blocking it. */
  const malformed = D.benefits.read();
  malformed["PRJ-004"] = "this was never a list";
  const tolerated = await D.benefits.replaceAll(malformed);
  check(
    "a group that is not a list is skipped, not treated as empty",
    tolerated.ok && tolerated.removed === 0 && D.benefits.all().length === held,
    JSON.stringify(tolerated)
  );
}

/* ------------------- 36. hydration fills the store, and nothing else does

   The property the whole application now rests on. Both adapters load their collections from
   PostgreSQL and hand each one to PPMStore.adopt(); there is no second copy anywhere, so if that
   handover does not happen the page shows nothing at all.

   Worth asserting explicitly because the failure is silent in the worst way. adopt() is called
   from inside hydration, whose errors are caught and logged so that one bad collection cannot
   take the other thirty-five with it - so a broken handover produces an empty page and a console
   line, which is exactly the shape of the blank projects register.

   It also pins the load order. ppm-data.js is defined after both adapters, so PPMStore does not
   exist while they are being parsed; hydration only works because it is asynchronous and yields
   before fetching. If anyone makes hydration synchronous, this section fails.
*/
{
  const D = sandbox.PPMStore;

  /* Nothing in the store for a collection nothing has loaded. */
  D.adopt("statusReports", []);
  check("a collection starts empty", D.statusReports.all().length === 0);

  db.rows.length = 0;
  db.rows.push(
    {
      id: "uuid-sr-1",
      project_code: "PRJ-00001",
      record_key: "SR-1",
      legacy_payload: { reportId: "SR-1", projectCode: "PRJ-00001", summary: "On track" },
      version: 1,
      deleted_at: null
    },
    {
      id: "uuid-sr-2",
      project_code: "PRJ-00002",
      record_key: "SR-2",
      legacy_payload: { reportId: "SR-2", projectCode: "PRJ-00002", summary: "Slipping" },
      version: 1,
      deleted_at: null
    }
  );

  const report = await A.hydrateModule("statusReports");
  check("hydration reports the rows it loaded", report?.ok === true && report.records === 2, JSON.stringify(report));
  check(
    "and every one of them reached the store",
    D.statusReports.all().length === 2,
    `${D.statusReports.all().length} in the store`
  );
  check(
    "in the shape the collection is registered with, keyed by project",
    Array.isArray(D.statusReports.read()?.["PRJ-00001"]) && D.statusReports.read()["PRJ-00001"].length === 1,
    JSON.stringify(D.statusReports.read())
  );
  check("reading by identifier finds a hydrated record", D.statusReports.byId("SR-1")?.summary === "On track");

  /* A second hydration replaces rather than accumulates: the database is the whole answer. */
  db.rows.length = 0;
  db.rows.push({
    id: "uuid-sr-1",
    project_code: "PRJ-00001",
    record_key: "SR-1",
    legacy_payload: { reportId: "SR-1", projectCode: "PRJ-00001", summary: "On track" },
    version: 1,
    deleted_at: null
  });
  await A.hydrateModule("statusReports");
  check(
    "hydrating again replaces the collection rather than adding to it",
    D.statusReports.all().length === 1,
    `${D.statusReports.all().length} in the store`
  );

  /* Soft-deleted rows are not records. */
  db.rows.length = 0;
  db.rows.push(
    {
      id: "uuid-sr-1",
      project_code: "PRJ-00001",
      record_key: "SR-1",
      legacy_payload: { reportId: "SR-1", projectCode: "PRJ-00001", summary: "On track" },
      version: 1,
      deleted_at: null
    },
    {
      id: "uuid-sr-3",
      project_code: "PRJ-00003",
      record_key: "SR-3",
      legacy_payload: { reportId: "SR-3", projectCode: "PRJ-00003", summary: "Gone" },
      version: 2,
      deleted_at: "2026-08-10T18:36:44.253Z"
    }
  );
  await A.hydrateModule("statusReports");
  check(
    "a soft-deleted row does not reach the store",
    D.statusReports.all().length === 1 && D.statusReports.byId("SR-3") === null,
    JSON.stringify(D.statusReports.all())
  );

  /* And the old mirror key is not written on the way past. Writing it would be harmless today
     and would be the first step back towards two copies of the data. */
  localStorage.removeItem("ppmStatusReports");
  await A.hydrateModule("statusReports");
  check(
    "hydration writes no localStorage mirror",
    localStorage.getItem("ppmStatusReports") === null,
    String(localStorage.getItem("ppmStatusReports"))
  );

  /* adopt() refuses a name no adapter registers rather than inventing a collection. */
  check("adopt refuses an unregistered collection", D.adopt("notACollection", []) === false);
}

/* ------------------- 37. the foundation adapter records its failures too

   The same gap as the child adapter's, in the other file. saveRecords() recorded the failures it
   collected, but PPMStore calls saveRecord() one row at a time - so since Stage 16 nothing a
   foundation collection did wrong reached the ledger, and pendingWrites() answered "everything
   reached the database" when it had not.
*/
{
  F.clearPending();
  check("the foundation ledger starts empty", F.pendingWrites().length === 0, JSON.stringify(F.pendingWrites()));

  updateResult = { data: null, error: { code: "42501", message: "permission denied for table projects" } };
  const refused = await F.saveRecord("projects", {
    projectCode: "PRJ-90002",
    projectName: "Ledger probe",
    databaseId: "uuid-ledger-1",
    databaseVersion: 1,
    version: 1
  });
  check("a refused foundation save reports the refusal", refused.status === "refused", JSON.stringify(refused));
  const after = F.pendingWrites();
  check(
    "and reaches the pending ledger",
    after.length === 1 && after[0].kind === "refused" && after[0].module === "projects",
    JSON.stringify(after)
  );

  updateResult = { data: { id: "uuid-ledger-1", version: 2 }, error: null };
  const saved = await F.saveRecord("projects", {
    projectCode: "PRJ-90002",
    projectName: "Ledger probe",
    databaseId: "uuid-ledger-1",
    databaseVersion: 1,
    version: 1
  });
  check(
    "a later success takes its own entry back out",
    saved.status === "saved" && F.pendingWrites().length === 0,
    JSON.stringify(F.pendingWrites())
  );
  F.clearPending();
}

/* ------------------- 38. the change log records nothing, and the API it called agrees

   ppm-change-log.js went on calling PPMAudit.compareAndRecord(), .record() and .diff() for a
   month after Stage 14 deleted all three, because it reached them through a local alias that no
   gate could see. Every save that recorded a change threw after the row had reached the database
   and killed the rest of the handler: the modal stayed open, the list never refreshed, no message
   appeared. It was reported as a button that did nothing.

   Two halves, checked differently and deliberately so. PPMAudit is loaded here, so its surface is
   asserted against the real object. ppm-change-log.js builds its history dialogue at load time
   and cannot run against this rig's document, so its half is read from the source - which is
   weaker, and is the reason VERIFY-STATIC.mjs §7 now also lists the bare method name.
*/
{
  ["compareAndRecord", "record", "recordMany", "diff"].forEach((name) => {
    check(`PPMAudit no longer exposes ${name}`, typeof Audit[name] === "undefined", typeof Audit[name]);
  });
  check("PPMAudit still exposes the reads the History button needs",
    typeof Audit.read === "function" && typeof Audit.serialise === "function");

  const changeLog = fs.readFileSync(path.join(here, "ppm-change-log.js"), "utf8");
  const code = changeLog.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  ["recordRow", "recordDeletion", "trackCollection"].forEach((name) => {
    check(
      `ppm-change-log.js no longer exports ${name}`,
      !new RegExp(`^\\s{4}${name},\\s*$`, "m").test(code),
      name
    );
  });
  ["compareAndRecord", ".record(", ".diff("].forEach((call) => {
    check(`ppm-change-log.js no longer calls ${call}`, !code.includes(call), call);
  });

  /*
    Stage 19: the History button reads the database, not just the browser rows.

    historyFor() used to read legacyAudit alone - pre-migration browser entries that stop in
    August and are never added to. So a record somebody had just edited reported "0 recorded
    changes", which reads as "nothing happened here" rather than "I am looking in the wrong
    place". It now merges public.audit_log with those legacy rows.
  */
  check(
    "ppm-change-log.js reads the database audit trail",
    code.includes("PPMDatabase.getAuditTrail"),
    "historyFor still reads only the browser rows"
  );
  check(
    "and matches on the tail of the composite audit key",
    code.includes("recordEndsWith"),
    "the audit key is 'PROJECT / RECORD', so an exact match on the record id finds nothing"
  );
  check(
    "and opening the dialogue awaits it",
    /async function openHistory/.test(code) && /await historyFor\(/.test(code),
    "openHistory must await the trail or it renders before the answer arrives"
  );
  /* The reading half must still be there: it is the easy thing to delete by accident while
     deleting the other half, and every register row calls it. */
  ["historyFor", "historyButton", "locationFor"].forEach((name) => {
    check(`ppm-change-log.js still exports ${name}`, new RegExp(`^\\s{4}${name},?\\s*$`, "m").test(code), name);
  });
}

/* ------------------- 39. signing in, and staying signed in

   WHY THIS SECTION EXISTS, WHICH IS NOT A HAPPY REASON

   ppm-auth-utils.js had no behavioural coverage at all. This rig stubs PPMAuth with two
   functions, because the adapters only ever needed getCurrentUser() from it - so the module that
   decides whether anybody can use the tool was never loaded, never called and never asserted.

   Stage 16 deleted four functions from it: the localStorage facade, the storage-scope patch, the
   browser audit, and saveResources(), which had been writing the signed-in person into the
   ppmResources mirror at sign-in. Nothing else read that mirror any more, so removing the write
   looked like tidying up. It was not: readValidSession() looked the signed-in person up in the
   directory on every page load, before hydration, and the mirror was the only place that record
   existed that early.

   The result was a redirect loop. Sign in, "Welcome back", Continue, and the next page finds no
   record for the session, calls endSession("account unavailable") and sends you back to the
   login screen. Nobody could use the application, and all five gates were green.

   THE RIG

   A second sandbox, built here rather than shared, because this module patches nothing and needs
   things the adapters never wanted - sessionStorage, crypto.getRandomValues, a document with
   listeners, and a location it can redirect. Two independent page loads share one sessionStorage,
   which is the whole point: the second load is the one that was broken.
*/
{
  const sessionBacked = new Map();
  const storageLike = (backing) => ({
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => backing.set(key, String(value)),
    removeItem: (key) => backing.delete(key),
    clear: () => backing.clear(),
    key: (index) => [...backing.keys()][index],
    get length() {
      return backing.size;
    }
  });

  const pageLoad = (directory) => {
    const box = {
      console: { log() {}, info() {}, warn() {}, error() {} },
      crypto: {
        randomUUID: () => "uuid-auth",
        getRandomValues: (array) => {
          for (let i = 0; i < array.length; i += 1) array[i] = i;
          return array;
        }
      },
      location: {
        pathname: "/home.html",
        search: "",
        href: "",
        replace(url) {
          box.__redirectedTo = url;
        }
      },
      document: {
        documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
        addEventListener() {},
        querySelectorAll: () => [],
        querySelector: () => null,
        getElementById: () => null,
        readyState: "loading",
        body: { appendChild() {}, insertBefore() {} },
        createElement: () => ({ classList: { add() {} }, setAttribute() {}, appendChild() {}, style: {} })
      },
      localStorage: storageLike(new Map()),
      sessionStorage: storageLike(sessionBacked),
      Storage: { prototype: { getItem() {}, setItem() {} } },
      btoa: (value) => Buffer.from(value, "binary").toString("base64"),
      setTimeout,
      clearTimeout,
      JSON, Math, Date, Object, Array, String, Number, Boolean, Set, Map, RegExp, Error,
      URLSearchParams, Promise, parseInt, parseFloat, isNaN,
      PPMSupabase: { auth: { getSession: async () => ({ data: { session: null } }) } }
    };
    /* Just enough PPMStore for the one question that matters here: when hydration HAS run, the
       directory it loaded must win over the copy kept with the session. */
    if (directory) box.PPMStore = { people: { all: () => directory } };
    box.window = box;
    box.globalThis = box;
    vm.createContext(box);
    ["ppm-core.js", "ppm-auth-utils.js"].forEach((file) =>
      vm.runInContext(fs.readFileSync(path.join(here, file), "utf8"), box, { filename: file })
    );
    return box;
  };

  const person = {
    legacy_resource_id: "RES-0001",
    full_name: "A Tester",
    email: "tester@example.com",
    access_role: "System Administrator",
    access_scope: "Portfolio-wide",
    account_status: "Active",
    active: true,
    additional_roles: [],
    permission_overrides: {},
    selected_project_codes: []
  };

  /* A page with no session must send you to the login screen, keeping where you were going. */
  const anonymous = pageLoad();
  check(
    "a page with no session redirects to the login screen",
    anonymous.__redirectedTo === "login.html?return=home.html",
    String(anonymous.__redirectedTo)
  );
  check("and nobody is signed in", anonymous.PPMAuth.getCurrentUser() === null);

  /* Signing in. */
  const first = pageLoad();
  const resource = first.PPMAuth.establishSupabaseSession(person, "auth-uuid-1", { audit: false });
  check("signing in resolves the person", resource?.fullName === "A Tester", JSON.stringify(resource?.fullName));
  check(
    "and the session carries their own record, not just a summary",
    Boolean(sessionBacked.get("ppmSessionResource")),
    [...sessionBacked.keys()].join(", ")
  );
  check(
    "which holds what readValidSession() has to check",
    (() => {
      const held = JSON.parse(sessionBacked.get("ppmSessionResource") || "{}");
      return held.active === true && held.accountStatus === "Active" && Boolean(held.accessRole);
    })(),
    sessionBacked.get("ppmSessionResource")
  );

  /*
    The load that was broken. A new page, an empty PPMStore because hydration has not run, and the
    only trace of who this is lives in sessionStorage.
  */
  const second = pageLoad();
  check(
    "the next page load does not bounce back to the login screen",
    second.__redirectedTo === undefined,
    String(second.__redirectedTo)
  );
  check("and knows who is signed in", second.PPMAuth.getCurrentUser()?.fullName === "A Tester");
  check("with their permissions intact", second.PPMAuth.can("projects.view") === true);
  check("including ones they should not have", second.PPMAuth.can("nonsense.permission") === false);

  /*
    And the other half of that rule, which is the half that matters for security.

    The session copy is a fallback for the window before hydration, not a second source of truth.
    Once the directory is loaded it wins - so an administrator deactivating somebody, or taking
    their role away, takes effect on their next page load rather than whenever they next sign in.
    Getting this backwards would mean a revoked account staying usable for as long as the tab
    stayed open.
  */
  const deactivated = pageLoad([
    { resourceId: "RES-0001", fullName: "A Tester", active: false, accountStatus: "Active", accessRole: "System Administrator" }
  ]);
  check(
    "a deactivated account is signed out on the next page load",
    deactivated.__redirectedTo === "login.html?return=home.html",
    String(deactivated.__redirectedTo)
  );

  /* Which also means the session has been cleared, not merely ignored. */
  check("and the session is cleared rather than ignored", sessionBacked.size === 0, [...sessionBacked.keys()].join(", "));

  /* Sign in again for the sign-out assertions below. */
  const third = pageLoad();
  third.PPMAuth.establishSupabaseSession(person, "auth-uuid-1", { audit: false });
  const second2 = pageLoad();
  check("signing in again works after a forced sign-out", second2.PPMAuth.getCurrentUser()?.fullName === "A Tester");

  /* Signing out clears all three keys, or the next visitor to this tab inherits the session. */
  second2.PPMAuth.endSession("test");
  check(
    "signing out leaves nothing behind in the tab",
    sessionBacked.size === 0,
    [...sessionBacked.keys()].join(", ")
  );

  const afterLogout = pageLoad();
  check(
    "and the next page load is anonymous again",
    afterLogout.__redirectedTo === "login.html?return=home.html",
    String(afterLogout.__redirectedTo)
  );
}

/* ------------------- 40. being named as an approver is the authority

   Reported from the pilot: a Project Sponsor named as a required approver on sixteen gates could
   not act on any of them, and the screen said only "No workflow actions are available to your
   account for this record" - which reads as a permission problem whatever the real reason.

   Two separate faults, and the second was hiding behind the first.

   The rule was "named AND your role holds stageGates.approve for this project". That is the
   wrong shape for an approval: an executive who wants a subject-matter expert to sign a gate
   would have to have the expert's role changed for every other screen first. Being named is now
   the authority, in the browser and in ppm_commit_stage_gate_workflow.

   And the message was wrong. On a Draft gate nobody can approve, because it has not been
   submitted - but the message named the account rather than the state, and sent the reader
   looking for a missing permission.

   The rig loads the real ppm-auth-utils.js and ppm-stage-gate-utils.js over a stubbed store, so
   these are the shipped rules rather than a restatement of them.
*/
{
  const gateFor = (overrides) => ({
    gateId: "SG-TEST-01",
    projectCode: "PRJ-TEST",
    workflowStatus: "Submitted",
    routeRequirement: "Required",
    routeApprovalStatus: "Not Required",
    currentStage: "Build",
    proposedNextStage: "Test",
    submissionOwner: "Tom Bradshaw",
    submissionOwnerResourceId: "RES-OWNER",
    submittedByResourceId: "RES-OWNER",
    requiredApprovers: [{ name: "A Tester", email: "tester@example.com", resourceId: "RES-0001" }],
    decisionHistory: [],
    routeApprovalHistory: [],
    submissionHistory: [],
    ...overrides
  });

  const transitionsFor = (person, gate) => {
    const sess = new Map([
      ["ppmAuthSession", JSON.stringify({
        sessionId: "s", resourceId: person.resourceId,
        issuedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 36e5).toISOString()
      })],
      ["ppmSessionResource", JSON.stringify(person)]
    ]);
    const storageLike = (backing) => ({
      getItem: (key) => (backing.has(key) ? backing.get(key) : null),
      setItem: (key, value) => backing.set(key, String(value)),
      removeItem: (key) => backing.delete(key),
      clear: () => backing.clear(),
      key: (index) => [...backing.keys()][index],
      get length() { return backing.size; }
    });
    const collections = {
      projects: [{ projectCode: "PRJ-TEST", projectName: "Test", projectStatus: "Active", archived: false,
                   currentStage: "Build", lifecycleTemplateId: "LIFE-00001", lifecycleTemplateVersion: 1 }],
      people: [person],
      stageGates: { "PRJ-TEST": [gate] },
      plans: {}, raid: {}, actions: {}, decisions: {}, benefits: {}, resourceDemand: [], programmes: []
    };
    const namespace = (name) => ({
      all: () => (Array.isArray(collections[name]) ? collections[name] : Object.values(collections[name] || {}).flat()),
      read: () => collections[name] ?? {},
      get: () => collections[name] ?? {},
      byId: () => null,
      forProject: () => []
    });
    const box = {
      console: { log() {}, info() {}, warn() {}, error() {} },
      crypto: { randomUUID: () => "u", getRandomValues: (a) => a },
      location: { pathname: "/stage-gates.html", search: "", href: "", replace() {} },
      document: {
        documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
        addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
        getElementById: () => null, readyState: "complete",
        body: { appendChild() {}, insertBefore() {} },
        createElement: () => ({ classList: { add() {} }, setAttribute() {}, appendChild() {}, style: {} })
      },
      localStorage: storageLike(new Map()),
      sessionStorage: storageLike(sess),
      Storage: { prototype: { getItem() {}, setItem() {} } },
      btoa: (v) => Buffer.from(v, "binary").toString("base64"),
      setTimeout, clearTimeout,
      JSON, Math, Date, Object, Array, String, Number, Boolean, Set, Map, RegExp, Error,
      URLSearchParams, Promise, parseInt, parseFloat, isNaN,
      PPMSupabase: { auth: { getSession: async () => ({ data: { session: null } }) } }
    };
    box.window = box;
    box.globalThis = box;
    box.PPMStore = new Proxy(
      { collections: () => Object.keys(collections) },
      { get: (target, key) => (key in target ? target[key] : (typeof key === "string" && key in collections ? namespace(key) : undefined)) }
    );
    vm.createContext(box);
    ["ppm-core.js", "ppm-auth-utils.js", "ppm-stage-gate-utils.js"].forEach((file) =>
      vm.runInContext(fs.readFileSync(path.join(here, file), "utf8"), box, { filename: file })
    );
    const found = box.PPMStageGates.getAll().find((row) => row.gateId === gate.gateId);
    return { transitions: found ? box.PPMStageGates.allowedTransitions(found) : null, box, found };
  };

  const base = {
    resourceId: "RES-0001", fullName: "A Tester", email: "tester@example.com",
    accessScope: "Assigned projects", accountStatus: "Active", active: true,
    additionalRoles: [], permissionOverrides: {}, selectedProjectCodes: []
  };

  /* The case that was reported: a role WITHOUT stage-gate approval, named as an approver. */
  const sme = transitionsFor({ ...base, accessRole: "Executive / Steering User" }, gateFor({}));
  check(
    "a named approver whose role cannot approve can still see the gate",
    Boolean(sme.found),
    "gate not visible"
  );
  check(
    "and is offered every decision",
    JSON.stringify(sme.transitions) ===
      JSON.stringify(["Conditionally Approved", "Approved", "Deferred", "Rejected"]),
    JSON.stringify(sme.transitions)
  );
  check(
    "even though the permission itself is still refused",
    sme.box.PPMAuth.can("stageGates.approve", "PRJ-TEST") === false,
    String(sme.box.PPMAuth.can("stageGates.approve", "PRJ-TEST"))
  );

  /* Someone not named gets nothing, whatever their role. This is the half that must not have
     been widened: the fix would be worthless if it let anyone decide. */
  const bystander = transitionsFor(
    { ...base, resourceId: "RES-9999", fullName: "Not Named", email: "other@example.com", accessRole: "System Administrator" },
    gateFor({})
  );
  /* null means the gate is not even visible to them, which is a stronger pass than "visible but
     no buttons" - they have no access to that project at all. */
  check(
    "somebody not named as an approver is offered no decision",
    bystander.transitions === null ||
      !bystander.transitions.some((t) => ["Approved", "Rejected", "Deferred", "Conditionally Approved"].includes(t)),
    JSON.stringify(bystander.transitions)
  );

  /*
    A different person who happens to share a mailbox is not the approver.

    Written after the bystander case above passed for the wrong reason: the first version of this
    section gave the bystander the approver's email address, and samePerson() matched on it -
    which is how the defect was found rather than reasoned about. The resource id decides it now,
    the same way private.is_named_gate_approver() does.
  */
  const sharedMailbox = transitionsFor(
    { ...base, resourceId: "RES-8888", fullName: "Shared Mailbox", accessRole: "System Administrator" },
    gateFor({})
  );
  check(
    "sharing an email address with the approver is not enough",
    sharedMailbox.transitions === null ||
      !sharedMailbox.transitions.some((t) => ["Approved", "Rejected", "Deferred", "Conditionally Approved"].includes(t)),
    JSON.stringify(sharedMailbox.transitions)
  );

  /* Separation of duties survives: naming yourself does not let you decide your own gate. */
  const selfApprover = transitionsFor(
    { ...base, accessRole: "System Administrator" },
    gateFor({ submissionOwnerResourceId: "RES-0001", submittedByResourceId: "RES-0001" })
  );
  check(
    "you still cannot decide a gate you submitted or own, even named and even as an administrator",
    Array.isArray(selfApprover.transitions) &&
      !selfApprover.transitions.some((t) => ["Approved", "Rejected", "Deferred", "Conditionally Approved"].includes(t)),
    JSON.stringify(selfApprover.transitions)
  );

  /* A Draft gate offers an approver nothing, because it has not been submitted. Correct, and the
     reason the message had to change. */
  const draft = transitionsFor(
    { ...base, accessRole: "Executive / Steering User" },
    gateFor({ workflowStatus: "Draft" })
  );
  check(
    "a Draft gate offers its approvers nothing to decide",
    Array.isArray(draft.transitions) &&
      !draft.transitions.some((t) => ["Approved", "Rejected"].includes(t)),
    JSON.stringify(draft.transitions)
  );

  /* The page must explain that by naming the state, not the account. */
  const pageSource = fs.readFileSync(path.join(here, "stage-gates-page.js"), "utf8");
  check(
    "the page no longer blames the account when a gate is simply not submitted",
    !pageSource.includes("No workflow actions are available to your account for this record"),
    "the old message is still there"
  );
  check(
    "and says what the state is instead",
    pageSource.includes("it has not been submitted yet"),
    "no explanation of the Draft state"
  );
}

/* ------------------- 41. readiness is advice, not a veto

   Stage 19. Submitting and approving both refused when the organisation's readiness rules found
   something outstanding, so the tool overruled the person whose judgement the gate exists to
   record. A sponsor who had decided to proceed with three evidence items open had no way to say
   so, and no trace of the decision survived - they simply filled in whatever unblocked the
   button, which is worse governance than recording the truth.

   The database never enforced readiness; it was only ever a browser rule.

   What must remain true, and is asserted here: the rules are still evaluated, the outstanding
   items are still reported, and a decision taken with items outstanding records what they were.
   Structural errors - a gate with no id, a stage outside the lifecycle - must still refuse,
   because those are statements about the record rather than about somebody's judgement.
*/
{
  const stageRules = [
    { ruleId: "R1", templateId: "LIFE-00001", templateVersion: 1, stage: "Test",
      fieldId: "testApproach", label: "Test approach", required: true, active: true },
    { ruleId: "R2", templateId: "LIFE-00001", templateVersion: 1, stage: "Test",
      fieldId: "goLiveCriteria", label: "Go-live criteria", required: true, active: true }
  ];

  const run = (person, gate, project) => {
    const sess = new Map([
      ["ppmAuthSession", JSON.stringify({ sessionId: "s", resourceId: person.resourceId,
        issuedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 36e5).toISOString() })],
      ["ppmSessionResource", JSON.stringify(person)]
    ]);
    const storageLike = (backing) => ({
      getItem: (k) => (backing.has(k) ? backing.get(k) : null),
      setItem: (k, v) => backing.set(k, String(v)),
      removeItem: (k) => backing.delete(k),
      clear: () => backing.clear(),
      key: (i) => [...backing.keys()][i],
      get length() { return backing.size; }
    });
    const collections = {
      projects: [project], people: [person], stageGates: { "PRJ-TEST": [gate] },
      lifecycleTemplates: [{ templateId: "LIFE-00001", name: "Standard", version: 1, isDefault: true, active: true,
        stages: ["Intake","Discovery","Requirements and Design","Build","Test","Implementation","Hypercare","Closure"]
          .map((name, index) => ({ stageId: `S${index}`, name, order: index })) }],
      lifecycleRules: stageRules,
      plans: {}, raid: {}, actions: {}, decisions: {}, benefits: {}, resourceDemand: [], programmes: [],
      referenceData: {}, reportingCalendars: [], reportingPeriods: [], portfolios: [], ragConfig: {},
      milestones: {}, documents: {}, statusReports: {}, financials: {}, financialEntries: {},
      financialApprovals: {}, planBaselines: {}, baselineRequests: {}, ragHistory: {},
      programmeMilestones: {}, programmeRaid: {}, resourceScenarios: [], resourceAbsence: [],
      resourceConfig: {}, financialCategories: [], resourceGanttViews: [], reportViews: [],
      searchViews: [], legacyAudit: [], stageGatesUnused: {}
    };
    const namespace = (name) => ({
      all: () => (Array.isArray(collections[name]) ? collections[name] : Object.values(collections[name] || {}).flat()),
      read: () => collections[name] ?? {}, get: () => collections[name] ?? {},
      byId: () => null, forProject: () => []
    });
    const box = {
      console: { log() {}, info() {}, warn() {}, error() {} },
      crypto: { randomUUID: () => "u", getRandomValues: (a) => a },
      location: { pathname: "/stage-gates.html", search: "", href: "", replace() {} },
      document: {
        documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
        addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
        getElementById: () => null, readyState: "complete",
        body: { appendChild() {}, insertBefore() {} },
        createElement: () => ({ classList: { add() {} }, setAttribute() {}, appendChild() {}, style: {} })
      },
      localStorage: storageLike(new Map()), sessionStorage: storageLike(sess),
      Storage: { prototype: { getItem() {}, setItem() {} } },
      btoa: (v) => Buffer.from(v, "binary").toString("base64"),
      setTimeout, clearTimeout,
      JSON, Math, Date, Object, Array, String, Number, Boolean, Set, Map, RegExp, Error,
      URLSearchParams, Promise, parseInt, parseFloat, isNaN,
      PPMSupabase: { auth: { getSession: async () => ({ data: { session: null } }) } }
    };
    box.window = box; box.globalThis = box;
    box.PPMStore = new Proxy({ collections: () => Object.keys(collections) },
      { get: (t, k) => (k in t ? t[k] : (typeof k === "string" && k in collections ? namespace(k) : undefined)) });
    vm.createContext(box);
    ["ppm-core.js", "ppm-auth-utils.js", "ppm-admin-utils.js", "ppm-stage-gate-utils.js"].forEach((file) =>
      vm.runInContext(fs.readFileSync(path.join(here, file), "utf8"), box, { filename: file })
    );
    return box;
  };

  /* A project deliberately missing both fields the Test stage requires. */
  const project = {
    projectCode: "PRJ-TEST", projectName: "Test", projectStatus: "Active", archived: false,
    currentStage: "Build", nextStage: "Test",
    lifecycleTemplateId: "LIFE-00001", lifecycleTemplateVersion: 1,
    testApproach: "", goLiveCriteria: ""
  };
  const gate = {
    gateId: "SG-TEST-01", projectCode: "PRJ-TEST", gateName: "Gate 4",
    workflowStatus: "Draft", routeRequirement: "Required", routeApprovalStatus: "Not Required",
    currentStage: "Build", proposedNextStage: "Test",
    submissionOwner: "Owner", submissionOwnerResourceId: "RES-OWNER",
    requiredApprovers: [{ name: "A Tester", email: "tester@example.com", resourceId: "RES-0001" }],
    decisionHistory: [], routeApprovalHistory: [], submissionHistory: []
  };
  const person = {
    resourceId: "RES-0001", fullName: "A Tester", email: "tester@example.com",
    accessRole: "System Administrator", accessScope: "Portfolio-wide",
    accountStatus: "Active", active: true, additionalRoles: [], permissionOverrides: {},
    selectedProjectCodes: []
  };

  const box = run(person, gate, project);
  const G = box.PPMStageGates;
  const loaded = G.getAll().find((row) => row.gateId === "SG-TEST-01");

  /* The rules still run and still report. Losing that would be a different bug. */
  const readiness = G.readinessFor(loaded);
  check(
    "readiness still reports what is outstanding",
    readiness.outstanding.includes("Test approach") && readiness.outstanding.includes("Go-live criteria"),
    JSON.stringify(readiness.outstanding)
  );
  check("and says so in a sentence", /readiness is incomplete/.test(readiness.summary), readiness.summary);

  /* But it no longer refuses. */
  let submitError = "";
  try {
    G.submit("SG-TEST-01", { submissionComments: "Proceeding with items open." });
  } catch (error) {
    submitError = String(error && error.message);
  }
  check(
    "a gate that fails readiness can still be submitted",
    !/readiness is incomplete/i.test(submitError),
    submitError || "(no error)"
  );

  /*
    Structural problems must still refuse: those are statements about the record rather than about
    somebody's judgement, and nobody is exercising discretion by naming a stage that does not
    exist. validate() is the function that draws the line, so it is asked directly.
  */
  const structural = G.validate(
    { ...gate, gateId: "SG-TEST-02", proposedNextStage: "Nowhere In The Lifecycle" },
    "submit"
  );
  check(
    "a stage outside the lifecycle template is still refused",
    structural.valid === false &&
      structural.errors.some((message) => /not part of the project's assigned lifecycle template/i.test(message)),
    JSON.stringify(structural.errors)
  );

  /* And the readiness finding is reported as advice on the same result, not as an error. */
  const advisory = G.validate(gate, "submit");
  check(
    "readiness appears as advice rather than an error",
    advisory.errors.every((message) => !/readiness is incomplete/i.test(message)) &&
      Array.isArray(advisory.advice) &&
      advisory.advice.some((entry) => /readiness is incomplete/i.test(entry.summary)),
    JSON.stringify({ errors: advisory.errors, advice: advisory.advice })
  );
}

/* ------------------- 42. the notification bell reads its own state

   ppm-notifications.js keeps which notifications a person has dismissed in localStorage - browser
   state, per person, per computer, with no table behind it. When the reads were migrated to
   PPMStore its raw() helper was changed to take a collection name, and two calls that pass a
   storage KEY were changed with it. PPMStore["ppmNotificationState"] is undefined, so
   `PPMStore[collection].read()` threw on every page load before the bell could render.

   Section 22 did not catch it because the module loads fine; the throw is inside initialise().
   So this calls the functions rather than loading the file and hoping.
*/
{
  const box = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    location: { pathname: "/home.html", search: "", href: "" },
    document: {
      documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
      addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
      getElementById: () => null, readyState: "complete",
      body: { appendChild() {}, insertBefore() {} },
      createElement: () => ({ classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {}, style: {}, addEventListener() {} })
    },
    localStorage: (() => {
      const backing = new Map();
      return {
        getItem: (k) => (backing.has(k) ? backing.get(k) : null),
        setItem: (k, v) => backing.set(k, String(v)),
        removeItem: (k) => backing.delete(k),
        clear: () => backing.clear(),
        key: (i) => [...backing.keys()][i],
        get length() { return backing.size; },
        __backing: backing
      };
    })(),
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    JSON, Math, Date, Object, Array, String, Number, Boolean, Set, Map, RegExp, Error,
    URLSearchParams, Promise, parseInt, parseFloat, isNaN,
    PPMAuth: {
      getCurrentUser: () => ({ resourceId: "RES-0001", fullName: "A Tester", accessRole: "System Administrator" }),
      can: () => true,
      canAny: () => true,
      holdsPermission: () => true,
      canAccessProject: () => true,
      filterProjects: (rows) => rows,
      rolesOf: () => ["System Administrator"],
      effectiveScope: () => "Portfolio-wide"
    }
  };
  box.window = box;
  box.globalThis = box;
  /* Every collection empty, which is the state a first page load actually starts from. */
  const empty = { projects: [], people: [], plans: {}, raid: {}, actions: {}, decisions: {},
    benefits: {}, documents: {}, statusReports: {}, stageGates: {}, planBaselines: {},
    baselineRequests: {}, financials: {}, financialEntries: {}, financialApprovals: {},
    resourceDemand: [], resourceAbsence: [], resourceScenarios: [], ragHistory: {},
    programmeMilestones: {}, programmeRaid: {}, programmes: [], milestones: {} };
  box.PPMStore = new Proxy({ collections: () => Object.keys(empty) }, {
    get: (target, key) => {
      if (key in target) return target[key];
      if (typeof key !== "string") return undefined;
      if (!(key in empty)) return undefined;
      return {
        all: () => (Array.isArray(empty[key]) ? empty[key] : Object.values(empty[key]).flat()),
        read: () => empty[key], get: () => empty[key], byId: () => null, forProject: () => []
      };
    }
  });
  vm.createContext(box);
  ["ppm-core.js", "ppm-notifications.js"].forEach((file) =>
    vm.runInContext(fs.readFileSync(path.join(here, file), "utf8"), box, { filename: file })
  );

  check("PPMNotifications is defined", Boolean(box.PPMNotifications));

  let threw = "";
  let notifications = null;
  try {
    notifications = box.PPMNotifications.getNotifications();
  } catch (error) {
    threw = String(error && error.message);
  }
  check("building the notification list does not throw on a first load", threw === "", threw);
  check("and answers with a list", Array.isArray(notifications), typeof notifications);

  /* Reading and writing the dismissed state is the part that broke. */
  threw = "";
  try {
    box.PPMNotifications.isRead("anything");
    box.PPMNotifications.setRead("anything", true);
    box.PPMNotifications.isRead("anything");
  } catch (error) {
    threw = String(error && error.message);
  }
  check("reading and recording a dismissal does not throw", threw === "", threw);
  check(
    "and the dismissal is kept in localStorage, not asked of PPMStore",
    box.localStorage.__backing.has("ppmNotificationState"),
    [...box.localStorage.__backing.keys()].join(", ")
  );
}

/* ------------------- 43. the person a gate is waiting on is told about it

   Two things had to be true and only the second one was.

   The notification is raised for whoever is a named required approver, which it was - but the
   whole module was throwing on load, so the bell never rendered and nothing was shown at all
   (section 42). And the notification it would have shown carried "Your access roles cannot
   approve stage gates - ask an administrator", which Stage 18 made false: being named IS the
   authority. It told somebody to go and get a permission they did not need, on the notification
   asking them to use it.

   This builds the list for a named approver whose role holds nothing, which is the case that
   would have been most wrongly advised.
*/
{
  const person = {
    resourceId: "RES-0112", fullName: "Nadia Kaur", email: "nadia@example.com",
    accessRole: "Executive / Steering User", accessScope: "Assigned projects",
    accountStatus: "Active", active: true, additionalRoles: [], permissionOverrides: {},
    selectedProjectCodes: []
  };
  const gate = {
    gateId: "SG-1", projectCode: "PRJ-N", gateName: "Gate 5",
    workflowStatus: "Submitted", routeRequirement: "Required", routeApprovalStatus: "Not Required",
    currentStage: "Implementation", proposedNextStage: "Hypercare",
    submissionOwner: "Tom Bradshaw", submissionOwnerResourceId: "RES-OWNER",
    submittedBy: "Tom Bradshaw", submittedByResourceId: "RES-OWNER",
    submittedAt: "2026-12-25T16:45:00.000Z", updatedAt: "2027-01-01T15:00:00.000Z",
    requiredApprovers: [{ name: "Nadia Kaur", email: "nadia@example.com", resourceId: "RES-0112" }],
    decisionHistory: [], routeApprovalHistory: [], submissionHistory: []
  };
  const project = {
    projectCode: "PRJ-N", projectName: "Adviser Portal", projectStatus: "Active", archived: false,
    currentStage: "Implementation", sponsorResourceId: "RES-0112",
    lifecycleTemplateId: "LIFE-00001", lifecycleTemplateVersion: 1
  };
  const held = {
    projects: [project], people: [person], stageGates: { "PRJ-N": [gate] },
    plans: {}, raid: {}, actions: {}, decisions: {}, benefits: {}, documents: {}, statusReports: {},
    planBaselines: {}, baselineRequests: {}, financials: {}, financialEntries: {},
    financialApprovals: {}, resourceDemand: [], resourceAbsence: [], resourceScenarios: [],
    ragHistory: {}, programmeMilestones: {}, programmeRaid: {}, programmes: [], milestones: {}
  };
  const storageLike = (backing) => ({
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
    clear: () => backing.clear(),
    key: (i) => [...backing.keys()][i],
    get length() { return backing.size; }
  });
  const buildFor = (who) => {
    const sessionBacked = new Map([
      ["ppmAuthSession", JSON.stringify({ sessionId: "s", resourceId: who.resourceId,
        issuedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 36e5).toISOString() })],
      ["ppmSessionResource", JSON.stringify(who)]
    ]);
    const context = {
      console: { log() {}, info() {}, warn() {}, error() {} },
      crypto: { randomUUID: () => "u", getRandomValues: (a) => a },
      location: { pathname: "/home.html", search: "", href: "", replace() {} },
      document: {
        documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
        addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
        getElementById: () => null, readyState: "complete",
        body: { appendChild() {}, insertBefore() {} },
        createElement: () => ({ classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {}, style: {}, addEventListener() {} })
      },
      localStorage: storageLike(new Map()), sessionStorage: storageLike(sessionBacked),
      Storage: { prototype: { getItem() {}, setItem() {} } },
      btoa: (v) => Buffer.from(v, "binary").toString("base64"),
      setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
      JSON, Math, Date, Object, Array, String, Number, Boolean, Set, Map, RegExp, Error,
      URLSearchParams, Promise, parseInt, parseFloat, isNaN,
      PPMSupabase: { auth: { getSession: async () => ({ data: { session: null } }) } }
    };
    context.window = context;
    context.globalThis = context;
    const directory = held.people.some((row) => row.resourceId === who.resourceId)
      ? held
      : { ...held, people: [...held.people, who] };
    context.PPMStore = new Proxy({ collections: () => Object.keys(directory) }, {
      get: (target, key) => {
        if (key in target) return target[key];
        if (typeof key !== "string" || !(key in directory)) return undefined;
        return {
          all: () => (Array.isArray(directory[key]) ? directory[key] : Object.values(directory[key]).flat()),
          read: () => directory[key], get: () => directory[key], byId: () => null, forProject: () => []
        };
      }
    });
    vm.createContext(context);
    ["ppm-core.js", "ppm-auth-utils.js", "ppm-notifications.js"].forEach((file) =>
      vm.runInContext(fs.readFileSync(path.join(here, file), "utf8"), context, { filename: file })
    );
    return context;
  };

  const box = buildFor(person);

  check("the approver's role genuinely cannot approve", box.PPMAuth.can("stageGates.approve", "PRJ-N") === false);

  const list = box.PPMNotifications.getNotifications();
  const waiting = list.find((row) => row.title === "Stage gate awaiting your decision");
  check("a named approver is told a gate is waiting on them", Boolean(waiting), JSON.stringify(list.map((r) => r.title)));
  check("and it is raised as high severity", waiting?.severity === "high", waiting?.severity);
  check("and links to the gate", /stage-gates\.html\?code=PRJ-N&item=SG-1/.test(waiting?.href || ""), waiting?.href);
  check(
    "and does not tell them to ask an administrator for a permission they do not need",
    !/ask an administrator/i.test(waiting?.meta || ""),
    waiting?.meta
  );

  /*
    And somebody not named on it hears nothing, whatever their role. A notification addressed to
    everybody is not an approval request, and a System Administrator is the strongest case: they
    can see the gate and could act on plenty else, and still must not be told this one is theirs.
  */
  const elsewhere = buildFor({
    ...person,
    resourceId: "RES-9999",
    fullName: "Somebody Else",
    email: "someone.else@example.com",
    accessRole: "System Administrator",
    accessScope: "Portfolio-wide"
  });
  const theirs = elsewhere.PPMNotifications.getNotifications();
  check(
    "somebody not named on the gate is not told it is waiting on them",
    !theirs.some((row) => row.title === "Stage gate awaiting your decision"),
    JSON.stringify(theirs.map((row) => row.title))
  );
  check(
    "even though they can see the gate perfectly well",
    elsewhere.PPMAuth.can("stageGates.approve", "PRJ-N") === true,
    String(elsewhere.PPMAuth.can("stageGates.approve", "PRJ-N"))
  );
}

/* ------------------- 44. the timeline's arithmetic: working days and weekends

   The rebuilt resource timeline states durations as work days on every bar, and it excludes
   weekends from allocation, availability and over-allocation. All of that rests on one function,
   PPMPlanning.workingDaysBetween, which the capacity tab, the heatmap, the runway projection and
   the demand form also use.

   A local copy of it was written in resource-management-page.js while building the timeline and
   deleted before it shipped. Two implementations of "how long is this in working days" is how a
   Gantt starts disagreeing with the report built from the same data - the spec has a section
   about it, and it nearly happened anyway.
*/
{
  /* Section 22 loads the modules into a context of its own, so this asks for it here. */
  if (!sandbox.PPMPlanning) load("ppm-planning-utils.js");
  const P = sandbox.PPMPlanning;
  check("PPMPlanning is loaded", Boolean(P));

  /* Monday 10 to Friday 14 August 2026: five working days. */
  check("a single working week is five days", P.workingDaysBetween("2026-08-10", "2026-08-14") === 5,
    String(P.workingDaysBetween("2026-08-10", "2026-08-14")));

  /* Monday 10 to Monday 17: the weekend in between costs nothing. */
  check("a weekend adds no working days", P.workingDaysBetween("2026-08-10", "2026-08-17") === 6,
    String(P.workingDaysBetween("2026-08-10", "2026-08-17")));

  /* Saturday 15 to Sunday 16 alone. Work can be placed there and the timeline still draws it,
     but it contributes nothing to a duration stated in work days. */
  check("a weekend on its own is zero working days", P.workingDaysBetween("2026-08-15", "2026-08-16") === 0,
    String(P.workingDaysBetween("2026-08-15", "2026-08-16")));

  check("one working day is one", P.workingDaysBetween("2026-08-12", "2026-08-12") === 1,
    String(P.workingDaysBetween("2026-08-12", "2026-08-12")));

  /* Backwards and missing ranges answer zero rather than throwing: the timeline asks about
     records whose dates a person has not filled in yet. */
  check("a reversed range is zero, not negative", P.workingDaysBetween("2026-08-14", "2026-08-10") === 0);
  check("a missing range is zero", P.workingDaysBetween("", "") === 0);

  /* Capacity is the other half, and the timeline's spare-capacity bars divide by it. */
  const capacity = P.availableCapacity({ standardWeeklyCapacity: 37.5 }, "2026-08-10", "2026-08-14");
  check("a full week of capacity is the weekly figure", Math.round(capacity.available) === 38,
    JSON.stringify(capacity));
  check("capacity never goes negative", P.availableCapacity(
    { standardWeeklyCapacity: 37.5, nonWorkingHoursPerWeek: 100 }, "2026-08-10", "2026-08-14"
  ).available === 0);
}

/* ------------------- 45. the resource page states its zoom levels honestly

   Day zoom is the one the rebuild added, and the column labels lost their week numbers - "W32 ·
   10 Aug" put a calendar fact almost nobody holds in their head ahead of the date people
   actually navigate by.

   Checked against the source because the page script cannot run in this rig: it binds to a dozen
   DOM elements at load. That is a weaker check than exercising it, and it is here to catch the
   zoom control and the zoom configuration drifting apart, which is the failure that would leave
   a button doing nothing.
*/
{
  const page = fs.readFileSync(path.join(here, "resource-management-page.js"), "utf8");
  const markup = fs.readFileSync(path.join(here, "resource-management.html"), "utf8");

  const configured = [...page.matchAll(/^\s{2}(\w+):\s*\{\s*width:/gm)].map((match) => match[1]);
  const buttons = [...markup.matchAll(/data-zoom="(\w+)"/g)].map((match) => match[1]);

  check("day zoom exists", configured.includes("day"), configured.join(", "));
  check(
    "every zoom button has a configuration behind it",
    buttons.every((name) => configured.includes(name)),
    `buttons: ${buttons.join(", ")} | configured: ${configured.join(", ")}`
  );
  check(
    "and every configured zoom has a button",
    configured.every((name) => buttons.includes(name)),
    `buttons: ${buttons.join(", ")} | configured: ${configured.join(", ")}`
  );

  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check(
    "column labels no longer lead with a week number",
    !/`W\$\{week\}/.test(code) && !code.includes('`W${'),
    "bucketLabel still builds a W-prefixed label"
  );
  check("weekends are identified", /function isWeekend/.test(code));

  /*
    One left-hand cell per person, not one per assignment.

    Every line used to carry its own details cell, so somebody on eight assignments produced eight
    of them - the name once, then the task name repeated beside a bar that already said it. The
    details are written once now and the lines stack beside it, which is what gives the timeline
    back the widest column in the view.
  */
  check(
    "a person's details are written once per block",
    /function resourceBlock/.test(code) && code.includes('class="resource-lines"'),
    "the per-person block is not there"
  );
  check(
    "and an assignment line carries no details cell of its own",
    !/function taskRow/.test(code) && /function taskLine/.test(code),
    "taskRow still exists, so each assignment still writes a left-hand cell"
  );
  check(
    "progress moved onto the bar",
    code.includes("% done"),
    "percentage complete is not on the assignment label"
  );
  check(
    "an assignment with no dates is still drawn rather than silently dropped",
    code.includes("unscheduled-bar"),
    "an owned but unscheduled assignment would vanish"
  );

  /*
    Editing an allocation from the timeline writes to the project plan.

    There is no assignments record - every bar is derived from a plan task - so the plan is the
    only thing that can be edited, and it is where the change belongs. Storing it on this page
    would give the plan and this view two different answers to "how much of this person is on
    this", and the plan would go on saying the old one.
  */
  check(
    "an allocation edit writes to the plan collection",
    code.includes("PPMStore.plans.replaceAll"),
    "the editor does not save through the plans collection"
  );
  check(
    "and looks at what comes back",
    /const saved = await PPMStore\.plans\.replaceAll\(plans\);[\s\S]{0,200}saved\.ok/.test(code),
    "the save result is not checked"
  );
  check(
    "the plan's own permission decides who may edit it",
    code.includes('can?.("plan.edit"'),
    "resourceManagement.edit would let somebody change a plan they cannot edit"
  );
  check(
    "and the whole view is re-derived afterwards rather than patched",
    /loadData\(\);\s*renderGantt\(\);/.test(code),
    "totals, over-allocation runs and spare capacity would drift from the bar"
  );

  /* The card follows the pointer. Anchored to the bar it sat a screen away from the cursor at day
     zoom, where a bar can be wider than the window. */
  /*
    Two things make the card follow: the position is read from the pointer event, and a
    pointermove handler keeps updating it while the pointer travels along the bar.

    The first version of this assertion matched showAssignmentCard(bar, event) anywhere in the
    file. There are two call sites, so breaking one left the other matching and the check passed
    with the card pinned to the bar again. Both halves are named now.
  */
  check(
    "the card reads its position from the pointer",
    code.includes("event?.clientX") && code.includes("event?.clientY"),
    "the card still positions from the bar's own rectangle"
  );
  check(
    "and keeps up while the pointer moves along the bar",
    /addEventListener\("pointermove"[\s\S]{0,260}showAssignmentCard\(bar, event\)/.test(code),
    "there is no pointermove handler, so the card is placed once and left behind"
  );

  /* Dead CSS is the same class of problem as dead code: it reads as live. */
  const css = fs.readFileSync(path.join(here, "resource-management-page.css"), "utf8");
  ["task-row", "resource-row", "availability-row"].forEach((name) => {
    check(
      `resource-management-page.css no longer styles the retired .${name}`,
      !css.includes(`.${name}`),
      `.${name} is still styled but nothing emits it`
    );
  });
  check(
    "and the timeline marks weekend columns",
    code.includes('" weekend"') || code.includes("weekend ?"),
    "no weekend class is emitted"
  );
}

/* ------------------- 46. a bar's label follows the part of the bar you can see

   A bar is positioned by its dates and its label sat at its start, so scrolling to the second
   half of a three-month task left a long rectangle on screen with nothing written on it. The
   only way to find out what it was was to scroll back to where it began.

   labelWindow() is the whole of the reasoning, and it is pure, so unlike the rest of this page
   it can be exercised rather than pattern-matched. Extracted and run here against the cases that
   actually occur while somebody drags the chart. The DOM plumbing around it is checked
   textually below, which is weaker and is why the arithmetic was separated from it.
*/
{
  const page = fs.readFileSync(path.join(here, "resource-management-page.js"), "utf8");

  const source = page.match(/function labelWindow\([\s\S]*?\n}/);
  check("labelWindow is present and extractable", Boolean(source), "no labelWindow in the page");

  if (source) {
    const box = { result: null };
    vm.createContext(box);
    vm.runInContext(`${source[0]}; result = labelWindow;`, box, { filename: "labelWindow" });
    const labelWindow = box.result;

    /* Nothing scrolled: the label belongs at the start of the bar, which is offset 0. */
    const atRest = labelWindow(100, 300, 0, 800);
    check(
      "an unscrolled bar keeps its label at its start",
      atRest.visible && atRest.offset === 0 && atRest.width === 300,
      JSON.stringify(atRest)
    );

    /* The case this exists for: the bar began 250px before the left edge, so the label moves
       250px along it and sits exactly at the edge. */
    const scrolledPast = labelWindow(100, 900, 350, 800);
    check(
      "a bar scrolled past its start moves its label to the visible edge",
      scrolledPast.visible && scrolledPast.offset === 250,
      JSON.stringify(scrolledPast)
    );

    /* And the label is given only the room that is on screen, so it ellipses at the viewport
       rather than running under the next bar or off the end. */
    check(
      "and is given only the width that is actually visible",
      scrolledPast.width === 650,
      `expected 650, got ${scrolledPast.width}`
    );

    /* A bar wholly to the left. Left alone: moving a label nobody can see is a style write for
       nothing, and 0 is the value it will need when it comes back into view. */
    const offLeft = labelWindow(0, 100, 400, 800);
    check(
      "a bar entirely off to the left is left alone",
      offLeft.visible === false && offLeft.offset === 0,
      JSON.stringify(offLeft)
    );

    const offRight = labelWindow(2000, 100, 0, 800);
    check(
      "so is one entirely off to the right",
      offRight.visible === false && offRight.offset === 0,
      JSON.stringify(offRight)
    );

    /* Touching the edge exactly is not visible - a zero-width sliver has nothing to label. This
       is the boundary that an inclusive comparison would get wrong, and it would get it wrong by
       flickering a label on and off as somebody scrolled. */
    const flush = labelWindow(0, 400, 400, 800);
    check(
      "a bar ending exactly at the left edge counts as off screen",
      flush.visible === false,
      JSON.stringify(flush)
    );

    /* Longer than the viewport in both directions: the label rides the left edge and is capped
       at the viewport width. This is a year-zoom bar at day zoom. */
    const spanning = labelWindow(-500, 4000, 200, 700);
    check(
      "a bar longer than the viewport rides the left edge",
      spanning.visible && spanning.offset === 700 && spanning.width === 700,
      JSON.stringify(spanning)
    );

    /* Scrolling back must return it, or the label would creep along the bar and stay there. */
    check(
      "scrolling back returns the label to the start",
      labelWindow(100, 900, 0, 800).offset === 0,
      JSON.stringify(labelWindow(100, 900, 0, 800))
    );
  }

  /* The plumbing. Each of these is a way the arithmetic above could be correct and the page
     still wrong. */
  check(
    "every labelled bar carries the class the tracker looks for",
    (page.match(/class="bar-label"/g) || []).length >= 3 &&
      page.includes('class="task-bar-label bar-label"'),
    "a bar type emits its label without the shared class, so it will not move"
  );
  /*
    Named handler, not just "a scroll listener exists".

    The first version of this check looked for addEventListener("scroll" ... passive: true and
    passed with the whole feature deleted - it was matching the card-hiding listener bound two
    hundred lines earlier. A check that cannot fail is worse than no check, because it is
    counted.
  */
  check(
    "the tracker is bound to the scroller",
    page.includes('scroller.addEventListener("scroll", schedule'),
    "nothing schedules a reposition on scroll, so labels never move"
  );
  check(
    "scroll work is coalesced to one frame",
    /requestAnimationFrame\(\(\) => \{[\s\S]{0,120}positionBarLabels/.test(page),
    "positionBarLabels runs per scroll event rather than per frame"
  );
  check(
    "geometry is re-read after every render",
    /bindLabelTracking\(\);[\s\S]{0,140}refreshBarLabels\(\)/.test(page),
    "the cache is not rebuilt, so labels use the previous zoom's positions"
  );
  check(
    "and after a resize, which moves the right edge",
    /addEventListener\("resize", refreshBarLabels\)/.test(page),
    "resizing the window leaves labels sized for the old viewport"
  );

  const css = fs.readFileSync(path.join(here, "resource-management-page.css"), "utf8");
  check(
    ".bar-label can truncate, or a moved label would overflow its bar",
    /\.bar-label \{[^}]*text-overflow: ellipsis/.test(css),
    ".bar-label has no ellipsis rule"
  );
}

/* ------------------- 47. signing out is a state, not thirty-six failures

   Every page loads both adapters, including the sign-in page and whatever page is showing when
   somebody signs out. Each collection was queried, each was refused for want of a session, and
   each logged its own warning: four from the parent adapter and thirty-two from the child, all
   describing the correct outcome of pressing "sign out" as a fault.

   Worse, the message was false. It said the page was "showing the last known local data" - true
   until Stage 17, when the localStorage mirror was deleted. There is no local copy now: a
   collection that does not load is empty and its page shows nothing. Reassuring and wrong is the
   worst combination, because somebody reading it concludes the screen is merely stale.

   Run for real against both adapters with no session, watching what reaches the console.
*/
{
  const box = {
    Promise, JSON, Math, Date, Object, Array, String, Number, Boolean, Error, Set, Map,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout, structuredClone,
    localStorage: new MockStorage(),
    sessionStorage: new MockStorage(),
    Storage: { prototype: { getItem() {}, setItem() {} } },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {}, setAttribute() {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
      documentElement: { classList: { contains: () => false, add() {}, remove() {}, toggle() {} } },
      addEventListener() {}
    },
    PPMAuth: { getCurrentUser: () => null }
  };

  const said = { warn: [], info: [], error: [] };
  box.console = {
    ...console,
    warn: (...a) => said.warn.push(a.join(" ")),
    info: (...a) => said.info.push(a.join(" ")),
    error: (...a) => said.error.push(a.join(" ")),
    log() {}, group() {}, groupEnd() {}, table() {}
  };

  /* Nobody signed in. from() throws if it is ever reached, so a collection that gets as far as
     querying fails loudly here rather than quietly returning nothing. */
  box.PPMSupabase = {
    from() { throw new Error("queried the database with no session"); },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: null } }) }
    },
    rpc: async () => ({ data: null, error: null })
  };
  box.window = box;
  box.globalThis = box;
  vm.createContext(box);

  ["ppm-core.js", "ppm-data-safety.js", "ppm-data.js", "ppm-database.js", "ppm-child-database.js"].forEach(
    (file) => vm.runInContext(fs.readFileSync(path.join(here, file), "utf8"), box, { filename: file })
  );

  /*
    Both adapters hydrate themselves on load, and that boot is asynchronous and unawaited - it is
    fired from an IIFE at the foot of each file. Measuring immediately after vm.runInContext read
    zero of everything and passed the "no warnings" check for the wrong reason: nothing had run
    yet. Drain the queue first, so what is counted below is the real first pass a page performs.
  */
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));

  /*
    Each adapter has now hydrated once and said its piece. That first pass is exactly what happens
    on a real page; it is checked, then the record is cleared so the explicit calls that follow
    are counted on their own rather than doubled.
  */
  check(
    "booting with no session warns about nothing",
    said.warn.length === 0,
    `${said.warn.length} warning(s) on boot, first: ${said.warn[0] || ""}`
  );
  check(
    "and each adapter accounts for itself once",
    said.info.length === 2,
    `${said.info.length} info line(s) on boot: ${said.info.join(" | ")}`
  );
  said.warn.length = 0;
  said.info.length = 0;

  const parent = await box.PPMDatabase.hydrate();
  const child = await box.PPMChildDatabase.hydrate();

  check(
    "signed out, the parent adapter skips every collection rather than failing them",
    parent.failed.length === 0 && parent.skipped.length > 0,
    `failed ${parent.failed.length}, skipped ${parent.skipped.length}`
  );
  check(
    "and the child adapter does the same across all of its collections",
    child.failed.length === 0 && child.skipped.length > 25,
    `failed ${child.failed.length}, skipped ${child.skipped.length}`
  );
  check(
    "and the reason given is that nobody is signed in",
    [...parent.skipped, ...child.skipped].every((row) => row.reason === "nobody is signed in"),
    JSON.stringify([...parent.skipped, ...child.skipped].map((r) => r.reason).slice(0, 3))
  );

  /* The whole point: quiet. Signing out is not a fault and must not warn. */
  check(
    "signing out produces no warnings at all",
    said.warn.length === 0,
    `${said.warn.length} warning(s), first: ${said.warn[0] || ""}`
  );
  check(
    "and says so once per adapter, not once per collection",
    said.info.length === 2,
    `${said.info.length} info line(s): ${said.info.join(" | ")}`
  );
  check(
    "and nothing reached the database",
    said.error.length === 0,
    said.error.join(" | ")
  );

  /*
    No message anywhere claims a local fallback.

    Checked over the adapters' full source rather than over what this run happened to print,
    because the failure path these strings live on only fires when the database is reachable but
    refuses - which this sandbox cannot produce.
  */
  const adapterSource = ["ppm-database.js", "ppm-child-database.js"]
    .map((file) => fs.readFileSync(path.join(here, file), "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  check(
    "no adapter message promises data the browser no longer keeps",
    !/last (known )?local|local (copy|data) instead/i.test(adapterSource),
    "a message still tells the reader the page is showing local data; there is no mirror to show"
  );
}

/* --------------------------------------------------------------- 12. report */

const width = results.reduce((n, r) => Math.max(n, r.name.length), 0);
results.forEach((r) => {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}${r.detail ? `   ${r.detail}` : ""}`);
});
console.log("-".repeat(70));
console.log(`${results.length - failures}/${results.length} passed`);

/*
  Record the total so the developer specification can quote it instead of carrying a number
  somebody typed. The spec said "128 assertions" long after the harness passed four hundred,
  because prose has no reason to change when the thing it describes does. Written on every run,
  pass or fail, and read at build time by BUILD-SPEC-DEVELOPER.mjs.
*/
fs.writeFileSync(
  path.join(here, "HARNESS-COUNT.json"),
  JSON.stringify(
    { assertions: results.length, sections: SECTION_COUNT, ranAt: new Date().toISOString() },
    null,
    2
  ) + "\n"
);

if (failures) process.exitCode = 1;
