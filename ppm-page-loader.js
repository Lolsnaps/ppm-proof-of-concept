/*
  Foresters Portfolio — page bootstrap and loading state

  Database-backed collections are asynchronous, while the existing page scripts remain
  synchronous by design. This loader waits for both hydration layers, then loads the page
  and domain scripts in their original order.

  It also owns the loading state, because it is the only thing that knows when a page is
  genuinely ready.

  WHY THE LOADING STATE LIVES HERE

  Every page draws its shell immediately - header, nav, empty panels - and then sits there
  until hydration finishes and these scripts run. A fully drawn empty page reads as broken
  rather than loading, and on a cold cache that window is long enough to notice.

  <html class="ppm-loading"> is in the markup, so the state is active from the first paint
  with no script involved. This file takes it off when the work is done.

  The timings below are deliberate and worth keeping:

    SKELETON_DELAY   nothing appears for 120ms, so a warm load never flashes grey
    SKELETON_MINIMUM once shown it stays 300ms, because a skeleton that vanishes
                     instantly is more distracting than none at all
    SLOW_AFTER       at 12s the skeleton is replaced by an explanation, since a
                     skeleton that never resolves is a lie

  Everything it injects is class-driven. No inline styles, because style-src does not
  permit them.

  ONE SCRIPT FAILING MUST NOT TAKE THE PAGE WITH IT

  It did once. GitHub Pages answered a single module with a 503 - the file was fine - and
  because the loop stopped at the first rejection, every script after it never loaded. The
  page drew its shell and then did nothing at all. So a failed script is retried once, and
  then the rest are loaded anyway and the failure is reported.

  The class comes off in every one of those paths. If it did not, the page would stay hidden
  behind a skeleton for good, which is worse than any amount of pop-in. ppm-core.js carries a
  failsafe for the one case this file cannot cover: itself failing to load.
*/
(function () {
  "use strict";

  const host = document.currentScript;
  const scripts = String(host?.dataset?.ppmScripts || "")
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);

  const SKELETON_DELAY = 120;
  const SKELETON_MINIMUM = 300;
  const SLOW_AFTER = 12000;

  const root = document.documentElement;
  const startedAt = Date.now();
  let skeleton = null;
  let progress = null;
  let slowTimer = null;

  /* ------------------------------------------------------------- scaffolding */

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  /* A thin indeterminate bar under the nav. Deliberately indeterminate: hydration has no
     meaningful percentage, and a fake percentage that jumps to 90% and waits is worse
     than an honest "working on it". */
  function addProgressBar() {
    const nav = document.querySelector("nav");
    const anchor = nav || document.querySelector("header");
    if (!anchor || !anchor.parentNode) return null;

    const bar = element("div", "ppm-progress");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Loading portfolio data");
    /* No aria-valuenow: the work genuinely has no measurable progress, and announcing a
       made-up number is worse for a screen reader than announcing none. */
    bar.appendChild(element("div", "ppm-progress-fill"));
    anchor.parentNode.insertBefore(bar, anchor.nextSibling);
    return bar;
  }

  /*
    A generic skeleton: a heading, a row of summary cards, and a table. It deliberately
    does not try to mirror each page's real layout - 19 bespoke skeletons would be 19
    things to keep in step, and the point is only to show that structure is coming.
  */
  function buildSkeleton() {
    const wrap = element("div", "ppm-skeleton");
    wrap.setAttribute("aria-hidden", "true");

    const inner = element("div", "ppm-skeleton-inner");
    inner.appendChild(element("div", "ppm-skeleton-heading"));
    inner.appendChild(element("div", "ppm-skeleton-sub"));

    const cards = element("div", "ppm-skeleton-cards");
    for (let i = 0; i < 4; i += 1) {
      const card = element("div", "ppm-skeleton-card");
      card.appendChild(element("div", "ppm-skeleton-card-label"));
      card.appendChild(element("div", "ppm-skeleton-card-value"));
      cards.appendChild(card);
    }
    inner.appendChild(cards);

    const panel = element("div", "ppm-skeleton-panel");
    const head = element("div", "ppm-skeleton-panel-head");
    head.appendChild(element("div", "ppm-skeleton-panel-title"));
    panel.appendChild(head);

    const widths = ["w1", "w2", "w3", "w5", "w4"];
    for (let r = 0; r < 6; r += 1) {
      const row = element("div", "ppm-skeleton-row");
      widths.forEach((w) => row.appendChild(element("div", `ppm-skeleton-cell ${w}`)));
      panel.appendChild(row);
    }
    inner.appendChild(panel);

    wrap.appendChild(inner);
    return wrap;
  }

  function showSkeleton() {
    const main = document.querySelector("main");
    if (!main || skeleton) return;
    skeleton = buildSkeleton();
    main.insertBefore(skeleton, main.firstChild);
  }

  /* Replaces the skeleton with an explanation. Called for a slow load and for a failed
     one, because in both cases the honest thing is words rather than more grey boxes. */
  function showMessage(kind, title, body) {
    const main = document.querySelector("main");
    if (!main) return;
    if (skeleton) {
      skeleton.remove();
      skeleton = null;
    }
    if (main.querySelector(".ppm-loading-message")) return;

    const box = element("div", `ppm-loading-message${kind === "failed" ? " failed" : ""}`);
    box.setAttribute("role", "status");
    box.appendChild(element("b", null, title));
    box.appendChild(document.createTextNode(body));
    main.insertBefore(box, main.firstChild);
  }

  function finish() {
    if (slowTimer) clearTimeout(slowTimer);
    if (progress) progress.remove();
    if (skeleton) skeleton.remove();
    skeleton = null;
    progress = null;
    root.classList.remove("ppm-loading");
  }

  /* ------------------------------------------------------------------- boot */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.addEventListener("load", () => resolve(src), { once: true });
      script.addEventListener("error", () => reject(new Error(`Could not load ${src}.`)), { once: true });
      document.body.appendChild(script);
    });
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* A 503 is usually gone a second later, so one retry costs little and recovers most of
     them. Two failures is a real failure, and the caller carries on regardless. */
  async function loadWithRetry(src) {
    try {
      return await loadScript(src);
    } catch (first) {
      await wait(400);
      try {
        const loaded = await loadScript(src);
        console.warn(`PPM page bootstrap: ${src} failed once and loaded on retry.`, first);
        return loaded;
      } catch (second) {
        console.error(
          `PPM page bootstrap: ${src} could not be loaded, twice. Anything that depends on it ` +
            `will not work; the rest of the page has been loaded anyway. Reload to try again.`,
          second
        );
        return null;
      }
    }
  }

  async function boot() {
    progress = addProgressBar();

    const skeletonTimer = setTimeout(showSkeleton, SKELETON_DELAY);
    slowTimer = setTimeout(() => {
      showMessage(
        "slow",
        "This is taking longer than usual.",
        "Still waiting for the database. If it does not appear shortly, check your connection " +
          "and reload the page. Nothing has been lost."
      );
    }, SLOW_AFTER);

    const failed = [];
    try {
      const waits = [];
      if (window.PPMDatabase?.ready) waits.push(PPMDatabase.ready);
      if (window.PPMChildDatabase?.ready) waits.push(PPMChildDatabase.ready);
      if (waits.length) await Promise.allSettled(waits);

      /* Sequential on purpose: these scripts depend on each other's globals. */
      for (const src of scripts) {
        if (!(await loadWithRetry(src))) failed.push(src);
      }
    } finally {
      clearTimeout(skeletonTimer);
    }

    /*
      If the skeleton has been up for less than its minimum, hold it there. Removing it
      after 40ms produces a flicker that looks like a rendering fault, and the extra
      quarter second is not the thing making the page feel slow.
    */
    const shownFor = Date.now() - startedAt - SKELETON_DELAY;
    if (skeleton && shownFor < SKELETON_MINIMUM) {
      await wait(SKELETON_MINIMUM - shownFor);
    }

    finish();

    /* Said after the page is revealed, not instead of revealing it. */
    if (failed.length) {
      showMessage(
        "failed",
        "Part of this page could not be loaded.",
        `${failed.length} of ${scripts.length} scripts did not load, so some of this page will ` +
          `not work. Reload the page; if it keeps happening, report it with what you were doing.`
      );
    }

    return { loaded: scripts.length - failed.length, failed };
  }

  window.PPMPageReady = boot().catch((error) => {
    console.error("PPM page bootstrap failed.", error);
    /*
      The class comes off even on failure. Leaving it on would hide the page's own markup
      behind a skeleton forever, so a partial page the user can at least read and reload
      from beats an indefinite loading state.
    */
    finish();
    showMessage(
      "failed",
      "This page could not finish loading.",
      "Some of it may be missing or out of date. Reload the page; if it keeps happening, " +
        "report it with what you were doing at the time."
    );
    throw error;
  });
})();
