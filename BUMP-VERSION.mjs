/*
  Portfolio Manager - version stamp updater

    node BUMP-VERSION.mjs            bump to today's next counter and restamp every page
    node BUMP-VERSION.mjs --check    report anything unstamped, change nothing (exit 1 if any)

  Rewrites the ?v= tag on every .js and .css reference in every .html page in this folder, so
  browsers stop serving cached copies of files that have just changed. The new version is
  today's date plus a counter: 2026.08.09.1, then .2 on a second run the same day.

  Double-click bump-version.cmd to run it.

  WHY THIS IS JAVASCRIPT

  It was bump-version.ps1, which meant the only way to run it was on Windows, by hand. Every
  other tool in this folder runs on node - the five release gates, the deploy set, the
  generators - so the version stamp was the one step that could not be checked or repeated
  anywhere else. That gap cost something real: with no runnable copy, the stamp got
  reimplemented from memory in a one-off script, the imitation applied a rule meant for the
  page-loader list to every <script src> tag, and 168 references across 21 pages silently lost
  their version. Nothing was broken on screen - a page just quietly served whatever the browser
  had cached, which is the failure this file exists to prevent.

  So: one implementation, on the runtime everything else already needs.

  THE FOUR STEPS, AND WHY EACH IS SEPARATE

    1. strip the existing tag from src= and href= references
    2. add the new tag to those same references
    3. restamp the page loader's own data-ppm-scripts list, which is pipe-separated and
       therefore invisible to steps 1 and 2
    4. take the tag back off the fixed third-party files, which never change

  Step 3 operates ONLY on the captured contents of data-ppm-scripts, never on the whole
  document. That confinement is the point: a rule written for a pipe-separated list, let loose
  on the whole page, is what caused the incident described above.

  THE PATTERN THAT MATTERS

  Tags are matched as \?v=[0-9.]* and never \?[^"]*. The second is greedy to the closing quote,
  so the moment a skipped file appears inside data-ppm-scripts it swallows every entry after it.
  That deleted three scripts from reports.html once, which is why the narrow form is used here
  and why --check exists.
*/

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/* Fixed third-party files that never change, so they keep no version tag. */
const SKIP = ["pdfmake.min.js", "vfs_fonts.js"];

/* A reference the browser fetches, written as an attribute. The leading (^|[\s"']) keeps this
   from matching the tail of some other attribute name that happens to end in src or href. */
const ATTRIBUTE = /(\s(?:src|href)=")([A-Za-z0-9.\-]+\.(?:js|css))(\?v=[0-9.]*)?(")/g;

function pages() {
  return readdirSync(HERE).filter((file) => file.endsWith(".html")).sort();
}

/*
  The two generated specification documents are .html and carry the build version in their
  footers, so the version-consistency check must see them. What must NOT see them is anything
  that reads their contents as page structure: they quote data-ppm-scripts attributes as
  examples, and a worked example of adding a page was being read as a page that had been added
  and left unstamped.

  Scoped here rather than in the gate so that the tool writing the tags and the gate requiring
  them keep agreeing about which files are pages.
*/
const DOCUMENTS = ["DEVELOPER-SPECIFICATION.html", "USER-SPECIFICATION.html"];

function appPages() {
  return pages().filter((file) => !DOCUMENTS.includes(file));
}

function nextVersion() {
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join(".");

  let counter = 1;
  try {
    const previous = readFileSync(join(HERE, "VERSION"), "utf8").trim();
    const match = previous.match(new RegExp(`^${today.replace(/\./g, "\\.")}\\.(\\d+)$`));
    if (match) counter = Number(match[1]) + 1;
  } catch {
    /* No VERSION file yet; start at .1 */
  }

  return `${today}.${counter}`;
}

function restamp(text, version) {
  /* 1 and 2 together: the capture groups make stripping and re-adding one pass. */
  let out = text.replace(ATTRIBUTE, (whole, lead, file, tag, close) =>
    SKIP.includes(file) ? `${lead}${file}${close}` : `${lead}${file}?v=${version}${close}`
  );

  /* 3. Confined to the attribute's own value. */
  out = out.replace(/data-ppm-scripts="([^"]*)"/g, (whole, list) => {
    const stamped = list
      .split("|")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const file = entry.split("?")[0];
        return SKIP.includes(file) ? file : `${file}?v=${version}`;
      })
      .join("|");
    return `data-ppm-scripts="${stamped}"`;
  });

  return out;
}

