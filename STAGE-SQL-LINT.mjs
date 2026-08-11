/*
  Portfolio Manager - SQL safety lint for the STAGE-*.sql migrations

  It touches nothing and connects to nothing: it reads the migration files in this folder
  and reports problems that a plain syntax check cannot see.

      node STAGE-SQL-LINT.mjs

  Exits non-zero if anything is flagged, so VERIFY-ALL.mjs uses it as a gate.

  WHY THIS EXISTS

  PostgreSQL's own parser validates grammar, and plpgsql function bodies are just string
  literals to it, so two whole classes of mistake get through a successful "parse OK".
  Both of these were real bugs found in this project:

    1. "x <> any(array[...])" is true as soon as x differs from ONE element, so it is true
       for very nearly everything. Intended exclusions silently stop excluding. The correct
       form is "<> all". Found in the Stage 12 audit read policy.

    2. "array_agg(catalog_column) = array['a','b']" fails at runtime with "operator does
       not exist: name[] = text[]", because catalog columns such as pg_attribute.attname
       are type "name", not text. Found in STAGE-12-VERIFY.sql.

  It also checks that every BEGIN/IF/LOOP/CASE inside a plpgsql or DO block is closed,
  which catches a truncated or mis-edited function body before it reaches the database.

  Comments, single-quoted strings and nested dollar-quoted literals ($f$...$f$) are all
  removed before analysis. That last one matters: without it, a "create table if not
  exists" inside a format() template reads as an unclosed IF.

  WHY THIS IS JAVASCRIPT AND NOT PYTHON

  It was STAGE-SQL-LINT.py until 9 August 2026. Python is not installed on the machine
  that publishes this tool, and Windows ships an App Execution Alias for "python3" that
  spawns successfully and then prints "Python was not found" - so the gate did not skip,
  it FAILED, and the release script refused to build. Four of the five gates already need
  node and nothing else. A gate nobody can run is not a gate, so the check moved to the
  runtime that is already required. The logic is a direct port; output is identical.
*/

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const NAME_TYPED_CATALOG_COLUMNS =
  "attname|relname|tgname|nspname|policyname|conname|proname|" +
  "column_name|table_name|udt_name|tablename|schemaname|constraint_name";

/* Punctuation is kept as tokens on purpose: "end," ends an expression CASE, whereas
   "end if" closes a block. Discarding commas conflates the two. */
const TOKEN = /[A-Za-z_][A-Za-z0-9_]*|[(),;]/g;

/* Case-insensitive, unlike the Python original. Every migration in this folder writes
   "as $$" in lower case, so this changes nothing today - but a body introduced as
   "AS $$" would have been skipped silently, and a check that inspects some function
   bodies and not others is worse than no check. */
const FUNCTION_BODY = /as \$\$([\s\S]*?)\$\$;/gi;
const ANONYMOUS_BLOCK = /do \$\$([\s\S]*?)\$\$;/gi;

/* Python prints a list as ['begin', 'if']; kept identical so the two can be diffed. */
function asPythonList(items) {
  return `[${items.map((item) => `'${item}'`).join(", ")}]`;
}

function lineOf(text, at) {
  let count = 1;
  for (let i = 0; i < at; i += 1) if (text[i] === "\n") count += 1;
  return count;
}

/* Remove comments, single-quoted strings and nested dollar-quoted literals. */
function stripNoise(text) {
  text = text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)\$[\s\S]*?\$\1\$/g, " @dollar@ ");

  const out = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    if (text.startsWith("--", i)) {
      const end = text.indexOf("\n", i);
      i = end < 0 ? n : end;
    } else if (text.startsWith("/*", i)) {
      /* Nested, because PostgreSQL block comments nest and this project's do. */
      let depth = 1;
      i += 2;
      while (i < n && depth) {
        if (text.startsWith("/*", i)) {
          depth += 1;
          i += 2;
        } else if (text.startsWith("*/", i)) {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
    } else if (text[i] === "'") {
      i += 1;
      while (i < n) {
        if (text[i] === "'" && i + 1 < n && text[i + 1] === "'") i += 2;
        else if (text[i] === "'") {
          i += 1;
          break;
        } else i += 1;
      }
      out.push(" @str@ ");
    } else {
      out.push(text[i]);
      i += 1;
    }
  }

  return out.join("");
}

