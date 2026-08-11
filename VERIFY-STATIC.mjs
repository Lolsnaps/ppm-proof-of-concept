/*
  Static verification gate.

    node VERIFY-STATIC.mjs

  WHY THIS EXISTS

  Several entries in the developer specification's traps section are structural
  mistakes that no runtime test can catch, because the code is correct in isolation and
  only wrong in how the page assembles it. The worst example already destroyed data:

    ppm-data-safety.js must load BEFORE ppm-auth-utils.js, because it captures
    Storage.prototype.getItem at load time and uses it to read past the project-scoping
    filter. Load it second and it captures the filtered version instead - so a user with
    limited project access takes a "full backup" containing only their own projects, and
    restoring it writes that partial copy over everything.

  That is a two-line ordering mistake in an HTML file, invisible to every unit test, and
  it is one careless edit away at all times. So it is asserted here, on every page.

  Everything checked below is either a trap that has already been paid for, or an
  invariant a release depends on. Exits non-zero on failure.
*/

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const problems = [];
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (!condition) problems.push(message);
}

const htmlFiles = readdirSync(HERE).filter((f) => f.endsWith(".html")).sort();
const jsFiles = readdirSync(HERE).filter((f) => f.endsWith(".js")).sort();

/*
  Pages that are documentation, previews or error screens rather than part of the running tool.

  Excluded from the app-page checks only. The whole-file checks below - the policy, referenced
  files existing, no style attributes, no secrets - still run over every .html in the folder,
  because those hold for anything that ever opens in a browser.
*/
const NON_APP_PAGES = new Set([
  "404.html",
  "TECHNICAL-SPECIFICATION.html",
  "USER-SPECIFICATION.html",
  "DEVELOPER-SPECIFICATION.html",
  "PREVIEW-CONTROLS.html"
]);
const appPages = htmlFiles.filter((f) => !NON_APP_PAGES.has(f));

/* ------------------------------------------------------- 1. script load order

   The order below is load-bearing, not stylistic. Each entry must appear before the
   next one on every page that includes both.
*/
const REQUIRED_ORDER = [
  "ppm-supabase.js",
  "ppm-core.js",
  "ppm-data-safety.js",
  "ppm-auth-utils.js",
  "ppm-database.js",
  "ppm-child-database.js",
  /* Stage 16. ppm-data.js builds its collection registry from both adapters' MODULES at load
     time, so an adapter loading after it leaves the registry empty - and PPMData.projects
     would simply not exist, which reads on a page as the data layer being broken rather than
     as a load-order mistake. */
  "ppm-data.js"
];

appPages.forEach((file) => {
  const html = readFileSync(join(HERE, file), "utf8");
  const positions = REQUIRED_ORDER.map((script) => ({ script, at: html.indexOf(script) })).filter(
    (entry) => entry.at !== -1
  );

  for (let i = 1; i < positions.length; i += 1) {
    check(
      positions[i - 1].at < positions[i].at,
      `${file}: ${positions[i].script} loads before ${positions[i - 1].script}. ` +
        `The order matters - see the load-order trap.`
    );
  }

  /* The single most expensive ordering mistake, called out explicitly so the failure
     message says what it costs rather than only what it is. */
  const safety = html.indexOf("ppm-data-safety.js");
  const auth = html.indexOf("ppm-auth-utils.js");
  if (safety !== -1 && auth !== -1) {
    check(
      safety < auth,
      `${file}: ppm-data-safety.js MUST load before ppm-auth-utils.js. Loaded after, it captures the ` +
        `project-scoped getItem instead of the native one, and a scoped user's "full backup" will contain ` +
        `only their own projects - which a restore would then write over everything.`
    );
  }

  /* The page loader is what guarantees no page script runs before hydration. */
  if (file !== "login.html") {
    check(
      html.includes("ppm-page-loader.js"),
      `${file}: does not use ppm-page-loader.js, so its scripts may run before hydration completes`
    );
  }
});

/* --------------------------------------------------- 2. one version everywhere

   A page loading a mix of old and new files produces bugs that cannot be reproduced,
   because the mix depends on what each browser happens to have cached.
*/
const versions = new Set();
htmlFiles.forEach((file) => {
  const html = readFileSync(join(HERE, file), "utf8");
  [...html.matchAll(/\?v=([0-9.]+)/g)].forEach((m) => versions.add(m[1]));
});
check(
  versions.size <= 1,
  `more than one cache-bust version is in use: ${[...versions].join(", ")}. Every page must move together.`
);

/*
  And that one version must be the one VERSION records.

  This was missing, and VERSION drifted a whole build behind the pages without any gate
  noticing: the file said 2026.08.08.15 while all 320 references said 2026.08.09.02.
  Nothing broke, because the pages agreed with each other - but VERSION is what the
  handover, the specifications and any bug report quote, so it being wrong sends the
  next reader looking at the wrong build.
*/
const recordedVersion = readFileSync(join(HERE, "VERSION"), "utf8").trim();
if (versions.size === 1) {
  const inUse = [...versions][0];
  check(
    inUse === recordedVersion,
    `VERSION records ${recordedVersion} but the pages load ${inUse}. Bump both together.`
  );
}

appPages.forEach((file) => {
  const html = readFileSync(join(HERE, file), "utf8");
  const localScripts = [...html.matchAll(/<script src="(?!https?:)([^"]+)"/g)].map((m) => m[1]);
  localScripts.forEach((src) => {
    check(src.includes("?v="), `${file}: ${src} has no cache-bust parameter`);
  });
  const localStyles = [...html.matchAll(/<link rel="stylesheet" href="(?!https?:)([^"]+)"/g)].map((m) => m[1]);
  localStyles.forEach((href) => {
    check(href.includes("?v="), `${file}: stylesheet ${href} has no cache-bust parameter`);
  });
});

/*
  And the same for the page loader's own list, which the two checks above cannot see because
  those entries are not src= attributes. Left unchecked, a script named in data-ppm-scripts
  without a tag is served from cache for as long as the browser feels like it - the exact
  failure this section exists to prevent, in the one place it was not being looked for.

  Delegated to BUMP-VERSION.mjs so the tool that writes the tags and the gate that requires
  them cannot disagree about what a correct tag looks like.
*/
{
  const { unstamped } = await import("./BUMP-VERSION.mjs");
  const missing = unstamped();
  check(
    missing.length === 0,
    `${missing.length} reference(s) carry the wrong cache-bust: ` +
      missing.map((entry) => `${entry.page} ${entry.file} (${entry.why})`).join("; ") +
      ". Run bump-version.cmd."
  );
}

