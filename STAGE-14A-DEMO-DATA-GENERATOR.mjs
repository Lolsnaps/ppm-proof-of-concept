/*
  STAGE 14A - demo data generator (offline tooling, never shipped to the browser)

  Purpose
  -------
  Produce a re-runnable SQL seed containing a realistic delivery portfolio, so
  functions, permissions and workflows can be tested against data that looks like
  real life rather than three rows called "test".

  Why a generator instead of hand-written SQL
  ------------------------------------------
  Every child table stores BOTH a legacy_payload (the whole browser record) and a
  set of normalised columns derived from it. The browser reads
  {...legacy_payload, ...non_null_columns}. Hand-writing that twice for ~30 tables
  is how drift gets in: a mistyped column name silently produces a record that
  looks half-empty in the UI and nowhere else.

  So this script loads the REAL field map out of ppm-child-database.js and derives
  the columns exactly the way the adapter's own toColumns()/typedValue() does. If
  the adapter's mapping changes, regenerate and the SQL follows. There is one
  source of truth, and it is the application.

  Usage
  -----
    node STAGE-14A-DEMO-DATA-GENERATOR.mjs

  Writes STAGE-14A-DEMO-DATA.sql and STAGE-14A-DEMO-DATA-REMOVE.sql.

  Determinism
  -----------
  No Math.random and no new Date() anywhere in the dataset. Dates are computed
  from a fixed anchor and identifiers are sequential, so re-running produces a
  byte-identical file. That makes the SQL reviewable in a diff.
*/

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/* The marker written into every seeded row. The remove script deletes strictly
   by this, so the seed can never take real records with it. */
export const MARKER_FIELD = "demoDataSet";
export const MARKER_VALUE = "STAGE-14A";

/* ------------------------------------------------------------------ adapter map

   Pull MODULES and ADAPTER_FIELDS straight out of the shipped adapter by
   extracting the object literals and evaluating them. They are plain data with
   no function values, which is what makes this safe.
--------------------------------------------------------------------------- */
function extractLiteral(source, marker, openChar) {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Could not find "${marker}" in ppm-child-database.js`);
  const open = source.indexOf(openChar, start);
  const close = openChar === "{" ? "}" : "]";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === openChar) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`Unbalanced literal after "${marker}"`);
}

const adapterSource = readFileSync(join(HERE, "ppm-child-database.js"), "utf8");

// eslint-disable-next-line no-eval
export const MODULES = eval(`(${extractLiteral(adapterSource, "const MODULES = {", "{")})`);
// eslint-disable-next-line no-eval
const ADAPTER_FIELD_LIST = eval(
  `(${extractLiteral(adapterSource, "const ADAPTER_FIELDS = new Set(", "[")})`
);
const ADAPTER_FIELDS = new Set(ADAPTER_FIELD_LIST);

const SINGLETON_KEY = "GLOBAL";

/* ------------------------------------------------------- adapter value mapping

   Deliberate copies of ppm-child-database.js typedValue() and payloadOf(). Kept
   as copies rather than imported because the adapter is a browser IIFE with no
   exports; the comment above each is the contract they must keep.
--------------------------------------------------------------------------- */

/* Mirrors typedValue(): empty string and null both mean "no value in this
   column", which is what lets the legacy payload remain the fallback. */
function typedValue(value, type) {
  if (value === undefined || value === null || value === "") return null;
  if (type === "numeric" || type.startsWith("numeric(")) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    if (String(value).toLowerCase() === "true") return true;
    if (String(value).toLowerCase() === "false") return false;
    return null;
  }
  if (type === "jsonb") return value;
  if (type === "date" || type === "timestamptz") return value || null;
  return value;
}

/* Mirrors payloadOf(): adapter bookkeeping never reaches the payload. */
function payloadOf(record) {
  const copy = { ...(record || {}) };
  ADAPTER_FIELDS.forEach((field) => delete copy[field]);
  return copy;
}

/* --------------------------------------------------------------- SQL rendering */

function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function sqlLiteral(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number in seed data: ${value}`);
    return String(value);
  }
  return sqlText(value);
}

/* jsonb is emitted dollar-quoted so no amount of apostrophes or backslashes in
   commentary can break out. The tag is asserted absent from the content. */
function sqlJson(value) {
  const json = JSON.stringify(value);
  if (json.includes("$ppm$")) throw new Error("Seed payload contains the dollar-quote tag $ppm$");
  return `$ppm$${json}$ppm$::jsonb`;
}

function columnList(columns) {
  return Object.keys(columns).join(", ");
}

function valueList(columns) {
  return Object.values(columns)
    .map((entry) => (entry && entry.__json ? sqlJson(entry.value) : sqlLiteral(entry)))
    .join(", ");
}

export function json(value) {
  return { __json: true, value };
}

/* --------------------------------------------------------- child row emission */

/*
  Build the full column set for one child record the way the adapter would, then
  render it as an insert. project_id is resolved by sub-select rather than
  hardcoded: the projects rows are created in the same transaction and their uuids
  are generated by the database.
*/
export function childInsert(moduleName, record, options = {}) {
  const definition = MODULES[moduleName];
  if (!definition) throw new Error(`Unknown module "${moduleName}"`);

  const marked = { ...record, [MARKER_FIELD]: MARKER_VALUE };
  const recordKey =
    definition.shape === "singleton" ? SINGLETON_KEY : String(marked[definition.idField] || "").trim();
  if (!recordKey) throw new Error(`${moduleName}: record has no ${definition.idField}`);

  const usesScope = definition.scopeColumn === "scope_key";
  const columns = {};

  if (usesScope) {
    columns.scope_key = options.scopeKey || SINGLETON_KEY;
    columns.record_key = recordKey;
  } else {
    columns.project_code = options.projectCode || "";
    columns.record_key = recordKey;
  }
  columns.legacy_payload = json(payloadOf(marked));

  if (definition.localKey === "ppmProjectBenefits")
    columns.programme_code = options.programmeCode || null;

  definition.fields.forEach((field) => {
    const value = typedValue(marked[field.field], field.type);
    columns[field.column] = field.type === "jsonb" && value !== null ? json(value) : value;
  });

  if (definition.localKey === "ppmPlanBaselines")
    columns.record_version = typedValue(marked.version, "numeric");

  const names = columnList(columns);
  const values = valueList(columns);

  /* Stage 9 tables carry a project_id foreign key alongside the business key. */
  if (!usesScope && options.projectCode) {
    return (
      `insert into public.${definition.table} (${names}, project_id)\n` +
      `select ${values}, (select id from public.projects where project_code = ${sqlText(options.projectCode)})` +
      `\non conflict do nothing;`
    );
  }
  return `insert into public.${definition.table} (${names})\nvalues (${values})\non conflict do nothing;`;
}

/* Emit many records of one module for one project, as a single statement block. */
export function childInserts(moduleName, records, options = {}) {
  return records.map((record) => childInsert(moduleName, record, options)).join("\n");
}

export { typedValue, payloadOf, sqlText, SINGLETON_KEY };
