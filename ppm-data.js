/*
  PPMStore - the one write seam.

  THE GLOBAL IS PPMStore, NOT PPMData.

  window.PPMData belongs to ppm-data-safety.js - backup, restore and the storage-limit
  warnings. This file loads after it, so naming this one PPMData replaces that module entirely:
  no error, no warning, and every backup and restore function stops existing. VERIFY-STATIC.mjs
  refuses two files claiming one global, and STAGE-14-HARNESS.mjs asserts that the backup API
  still answers.

  Stage 16. This is the only place in the application that writes business data. Nothing else
  may call Supabase for a business table, and nothing else may put a business collection into
  localStorage. Two gates in VERIFY-STATIC.mjs enforce both of those sentences.

  WHAT IT REPLACES, AND WHY

  Until Stage 16 a page saved a project like this:

      localStorage.setItem("ppmProjects", JSON.stringify(projects));

  and two adapters had replaced Storage.prototype.setItem with their own function, which parsed
  the JSON back out, diffed the whole collection against a baseline, and enqueued row writes to
  PostgreSQL. It worked. It was also indefensible, for six reasons set out in
  STAGE-16-ONE-WRITE-SEAM.md, of which one matters more than the rest:

      setItem returns undefined, synchronously, before the database has been asked anything.

  So a page could tell somebody "Saved" when PostgreSQL had refused the write, and no test would
  catch it, because the local copy always succeeds. Every write through this module is awaited
  and returns an answer the caller has to look at.

  THE SHAPE OF IT

      reads   synchronous, from a store this module owns
      writes  asynchronous, one record, explicit result

      const rows = PPMStore.projects.all();
      const one  = PPMStore.projects.byId("PRJ-001");

      const result = await PPMStore.projects.save(project);
      if (!result.ok) { showMessage(result.message); return; }

  Reads are deliberately synchronous. Making them async would push await through every render
  function on twenty pages to no purpose - the data is in memory either way. What changed is
  where "in memory" lives: an object owned here, rather than a JSON string in localStorage that
  any code on the page could rewrite.

  THE FIVE ANSWERS A WRITE CAN GIVE

      ok         it is in the database
      offline    the request could not be made; the change is queued and visible
      conflict   somebody else changed this record first; nothing was written
      denied     row-level security or a workflow rule refused it
      invalid    the record was rejected here, before anything was sent
      failed     something else went wrong; the message says what

  Only "offline" queues. A denied write will never succeed on retry, and a queue that keeps
  telling somebody their work is pending when it can never land is worse than an error.

  WHAT THIS IS NOT

  It is not the security boundary and never was. RLS on all 37 tables, AAL2 on every read and
  write, the workflow RPCs and the append-only rules are unchanged and are the only things that
  actually protect the data. This makes the client honest; the database makes it safe.
*/