function checkBlocks(body) {
  const tokens = [...stripNoise(body).toLowerCase().matchAll(TOKEN)].map((match) => match[0]);
  const stack = [];
  const errors = [];
  let k = 0;

  while (k < tokens.length) {
    const word = tokens[k];

    if (word === "end") {
      const following = k + 1 < tokens.length ? tokens[k + 1] : "";
      if (following === "if" || following === "loop" || following === "case") {
        if (!stack.length || stack[stack.length - 1] !== following) {
          errors.push(`'end ${following}' but the open block is ${stack.length ? stack[stack.length - 1] : "none"}`);
        } else {
          stack.pop();
        }
        k += 2;
        continue;
      }
      if (stack.length && (stack[stack.length - 1] === "begin" || stack[stack.length - 1] === "case")) {
        stack.pop();
      } else {
        errors.push(`stray 'end' near: ${tokens.slice(Math.max(0, k - 8), k + 2).join(" ")}`);
      }
      k += 1;
      continue;
    }

    if (word === "begin" || word === "loop" || word === "case") stack.push(word);
    else if (word === "if") stack.push("if");
    else if ((word === "elsif" || word === "elseif") && (!stack.length || stack[stack.length - 1] !== "if")) {
      errors.push("elsif outside an if");
    }
    k += 1;
  }

  if (stack.length) errors.push(`unclosed: ${asPythonList(stack)}`);
  return errors;
}

function checkHazards(sql) {
  const found = [];
  let clean = sql.replace(/\/\*[\s\S]*?\*\//g, "");
  clean = clean.replace(/--[^\n]*/g, "");

  for (const match of clean.matchAll(/(<>|!=)\s*any\s*\(/gi)) {
    found.push([
      lineOf(clean, match.index),
      "'<> ANY' is true if the value differs from ANY element - use '<> ALL'"
    ]);
  }

  const aggregated = new RegExp(
    `array_agg\\s*\\(\\s*(?:distinct\\s+)?[a-z_]*\\.?(${NAME_TYPED_CATALOG_COLUMNS})\\b`,
    "gi"
  );
  for (const match of clean.matchAll(aggregated)) {
    const window = clean.slice(match.index, match.index + 500);
    /* Only the aggregate's own argument list matters, so look no further than its
       first closing bracket. A ::text anywhere after that is a different expression. */
    if (!`${window.split(")")[0]})`.includes("::text")) {
      found.push([
        lineOf(clean, match.index),
        "array_agg over a name-typed catalog column - cast ::text or name[] = text[] fails"
      ]);
    }
  }

  return found;
}

function main() {
  const files = readdirSync(HERE)
    .filter((file) => file.startsWith("STAGE-") && file.endsWith(".sql"))
    .sort();

  if (!files.length) {
    console.log("No STAGE-*.sql files found. Run this from the application folder.");
    return 1;
  }

  let failures = 0;

  for (const path of files) {
    const sql = readFileSync(join(HERE, path), "utf8");
    const problems = [];

    const bodies = [
      ...[...sql.matchAll(FUNCTION_BODY)].map((match) => match[1]),
      ...[...sql.matchAll(ANONYMOUS_BLOCK)].map((match) => match[1])
    ];

    bodies.forEach((body, index) => {
      checkBlocks(body).forEach((error) => problems.push(`block ${index + 1}: ${error}`));
    });
    checkHazards(sql).forEach(([line, message]) => problems.push(`line ${line}: ${message}`));

    if (problems.length) {
      failures += 1;
      console.log(`  FAIL  ${path}`);
      problems.forEach((problem) => console.log(`          ${problem}`));
    } else {
      console.log(`  ok    ${path}  (${bodies.length} block(s))`);
    }
  }

  console.log("");
  if (failures) {
    console.log(`${failures} file(s) need attention.`);
    return 1;
  }
  console.log(`All ${files.length} migration file(s) passed.`);
  return 0;
}

process.exitCode = main();