/* Every reference that ought to carry a tag and does not. Used by --check, and by the release
   gate, so an unstamped page is a failure rather than a thing somebody notices later. */
export function unstamped() {
  const found = [];
  appPages().forEach((page) => {
    const text = readFileSync(join(HERE, page), "utf8");

    [...text.matchAll(ATTRIBUTE)].forEach((match) => {
      const [, , file, tag] = match;
      if (SKIP.includes(file)) {
        if (tag) found.push({ page, file, why: "carries a tag but is a fixed third-party file" });
        return;
      }
      if (!tag) found.push({ page, file, why: "has no ?v= tag" });
    });

    [...text.matchAll(/data-ppm-scripts="([^"]*)"/g)].forEach((match) => {
      match[1]
        .split("|")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => {
          const file = entry.split("?")[0];
          const tagged = /\?v=[0-9.]+$/.test(entry);
          if (SKIP.includes(file)) {
            if (tagged) found.push({ page, file, why: "tagged inside data-ppm-scripts but is fixed" });
            return;
          }
          if (!tagged) found.push({ page, file, why: "has no ?v= tag inside data-ppm-scripts" });
        });
    });
  });
  return found;
}

/* Every distinct version stamp in use. More than one means a page loads a mix of old and new. */
export function versionsInUse() {
  const seen = new Map();
  pages().forEach((page) => {
    [...readFileSync(join(HERE, page), "utf8").matchAll(/\?v=([0-9.]+)/g)].forEach((match) => {
      if (!seen.has(match[1])) seen.set(match[1], new Set());
      seen.get(match[1]).add(page);
    });
  });
  return seen;
}

/* --------------------------------------------------------------------- entry */

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const list = pages();
  if (!list.length) {
    console.log("No .html pages found in this folder. Nothing to do.");
    process.exit(1);
  }

  if (process.argv.includes("--check")) {
    const missing = unstamped();
    const versions = versionsInUse();

    console.log(`\nChecked ${list.length} page(s). Nothing has been changed.\n`);
    console.log(`  version stamp(s) in use: ${[...versions.keys()].sort().join(", ") || "none"}`);
    console.log(`  unstamped reference(s):  ${missing.length}`);

    if (versions.size > 1) {
      console.log("\nMore than one version is in use, so some page loads a mix of old and new:");
      [...versions.entries()].sort().forEach(([version, where]) => {
        console.log(`  ${version}  ${[...where].sort().join(", ")}`);
      });
    }
    if (missing.length) {
      console.log("");
      missing.forEach((entry) => console.log(`  ${entry.page.padEnd(28)} ${entry.file.padEnd(26)} ${entry.why}`));
      console.log("\nRun node BUMP-VERSION.mjs to fix all of them.\n");
    } else {
      console.log("");
    }
    process.exit(missing.length || versions.size > 1 ? 1 : 0);
  }

  const version = nextVersion();
  console.log(`\nPortfolio Manager - updating the version stamp`);
  console.log(`New version: ${version}\n`);

  let changedPages = 0;
  let changedRefs = 0;

  list.forEach((page) => {
    const path = join(HERE, page);
    const original = readFileSync(path, "utf8");
    const text = restamp(original, version);
    const refs = (text.match(new RegExp(`\\?v=${version.replace(/\./g, "\\.")}`, "g")) || []).length;
    changedRefs += refs;

    if (text !== original) {
      writeFileSync(path, text);
      changedPages += 1;
      console.log(`  updated  ${page.padEnd(32)}${refs} reference(s)`);
    }
  });

  writeFileSync(join(HERE, "VERSION"), `${version}\n`);

  const missing = unstamped();
  console.log(`\nDone. ${changedRefs} file reference(s) updated across ${changedPages} page(s).`);
  if (missing.length) {
    console.log(`\nWARNING: ${missing.length} reference(s) are still unstamped:`);
    missing.forEach((entry) => console.log(`  ${entry.page}  ${entry.file}  ${entry.why}`));
    process.exitCode = 1;
  } else {
    console.log("Anyone opening the tool now will load the latest files.");
  }
  console.log("");
}
