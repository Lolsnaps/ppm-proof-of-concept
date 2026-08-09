/*
  PPM Core
  --------
  Canonical implementations of the small helpers that were previously copied
  into almost every file. Load this first, before any other ppm-*.js module.

  Only helpers whose copies were genuinely equivalent live here. Where two
  versions behaved differently, the difference is deliberate and they have been
  left where they are — see "Deliberately not shared" at the bottom of this file.

  Backup, restore and storage-limit handling live in ppm-data-safety.js, which
  loads immediately after this file.
*/
(function () {
  "use strict";

  /* ------------------------------------------------------------------- text */

  /*
    Escape a value for insertion into HTML, including inside an attribute.

    Note: an earlier copy of this in the resource-management module escaped
    via textContent/innerHTML, which does NOT escape quotes and so could break
    out of an attribute such as  data-id="${escapeHtml(value)}".
    This version escapes quotes, so it is safe in both text and attributes.
  */
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Kept as a separate name because several call sites read better this way.
  const escapeAttribute = escapeHtml;

  // Lower-cased, trimmed text for comparisons (names, emails, teams).
  function normaliseText(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase();
  }

  /* ------------------------------------------------------------------- json */

  /*
    Parse a JSON string, returning the fallback if it is missing or malformed.
    `label` is only used to make the console message useful when data is corrupt.
  */
  function parseJson(value, fallback, label) {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch (error) {
      if (label) console.error(`Stored ${label} could not be read.`, error);
      return fallback;
    }
  }

  // Read and parse a localStorage key in one step.
  function readJson(key, fallback, label) {
    return parseJson(localStorage.getItem(key), fallback, label || key);
  }

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  /* ------------------------------------------------------------------ dates */

  // All dates are held as local-time ISO days (YYYY-MM-DD), never UTC, so that
  // a date entered as the 5th never displays as the 4th in a negative offset.
  function isoDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function todayIso() {
    return isoDate(new Date());
  }

  // Accepts "YYYY-MM-DD" or a full ISO timestamp; returns a local-midnight Date.
  function parseDate(value) {
    if (!value) return null;
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Returns an ISO day string, not a Date, so it can be stored directly.
  function addDays(value, days) {
    const date = value instanceof Date ? new Date(value) : parseDate(value);
    if (!date) return "";
    date.setDate(date.getDate() + Number(days || 0));
    return isoDate(date);
  }

  /* ---------------------------------------------------------------- numbers */

  function numeric(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  /* ------------------------------------------------------- loading failsafe */

  /*
    `<html class="ppm-loading">` hides the page's own content until ppm-page-loader.js takes
    the class off. That is what removes the pop-in - and it means one thing must never
    happen: the class staying on. A hidden page is worse than an ugly one.

    ppm-page-loader.js removes it on success, on a slow load, on a partial failure and in its
    catch. The one case it cannot cover is itself never running - a 503 on that file, which is
    exactly the failure this pilot has already seen once on another module. So the guarantee
    lives here instead, in a file that loads in <head> long before it.

    20 seconds, so it sits well behind the loader's own 12-second "taking longer than usual"
    message and only fires when that message never arrived either.
  */
  const LOADING_CLASS = "ppm-loading";
  const LOADING_FAILSAFE_MS = 20000;

  if (typeof document !== "undefined" && document.documentElement?.classList?.contains(LOADING_CLASS)) {
    setTimeout(() => {
      const root = document.documentElement;
      if (!root.classList.contains(LOADING_CLASS)) return;
      root.classList.remove(LOADING_CLASS);
      console.error(
        `PPMCore: the page was still in its loading state after ${LOADING_FAILSAFE_MS / 1000}s, so it ` +
          `has been revealed anyway. ppm-page-loader.js did not finish - check the console above ` +
          `for a script that failed to load, and reload the page.`
      );
    }, LOADING_FAILSAFE_MS);
  }

  /* --------------------------------------------------------- computed styles */

  /*
    Geometry that has to be calculated - a bar's left and width, a timeline's total
    width, a column's pixel width, an indent - applied without an inline style
    attribute.

    WHY THIS EXISTS

    style-src is 'self' with no 'unsafe-inline', which blocks style attributes as well
    as <style> blocks, and it blocks them wherever they come from: markup written by
    hand and markup assigned to innerHTML alike. Eight page scripts were still
    emitting style="left:...px;width:...px" into their templates. The browser dropped
    every one, silently, with only a console message - so the Allocation Gantt
    collapsed into a single coloured block, the project plan's dependency SVG lost its
    position and drew its links across the whole page, and register columns lost their
    widths and wrapped their headings mid-word.

    WHY A data- ATTRIBUTE AND NOT A CLASS

    A class cannot carry a number computed at render time. What CSP restricts is the
    parsing of a style attribute; it does not restrict CSSOM, so a value written with
    element.style.setProperty() applies normally and stays within the policy. So the
    template carries the declarations as data and this applies them afterwards.

    Static declarations should NOT come here - they belong in a named class in the
    page's stylesheet. This is only for values that depend on the data.

    WHY AN OBSERVER AS WELL AS A FUNCTION

    Every render path would otherwise have to remember to call apply() after each
    innerHTML assignment, and the failure mode of forgetting is invisible - the markup
    is correct, the page just renders flat. The observer makes the default outcome
    correct; the explicit call at known render points is what avoids a frame of
    unpositioned content before it runs.
  */
  const STYLE_ATTRIBUTE = "data-ppm-style";
  let observing = false;

  /*
    Returns a ready-to-interpolate attribute, including the leading space, or ""
    when there is nothing to apply - so a template can drop it in unconditionally
    without emitting an empty attribute.
  */
  function styleAttribute(declarations) {
    const text = String(declarations ?? "").trim();
    if (!text) return "";
    return ` ${STYLE_ATTRIBUTE}="${escapeAttribute(text)}"`;
  }

  function applyOne(element) {
    const declarations = element.getAttribute(STYLE_ATTRIBUTE);
    if (!declarations) return;
    declarations.split(";").forEach((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator < 1) return;
      const property = declaration.slice(0, separator).trim();
      const value = declaration.slice(separator + 1).trim();
      /* setProperty rather than assigning to style.cssText, because custom
         properties such as --unit-width are only reachable this way. */
      if (property && value) element.style.setProperty(property, value);
    });
  }

  /* Applies to `root` itself and everything inside it. Idempotent. */
  function applyComputedStyles(root) {
    const scope = root && root.nodeType === 1 ? root : document;
    if (scope.nodeType === 1 && scope.hasAttribute(STYLE_ATTRIBUTE)) applyOne(scope);
    scope.querySelectorAll(`[${STYLE_ATTRIBUTE}]`).forEach(applyOne);
  }

  function observeComputedStyles() {
    if (observing || typeof MutationObserver !== "function") return;
    observing = true;
    /* documentElement rather than body: this module loads in <head>, where body does
       not exist yet, and subtree covers body once the parser creates it. */
    new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node.nodeType === 1) applyComputedStyles(node);
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  observeComputedStyles();

  /* ------------------------------------------------------------------- misc */

  // "PRJ-<uuid>" where available, falling back to timestamp plus random suffix.
  function uid(prefix) {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  /*
    Deliberately not shared
    -----------------------
    These look duplicated but the copies behave differently on purpose, so
    merging them would change what users see or what gets stored:

    formatDate    Different screens want a different empty value — "Not set",
                  "Invalid date", or a blank cell. The fallback is part of each
                  screen's design, so each page keeps its own.
    formatMoney   Some views round to whole pounds, others show pence.
    uid / IDs     Audit, financial and planning records use different ID shapes
                  that are already stored in existing data; changing them would
                  orphan those records.
    flattenStore  Each store nests project data slightly differently and the
                  callers depend on those differences.
    optionMarkup  Signatures differ over whether a blank option is included.
  */

  window.PPMCore = Object.freeze({
    escapeHtml,
    escapeAttribute,
    normaliseText,
    parseJson,
    readJson,
    clone,
    isoDate,
    todayIso,
    parseDate,
    addDays,
    numeric,
    uid,
    styleAttribute,
    applyComputedStyles
  });
})();
