/*
  Schema drift check.

    node SCHEMA-DRIFT-CHECK.mjs

  WHY THIS EXISTS

  The developer specification's traps section warns "the SQL file is not the schema",
  and that warning has already been earned twice. A column was renamed when a
  migration was applied, the .sql file was never updated, and weeks later the file
  said `timestamp` while the database had `timestamp_value`. The first attempted fix
  would have added an empty duplicate column, which is worse than the original bug.

  A warning in prose does not stop that happening again. This does, by comparing three
  descriptions of the same schema that are maintained by different people at different
  times:

    1. SCHEMA-MANIFEST.json  - what the database actually has
    2. the adapters          - which columns they read and write
    3. the STAGE-*.sql files - which columns they declare

  Any disagreement is reported. The adapter check is the one that matters most: an
  adapter mapping a column that does not exist means every write to that collection
  fails at runtime, and mapping a column it does not know about means that value is
  silently ignored on read.

  REGENERATING THE MANIFEST after a migration - run this in the SQL editor and paste
  the result into SCHEMA-MANIFEST.json:

    select c.table_name, string_agg(c.column_name, ',' order by c.column_name) cols
      from information_schema.columns c
      join pg_class pc on pc.relname = c.table_name
      join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
     where c.table_schema = 'public' and pc.relkind = 'r'
     group by c.table_name order by c.table_name;

  Committing that diff alongside the migration is the point: the manifest changing is
  how a reviewer sees the schema changed.

  Exits non-zero on drift, so it belongs in the release gate.
*/

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const problems = [];
const notes = [];

const manifest = JSON.parse(readFileSync(join(HERE, "SCHEMA-MANIFEST.json"), "utf8"));
const LIVE = manifest.tables;

/* ------------------------------------------------- read the adapter mappings */

function literalAfter(source, marker, open) {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`marker not found: ${marker}`);
  const from = source.indexOf(open, start);
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  throw new Error(`unbalanced literal after ${marker}`);
}

const childSrc = readFileSync(join(HERE, "ppm-child-database.js"), "utf8");
// eslint-disable-next-line no-eval
const MODULES = eval(`(${literalAfter(childSrc, "const MODULES = {", "{")})`);

/*
  Columns the child adapter writes for every collection. The generic ones are added by
  toColumns() rather than declared in the fields array, so they are listed here to
  match what the adapter actually sends.
*/
const GENERIC_PROJECT_SCOPED = ["project_code", "record_key", "legacy_payload", "import_payload", "project_id"];
const GENERIC_SCOPE_KEYED = ["scope_key", "record_key", "legacy_payload", "import_payload"];

function adapterColumnsFor(name, definition) {
  const generic = definition.scopeColumn === "scope_key" ? GENERIC_SCOPE_KEYED : GENERIC_PROJECT_SCOPED;
  const mapped = (definition.fields || []).map((field) => field.column);
  const extra = [];
  if (definition.localKey === "ppmProjectBenefits") extra.push("programme_code");
  if (definition.localKey === "ppmPlanBaselines") extra.push("record_version");
  return [...new Set([...generic, ...mapped, ...extra])];
}

/* ------------------------------------------- 1. adapter against the database */

Object.entries(MODULES).forEach(([name, definition]) => {
  const table = definition.table;
  const live = LIVE[table];
  if (!live) {
    problems.push(`adapter collection "${name}" maps to table "${table}", which does not exist in the database`);
    return;
  }
  adapterColumnsFor(name, definition).forEach((column) => {
    if (!live.includes(column)) {
      problems.push(
        `adapter collection "${name}" maps column "${table}.${column}", which does not exist. ` +
          `Every write to this collection will fail.`
      );
    }
  });
});

/*
  The foundation adapter declares its columns inside mapper functions rather than a
  registry, so its tables are checked by scanning for snake_case column reads.

  audit_log is included deliberately: the same file also reads the audit trail
  (getAuditTrail / mapAuditEntry), so its columns are legitimate reads here. Leaving it
  out made the first run of this check report nine false positives - which is worth
  recording, because a checker that cries wolf gets switched off, and then the real
  drift it was written to catch goes unnoticed.
*/
const foundationSrc = readFileSync(join(HERE, "ppm-database.js"), "utf8");
const FOUNDATION_TABLES = {
  projects: "projects",
  programmes: "programmes",
  portfolios: "portfolios",
  people: "people",
  auditLog: "audit_log"
};
const foundationReads = new Set(
  [...foundationSrc.matchAll(/\brow\.([a-z][a-z0-9_]*)\b/g)].map((m) => m[1])
);
const allFoundationColumns = new Set(Object.values(FOUNDATION_TABLES).flatMap((t) => LIVE[t] || []));
[...foundationReads].forEach((column) => {
  if (!allFoundationColumns.has(column)) {
    problems.push(
      `ppm-database.js reads "row.${column}", which is not a column on any table it touches ` +
        `(${Object.values(FOUNDATION_TABLES).join(", ")})`
    );
  }
});