(function () {
  "use strict";

  var FOUNDATION = "foundation";
  var CHILD = "child";

  var store = new Map(); /* collection -> raw store, in whatever shape the collection uses */
  var registry = new Map(); /* collection -> { owner, definition } */
  var queue = [];
  var listeners = [];
  var started = false;

  function child() {
    return window.PPMChildDatabase || null;
  }
  function foundation() {
    return window.PPMDatabase || null;
  }

  /*
    THE COPY BOUNDARY, AND WHY IT IS NOT AN OPTIMISATION TO REMOVE

    Nothing crosses in or out of the store by reference. A caller gets its own copy; a record
    handed to save() is copied before it is kept.

    The reason is the whole point of this stage. The store is only updated once PostgreSQL has
    confirmed the write - that is what stops the screen showing a state the database refused. Hand
    out the live object instead and any caller can defeat that with an ordinary line of code:

        var projects = PPMStore.projects.read();
        projects[0].status = "Closed";        // the store now disagrees with the database
                                              // silently, and every later read repeats the lie

    No error, no write, no answer to check - which is precisely the shape of defect the write
    seams produced and this module exists to remove. Sorting in place, splicing a row out before
    a save, or keeping a reference and editing it later all do the same damage by accident.

    JSON round-trip rather than structuredClone, deliberately. Every one of these records came
    from PostgreSQL as JSON and the reads being migrated all went through JSON.parse of a
    localStorage string, so this reproduces exactly the shape callers already handle - undefined
    dropped, dates left as strings. structuredClone would hand back live Date objects that the
    old path never produced, which is a behaviour change disguised as a performance improvement.

    Cost: a parse and a stringify per read. The path being replaced did a JSON.parse of the whole
    collection on every single read, so this is no worse than what it removes, on a portfolio of
    hundreds of rows rather than millions.
  */
  function copy(value) {
    if (value === null || value === undefined) return value;
    if (typeof value !== "object") return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      /* Circular or otherwise unserialisable. It cannot have come from the database, so refusing
         to hand it on is safer than handing on the original by reference. */
      console.error("PPMStore: a stored value could not be copied and has been treated as empty.", error);
      return Array.isArray(value) ? [] : {};
    }
  }

  /* ------------------------------------------------------------------ registry

     Built from the adapters' own module definitions rather than a list typed here. A hand
     written list of 36 collections is wrong the first time somebody adds one, and wrong
     silently - the collection simply would not be writable through this module, and the old
     habit of writing it straight to localStorage would look like it worked.
  */
  function buildRegistry() {
    registry.clear();

    var f = foundation();
    if (f && f.MODULES) {
      Object.keys(f.MODULES).forEach(function (name) {
        registry.set(name, { owner: FOUNDATION, definition: f.MODULES[name] });
      });
    }

    var c = child();
    if (c && c.MODULES) {
      Object.keys(c.MODULES).forEach(function (name) {
        /* A name in both adapters would be ambiguous. The foundation adapter wins, because it
           owns the parent tables, and the collision is reported rather than resolved quietly. */
        if (registry.has(name)) {
          console.warn('PPMStore: "' + name + '" is defined by both adapters; using the foundation one.');
          return;
        }
        registry.set(name, { owner: CHILD, definition: c.MODULES[name] });
      });
    }

    return registry;
  }

  function entry(name) {
    if (!registry.size) buildRegistry();
    return registry.get(name) || null;
  }

  function localKeyOf(name) {
    var found = entry(name);
    return found ? found.definition.localKey || "" : "";
  }

  /*
    The collection that used to live under a given localStorage key.

    Modules being migrated still think in those keys - ppm-admin-utils.js funnels eleven
    configuration stores through one writer that takes a key. Rather than have each of them
    carry a hand-typed key-to-collection map that would be wrong the first time a collection
    was added, they ask here, and the answer comes from the adapters' own registry.
  */
  function collectionFor(localKey) {
    var wanted = String(localKey || "");
    if (!registry.size) buildRegistry();
    var match = null;
    registry.forEach(function (found, name) {
      if (!match && found.definition.localKey === wanted) match = name;
    });
    return match;
  }

  /* --------------------------------------------------------------------- store

     WHERE THE DATA COMES FROM

     Hydration. Both adapters load their collections from PostgreSQL and hand each one here
     through adopt(). Nothing else fills the store, and there is no second copy anywhere.

     There used to be one: hydration wrote each collection into localStorage under its legacy key
     and twenty pages read it back. That mirror is gone. It was never the data - it was a copy of
     the data whose only guarantee was that hydration had happened at some point, in some tab -
     and it was absent before hydration finished, stale when a change was pending, and
     indistinguishable at the call site from the real thing.

     ppm-page-loader.js is what makes the store sufficient on its own: it waits for both adapters'
     ready promises before loading a single page script, so by the time anything reads, hydration
     has finished. That was already true while the mirror existed; the mirror was simply never
     the reason reads worked.

     A collection that hydration could not load is empty here, and empty is the honest answer -
     the alternative is showing a copy from some earlier visit and calling it current.
  */
  function adopt(name, value) {
    if (!entry(name)) {
      console.warn('PPMStore: "' + name + '" is not a collection, so hydration for it was ignored.');
      return false;
    }
    store.set(name, value === null || value === undefined ? emptyFor(name) : value);
    return true;
  }

  function emptyFor(name) {
    var found = entry(name);
    var shape = found && found.definition ? found.definition.shape : "array";
    if (shape === "singleton") return {};
    if (shape === "object") return {};
    return [];
  }

  /*
    The canonical object. Internal only - the three functions that maintain the store need to
    change it in place, and everything else must go through read(), which copies. Handing this
    out is the mistake the copy boundary above exists to prevent.
  */
  function live(name) {
    if (!entry(name)) return null;
    if (!store.has(name)) store.set(name, emptyFor(name));
    return store.get(name);
  }

  function read(name) {
    return copy(live(name));
  }

  function objectish(value) {
    return Boolean(value) && typeof value === "object";
  }

  /*
    Every row, with the group it is stored under, flattened without copying. Internal.

    The group is carried alongside rather than derived from the row, because for eighteen of the
    thirty-six collections the group IS the storage structure - an object keyed by project code -
    and a row whose own projectCode disagrees with the key it is filed under must still be
    written back where it was found.
  */
  function pairs(name) {
    var found = entry(name);
    var raw = live(name);
    if (!raw || !found) return [];
    var shape = found.definition.shape;

    if (shape === "singleton") {
      return objectish(raw) && Object.keys(raw).length ? [{ row: raw, group: null }] : [];
    }

    if (Array.isArray(raw)) {
      return raw.filter(objectish).map(function (row) {
        return { row: row, group: null };
      });
    }

    var out = [];
    Object.keys(raw).forEach(function (group) {
      var group_rows = raw[group];
      if (!Array.isArray(group_rows)) return;
      group_rows.forEach(function (row) {
        if (objectish(row)) out.push({ row: row, group: group });
      });
    });
    return out;
  }

  /*
    A row that does not name its own project takes it from the key it is filed under.

    Three modules each wrote their own version of this - ppm-financial-utils flatten(),
    ppm-register-utils flattenStore() and ppm-notifications - because legacy rows exist that
    carry no project field and would otherwise be invisible to every "for this project" filter,
    despite being stored under that project. Written once here, the three copies go.

    Groups beginning "programme:" or "__" are markers rather than project codes, and filling a
    project code from one would invent a project that does not exist. ppm-notifications learnt
    that the hard way and its exclusion is kept.
  */
  var PROGRAMME_GROUP = /^programme:/i;
  var NOT_AN_OWNER = /^__/;

  function filled(row, field, value) {
    if (row[field]) return row;
    var out = {};
    Object.keys(row).forEach(function (key) {
      out[key] = row[key];
    });
    out[field] = value;
    return out;
  }

  function withGroupKey(name, pair) {
    var group = pair.group;
    if (group === null || group === undefined || group === "") return pair.row;
    /* "__UNSCOPED__" and its kind are placeholders for "no owner", not an owner. */
    if (NOT_AN_OWNER.test(group)) return pair.row;

    /*
      What the key means comes from the adapter's own registry, not from the shape of the string.

      Two collections - programme milestones and programme RAID - are keyed by a bare programme
      id, and the registry says so with scopeKind "programme". Guessing from the key would have
      filled projectCode with a programme id and invented a project that does not exist, which is
      worse than not filling it at all, because every "for this project" filter would then quietly
      believe it.

      Benefits are the other case: a benefit owned by a programme rather than a project is filed
      under "programme:<id>", a convention ppm-register-utils.js introduced, in a collection whose
      other rows are project-keyed. There the prefix genuinely is the answer.
    */
    var found = entry(name);
    var definition = found ? found.definition : {};
    if (definition.scopeKind === "programme") return filled(pair.row, "programmeId", group);
    if (PROGRAMME_GROUP.test(group)) return filled(pair.row, "programmeId", group.slice("programme:".length));
    return filled(pair.row, definition.projectField || "projectCode", group);
  }

  function rows(name) {
    return pairs(name).map(function (pair) {
      return withGroupKey(name, pair);
    });
  }

  /* Flat list of records. Copied, because all of it is being handed out. */
  function all(name) {
    return copy(rows(name));
  }

  function idFieldOf(name) {
    var found = entry(name);
    if (!found) return "";
    return found.definition.idField || found.definition.businessKey || "";
  }

  /*
    byId and forProject search the live rows and copy only what they return, rather than copying
    the collection and then discarding most of it. Same guarantee, and it keeps a lookup inside a
    loop - which is how a page renders a list of projects with their owners - from copying every
    record once per iteration.
  */
  function byId(name, id) {
    var field = idFieldOf(name);
    if (!field) return null;
    var wanted = String(id || "");
    var found = rows(name).find(function (row) {
      return String(row[field] || "") === wanted;
    });
    return found ? copy(found) : null;
  }

  function forProject(name, projectCode) {
    var found = entry(name);
    if (!found) return [];
    var field = found.definition.projectField || "projectCode";
    var wanted = String(projectCode || "");
    return copy(
      rows(name).filter(function (row) {
        return String(row[field] || row.projectCode || "") === wanted;
      })
    );
  }

  function get(name) {
    var raw = read(name);
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  }

  /* ------------------------------------------------------- results and reasons

     Both adapters already answer with saved / conflict / refused / invalid / failed, and both
     already write the message a person reads. Translating rather than reinventing keeps one
     vocabulary: what a caller of this module sees and what appears in a sync outcome or in
     pendingWrites() are the same words.
  */
  /*
    Whether a failure is worth queueing.

    The browser's own answer comes first: navigator.onLine === false is not a guess. The text
    match is the fallback for the commoner case where the connection is nominally up but the
    request could not be made - a dropped session, a Supabase client that never loaded, a fetch
    that failed outright. Getting this wrong in the cautious direction only means an error is
    shown instead of queued; getting it wrong the other way would tell somebody their work is
    pending when nothing will ever retry it.
  */
  function offlineLooking(message) {
    var navigatorSaysOffline =
      typeof window.navigator === "object" && window.navigator && window.navigator.onLine === false;
    if (navigatorSaysOffline) return true;
    return /offline|network|failed to fetch|fetch failed|no active supabase session|not loaded|timeout/i.test(
      String(message || "")
    );
  }

  function toResult(name, outcome, record) {
    var status = String(outcome && outcome.status ? outcome.status : "failed");
    var message = String((outcome && outcome.message) || "");

    if (status === "saved") return { ok: true, record: record, key: outcome && outcome.key, queued: false };

    var reason =
      status === "conflict"
        ? "conflict"
        : status === "refused"
          ? "denied"
          : status === "invalid"
            ? "invalid"
            : offlineLooking(message)
              ? "offline"
              : "failed";

    if (reason === "conflict" && !message) {
      message = "Somebody else changed this record while you were editing it. Reload to see their version.";
    }
    if (reason === "offline" && !message) {
      message = "This change could not reach the database and is saved on this computer for now.";
    }

    var queued = reason === "offline";
    if (queued) enqueue(name, record, message);

    return { ok: false, reason: reason, message: message, queued: queued, key: outcome && outcome.key };
  }

  /* ------------------------------------------------------------------- queue */

  function enqueue(name, record, message) {
    queue.push({
      collection: name,
      record: record,
      message: message,
      at: new Date().toISOString()
    });
    announce();
  }

  function outstanding() {
    return queue.slice();
  }

  function announce() {
    listeners.forEach(function (listener) {
      try {
        listener(outstanding());
      } catch (error) {
        console.error("PPMStore: a change listener threw.", error);
      }
    });
  }

  function onChange(listener) {
    if (typeof listener !== "function") return function () {};
    listeners.push(listener);
    listener(outstanding());
    return function () {
      listeners = listeners.filter(function (item) {
        return item !== listener;
      });
    };
  }

  /* Retries everything queued. Anything that fails again for the same reason stays queued;
     anything that now fails for a different reason - denied, say, because a permission changed
     while it was waiting - is dropped from the queue and reported, because retrying it for ever
     would be a lie. */
  async function retry() {
    if (!queue.length) return { retried: 0, saved: 0, stillQueued: 0, dropped: [] };

    var waiting = queue.slice();
    queue = [];
    var saved = 0;
    var dropped = [];

    for (var i = 0; i < waiting.length; i += 1) {
      var item = waiting[i];
      var result = await save(item.collection, item.record, { retrying: true });
      if (result.ok) saved += 1;
      else if (!result.queued) dropped.push({ collection: item.collection, reason: result.reason, message: result.message });
    }

    announce();
    return { retried: waiting.length, saved: saved, stillQueued: queue.length, dropped: dropped };
  }

  /* ------------------------------------------------------------------- writes */

  function invalid(message) {
    return { ok: false, reason: "invalid", message: message, queued: false };
  }

  async function save(name, record, options) {
    var found = entry(name);
    if (!found) return invalid('"' + name + '" is not a collection in this application.');
    if (!record || typeof record !== "object") return invalid("There is no record to save.");

    var outcome;
    try {
      if (found.owner === FOUNDATION) {
        var f = foundation();
        if (!f || typeof f.saveRecord !== "function") {
          return { ok: false, reason: "failed", message: "The database adapter is not loaded on this page.", queued: false };
        }
        outcome = await f.saveRecord(name, record, options);
      } else {
        var c = child();
        if (!c || typeof c.saveOne !== "function") {
          return { ok: false, reason: "failed", message: "The database adapter is not loaded on this page.", queued: false };
        }
        outcome = await c.saveOne(name, record, options);
      }
    } catch (error) {
      /* A thrown error is not a returned status, and the difference matters: it means the
         adapter did not get far enough to classify anything. Treated as failed, never as
         saved. */
      return { ok: false, reason: offlineLooking(error && error.message) ? "offline" : "failed", message: String((error && error.message) || error), queued: false };
    }

    var result = toResult(name, outcome, record);
    if (result.ok) applyToStore(name, record, options);
    return result;
  }

  async function saveMany(name, records, options) {
    var list = Array.isArray(records) ? records.filter(Boolean) : [records].filter(Boolean);
    var outcome = { ok: true, saved: 0, problems: [] };

    for (var i = 0; i < list.length; i += 1) {
      var result = await save(name, list[i], options);
      if (result.ok) outcome.saved += 1;
      else {
        outcome.ok = false;
        outcome.problems.push(result);
      }
    }

    /* One summary message rather than a burst of them, because a caller showing a message per
       record for a fifty-row plan is unusable. */
    if (!outcome.ok) {
      outcome.reason = outcome.problems[0].reason;
      outcome.message =
        outcome.problems.length === 1
          ? outcome.problems[0].message
          : outcome.problems.length + " of " + list.length + " changes did not save. " + outcome.problems[0].message;
    }
    return outcome;
  }

  /*
    replaceAll - "this array is now the collection".

    THE MIGRATION VEHICLE, AND WHY IT IS NOT A COMPROMISE

    Every helper being migrated has the same shape today: it is handed a whole collection and
    writes the lot. saveResources(resources), saveProgrammes(programmes), write(key, plans).
    Rewriting all of them into single-record saves in one pass is how deletes get quietly lost -
    a caller that removed an item from an array and saved it expects the item to go, and a
    per-record save cannot see an absence.

    So the collection-shaped signature survives, and what happens underneath changes completely:

      - the incoming array is diffed against what is already known
      - only records that are new or actually different are written, one row at a time
      - records that have disappeared are removed, one row at a time
      - every one of those carries its own version, so a stale record is refused, not merged

    That is the fix, not a stepping stone towards it. The clobbering in the old design came from
    rewriting every row of a collection whenever any one of them changed; two people editing
    different projects overwrote each other because both wrote all the projects. Here, an
    untouched record is not written at all, so there is nothing to overwrite - and an edit made
    against a stale copy comes back as a conflict rather than winning.

    Call sites that genuinely change one record should still use save(); this exists so that the
    ones that legitimately think in collections keep working, and keep being honest about it.
  */
  function sameRecord(a, b) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (error) {
      return false;
    }
  }

  /*
    A collection-shaped argument, resolved into rows and the group each row belongs to.

    THE DEFECT THIS EXISTS TO FIX, WHICH SHIPPED

    replaceAll used to open with one line:

        var incoming = Array.isArray(records) ? records.filter(Boolean) : [];

    Eighteen of the thirty-six collections are stored as an object keyed by project code, and
    every migrated caller passes exactly that object - saveMilestones() builds the whole store
    with one project's rows replaced and hands the lot over, which is the signature replaceAll
    exists to keep. An object is not an array, so `incoming` was empty; an empty incoming means
    every record already held has "disappeared"; so the removal pass soft-deleted the entire
    collection, and the call returned ok.

    Saving one milestone would have removed every milestone in the portfolio. Duplicating a
    project would have removed every plan task in it. Nothing caught this: section 29 of the
    harness exercises replaceAll thoroughly and only ever against resourceScenarios, which is
    one of the array-shaped ones.

    The rule that replaces it: a shape this function does not recognise is an error, never an
    empty collection. "There is nothing here" and "I did not understand you" must not produce
    the same behaviour when one of them deletes everything.
  */
  function incoming(name, records) {
    var found = entry(name);
    var shape = found.definition.shape;

    if (Array.isArray(records)) {
      /* A flat list is accepted for either shape. Grouped collections then fall back to the
         row's own project field, which is how single-record save() has always grouped. */
      return {
        rows: records.filter(objectish).map(function (row) {
          return { row: row, group: null };
        })
      };
    }

    if (objectish(records)) {
      if (shape !== "object") {
        return {
          error:
            name +
            " is stored as a list, so it cannot be replaced with an object keyed by project. Pass an array of records."
        };
      }
      var out = [];
      Object.keys(records).forEach(function (group) {
        var group_rows = records[group];
        if (!Array.isArray(group_rows)) {
          /* Skipped rather than treated as empty, and said out loud. Treating it as empty is
             what deleted collections; failing the whole save would make one malformed legacy
             group block every later edit. */
          console.warn(
            'PPMStore: group "' + group + '" of ' + name + " is not a list of records and has been left alone."
          );
          return;
        }
        group_rows.forEach(function (row) {
          if (objectish(row)) out.push({ row: row, group: group });
        });
      });
      return { rows: out };
    }

    return {
      error:
        "There is nothing to save for " +
        name +
        ". replaceAll needs the whole collection, either as a list of records or as an object keyed by project."
    };
  }

  async function replaceAll(name, records, options) {
    var found = entry(name);
    if (!found) return invalid('"' + name + '" is not a collection in this application.');

    if (found.definition.shape === "singleton") {
      return save(name, records || {}, options);
    }

    var resolved = incoming(name, records);
    if (resolved.error) return invalid(resolved.error);
    var wanted = resolved.rows;

    var field = idFieldOf(name);
    if (!field) return invalid('"' + name + '" has no identifier field, so a collection cannot be diffed.');

    /* Groups carried through from the store, so a removed row is dropped from the group it was
       actually filed under rather than one guessed from its own fields. */
    var before = pairs(name).map(function (pair) {
      return { row: copy(pair.row), group: pair.group };
    });
    var beforeById = new Map(
      before.map(function (pair) {
        return [String(pair.row[field] || ""), pair.row];
      })
    );
    var incomingIds = new Set(
      wanted.map(function (pair) {
        return String(pair.row[field] || "");
      })
    );

    /* The group the caller filed this row under wins over anything derivable from the row. */
    var withGroup = function (group) {
      if (group === null || group === undefined || group === "") return options;
      var merged = {};
      Object.keys(options || {}).forEach(function (key) {
        merged[key] = options[key];
      });
      merged.storageGroup = group;
      return merged;
    };

    var outcome = { ok: true, saved: 0, removed: 0, unchanged: 0, problems: [] };

    for (var i = 0; i < wanted.length; i += 1) {
      var row = wanted[i].row;
      var prior = beforeById.get(String(row[field] || ""));
      if (prior && sameRecord(prior, row)) {
        outcome.unchanged += 1;
        continue;
      }
      var saveResult = await save(name, row, withGroup(wanted[i].group));
      if (saveResult.ok) outcome.saved += 1;
      else {
        outcome.ok = false;
        outcome.problems.push(saveResult);
      }
    }

    for (var j = 0; j < before.length; j += 1) {
      var gone = before[j].row;
      if (incomingIds.has(String(gone[field] || ""))) continue;
      var removeResult = await remove(name, gone, withGroup(before[j].group));
      if (removeResult.ok) outcome.removed += 1;
      else {
        outcome.ok = false;
        outcome.problems.push(removeResult);
      }
    }

    if (!outcome.ok) {
      outcome.reason = outcome.problems[0].reason;
      outcome.queued = outcome.problems.some(function (problem) {
        return problem.queued;
      });
      outcome.message =
        outcome.problems.length === 1
          ? outcome.problems[0].message
          : outcome.problems.length + " changes did not save. " + outcome.problems[0].message;
    }
    return outcome;
  }

  async function remove(name, record, options) {
    var found = entry(name);
    if (!found) return invalid('"' + name + '" is not a collection in this application.');
    if (!record || typeof record !== "object") return invalid("There is no record to remove.");

    if (found.owner === FOUNDATION) {
      /*
        Projects, programmes, portfolios and people are never deleted - they are archived or
        deactivated, which is an ordinary field change and goes through save(). Saying so is
        more useful than a permission error from a DELETE that was never granted.
      */
      return invalid(
        name + " records are archived rather than deleted. Set the archived or active field and save instead."
      );
    }

    var c = child();
    if (!c || typeof c.removeOne !== "function") {
      return { ok: false, reason: "failed", message: "The database adapter is not loaded on this page.", queued: false };
    }

    var outcome;
    try {
      outcome = await c.removeOne(name, record, options);
    } catch (error) {
      return { ok: false, reason: "failed", message: String((error && error.message) || error), queued: false };
    }

    var result = toResult(name, outcome, record);
    if (result.ok) removeFromStore(name, record, options);
    return result;
  }

  /* ------------------------------------------------- keeping the store in step

     The store is updated only after the database has confirmed, so the screen can never show a
     state the database refused. That is the whole point of the change, and it is the one rule
     in this file that must not be relaxed for convenience.
  */
  function groupFor(name, record, options) {
    var found = entry(name);
    var explicit = options && (options.storageGroup || options.projectCode);
    if (explicit) return String(explicit);
    var field = found.definition.projectField;
    return String((field && record[field]) || record.projectCode || record.programmeCode || "");
  }

  function applyToStore(name, record, options) {
    var found = entry(name);
    if (!found) return;
    var shape = found.definition.shape;
    var field = idFieldOf(name);
    var raw = live(name);
    /* The caller keeps its own object and may well edit it again - a form that saves on every
       keystroke does exactly that. What the store keeps is the state the database confirmed, so
       it cannot be the same object. */
    var kept = copy(record);

    if (shape === "singleton") {
      store.set(name, kept);
      return;
    }

    var rows;
    if (Array.isArray(raw)) rows = raw;
    else {
      var group = groupFor(name, record, options);
      if (!Array.isArray(raw[group])) raw[group] = [];
      rows = raw[group];
    }

    var at = rows.findIndex(function (row) {
      return String(row[field] || "") === String(record[field] || "");
    });
    if (at === -1) rows.push(kept);
    else rows[at] = kept;
  }

  function removeFromStore(name, record, options) {
    var found = entry(name);
    if (!found) return;
    var field = idFieldOf(name);
    var raw = live(name);
    var wanted = String(record[field] || "");

    if (found.definition.shape === "singleton") {
      store.set(name, {});
      return;
    }

    var drop = function (rows) {
      return rows.filter(function (row) {
        return String(row[field] || "") !== wanted;
      });
    };

    if (Array.isArray(raw)) {
      store.set(name, drop(raw));
      return;
    }
    var group = groupFor(name, record, options);
    if (Array.isArray(raw[group])) raw[group] = drop(raw[group]);
  }

  /* --------------------------------------------------------------- diagnostic */

  function explain() {
    if (!registry.size) buildRegistry();
    var rows = [];
    registry.forEach(function (found, name) {
      rows.push({
        collection: name,
        owner: found.owner,
        shape: found.definition.shape || "record",
        records: all(name).length,
        loaded: store.has(name)
      });
    });
    console.table(rows);
    if (queue.length) {
      console.warn(queue.length + " change(s) are saved on this computer but not yet in the database:");
      console.table(queue.map(function (item) {
        return { collection: item.collection, when: item.at, why: item.message };
      }));
    } else {
      console.info("Nothing is waiting to be saved.");
    }
    return { collections: rows, outstanding: outstanding() };
  }

  function start() {
    if (started) return registry;
    started = true;
    return buildRegistry();
  }

  /* ------------------------------------------------- per-collection namespaces

     PPMStore.projects.save(...) reads better at a call site than PPMStore.save("projects", ...),
     and a typo in a collection name becomes "cannot read property save of undefined" at once
     rather than an invalid result nobody checked. Generated from the registry, so a collection
     added to an adapter appears here without anything being typed twice.
  */
  function namespaces() {
    var api = {};
    start().forEach(function (found, name) {
      api[name] = Object.freeze({
        all: function () {
          return all(name);
        },
        byId: function (id) {
          return byId(name, id);
        },
        forProject: function (projectCode) {
          return forProject(name, projectCode);
        },
        get: function () {
          return get(name);
        },
        read: function () {
          return read(name);
        },
        save: function (record, options) {
          return save(name, record, options);
        },
        saveMany: function (records, options) {
          return saveMany(name, records, options);
        },
        replaceAll: function (records, options) {
          return replaceAll(name, records, options);
        },
        remove: function (record, options) {
          return remove(name, record, options);
        }
      });
    });
    return api;
  }

  var api = {
    collections: function () {
      return [...start().keys()].sort();
    },
    collectionFor: collectionFor,
    /* Hydration's way in, and the adapters' only reason to touch this module. Not for page code:
       it sets a collection without asking the database anything, which is exactly what every
       other function here exists to prevent. */
    adopt: adopt,
    read: read,
    all: all,
    byId: byId,
    forProject: forProject,
    get: get,
    save: save,
    saveMany: saveMany,
    replaceAll: replaceAll,
    remove: remove,
    outstanding: outstanding,
    retry: retry,
    onChange: onChange,
    explain: explain
  };

  Object.assign(api, namespaces());
  window.PPMStore = Object.freeze(api);

  /* A queued change is worth another attempt the moment the connection comes back, and the
     browser says so without being asked. */
  if (typeof window.addEventListener === "function") {
    window.addEventListener("online", function () {
      if (queue.length) retry();
    });
  }
})();
