/*
  Runs every offline gate in one command.

    node VERIFY-ALL.mjs

  There are five offline gates and they are easy to forget individually, which defeats
  the point of having them. This runs all of them, reports each result, and exits
  non-zero if any fails.

  Every gate runs on node and nothing else. That is deliberate: the SQL lint was a Python
  script until 9 August 2026, and on a machine without Python the release script refused
  to build - Windows answers "python3" with a Microsoft Store stub that starts, prints
  "Python was not found" and exits non-zero, so the gate did not skip, it failed. A gate
  that only runs on the author's machine protects nobody.

  The one gate this cannot run is VERIFY-INVARIANTS.sql, because it needs a database
  connection. Run that in the Supabase SQL editor after any migration; this script
  reminds you at the end.
*/

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const GATES = [
  {
    name: "Behavioural harness",
    what: "the adapters, seams, append-only rules and restore refusals",
    command: ["node", ["STAGE-14-HARNESS.mjs"]]
  },
  {
    name: "Static verification",
    what: "script load order, CSP, cache-busts, dependency pinning, secrets",
    command: ["node", ["VERIFY-STATIC.mjs"]]
  },
  {
    name: "Schema drift",
    what: "the database, the adapters and the migration files agree",
    command: ["node", ["SCHEMA-DRIFT-CHECK.mjs"]]
  },
  {
    name: "SQL lint",
    what: "mistakes a SQL parser accepts but PostgreSQL misinterprets",
    command: ["node", ["STAGE-SQL-LINT.mjs"]]
  },
  {
    name: "Demo data",
    what: "the generated seed is internally consistent",
    command: ["node", ["STAGE-14A-DEMO-VERIFY.mjs"]],
    optional: true
  }
];

function run(binary, args) {
  return spawnSync(binary, args, { cwd: HERE, encoding: "utf8" });
}

const results = [];
let failed = 0;

for (const gate of GATES) {
  const script = gate.command[1][0];
  if (!existsSync(join(HERE, script))) {
    if (gate.optional) continue;
    results.push({ gate, status: "MISSING", summary: `${script} is not in this folder` });
    failed += 1;
    continue;
  }

  const out = run(gate.command[0], gate.command[1]);

  if (out.error) {
    results.push({ gate, status: "SKIPPED", summary: `could not run ${gate.command[0]}: ${out.error.message}` });
    if (!gate.optional) failed += 1;
    continue;
  }

  const text = `${out.stdout || ""}${out.stderr || ""}`.trim();
  const lastLine = text.split("\n").filter(Boolean).pop() || "(no output)";
  const ok = out.status === 0;
  if (!ok) failed += 1;
  results.push({ gate, status: ok ? "PASS" : "FAIL", summary: lastLine, detail: ok ? "" : text });
}

const width = results.reduce((n, r) => Math.max(n, r.gate.name.length), 0);
console.log("Portfolio Manager - release gates\n");
results.forEach((r) => {
  const mark = r.status === "PASS" ? "PASS" : r.status === "FAIL" ? "FAIL" : r.status;
  console.log(`  ${mark.padEnd(7)} ${r.gate.name.padEnd(width)}  ${r.summary}`);
});

const failures = results.filter((r) => r.status === "FAIL");
if (failures.length) {
  failures.forEach((r) => {
    console.log(`\n${"-".repeat(72)}\n${r.gate.name} - full output:\n`);
    console.log(r.detail);
  });
}

console.log(`\n${"-".repeat(72)}`);
if (failed) {
  console.log(`${failed} gate(s) failed. Do not release.`);
  process.exitCode = 1;
} else {
  console.log("All offline gates passed.");
  console.log("");
  console.log("Still to do by hand:");
  console.log("  - Database invariants: run VERIFY-INVARIANTS.sql in the Supabase SQL editor");
  console.log("    (needed after any migration - it checks RLS, policies, grants and triggers)");
  console.log("  - Smoke test signed in: authenticator, one page per nav entry, one save, one workflow");
}