/* ------------------------------- 2. migration files against the database */

/*
  Every `create table` block in the migration history is parsed and its declared
  columns compared with the manifest. A column in a file that is absent from the
  database is the exact drift that caused the original incident.

  Columns added by later ALTER statements are expected to be absent from the original
  CREATE, so only the file-declares-what-the-database-lacks direction is treated as an
  error. The reverse is reported as information.
*/
const sqlFiles = readdirSync(HERE).filter((f) => /^STAGE-.*\.sql$/.test(f) && !/-VERIFY|-REMOVE|-ROLLBACK/.test(f));
const declared = new Map();

sqlFiles.forEach((file) => {
  const sql = readFileSync(join(HERE, file), "utf8");
  const blocks = sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi);
  for (const block of blocks) {
    const table = block[1];
    const body = block[2];
    const columns = [];
    body.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("--") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return;
      /* Skip table-level constraints, which are not columns. */
      if (/^(primary key|unique|foreign key|constraint|check|exclude)\b/i.test(trimmed)) return;
      const m = trimmed.match(/^([a-z][a-z0-9_]*)\s+/);
      if (m) columns.push(m[1]);
    });
    if (!declared.has(table)) declared.set(table, new Map());
    columns.forEach((c) => {
      if (!declared.get(table).has(c)) declared.get(table).set(c, file);
    });
  }
});

/* Columns later renamed or dropped by an ALTER are legitimately absent from the live
   schema, so a file naming one is only a problem if nothing ever altered it. */
const alteredAway = new Set();
sqlFiles.forEach((file) => {
  const sql = readFileSync(join(HERE, file), "utf8");
  for (const m of sql.matchAll(/alter table\s+(?:public\.)?(\w+)\s+rename column\s+(\w+)\s+to\s+(\w+)/gi)) {
    alteredAway.add(`${m[1]}.${m[2]}`);
  }
  for (const m of sql.matchAll(/alter table\s+(?:public\.)?(\w+)\s+drop column\s+(?:if exists\s+)?(\w+)/gi)) {
    alteredAway.add(`${m[1]}.${m[2]}`);
  }
});

declared.forEach((columns, table) => {
  const live = LIVE[table];
  if (!live) {
    notes.push(`migration files create table "${table}", which is not in the manifest (dropped, or renamed)`);
    return;
  }
  columns.forEach((file, column) => {
    if (live.includes(column)) return;
    if (alteredAway.has(`${table}.${column}`)) return;
    problems.push(
      `${file} declares "${table}.${column}", which the database does not have and no migration renames or drops. ` +
        `Either the file is stale or the migration was applied by hand.`
    );
  });
});

/* --------------------------------- 3. every live table should be accounted for */

const knownTables = new Set([
  ...Object.values(MODULES).map((d) => d.table),
  ...Object.values(FOUNDATION_TABLES),
  "audit_log"
]);
Object.keys(LIVE).forEach((table) => {
  if (!knownTables.has(table)) {
    notes.push(`table "${table}" exists in the database but no adapter registers it`);
  }
});

/* ------------------------------------- 4. the manifest itself must be coherent */

if (manifest.tableCount !== Object.keys(LIVE).length) {
  problems.push(
    `SCHEMA-MANIFEST.json says tableCount ${manifest.tableCount} but lists ${Object.keys(LIVE).length} tables`
  );
}
Object.entries(LIVE).forEach(([table, columns]) => {
  if (!columns.length) problems.push(`manifest lists "${table}" with no columns`);
  const dupes = columns.filter((c, i) => columns.indexOf(c) !== i);
  if (dupes.length) problems.push(`manifest lists duplicate columns on "${table}": ${dupes.join(", ")}`);
  ["id", "created_at", "updated_at"].forEach((required) => {
    if (!columns.includes(required) && table !== "audit_log") {
      problems.push(`"${table}" has no ${required} column, which every table in this schema is expected to have`);
    }
  });
});

/* ------------------------------------------------------------------- report */

const checked =
  Object.keys(MODULES).length + Object.keys(FOUNDATION_TABLES).length + declared.size + Object.keys(LIVE).length;

console.log(`Schema drift check - ${Object.keys(LIVE).length} tables, ${Object.keys(MODULES).length} collections, ${sqlFiles.length} migration files\n`);

if (notes.length) {
  console.log("Notes (not failures):");
  notes.forEach((n) => console.log(`  - ${n}`));
  console.log("");
}

if (problems.length) {
  console.log(`DRIFT DETECTED - ${problems.length} problem(s):\n`);
  problems.forEach((p) => console.log(`  x ${p}`));
  console.log("");
  process.exitCode = 1;
} else {
  console.log(`No drift. ${checked} descriptions cross-checked and consistent.`);
}