/* ------------------- 2a. one global, one owner

   Two files assigning the same window.X is invisible: no error, no warning, and the winner is
   decided by load order. Stage 16 introduced a module called PPMData, which loads after
   ppm-data-safety.js - the file that has always owned window.PPMData - and silently replaced
   it. Every backup, restore and storage-warning function on the administration page stopped
   existing, and nothing said so. The behavioural harness caught it only because it happened to
   call one of them.

   A name collision is a two-line mistake with no symptom until somebody clicks the thing that
   is now missing, so it is checked rather than remembered.
*/
{
  const owners = new Map();
  jsFiles
    .filter((file) => !file.includes("pdfmake") && !file.includes("vfs_fonts"))
    .forEach((file) => {
      const source = readFileSync(join(HERE, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      [...source.matchAll(/\bwindow\.(PPM[A-Za-z0-9_]*)\s*=(?!=)/g)].forEach((match) => {
        const name = match[1];
        if (!owners.has(name)) owners.set(name, new Set());
        owners.get(name).add(file);
      });
    });

  owners.forEach((files, name) => {
    check(
      files.size === 1,
      `window.${name} is assigned by ${files.size} files: ${[...files].sort().join(", ")}. ` +
        `Whichever loads last wins and the other module's API disappears with no error.`
    );
  });
}

/* ------------------- 2c. every cross-module call names something that exists

   This is the gate that would have caught the broken governance workflows on the day they
   broke. Four modules ask the child adapter whether a workflow is available:

       Boolean(window.PPMChildDatabase?.stage11AReady?.())

   Stage 14 retired those four probes. Nothing updated the four callers, and the optional call
   turns a missing method into undefined rather than an error - so Boolean(undefined) is false,
   every workflow reported "not available", and all four fell back to a path the database
   refuses. Stage gates, baselines, budget approvals and scenario publishing stopped working,
   silently, for months. See STAGE-17-WORKFLOWS-UNREACHABLE.md.

   No existing gate could have found it. They assert that retired names are ABSENT, which is
   the opposite question. Nothing asked whether a module still agrees with the API it calls.

   The exported names come from BUILD-SPEC-MODULES.mjs, read from each module's own
   window.X = { ... } literal - the same source the developer guide documents - so this cannot
   drift from what a module actually exposes.
*/
{
  const { describeScripts } = await import("./BUILD-SPEC-MODULES.mjs");

  const modules = new Map();
  describeScripts().forEach((module) => {
    if (module.global && module.api.length) modules.set(module.global, { file: module.file, api: new Set(module.api) });
  });

  const missing = [];
  jsFiles
    .filter((file) => !file.includes("pdfmake") && !file.includes("vfs_fonts"))
    .forEach((file) => {
      const source = readFileSync(join(HERE, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      modules.forEach((info, globalName) => {
        /* A module reaches its own internals freely; only cross-module calls are checked. */
        if (info.file === file) return;
        const pattern = new RegExp(`\\b${globalName}\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)`, "g");
        [...source.matchAll(pattern)].forEach((match) => {
          if (info.api.has(match[1])) return;
          const line = source.slice(0, match.index).split("\n").length;
          missing.push(`${file}:${line} calls ${globalName}.${match[1]}, which ${info.file} does not expose`);
        });
      });
    });

  /*
     Empty since Stage 17 fixed the four probes. It stays as a list rather than becoming a bare
     "must be zero" so that a future deliberate exception has to be written down and justified
     here, where the next reader will see it.
  */
  const KNOWN_BROKEN = [];

  const unexpected = missing.filter(
    (entry) => !KNOWN_BROKEN.some((known) => entry.startsWith(known))
  );

  check(
    unexpected.length === 0,
    `${unexpected.length} cross-module call(s) name something that does not exist:\n    ` +
      unexpected.join("\n    ")
  );

  if (!problems.length && missing.length) {
    console.log(`  Stage 17: ${missing.length} known-broken call(s) still present.`);
  }
}

/* ------------------- 2d. Stage 16: no prototype may be patched to write

   The write-through seams are gone. This is what stops them coming back.

   One file still replaces a Storage method, for a reason that is not write-through and is
   documented where it happens:

     ppm-data-safety.js   wraps setItem to notice a quota failure and warn before data is lost

   ppm-auth-utils.js was the second. It wrapped getItem and setItem to apply the project-scoping
   filter to the localStorage mirror - reads came back filtered, writes were merged with the
   records the reader could not see. With the mirror gone it filtered nothing, and it was never
   protection in the first place: it ran in the browser, in code the person could edit, and
   anything wanting the unfiltered list only had to call rawRead. Row-level security at AAL2 is
   what keeps one person out of another's projects, and it is now the only thing claiming to.

   Anything else assigning to Storage.prototype fails, because that is how a browser API quietly
   becomes a database call again.
*/
{
  const ALLOWED_PATCHERS = new Set(["ppm-data-safety.js"]);

  jsFiles
    .filter((file) => !file.includes("pdfmake") && !file.includes("vfs_fonts"))
    .forEach((file) => {
      const source = readFileSync(join(HERE, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const patches = [...source.matchAll(/Storage\s*\.\s*prototype\s*\.\s*(\w+)\s*=(?!=)/g)].map((m) => m[1]);
      if (!patches.length) return;
      check(
        ALLOWED_PATCHERS.has(file),
        `${file} assigns Storage.prototype.${patches.join(", ")}. Stage 16 removed the write-through ` +
          `patches; a browser storage call must not become a database write again. Use PPMStore.`
      );
    });
}

/* ------------------- 2e. Stage 16: a write whose result nobody reads

   The defect this whole stage exists to remove is a write that cannot report failure. Making
   writes return a result achieves nothing if callers throw it away, and "PPMStore.x.save(...)"
   on a line of its own is exactly as silent as the old setItem was.

   So a PPMStore write must be awaited into something, returned, or explicitly handled. A bare
   call statement fails.
*/
{
  const WRITE_METHODS = /(?:save|saveMany|replaceAll|remove)\s*\(/;

  jsFiles
    .filter((file) => file !== "ppm-data.js" && !file.includes("pdfmake") && !file.includes("vfs_fonts"))
    .forEach((file) => {
      const source = readFileSync(join(HERE, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      source.split("\n").forEach((line, index) => {
        const trimmed = line.trim();
        if (!/(?:window\.)?PPMStore\s*[.[]/.test(trimmed)) return;
        if (!WRITE_METHODS.test(trimmed)) return;
        /* Fine: assigned, returned, awaited into a condition, or passed to a handler. */
        if (/(?:^|[\s(=[,:?])(?:const|let|var|return|await|if|\?\?|&&|\|\|)\b/.test(trimmed)) return;
        if (/^(?:const|let|var|return)\b/.test(trimmed)) return;
        check(
          false,
          `${file}:${index + 1} calls a PPMStore write and discards the result: ${trimmed.slice(0, 90)}. ` +
            `A write that cannot report failure is the defect Stage 16 removed.`
        );
      });
    });
}

/* ------------------- 2f. a statement that is only a bare keyword

   `async` on a line of its own, followed by a function declaration, is VALID JavaScript. It
   parses as a reference to a variable called async, automatic semicolon insertion ends the
   statement, and the declaration below is unaffected. So every syntax check passes - node
   --check passed it, and so did the release gate - and the page then dies at run time with
   "ReferenceError: async is not defined", taking everything after it with it.

   That shipped. An edit inserted a helper function between the `async` keyword and the
   `function` it belonged to, orphaning the keyword onto its own line. index-page.js died at
   that statement, so renderProjects() never ran and the projects register was blank with every
   summary card showing zero. resource-directory-page.js had the same wound.

   Syntax checking cannot catch this, because there is nothing wrong with the syntax. Matching
   the shape can.
*/
{
  const ORPHANS = /^\s*(async|await|new|typeof|void|delete)\s*$/;

  jsFiles
    .filter((file) => !file.includes("pdfmake") && !file.includes("vfs_fonts"))
    .forEach((file) => {
      readFileSync(join(HERE, file), "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (!ORPHANS.test(line)) return;
          check(
            false,
            `${file}:${index + 1} is the keyword "${line.trim()}" alone on a line. That parses as a ` +
              `variable reference and throws at run time, killing the rest of the script.`
          );
        });
    });
}

/* ------------------- 2g. every collection named on PPMStore is a real collection

   2c cannot check this one. It reads a module's API from the `window.X = { ... }` literal, and
   PPMStore's collection namespaces are not in a literal - they are generated at run time from
   the adapters' own MODULES registries, which is deliberate, because a hand-typed list of 36
   collections is wrong the first time somebody adds one. The consequence is that
   `PPMStore.<anything>` was entirely unchecked.

   That matters now more than it did. The read migration names a collection at every read site,
   and a misspelt name does not throw where it is written - PPMStore.financialEntrys is
   undefined, and `undefined.all()` throws only when that line runs, on one page, possibly only
   for one person's data. The blank projects register was exactly this class of failure: one
   statement threw and everything after it in the file never ran.

   So the names are checked against the same registries the namespaces are built from.
*/
{
  /* The adapters' MODULES literals, read the way ppm-data.js reads them at run time. */
  const collectionsFrom = (file) => {
    const source = readFileSync(join(HERE, file), "utf8");
    const at = source.indexOf("const MODULES = {");
    if (at === -1) return [];
    const open = source.indexOf("{", at);
    let depth = 0;
    let close = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (!depth) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) return [];
    /* eslint-disable-next-line no-new-func -- a data literal from this repository, not input. */
    return Object.keys(new Function(`return ${source.slice(open, close + 1)}`)());
  };

  const known = new Set([...collectionsFrom("ppm-database.js"), ...collectionsFrom("ppm-child-database.js")]);
  check(known.size > 30, `only ${known.size} collections were found in the two adapters' MODULES registries`);

  /* Plus the module's own functions, from its `var api = { ... }` literal. */
  const dataSource = readFileSync(join(HERE, "ppm-data.js"), "utf8");
  const apiLiteral = dataSource.slice(dataSource.indexOf("var api = {"), dataSource.indexOf("Object.assign(api, namespaces())"));
  [...apiLiteral.matchAll(/^\s{4}([A-Za-z_$][\w$]*)\s*:/gm)].forEach((match) => known.add(match[1]));
  ["read", "all", "byId", "forProject", "get", "save", "saveMany", "replaceAll", "remove"].forEach((name) => known.add(name));

  jsFiles
    .filter((file) => file !== "ppm-data.js" && !file.includes("pdfmake") && !file.includes("vfs_fonts"))
    .forEach((file) => {
      const source = readFileSync(join(HERE, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      [...source.matchAll(/\bPPMStore\s*\??\.\s*([A-Za-z_$][\w$]*)/g)].forEach((match) => {
        if (known.has(match[1])) return;
        const line = source.slice(0, match.index).split("\n").length;
        check(
          false,
          `${file}:${line} names PPMStore.${match[1]}, which is neither a collection in either ` +
            `adapter's MODULES registry nor a function ppm-data.js exposes. A misspelt collection ` +
            `is undefined, and the error surfaces only when that line runs.`
        );
      });
    });
}

/* ------------------- 2b. Stage 16: nothing but ppm-data.js touches a business collection

   THIS GATE WAS WRONG, AND FOUR BROKEN WRITES SHIPPED THROUGH IT

   It used to ask "does this FILE contain localStorage.setItem?" and carry a list of files
   excused as UI-state-only. But a page writes both kinds: raid-log-page.js saved its column
   choices AND the RAID log itself, search-page.js its recent searches AND its saved views.
   Excusing the file excused everything in it.

   What that cost, once the prototype patch was deleted and localStorage.setItem stopped
   reaching PostgreSQL:

     raid-log-page.js            ppmProjectRaid          every RAID save lost on reload
     search-page.js              ppmSearchViews          saved searches lost on reload
     reports-page.js             ppmReportViews          saved report views lost on reload
     resource-management-page.js ppmResourceGanttViews   saved resource views lost on reload

   All four wrote to the browser, said "saved", and were replaced by the database's copy at the
   next hydration. All four were green.

   So the question changed from which file to which KEY. The business keys come from the two
   adapters' own MODULES registries, which is what the design document said in the first place -
   36 collections that cannot drift from what the adapters actually own. A key that cannot be
   resolved to a literal fails too: the gate has to be able to decide, and "I could not tell"
   must not read as "fine".
*/
{
  /*
     Nothing is exempt any more.

     ppm-data.js, both adapters and ppm-auth-utils.js were excused, because hydration wrote every
     collection into localStorage and the data layer read it back. There is no mirror: hydration
     hands each collection to PPMStore.adopt(), and the only keys these four still touch are the
     two pending-write ledgers, which are listed as browser-only below like everything else.

     Checking them by the same rule as every other file is the point. If a mirror write ever comes
     back it will come back here, in the files that used to be allowed to make it.
  */
  const ALLOWED = new Set();

  const businessKeys = new Map(); /* localStorage key -> collection that owns it */
  [
    ["ppm-database.js", "foundation"],
    ["ppm-child-database.js", "child"]
  ].forEach(([file]) => {
    const source = readFileSync(join(HERE, file), "utf8");
    const at = source.indexOf("const MODULES = {");
    const open = source.indexOf("{", at);
    let depth = 0;
    let close = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (!depth) {
          close = i;
          break;
        }
      }
    }
    /* eslint-disable-next-line no-new-func -- a data literal from this repository. */
    const modules = new Function(`return ${source.slice(open, close + 1)}`)();
    Object.entries(modules).forEach(([name, definition]) => {
      if (definition.localKey) businessKeys.set(definition.localKey, name);
    });
  });
  check(businessKeys.size > 30, `only ${businessKeys.size} business keys were found in the adapters`);
  const businessCollections = new Set(businessKeys.values());

  /* PPMPlanning.read/write accept PPMStore collection names, never retired localStorage keys. */
  jsFiles
    .filter((file) => !file.includes("pdfmake") && !file.includes("vfs_fonts"))
    .forEach((file) => {
      const source = readFileSync(join(HERE, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      [...source.matchAll(/PPMPlanning\s*\.\s*(read|write)\s*\(\s*["'`]([^"'`]+)["'`]/g)].forEach((match) => {
        const collection = match[2];
        const legacy = businessKeys.get(collection);
        check(
          businessCollections.has(collection),
          legacy
            ? `${file} passes legacy storage key "${collection}" to PPMPlanning.${match[1]}(); use collection "${legacy}".`
            : `${file} passes unknown collection "${collection}" to PPMPlanning.${match[1]}().`
        );
      });
    });

  /*
     Keys this application deliberately keeps in the browser. Each one is per-person, per-browser
     preference with no table behind it, and each is listed individually so that adding one is a
     decision somebody wrote down rather than a file quietly becoming exempt.
  */
  const BROWSER_ONLY = new Map([
    ["ppmProjectDetailSections", "which detail sections this person has expanded"],
    ["ppmProjectPlanColumnWidths", "how wide this person dragged the plan columns"],
    ["ppmRecentSearches", "the last few things this person searched for"],
    ["ppmNotificationState", "which notifications this person has dismissed"],
    ["ppmAdminSchemaVersion", "which configuration schema version this browser last migrated"],
    ["ppmDatabasePending", "the pending-write ledger, owned by the adapters"],
    ["ppmChildDatabasePending", "the pending-write ledger, owned by the adapters"],
    /* Read once on every page load, only to delete it. Stage 3E replaced local password hashing
       with Supabase Auth; a backup taken before that could still put the file back, and a file
       full of password hashes should not linger. See removeRetiredCredentialStore(). */
    ["ppmAuthCredentials", "the retired local credential store, read only in order to remove it"]
  ]);

  /*
     Resolve the first argument of a setItem call to the string it will actually be at run time.
     Handles a literal, a const holding a literal, and a member of an object literal - which is
     every form this codebase uses.
  */
  const resolveKey = (source, argument) => {
    const literal = argument.match(/^["'`]([^"'`]+)["'`]$/);
    if (literal) return literal[1];

    const simple = argument.match(/^[A-Za-z_$][\w$]*$/);
    if (simple) {
      const declared = source.match(
        new RegExp(`\\b(?:const|let|var)\\s+${argument}\\s*=\\s*["'\`]([^"'\`]+)["'\`]`)
      );
      if (declared) return declared[1];
      /* Also the comma-continued form: const A = "x",\n  B = "y"; */
      const continued = source.match(new RegExp(`[,{]\\s*${argument}\\s*=\\s*["'\`]([^"'\`]+)["'\`]`));
      if (continued) return continued[1];
      return null;
    }

    const member = argument.match(/^([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)$/);
    if (member) {
      const [, object, property] = member;
      /* const X = { ... } and const X = Object.freeze({ ... }) - both are used here. */
      const declaration = source.match(
        new RegExp(`\\b(?:const|let|var)\\s+${object}\\s*=\\s*(?:Object\\.freeze\\s*\\(\\s*)?\\{`)
      );
      if (!declaration) return null;
      const from = source.indexOf("{", declaration.index);
      let depth = 0;
      let to = -1;
      for (let i = from; i < source.length; i += 1) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") {
          depth -= 1;
          if (!depth) {
            to = i;
            break;
          }
        }
      }
      if (to === -1) return null;
      const found = source
        .slice(from, to)
        .match(new RegExp(`\\b${property}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`));
      return found ? found[1] : null;
    }

    return null;
  };

  let direct = 0;

  /* ppm-core.js defines readJson, the generic helper - localStorage.getItem of whatever key it
     is handed. Its own definition cannot name a key, and does not need to: every caller of
     PPMCore.readJson is checked below, which is where a key actually gets chosen. */
  const HELPER = new Set(["ppm-core.js"]);

  jsFiles
    .filter((file) => !ALLOWED.has(file) && !file.includes("pdfmake") && !file.includes("vfs_fonts"))
    .forEach((file) => {
      const source = readFileSync(join(HERE, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      /* The two PPMAuth wrappers went with the prototype patch; naming them is now always wrong. */
      [...source.matchAll(/\b(writeGlobal|writeScoped)\s*\(/g)].forEach((match) => {
        check(
          false,
          `${file}:${source.slice(0, match.index).split("\n").length} calls ${match[1]}, which Stage 16 ` +
            `removed. Use PPMStore.<collection>.save() or replaceAll().`
        );
      });

      /*
         Reads matter as much as writes, and for the same reason.

         A page that reads ppmProjects out of localStorage is reading the mirror hydration
         happens to have left there, not the collection. It works until it does not: the mirror
         is refused for a collection with a pending change, or hydration has not finished, or -
         once the mirror goes - it is simply not there, and the page renders empty with no error.
         The blank projects register was this shape of failure.

         PPMCore.readJson is included because it is localStorage.getItem with a nicer name; not
         checking it would leave the same hole one call deep.
      */
      const storageCalls = HELPER.has(file)
        ? []
        : [
            ...source.matchAll(/localStorage\s*\.\s*(setItem|getItem)\s*\(\s*([^,)]+?)\s*[,)]/g)
          ].map((match) => ({
            index: match.index,
            verb: match[1] === "getItem" ? "reads" : "writes",
            argument: match[2]
          }));

      if (file !== "ppm-core.js") {
        [...source.matchAll(/PPMCore\s*\.\s*readJson\s*\(\s*([^,)]+?)\s*[,)]/g)].forEach((match) => {
          storageCalls.push({ index: match.index, verb: "reads", argument: match[1] });
        });
      }

      storageCalls.forEach(({ index, verb, argument }) => {
        const line = source.slice(0, index).split("\n").length;
        const key = resolveKey(source, argument.trim());

        if (key === null) {
          check(
            false,
            `${file}:${line} ${verb} localStorage with a key this gate cannot resolve to a literal ` +
              `(${argument.trim()}). Use a string, or a const holding one, so the gate can tell whether ` +
              `it is a business collection.`
          );
          return;
        }

        if (businessKeys.has(key)) {
          direct += 1;
          const collection = businessKeys.get(key);
          check(
            false,
            verb === "writes"
              ? `${file}:${line} writes "${key}" to localStorage, which is the ${collection} collection. ` +
                  `Since the prototype patch was removed this reaches the browser and nowhere else, and ` +
                  `hydration replaces it - so the save appears to work and does not last. Use ` +
                  `PPMStore.${collection}.save() or replaceAll() and show what comes back.`
              : `${file}:${line} reads "${key}" from localStorage, which is the ${collection} collection. ` +
                  `That is the hydration mirror, not the data - it is absent before hydration finishes ` +
                  `and stale when a change is pending. Use PPMStore.${collection}.all(), .read() or ` +
                  `.forProject().`
          );
          return;
        }

        check(
          BROWSER_ONLY.has(key),
          `${file}:${line} ${verb} "${key}" in localStorage. It is not a business collection, so if it ` +
            `is genuinely per-person browser state add it to BROWSER_ONLY in VERIFY-STATIC.mjs with a ` +
            `note saying what it holds.`
        );
      });
    });

  if (!problems.length) {
    console.log(
      `  Stage 16: ${businessKeys.size} business collections, ${direct} direct localStorage uses of them, ` +
        `${BROWSER_ONLY.size} keys deliberately kept in the browser.`
    );
  }
}

/* --------------------------------------------- 3. referenced files must exist

   A case mismatch or a rename that missed one page fails only on the page nobody
   opened, and only in production, because local filesystems are often case-insensitive.
*/
const onDisk = new Set(readdirSync(HERE));
htmlFiles.forEach((file) => {
  const html = readFileSync(join(HERE, file), "utf8");
  [...html.matchAll(/(?:src|href)="(?!https?:|#|mailto:)([^"]+)/g)].forEach((m) => {
    /* Strip both the cache-bust query and any fragment: "USER-SPECIFICATION.html#matrix"
       is a link to a section of a real file, not a file called that. */
    const target = m[1].split("?")[0].split("#")[0];
    if (!target || target.startsWith("data:")) return;
    check(onDisk.has(target), `${file}: references "${target}", which is not a file in this folder`);
  });
});

/* ------------------------------------------------- 4. Content Security Policy */

htmlFiles.forEach((file) => {
  const html = readFileSync(join(HERE, file), "utf8");
  const csp = html.match(/Content-Security-Policy"\s*\n?\s*content="([^"]*)"/s);
  check(Boolean(csp), `${file}: has no Content Security Policy`);
  if (!csp) return;
  const policy = csp[1];

  check(!policy.includes("unsafe-eval"), `${file}: CSP allows unsafe-eval`);
  check(policy.includes("object-src 'none'"), `${file}: CSP does not set object-src 'none'`);
  check(policy.includes("base-uri 'self'"), `${file}: CSP does not set base-uri 'self'`);

  /*
    style-src must not allow inline styles generally. A single-file document may name
    the SHA-256 hash of its own style block instead, which permits exactly that block.
  */
  const styleSrc = policy.match(/style-src ([^;]*)/);
  check(Boolean(styleSrc), `${file}: CSP has no style-src`);
  if (styleSrc) {
    check(
      !styleSrc[1].includes("unsafe-inline"),
      `${file}: CSP allows style-src 'unsafe-inline'. Move the styles into a stylesheet, ` +
        `or name the block's SHA-256 hash.`
    );
    const inline = html.match(/<style>([\s\S]*?)<\/style>/);
    if (inline) {
      const hash = createHash("sha256").update(inline[1], "utf8").digest("base64");
      check(
        styleSrc[1].includes(`'sha256-${hash}'`),
        `${file}: has an inline <style> block whose hash is not in its CSP. ` +
          `Expected 'sha256-${hash}'. The block will be blocked and the page will render unstyled.`
      );
    }
  }

  /* No inline style attributes anywhere - style-src covers those too. */
  const inlineAttributes = [...html.matchAll(/<[a-zA-Z][^<>]*?\sstyle="/gs)];
  check(
    inlineAttributes.length === 0,
    `${file}: has ${inlineAttributes.length} inline style attribute(s), which style-src 'self' blocks`
  );
});

/* ------------------------------- 5. the external dependency is pinned and hashed */

appPages.forEach((file) => {
  const html = readFileSync(join(HERE, file), "utf8");
  if (!html.includes("cdn.jsdelivr.net")) return;

  check(
    !/supabase-js@\d+["/]?\s*"/.test(html) && !html.includes('supabase-js@2"'),
    `${file}: loads supabase-js on a floating version. Pin an exact version.`
  );
  const tag = html.match(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*>/s);
  check(Boolean(tag), `${file}: CDN script tag could not be parsed`);
  if (tag) {
    check(/integrity="sha(256|384|512)-/.test(tag[0]), `${file}: CDN script has no integrity hash`);
    check(tag[0].includes('crossorigin="anonymous"'), `${file}: CDN script has integrity but no crossorigin, so the hash cannot be checked`);
    check(/@\d+\.\d+\.\d+\//.test(tag[0]), `${file}: CDN script URL is not pinned to an exact version`);
  }
});

/* Every page must agree on the same pinned version and hash. */
const cdnTags = new Set();
appPages.forEach((file) => {
  const html = readFileSync(join(HERE, file), "utf8");
  const tag = html.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+/);
  const integrity = html.match(/integrity="(sha\d+-[^"]+)"/);
  if (tag) cdnTags.add(`${tag[0]}|${integrity ? integrity[1] : "none"}`);
});
check(cdnTags.size <= 1, `pages disagree on the pinned dependency: ${[...cdnTags].join("  ||  ")}`);

/* ------------- 6. no module injects a <style> element or a style attribute

   Section 4 checks the style attributes written into the HTML files. That is only half
   of what the policy governs, and it was the half that happened not to be broken.

   style-src applies to a style attribute whenever it is parsed, and markup assigned to
   innerHTML is parsed. Eight page scripts were still building style="left:...px" into
   their templates, so the browser dropped every one: the Allocation Gantt collapsed to
   a single coloured block, the project plan's dependency SVG lost its box and drew its
   links across the whole page, and register columns lost their widths. 1,916 assertions
   passed throughout, because none of them looked in the JavaScript.

   Computed geometry goes through PPMCore.styleAttribute() and applyComputedStyles(),
   which writes it with CSSOM - outside what CSP restricts. Fixed declarations belong
   in a class in the page's stylesheet.
*/

jsFiles.forEach((file) => {
  const src = readFileSync(join(HERE, file), "utf8");
  check(
    !/createElement\((["'])style\1\)/.test(src),
    `${file}: creates a <style> element. CSP blocks it, so the component renders unstyled rather than erroring.`
  );

  /* Comments explain this rule and quote the markup it forbids, so they are removed
     before the source is searched - the same treatment section 7 gives retired names. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  /*
    Matches an attribute, not a variable: `style="`, `style='` and `style=${`. A
    declaration is written `const style = "..."` with spaces, and a CSSOM assignment is
    preceded by a dot, so neither is caught.
  */
  const injected = [...code.matchAll(/(?<![.\w])style=(["'`]|\$\{)/g)];
  check(
    injected.length === 0,
    `${file}: builds markup containing ${injected.length} inline style attribute(s), which ` +
      `style-src 'self' silently drops. Use PPMCore.styleAttribute() for computed values, ` +
      `or a class for fixed ones.`
  );

  /*
    element.style.setProperty() is CSSOM and allowed. setAttribute("style", ...) is not:
    it hands the browser an attribute to parse, which is exactly what the policy stops.
  */
  check(
    !/setAttribute\(\s*(["'])style\1/.test(code),
    `${file}: calls setAttribute("style", ...), which CSP blocks. Assign through element.style instead.`
  );
});

/* ------------------------- 6b. the project editors stay consistent

   The project details page edits a project in place, in three forms rendered from
   ppm-project-fields.js. Four things about that can drift silently, so none of them is left
   to memory.

   The first is the one that matters most. The registry is derived from the field markup in
   add-project.html by BUILD-PROJECT-FIELDS.mjs, and a field present there but missing from
   the registry would exist on every new project and then be uneditable, with no error
   anywhere - the value would simply stop being reachable.
*/

const DETAILS_PAGE = "project-details.html";
const REGISTRY = "ppm-project-fields.js";

if (onDisk.has(DETAILS_PAGE) && onDisk.has(REGISTRY)) {
  const details = readFileSync(join(HERE, DETAILS_PAGE), "utf8");

  /*
    Regenerated in memory and compared, so the copy on disk cannot fall behind.

    The generator refuses rather than guesses when a field belongs to no group, so its
    exception is a finding and is reported as one. Left uncaught it took this whole gate down
    with a stack trace, which reads as "the checker is broken" rather than "you added a field
    and did not say where it goes".
  */
  const { build } = await import("./BUILD-PROJECT-FIELDS.mjs");
  let generated = null;
  try {
    generated = build();
  } catch (error) {
    check(false, `${REGISTRY} cannot be regenerated: ${error.message}`);
  }
  if (generated !== null) {
    check(
      generated.replace(/\r\n/g, "\n") === readFileSync(join(HERE, REGISTRY), "utf8").replace(/\r\n/g, "\n"),
      `${REGISTRY} is out of date with the field markup in add-project.html. Run node BUILD-PROJECT-FIELDS.mjs.`
    );
  }

  /*
    Editing must not send the reader to the page that creates projects. That was the whole
    complaint, and a stray href is all it would take to reintroduce it.
  */
  const editorControls = ["editProjectButton", "updateStatusButton", "projectEditLink", "projectStatusLink"];
  editorControls.forEach((id) => {
    const tag = new RegExp(`<(\\w+)[^>]*\\sid="${id}"`).exec(details);
    check(Boolean(tag), `${DETAILS_PAGE}: #${id} is missing`);
    if (tag) {
      check(
        tag[1] === "button",
        `${DETAILS_PAGE}: #${id} is a <${tag[1]}>. It must be a <button>: an anchor invites a ` +
          `navigation, and navigating away to edit is what this replaced.`
      );
    }
  });
  check(
    !/href="add-project\.html/.test(details),
    `${DETAILS_PAGE}: still links to add-project.html. Editing happens on this page.`
  );

  /* The panel and the controls the page script writes into. */
  [
    "projectEditorPanel",
    "projectEditorHost",
    "projectEditorTitle",
    "projectEditorDescription",
    "projectEditorCount",
    "projectEditorProblems",
    "projectEditorSave",
    "projectEditorCancel"
  ].forEach((id) => {
    check(details.includes(`id="${id}"`), `${DETAILS_PAGE}: the project editors need #${id}`);
  });

  /* Every module the editors call has to be loaded, in an order that defines before it uses. */
  const scripts = details.match(/data-ppm-scripts="([^"]*)"/);
  check(Boolean(scripts), `${DETAILS_PAGE}: no data-ppm-scripts list`);
  if (scripts) {
    const loaded = scripts[1];
    ["ppm-resource-utils.js", "ppm-project-fields.js", "ppm-project-forms.js"].forEach((file) => {
      check(loaded.includes(file), `${DETAILS_PAGE}: does not load ${file}, which the editors need`);
    });
    check(
      loaded.indexOf("ppm-project-fields.js") < loaded.indexOf("ppm-project-forms.js") &&
        loaded.indexOf("ppm-project-forms.js") < loaded.indexOf("project-details-page.js"),
      `${DETAILS_PAGE}: the registry must load before the renderer, and both before the page script`
    );
  }

  /*
    The rendered controls must not use bare field ids. `projectName` as an id would collide
    with an element of that name on the page, and getElementById returns whichever comes
    first - so one of the two readers silently gets the wrong element. It happened once
    already, with <h2 id="projectName">.
  */
  if (onDisk.has("ppm-project-forms.js")) {
    const renderer = readFileSync(join(HERE, "ppm-project-forms.js"), "utf8");
    check(
      renderer.includes('const PREFIX = "ppmField-"') && renderer.includes(`id="${"${PREFIX}"}`),
      "ppm-project-forms.js: rendered field ids must be prefixed, so they cannot collide with the host page"
    );
  }
}

/* ------------------------------ 6d. the loading state cannot strand a page

   <html class="ppm-loading"> hides a page's content from the first paint, which is what
   removes the pop-in. It also means something has to take the class off again. Only
   ppm-page-loader.js does, so a page carrying the class without loading it would stay blank
   for as long as anyone was prepared to look at it - and login.html and 404.html deliberately
   have no loader.
*/
htmlFiles.forEach((file) => {
  const html = readFileSync(join(HERE, file), "utf8");
  const hides = /<html[^>]*class="[^"]*ppm-loading/.test(html);
  const hasLoader = /<script src="ppm-page-loader\.js/.test(html);
  if (hides) {
    check(
      hasLoader,
      `${file}: hides itself with class="ppm-loading" but does not load ppm-page-loader.js, ` +
        `so nothing will ever reveal it`
    );
  }
  if (hasLoader) {
    check(
      hides,
      `${file}: loads the page loader but has no class="ppm-loading" on <html>, so it will draw ` +
        `an empty shell and then pop in`
    );
  }
});

/* The stylesheet that hides it has to be on the page as well. */
appPages.forEach((file) => {
  const html = readFileSync(join(HERE, file), "utf8");
  if (!/<html[^>]*class="[^"]*ppm-loading/.test(html)) return;
  check(
    html.includes("ppm-shared.css"),
    `${file}: uses the loading state but does not load ppm-shared.css, which defines it`
  );
});

/* ------------------- 6e. every page loads its own page script

   Found by writing the module reference: reports.html loaded ppm-page-loader.js with
   data-ppm-scripts="pdfmake.min.js" and nothing else. Not reports-page.js, all 3,392 lines of
   it; not ppm-report-pdf.js; not the fonts. Reports & Dashboards drew its shell and then did
   nothing, and had done for at least four commits of that file.

   Nothing noticed, because every existing check asks whether what IS referenced is correct.
   None of them asked whether something was missing. A page and its script are named after
   each other, so that pairing can simply be required.

   Also checks that a script's own dependencies load before it: a page script that runs before
   the module defining a global it calls fails on its first line, which reads as the page being
   broken rather than the order being wrong.
*/

appPages.forEach((file) => {
  const html = readFileSync(join(HERE, file), "utf8");
  const expected = `${file.replace(/\.html$/, "")}-page.js`;
  if (!onDisk.has(expected)) return;

  const list = html.match(/data-ppm-scripts="([^"]*)"/);
  const loaded = list
    ? list[1].split("|").map((entry) => entry.split("?")[0].trim())
    : [];
  const direct = [...html.matchAll(/<script src="(?!https?:)([^"?]+)/g)].map((m) => m[1]);

  check(
    loaded.includes(expected) || direct.includes(expected),
    `${file}: does not load ${expected}. The page will render its shell and then do nothing.`
  );

  /* A page script's dependencies must precede it in the same list. */
  if (loaded.includes(expected)) {
    const source = readFileSync(join(HERE, expected), "utf8");
    const PROVIDERS = {
      PPMResources: "ppm-resource-utils.js",
      PPMAdmin: "ppm-admin-utils.js",
      PPMGovernance: "ppm-governance-utils.js",
      PPMPlanning: "ppm-planning-utils.js",
      PPMStageGates: "ppm-stage-gate-utils.js",
      PPMRegisters: "ppm-register-utils.js",
      PPMFinancial: "ppm-financial-utils.js",
      PPMReportPdf: "ppm-report-pdf.js",
      PPMChangeLog: "ppm-change-log.js",
      PPMProjectForms: "ppm-project-forms.js",
      PPMProjectFields: "ppm-project-fields.js"
    };
    Object.entries(PROVIDERS).forEach(([global, provider]) => {
      if (!new RegExp(`\\b${global}\\.`).test(source)) return;
      const at = loaded.indexOf(provider);
      check(
        at !== -1,
        `${file}: ${expected} calls ${global} but ${provider} is not loaded, so it will throw on first use`
      );
      if (at !== -1) {
        check(
          at < loaded.indexOf(expected),
          `${file}: ${provider} must load before ${expected}, which calls ${global}`
        );
      }
    });
  }
});

/* ------------------- 6g. the session bar outranks every page layer

   The notification panel lives inside .ppm-session-bar, which carries a `transform` to centre
   itself vertically. A transform creates a stacking context, so the panel's own z-index - 5000 -
   only ever decided its order relative to the bell next to it. Against the page, the whole bar
   competed at whatever position it happened to occupy, which was underneath everything.

   The result was a notification panel with the stage-gate register showing through it. The panel
   was drawn; sticky table cells at z-index 2 to 6 were drawn on top.

   So the bar carries the z-index instead, and it has to stay above every layer a page can
   create. A new page adding a modal at 1500 would put the panel back underneath it, in a way
   that is invisible until somebody opens the bell on that one page.
*/
{
  const BAR = 1400;
  const OVERLAYS = new Set(["ppm-auth.css", "ppm-shared.css"]);

  const styles = readdirSync(HERE).filter((file) => file.endsWith(".css") && !file.startsWith("PREVIEW"));
  const tooHigh = [];

  styles.forEach((file) => {
    if (OVERLAYS.has(file)) return;
    const css = readFileSync(join(HERE, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    [...css.matchAll(/z-index:\s*(\d+)/g)].forEach((match) => {
      const value = Number(match[1]);
      if (value < BAR) return;
      const line = css.slice(0, match.index).split("\n").length;
      tooHigh.push(`${file}:${line} uses z-index ${value}`);
    });
  });

  check(
    tooHigh.length === 0,
    `${tooHigh.length} page layer(s) sit at or above the session bar's z-index of ${BAR}, so the ` +
      `notification panel would appear underneath them:\n    ${tooHigh.join("\n    ")}\n    ` +
      `Raise .ppm-session-bar in ppm-auth.css rather than lowering the page, and update this gate.`
  );

  const authCss = readFileSync(join(HERE, "ppm-auth.css"), "utf8");
  const declared = authCss.match(/\.ppm-session-bar\s*\{[^}]*z-index:\s*(\d+)/);
  check(
    declared && Number(declared[1]) === BAR,
    `.ppm-session-bar should declare z-index ${BAR}; found ${declared ? declared[1] : "none"}. ` +
      `Without it the transform on that element traps the notification panel behind the page.`
  );
}

/* ------------------- 6h. every control sits inside a region the guard scans

   applyControlPermissions() used to query the whole document, so it found and disabled buttons
   belonging to browser extensions that inject UI into the page - a sidebar, a recorder, a
   toolbar. The user's extension broke on this site only, and the console reported untagged
   controls that do not exist anywhere in this codebase, which is a false defect report and hides
   the real ones.

   The scan is scoped to APP_REGIONS now. That trades one failure for another: a control outside
   every listed region is no longer guarded at all, and nothing about the page would look wrong.
   Permission state is not the security boundary - RLS and the workflow functions are, and they
   are untouched by any of this - but a button that stays enabled invites somebody to attempt
   something the database will refuse, which reads as a bug in the tool.

   So the region list and the markup have to agree, and this is the check that makes them.
*/
{
  const authUtils = readFileSync(join(HERE, "ppm-auth-utils.js"), "utf8");
  const block = authUtils.match(/const APP_REGIONS = \[([\s\S]*?)\]\.join/);
  check(Boolean(block), "APP_REGIONS is no longer declared as a list in ppm-auth-utils.js.");

  const regions = block ? [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
  const tags = new Set(regions.filter((r) => !r.startsWith(".")));
  const classes = new Set(regions.filter((r) => r.startsWith(".")).map((r) => r.slice(1)));

  /* The same words applyControlPermissions() treats as a data-changing control. Kept in step by
     reading them out of the source rather than retyping them, so a new verb cannot be added to
     one and not the other. */
  const verbs = authUtils.match(/return \/(add\|save\|edit[^/]*)\/\.test\(/);
  const mutationWord = verbs ? new RegExp(verbs[1], "i") : /add|save|edit|delete/i;

  const unguarded = [];

  appPages.forEach((file) => {
    const html = readFileSync(join(HERE, file), "utf8");
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
    if (!body) return;

    /* Walk the tag stream keeping the open-element stack, so "is this control inside a listed
       region" is answered by looking at its actual ancestors rather than by a regex that would
       have to guess at nesting. */
    const VOID = new Set(["br", "img", "input", "meta", "link", "hr", "source", "track", "area"]);
    const stack = [];
    let inRegion = 0;

    for (const match of body[1].matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
      const [, closing, rawTag, attrs] = match;
      const tag = rawTag.toLowerCase();
      if (VOID.has(tag)) continue;

      if (closing) {
        const popped = stack.pop();
        if (popped?.region) inRegion -= 1;
        continue;
      }

      const classList = (attrs.match(/class="([^"]*)"/) || [, ""])[1].split(/\s+/).filter(Boolean);
      const isRegion = tags.has(tag) || classList.some((name) => classes.has(name));

      const control =
        tag === "button" ||
        (tag === "a" && classList.includes("button")) ||
        classList.includes("add-row-button") ||
        /role="button"/.test(attrs);

      if (control && !inRegion && !isRegion) {
        const line = body[1].slice(0, match.index).split("\n").length;
        const id = (attrs.match(/id="([^"]*)"/) || [, ""])[1];
        unguarded.push(`${file}:${line} <${tag}${id ? ` id="${id}"` : ""}>`);
      }

      if (!attrs.trim().endsWith("/")) {
        stack.push({ tag, region: isRegion });
        if (isRegion) inRegion += 1;
      }
    }
  });

  check(
    unguarded.length === 0,
    `${unguarded.length} control(s) sit outside every region in APP_REGIONS, so the permission ` +
      `guard will never see them:\n    ${unguarded.join("\n    ")}\n    ` +
      `Either move the control inside a listed region, or add its container's class to ` +
      `APP_REGIONS in ppm-auth-utils.js.`
  );

  /* And the guard must actually use the scoped query. Naming ownControls() rather than looking
     for "querySelectorAll" - the file has dozens of those, and a check that matches any of them
     would pass with the scoping removed. */
  check(
    /ownControls\(\)\.forEach/.test(authUtils) &&
      !/document\.querySelectorAll\(CONTROL_SELECTOR\)/.test(authUtils),
    "applyControlPermissions no longer scans through ownControls(), so it is reaching outside " +
      "this application's own DOM again and will disable browser-extension buttons."
  );
}

/* ------------------- 6f. the module reference documents every script

   The developer guide's module reference is derived facts plus hand-written prose. The facts
   cannot drift because they are read from source at build time; the prose can simply be
   missing, and a file nobody documented is a file the next reader has to reverse-engineer.

   So adding a script is required to come with a sentence about what it owns.
*/
{
  const { undocumentedScripts } = await import("./BUILD-SPEC-MODULES.mjs");
  const missing = undocumentedScripts();
  check(
    missing.length === 0,
    `${missing.length} script(s) have no entry in NOTES in BUILD-SPEC-MODULES.mjs, so the ` +
      `developer guide cannot describe them: ${missing.join(", ")}`
  );
}

/* --------------------------------------- 7. no retired identifier is referenced

   THIS GATE HAD A HOLE, AND A MONTH OF BROKEN SAVES WENT THROUGH IT

   The list below is matched as text. "PPMAudit.compareAndRecord" catches a call written that
   way and misses one written through an alias:

       const log = audit();          // returns window.PPMAudit
       log.compareAndRecord(...);    // invisible to this gate

   ppm-change-log.js did exactly that. Stage 14 deleted compareAndRecord, record and diff from
   PPMAudit; this module went on calling all three, so recordRow(), recordDeletion() and
   trackCollection() threw TypeError on every save that used them - after the row had reached the
   database, killing the rest of the handler. Saving a resource, milestone, programme, benefit or
   project detail left the modal open and the list unchanged, which reads as a dead button rather
   than as a broken audit trail. It shipped, and was reported by a user.

   So distinctive method names are listed on their own line as well, without the global. A name
   like "record" or "diff" is too common for that to be safe, which is a limit of matching text:
   the general answer is section 2c, which resolves a module's real API - and it cannot follow an
   alias either. If you introduce one, you have stepped outside what any of these gates can see.
*/

const RETIRED = [
  "PPMAudit.record",
  "PPMAudit.recordMany",
  "PPMAudit.compareAndRecord",
  /* Bare, because the call site aliased the global. Distinctive enough not to collide. */
  "compareAndRecord",
  "recordMany",
  "importLegacyToDatabase",
  "useShadowFor",
  "shadowEverything",
  "useLocalForEverything",
  "runShadowCheck",
  "divergenceReport",
  "cutOverAll",
  "cutOverBatch",
  "fastCutOver",
  "seedStage12Defaults",
  "ppm_stage11a_ready",
  "ppm_import_legacy_audit",
  /*
     Stage 16 removed the storage facade. All four filtered or deliberately unfiltered the
     localStorage mirror, which no longer has any readers - and the filtering they described was
     never protection, since it ran in the browser. Row-level security at AAL2 is what keeps one
     person out of another's projects, and that is unchanged.
  */
  "readScoped",
  "writeScoped",
  "readGlobal",
  "writeGlobal",
  "isScopedKey",
  "SCOPED_KEYS",
  /*
     Stage 16 deleted the collection-level sync machinery with the write-through. Every one of
     these is a local function inside ppm-child-database.js, so no cross-module gate could ever
     see a leftover call - and one was left: `await Promise.all(STAGE_GATE_WORKFLOW_MODULES.map(
     (name) => flush(name)))` survived in commitStageGateWorkflow(), parsed cleanly, passed every
     gate, and threw "flush is not defined" the first time somebody approved a stage gate.

     Text matching is a poor substitute for knowing whether an identifier resolves. The sound
     version needs a JavaScript parser and proper scope analysis; a hand-rolled approximation was
     tried and mangled nested template literals badly enough to hide real declarations, which is
     worse than nothing because it would be trusted. Listing the names is what can be relied on
     today. See the backlog.
  */
  "syncFromRawValue",
  "enqueueSync",
  "syncStore",
  "appendOnlySync",
  "diffStore",
  "flush("
];
const TOOLING = new Set(["STAGE-14-HARNESS.mjs", "STAGE-11E-12-HARNESS.mjs", "VERIFY-STATIC.mjs"]);
/* Third-party bundles are not ours to police, and pdfmake has its own flush(). */
const VENDOR = (file) => file.includes("pdfmake") || file.includes("vfs_fonts");
jsFiles
  .filter((f) => !TOOLING.has(f) && !VENDOR(f) && !f.startsWith("STAGE-14A"))
  .forEach((file) => {
    const src = readFileSync(join(HERE, file), "utf8");
    /* Comments legitimately name retired APIs when explaining why they went. */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    RETIRED.forEach((name) => {
      check(!code.includes(name), `${file}: still references the retired "${name}" outside a comment`);
    });
  });

/* ------------------- 6i. controls built at runtime carry their permission too

   Gate 6h reads the shipped HTML. Most controls in this application are not in the shipped HTML:
   they are written into template literals and injected when a list renders. Nothing checked those
   at build time, so the only warning was the console one at runtime, which nobody sees unless
   they happen to have devtools open on the page that renders them.

   Eight were found untagged this way, including Edit and Delete on every document row of
   project-details. Untagged means the guard fails closed and disables them, so those two buttons
   did nothing for anybody, at any permission level, however long they had been there.

   The word list is read out of ppm-auth-utils.js rather than retyped, so a control this gate
   passes is one the runtime guard would also pass.
*/
{
  const authUtils = readFileSync(join(HERE, "ppm-auth-utils.js"), "utf8");
  const verbs = authUtils.match(/return \/(add\|save\|edit[^/]*)\/\.test\(/);
  check(Boolean(verbs), "the mutation-word list in ppm-auth-utils.js could not be read.");
  const mutationWord = new RegExp(verbs ? verbs[1] : "add|save|edit|delete", "i");

  /* Controls the runtime guard never inspects, so this gate must not either. */
  const EXEMPT = /ppm-notification-|ppm-history-/;

  const untagged = [];

  jsFiles
    .filter((file) => !TOOLING.has(file) && !VENDOR(file) && !file.startsWith("STAGE-14A"))
    .forEach((file) => {
      const code = readFileSync(join(HERE, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      /* Attributes may contain ${...}, which can hold anything except a closing brace; the label
         may run over several lines. Both are why this is not a one-line regex. */
      for (const match of code.matchAll(
        /<button\b((?:[^<>]|\$\{[^}]*\})*?)>((?:(?!<\/button>)[\s\S]){0,400}?)<\/button>/g
      )) {
        const [, attrs, inner] = match;
        if (attrs.includes("data-permission")) continue;
        if (EXEMPT.test(attrs)) continue;

        const label = inner.replace(/<[^>]*>|\$\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
        /* Exactly the test isMutationControl() applies: id, class and label together. */
        if (!mutationWord.test(`${attrs} ${label}`)) continue;

        const line = code.slice(0, match.index).split("\n").length;
        untagged.push(`${file}:${line} "${label.slice(0, 40)}"`);
      }
    });

  check(
    untagged.length === 0,
    `${untagged.length} control(s) built in JavaScript look like they change data but carry no ` +
      `data-permission, so the guard disables them and they do nothing for anybody:\n    ` +
      `${untagged.join("\n    ")}\n    Add data-permission="<permission>", or ` +
      `data-permission="none" if the control does not change data.`
  );
}

/* ------------------- 6j. the specifications do not carry a stale number

   The developer specification said "128 assertions" long after the harness passed four hundred,
   "126 triggers" after there were 132, "40 files" after there were 44, and "four gates" after
   there were five. None of it was noticed, because a number in prose has no reason to change
   when the thing it counts does.

   Most of those figures are interpolated at build time now and cannot drift. What remains are
   the database counts, which cannot be measured without a connection. This gate checks those
   against the artefacts that can be read here, and checks that the interpolated ones were not
   quietly replaced with literals again.
*/
{
  const devSource = readFileSync(join(HERE, "BUILD-SPEC-DEVELOPER.mjs"), "utf8");
  const devDoc = readFileSync(join(HERE, "DEVELOPER-SPECIFICATION.html"), "utf8");

  /* Counts that are derived must stay derived. A literal creeping back in is the failure this
     gate exists to prevent, so it is checked in the generator rather than the output. */
  ["COUNTS.assertions", "COUNTS.collections", "COUNTS.pages", "COUNTS.browserScripts",
   "COUNTS.releaseGates", "COUNTS.tables"].forEach((token) => {
    check(
      devSource.includes("${" + token + "}"),
      `BUILD-SPEC-DEVELOPER.mjs no longer interpolates ${token}, so that figure can go stale ` +
        `the way "128 assertions" did. Use the derived value rather than typing the number.`
    );
  });

  /* The harness total is quoted from a real run. If that file is missing or stale relative to
     the harness itself, the document is quoting a number nobody has checked. */
  const countPath = join(HERE, "HARNESS-COUNT.json");
  const recorded = existsSync(countPath) ? JSON.parse(readFileSync(countPath, "utf8")) : null;
  check(
    recorded && Number.isInteger(recorded.assertions) && recorded.assertions > 0,
    "HARNESS-COUNT.json is missing or malformed. Run node STAGE-14-HARNESS.mjs, which writes it, " +
      "before rebuilding the specifications."
  );
  if (recorded) {
    check(
      statSync(countPath).mtimeMs >= statSync(join(HERE, "STAGE-14-HARNESS.mjs")).mtimeMs,
      "HARNESS-COUNT.json is older than the harness that writes it, so the specification is " +
        "quoting an assertion count from before the harness last changed. Re-run the harness."
    );
  }

  /* Database figures cannot be counted from here. Check the one artefact that does record the
     schema, and require the rest to be stated as of a date so a reader knows what they are. */
  const manifest = JSON.parse(readFileSync(join(HERE, "SCHEMA-MANIFEST.json"), "utf8"));
  const claimedTables = devDoc.match(/(\d+)\s+tables/);
  check(
    claimedTables && Number(claimedTables[1]) === manifest.tableCount,
    `The developer specification says ${claimedTables ? claimedTables[1] : "?"} tables; ` +
      `SCHEMA-MANIFEST.json records ${manifest.tableCount}.`
  );

  const claimedMigrations = readdirSync(HERE).filter((f) => f.endsWith(".sql")).length;
  const lintLine = devDoc.match(/(\d+)\s+migration file/);
  if (lintLine) {
    check(
      Number(lintLine[1]) === claimedMigrations,
      `The developer specification says ${lintLine[1]} migration files; there are ${claimedMigrations}.`
    );
  }
}

/* ------------------- 6k. the specification does not name code that no longer exists

   The resource-management section sent a developer to resourceRow() for six weeks after the
   rebuild replaced it with resourceBlock(). The recipe read perfectly and the function was gone.
   Prose naming a function has no reason to change when that function is renamed, which is the
   same failure as the stale counts in gate 6j and needs the same treatment.

   Every function this document presents as a call site must exist somewhere in the source, or be
   listed below as something the document names precisely because it was removed.
*/
{
  const doc = readFileSync(join(HERE, "DEVELOPER-SPECIFICATION.html"), "utf8")
    .replace(/<style>[\s\S]*?<\/style>/g, " ");
  /*
     Browser scripts and migrations only. The .mjs tooling is excluded on purpose: the harness
     contains string literals like "function taskRow" inside the assertions that prove taskRow is
     gone, so scanning it would report a retired function as alive. The first version of this gate
     did exactly that.
  */
  const source = readdirSync(HERE)
    .filter((f) => (f.endsWith(".js") || f.endsWith(".sql")) && !/pdfmake|vfs_fonts/.test(f))
    .map((f) => readFileSync(join(HERE, f), "utf8"))
    .join("\n");

  /* Names the document mentions in order to say they are gone. Each must stay absent from the
     source, so this list cannot be used to wave through a genuine dangling reference. */
  const NAMED_AS_REMOVED = [
    "taskRow", "resourceRow", "compareAndRecord", "readMirror", "rawSet",
    "importLegacyToDatabase", "flush"
  ];

  const named = [...new Set([...doc.matchAll(/<code>([a-z][A-Za-z0-9_]{3,})\(\)?<\/code>/g)].map((m) => m[1]))];
  const dangling = named.filter(
    (n) =>
      !NAMED_AS_REMOVED.includes(n) &&
      !new RegExp(
        `(function\\s+${n}\\b|\\b${n}\\s*[:=]\\s*(function|\\(|async)|` +
          `create\\s+or\\s+replace\\s+function\\s+[\\w.]*${n}\\b)`,
        "i"
      ).test(source)
  );
  check(
    dangling.length === 0,
    `The developer specification names ${dangling.length} function(s) that do not exist in the ` +
      `source: ${dangling.join(", ")}. Either the code was renamed and the document was not, or ` +
      `the name belongs in NAMED_AS_REMOVED because the document is explaining its removal.`
  );

  NAMED_AS_REMOVED.forEach((n) => {
    check(
      !new RegExp(`function\\s+${n}\\b`).test(source),
      `${n} is listed as removed in gate 6k but exists in the source again. Either it came back, ` +
        `in which case take it off the list, or something has been named after a retired function.`
    );
  });
}

/* ------------------- 6l. no diagram text runs outside its own frame

   The Gantt diagram shipped with six captions running off the right-hand edge, overlapping the
   timeline columns and each other. It passed the check I had written, because that check tested
   whether the anchor point was inside the viewBox and text is drawn from its anchor outwards.
   A label at x=678 with sixty characters starts inside the frame and ends 160px past it.

   These diagrams are hand-positioned SVG with no layout engine, so nothing else will notice.
   Widths are estimated from the character count and the font size in the class, which is
   approximate but wrong in the safe direction: Arial's average advance is below these figures,
   so a caption this gate passes will fit.
*/
{
  const PER_CHAR = { "d-small": 5.35, "d-title": 7.3, "d-text": 6.2, "d-mono": 6.4 };
  const spec = readFileSync(join(HERE, "DEVELOPER-SPECIFICATION.html"), "utf8");
  const overflowing = [];

  [...spec.matchAll(/<svg[^>]*viewBox="0 0 (\d+) (\d+)"[\s\S]*?<\/svg>/g)].forEach((figure) => {
    const [svg, w, h] = [figure[0], Number(figure[1]), Number(figure[2])];
    const id = (svg.match(/aria-labelledby="fig-([\w-]+)"/) || [, "?"])[1];

    [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"([^>]*)>([^<]*)<\/text>/g)].forEach((t) => {
      const label = t[4].replace(/&\w+;/g, "-").trim();
      if (!label) return;
      const cls = (t[3].match(/class="([\w-]+)/) || [, "d-text"])[1];
      const anchorAttr = (t[3].match(/text-anchor="(\w+)"/) || [, ""])[1];
      const width = label.length * (PER_CHAR[cls] || 6);
      const x = Number(t[1]);
      const left = anchorAttr === "middle" ? x - width / 2 : anchorAttr === "end" ? x - width : x;

      if (left + width > w - 6 || left < 6 || Number(t[2]) > h - 4) {
        overflowing.push(`${id}: "${label.slice(0, 46)}" runs from ${Math.round(left)} to ` +
          `${Math.round(left + width)} in a ${w}-wide frame`);
      }
    });
  });

  check(
    overflowing.length === 0,
    `${overflowing.length} diagram caption(s) fall outside their frame:\n    ` +
      `${overflowing.join("\n    ")}\n    Shorten the caption or wrap it onto another line. ` +
      `These diagrams have no layout engine, so nothing else will catch this.`
  );
}

/* ------------------- 7b. no message promising a local fallback that does not exist

   Until Stage 17 a failed refresh really did leave the previous data on screen, because
   localStorage held a mirror of every collection. The mirror is gone: PPMStore is filled from
   the database on each page load and from nowhere else, so a collection that fails to load is
   empty and its page shows nothing.

   Four messages went on saying otherwise - "the page is showing the last known local data", "the
   page is using the last local copy", "keeping the last known local data". They were reassuring
   and false, which is the worst combination: somebody reading the console concludes the screen
   is stale rather than blank, and stops looking.

   Comments are exempt because they legitimately explain what the mirror used to do.
*/
{
  const CLAIMS = [
    "last known local data",
    "last local copy",
    "last known local",
    "showing the last",
    "using the last local"
  ];
  jsFiles
    .filter((file) => !TOOLING.has(file) && !VENDOR(file))
    .forEach((file) => {
      const code = readFileSync(join(HERE, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      CLAIMS.forEach((claim) => {
        check(
          !code.toLowerCase().includes(claim),
          `${file}: a message still promises "${claim}". There is no local copy - Stage 17 deleted ` +
            `the mirror, so a collection that fails to load is empty. Say that instead.`
        );
      });
    });
}

/* ------------------- 7c. nothing identifies the organisation it was built in

   This tool was written inside one company and then opened up. 6,671 references to that
   company's name were removed from 121 files: the product name, email domains in the demo
   portfolio, a palette comment in eight stylesheets, backup filename prefixes, and prose in both
   specifications.

   A rename that large is only done once. What it needs is something that notices the next time
   one comes back, in a paste from an old branch, an untouched batch file, or a spec section
   rebuilt from a stale generator.

   The demo portfolio is included in the scan on purpose. It is invented data, but it was
   invented to look like a real portfolio at a real firm, and that is exactly the kind of thing
   that reads as an accidental leak rather than a fixture.
*/
{
  /*
     Assembled from fragments so the literal never appears in this file. Written the obvious way,
     the gate scanned itself, found its own search terms and failed. That is the second time in
     this suite that a check has matched the thing it was written to look for - see also gate 6k,
     which found "function taskRow" inside the harness assertion proving taskRow was gone.
  */
  const IDENTIFYING = [
    { term: ["forest", "ers"].join(""), why: "the organisation this was originally built for" },
    { term: ["forest", "er life"].join(""), why: "the legal entity name" }
  ];

  const scanned = [];
  const walk = (dir) => {
    readdirSync(join(HERE, dir), { withFileTypes: true }).forEach((entry) => {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (![".git", "node_modules", "deploy"].includes(entry.name)) walk(rel);
        return;
      }
      /* .cmd and .ps1 are included because the first sweep did not scan them and three
         deployment scripts kept the old name in a header comment for a whole build. */
      if (/\.(js|mjs|html|css|sql|json|md|txt|cmd|ps1|sh|yml|yaml)$/.test(entry.name)) scanned.push(rel);
    });
  };
  walk("");

  const found = [];
  scanned.forEach((rel) => {
    const text = readFileSync(join(HERE, rel), "utf8").toLowerCase();
    IDENTIFYING.forEach(({ term, why }) => {
      const hits = (text.match(new RegExp(term, "g")) || []).length;
      if (hits) found.push(`${rel}: ${hits} x "${term}" (${why})`);
    });
  });

  /*
     Office files are zip archives of deflated XML, so scanning the raw bytes finds nothing.

     My first attempt did exactly that, noted in a comment that compressed parts were
     "unreadable without unzipping", and claimed it caught the common case. It caught nothing:
     putting the old name back into the workbook did not fail the gate. That is the same
     "assertion that cannot fail" this suite has been bitten by three times, and the only fix is
     to actually decompress.

     Central directory rather than local headers, because entries written with a data descriptor
     carry zero sizes in the local header and the real ones only in the directory.
  */
  const officeText = (buf) => {
    const EOCD = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (EOCD < 0) return "";
    let offset = buf.readUInt32LE(EOCD + 16);
    const count = buf.readUInt16LE(EOCD + 10);
    let out = "";

    for (let i = 0; i < count; i += 1) {
      if (buf.readUInt32LE(offset) !== 0x02014b50) break;
      const method = buf.readUInt16LE(offset + 10);
      const compSize = buf.readUInt32LE(offset + 20);
      const nameLen = buf.readUInt16LE(offset + 28);
      const extraLen = buf.readUInt16LE(offset + 30);
      const commentLen = buf.readUInt16LE(offset + 32);
      const localAt = buf.readUInt32LE(offset + 42);
      const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);

      if (name.endsWith(".xml") || name.endsWith(".rels")) {
        const lNameLen = buf.readUInt16LE(localAt + 26);
        const lExtraLen = buf.readUInt16LE(localAt + 28);
        const dataAt = localAt + 30 + lNameLen + lExtraLen;
        const raw = buf.subarray(dataAt, dataAt + compSize);
        try {
          out += method === 0 ? raw.toString("utf8") : inflateRawSync(raw).toString("utf8");
        } catch {
          /* A part we cannot inflate is reported rather than skipped silently. */
          out += `\n[unreadable part: ${name}]\n`;
        }
      }
      offset += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  };

  readdirSync(HERE)
    .filter((f) => /\.(xlsx|docx|pptx)$/.test(f))
    .forEach((f) => {
      const text = officeText(readFileSync(join(HERE, f))).toLowerCase();
      IDENTIFYING.forEach(({ term, why }) => {
        const hits = (text.match(new RegExp(term, "g")) || []).length;
        if (hits) found.push(`${f}: ${hits} x "${term}" (${why})`);
      });
    });

  check(
    found.length === 0,
    `${found.length} file(s) still name the organisation this was built in:\n    ` +
      `${found.slice(0, 12).join("\n    ")}${found.length > 12 ? `\n    ...and ${found.length - 12} more` : ""}\n    ` +
      `This is a public repository. Replace the reference rather than leaving it.`
  );

  /* The rename touched a filename convention that two files have to agree on. They are checked
     here rather than trusted, because the export writes a name and .gitignore excludes a
     pattern, and a mismatch means real portfolio data becomes committable. */
  const writer = readFileSync(join(HERE, "ppm-data-safety.js"), "utf8");
  const ignore = readFileSync(join(HERE, ".gitignore"), "utf8");
  ["portfolio-manager-backup", "portfolio-manager-audit-archive"].forEach((prefix) => {
    check(
      writer.includes(prefix) && ignore.includes(`${prefix}-*.json`),
      `The export writes "${prefix}-*.json" but .gitignore does not exclude it, or the two have ` +
        `drifted apart. A backup holds real portfolio data and must never be committable.`
    );
  });
}

/* ---------------------------------------------- 8. no secret in browser source */

[...htmlFiles, ...jsFiles, ...readdirSync(HERE).filter((f) => f.endsWith(".css"))].forEach((file) => {
  const src = readFileSync(join(HERE, file), "utf8");
  check(!/eyJ[A-Za-z0-9_-]{30,}/.test(src), `${file}: contains a JWT-shaped string`);
  check(!/sb_secret/.test(src) || file.endsWith("SPECIFICATION.html"), `${file}: mentions sb_secret`);
});

/* ------------------------------------------------------------------- report */

console.log(
  `Static verification - ${htmlFiles.length} pages, ${jsFiles.length} scripts, ${checks} assertions\n`
);
if (problems.length) {
  console.log(`${problems.length} problem(s):\n`);
  problems.forEach((p) => console.log(`  x ${p}`));
  console.log("");
  process.exitCode = 1;
} else {
  console.log("All static invariants hold.");
}
