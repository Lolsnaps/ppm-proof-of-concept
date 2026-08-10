/*
  The unsaved-work banner.

  Stage 16 gave every write an answer, and made one of those answers "offline: this is saved on
  this computer and will be retried". This is the part that makes that honest, because a queue
  nobody can see is not meaningfully different from a write that failed silently - which is the
  defect the whole stage exists to remove.

  WHAT IT SHOWS

  Nothing at all, until something is queued. Then a bar at the top of the page:

      3 changes are saved on this computer but not yet in the database.   [ What? ] [ Retry ]

  "What?" lists them. "Retry" attempts them now rather than waiting for the browser to notice
  the connection is back. When the queue drains it says so briefly and then removes itself.

  WHY IT IS NOT A MODAL

  Because the work is not lost and the person is probably mid-task. A dialogue would interrupt
  something that does not need interrupting; a bar that stays until it is true no longer is
  enough. It is polite() rather than assertive() for the same reason - a screen reader should
  mention it at a natural pause, not cut across what is being read.

  WHAT IT DELIBERATELY DOES NOT DO

  It does not retry on a timer. PPMStore already retries when the browser reports the connection
  has returned, which is the event that actually matters; a spinning retry loop against a
  database that is refusing would just be noise. And it never says "saved" - that word belongs
  to writes that reached PostgreSQL.
*/

(function () {
  "use strict";

  var BANNER_ID = "ppmUnsavedBanner";
  var LIST_ID = "ppmUnsavedList";
  var settled = null;

  function store() {
    return window.PPMStore || null;
  }

  function plural(count, one, many) {
    return count === 1 ? one : many;
  }

  function build() {
    var existing = document.getElementById(BANNER_ID);
    if (existing) return existing;

    var banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.className = "ppm-unsaved";
    banner.setAttribute("role", "status");
    /* Polite: this is information, not an interruption. */
    banner.setAttribute("aria-live", "polite");

    var text = document.createElement("span");
    text.className = "ppm-unsaved-text";

    var detail = document.createElement("button");
    detail.type = "button";
    detail.className = "ppm-unsaved-action";
    /* Not a data-changing control, so PPMAuth must not fail it closed. */
    detail.setAttribute("data-permission", "none");
    detail.textContent = "What is outstanding?";

    var retry = document.createElement("button");
    retry.type = "button";
    retry.className = "ppm-unsaved-action";
    retry.setAttribute("data-permission", "none");
    retry.textContent = "Try again now";

    var list = document.createElement("ul");
    list.id = LIST_ID;
    list.className = "ppm-unsaved-list";
    list.hidden = true;

    var bar = document.createElement("div");
    bar.className = "ppm-unsaved-bar";
    bar.appendChild(text);
    bar.appendChild(detail);
    bar.appendChild(retry);

    banner.appendChild(bar);
    banner.appendChild(list);

    detail.addEventListener("click", function () {
      list.hidden = !list.hidden;
      detail.textContent = list.hidden ? "What is outstanding?" : "Hide the list";
    });

    retry.addEventListener("click", async function () {
      var api = store();
      if (!api) return;
      retry.disabled = true;
      var label = retry.textContent;
      retry.textContent = "Trying…";
      try {
        await api.retry();
      } finally {
        retry.disabled = false;
        retry.textContent = label;
      }
    });

    /* Before <main> so it is the first thing after the navigation, and does not move the page
       content around when it appears. */
    var main = document.querySelector("main");
    if (main && main.parentNode) main.parentNode.insertBefore(banner, main);
    else document.body.insertBefore(banner, document.body.firstChild);

    return banner;
  }

  function describe(entry) {
    var collection = String(entry.collection || "a record");
    var when = entry.at ? new Date(entry.at) : null;
    var time = when && !isNaN(when.getTime()) ? when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
    return time ? collection + " - " + time + " - " + entry.message : collection + " - " + entry.message;
  }

  /*
    The banner's own parts, rebuilt if anything is missing.

    render() used to reach straight for banner.querySelector(".ppm-unsaved-text") and set its
    textContent. If the element was not there - a page that had removed the banner, a partial
    build - that threw, and because render runs inside PPMStore's listener loop the throw was
    caught and logged rather than shown. A banner that exists to make failure visible must not
    fail invisibly.
  */
  function parts(banner) {
    var text = banner.querySelector(".ppm-unsaved-text");
    if (text) return { banner: banner, text: text };
    if (banner.parentNode) banner.parentNode.removeChild(banner);
    var rebuilt = build();
    return { banner: rebuilt, text: rebuilt.querySelector(".ppm-unsaved-text") };
  }

  function render(outstanding) {
    var count = outstanding.length;
    var banner = document.getElementById(BANNER_ID);

    if (!count) {
      if (!banner) return;
      /*
        Say it drained rather than vanishing without explanation - somebody who saw the warning
        deserves to be told it resolved. Then remove it, so a stale reassurance cannot sit on
        the page.
      */
      var settledParts = parts(banner);
      banner = settledParts.banner;
      banner.classList.add("settled");
      if (settledParts.text) settledParts.text.textContent = "All changes have now reached the database.";
      var list = document.getElementById(LIST_ID);
      if (list) {
        list.hidden = true;
        list.textContent = "";
      }
      banner.querySelectorAll(".ppm-unsaved-action").forEach(function (button) {
        button.hidden = true;
      });
      clearTimeout(settled);
      settled = setTimeout(function () {
        if (banner.parentNode) banner.parentNode.removeChild(banner);
      }, 6000);
      return;
    }

    clearTimeout(settled);
    banner = build();
    banner.classList.remove("settled");
    banner.querySelectorAll(".ppm-unsaved-action").forEach(function (button) {
      button.hidden = false;
    });

    var current = parts(banner);
    banner = current.banner;
    if (current.text) {
      current.text.textContent =
        count +
        " " +
        plural(count, "change is", "changes are") +
        " saved on this computer but not yet in the database.";
    }

    var list = document.getElementById(LIST_ID);
    if (!list) return;
    list.textContent = "";
    outstanding.forEach(function (entry) {
      var item = document.createElement("li");
      item.textContent = describe(entry);
      list.appendChild(item);
    });
  }

  function start() {
    var api = store();
    if (!api || typeof api.onChange !== "function") {
      console.warn("PPMUnsaved: PPMStore is not loaded, so outstanding changes cannot be shown.");
      return;
    }
    /* onChange reports the current state immediately, so nothing is needed on first paint. */
    api.onChange(render);
  }

  window.PPMUnsaved = Object.freeze({
    render: render,
    outstanding: function () {
      var api = store();
      return api ? api.outstanding() : [];
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
