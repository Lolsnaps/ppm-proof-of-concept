/*
  Turns a <select multiple> into a list of tick boxes.

  Loaded by administration.html and resource-directory.html - the only two pages with a
  multiple-select. It self-starts, so no page script calls it (see SELF-STARTING below).

  WHY

  A multiple-select shows selection as highlight and nothing else. Highlight is also what
  hover looks like, what focus looks like, and what a row looks like in every other list in
  this application, so "these two are selected" and "my pointer is here" are the same
  picture. Worse, selecting a second item needs Ctrl held down, and clicking without it
  silently clears everything already chosen. Two of the four are access-control fields -
  additional roles, and which projects a person may see - where a silent clear is a
  permissions change nobody meant to make.

  THE ONE IMPORTANT DESIGN DECISION

  The <select> is not replaced. It stays in the DOM, hidden, and remains the only thing that
  holds the answer. The tick boxes are a second face on the same control:

      tick a box  ->  set option.selected  ->  dispatch change on the select
      set options ->  MutationObserver     ->  rebuild the tick boxes

  So every existing read keeps working untouched - administration-page.js does
  [...el("portfolioProgrammes").selectedOptions].map(...), resource-directory-page.js has
  selectedValues("selectedProjectCodes"), and neither has to know this file exists. The
  alternative, a component that owns its own state, would have meant editing every read and
  re-proving the two access-control paths in the harness. Nothing here can change what a form
  saves, because nothing here is what a form reads.

  The same argument covers permissions. PPMAuth disables data-changing controls by setting
  disabled on the real element; this mirrors that onto the tick boxes rather than deciding
  anything itself. The permission model keeps one owner.

  SELF-STARTING

  It enhances every select[multiple] on the page by itself, once, as soon as it loads. No page
  script was changed to make this work, which is the point: administration-page.js and
  resource-directory-page.js are 1,000-line files that handle access control, and the safest
  edit to them was none.

  That is only sound because all four of these selects are in the static markup - only their
  <option> lists are built at runtime. So there is nothing to wait for and nothing to watch the
  document for; the per-select observer below picks up the options when they arrive. A page that
  ever creates a multiple-select from scratch must call PPMPicklist.enhance() on it, and there
  is no gate for that, so it is written here where whoever adds one will be reading.

  ADDING IT TO ANOTHER PAGE

      1. link ppm-controls.css last in the head - it must win over the page stylesheet
      2. add ppm-picklist.js to data-ppm-scripts, before the page script

  enhanceAll() is safe to call repeatedly; a select that is already enhanced is skipped.

  GOTCHA

  Pages populate these selects by assigning innerHTML, which destroys and recreates every
  option. That is why the observer watches childList and rebuilds rather than trying to
  reconcile - and why selection is read back from the select after each rebuild rather than
  remembered here. The select is the record; this is a view of it.
*/

(function () {
  "use strict";

  var ENHANCED = "data-ppm-picklist-for";
  var registry = new Map();

  function isEnhanceable(select) {
    return !!select && select.tagName === "SELECT" && select.multiple;
  }

  function resolve(target) {
    if (typeof target === "string") return document.getElementById(target);
    return target || null;
  }

  function label(select) {
    /* The visible label, so the tick-box group announces itself the same way the select did. */
    if (select.id) {
      var explicit = document.querySelector('label[for="' + select.id + '"]');
      if (explicit && explicit.textContent.trim()) return explicit.textContent.trim();
    }
    var wrapping = select.closest("label");
    if (wrapping && wrapping.textContent.trim()) return wrapping.textContent.trim();
    return select.getAttribute("aria-label") || "Selection";
  }

  function optionsOf(select) {
    return Array.prototype.slice.call(select.options);
  }

  /* ------------------------------------------------------------------ building */

  function build(select) {
    var wrapper = document.createElement("div");
    wrapper.className = "ppm-picklist";
    wrapper.setAttribute("role", "group");
    wrapper.setAttribute("aria-label", label(select));
    if (select.id) wrapper.setAttribute(ENHANCED, select.id);

    var bar = document.createElement("div");
    bar.className = "ppm-picklist-bar";

    var count = document.createElement("span");
    count.className = "ppm-picklist-count";

    var all = document.createElement("button");
    all.type = "button";
    all.className = "ppm-picklist-action";
    all.textContent = "Select all";

    var none = document.createElement("button");
    none.type = "button";
    none.className = "ppm-picklist-action";
    none.textContent = "Clear";

    bar.appendChild(count);
    bar.appendChild(all);
    bar.appendChild(none);

    var list = document.createElement("ul");
    list.className = "ppm-picklist-list";

    wrapper.appendChild(bar);
    wrapper.appendChild(list);

    return { wrapper: wrapper, bar: bar, count: count, all: all, none: none, list: list };
  }

  function row(option, index, select) {
    var item = document.createElement("li");

    var line = document.createElement("label");
    line.className = "ppm-picklist-item";

    var box = document.createElement("input");
    box.type = "checkbox";
    box.className = "ppm-picklist-box";
    box.checked = option.selected;
    box.disabled = select.disabled || option.disabled;
    /* The index, not the value: two options may carry the same value, and the option is what
       has to be toggled. */
    box.setAttribute("data-ppm-option", String(index));

    var text = document.createElement("span");
    text.className = "ppm-picklist-text";
    text.textContent = option.textContent;

    line.appendChild(box);
    line.appendChild(text);
    item.appendChild(line);

    if (option.selected) line.classList.add("selected");
    if (box.disabled) line.classList.add("disabled");

    return item;
  }

  /* ------------------------------------------------------------------- syncing */

  function paint(entry) {
    var select = entry.select;
    var options = optionsOf(select);
    var selected = options.filter(function (option) {
      return option.selected;
    }).length;

    entry.parts.count.textContent = options.length
      ? selected + " of " + options.length + " selected"
      : "Nothing to choose from";
    entry.parts.count.classList.toggle("some", selected > 0);

    entry.parts.all.disabled = select.disabled || !options.length || selected === options.length;
    entry.parts.none.disabled = select.disabled || !selected;
  }

  function rebuild(entry) {
    var select = entry.select;
    var list = entry.parts.list;
    var options = optionsOf(select);

    list.textContent = "";

    if (!options.length) {
      var empty = document.createElement("li");
      empty.className = "ppm-picklist-empty";
      empty.textContent = "Nothing to choose from yet.";
      list.appendChild(empty);
      paint(entry);
      return;
    }

    options.forEach(function (option, index) {
      list.appendChild(row(option, index, select));
    });
    paint(entry);
  }

  /*
    One change event on the select, however the change arrived. Pages listen for it - the
    resource directory recalculates the permissions summary from additionalRoles on change -
    so a tick that did not dispatch would leave the page describing the previous selection.
  */
  function announce(select) {
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function toggle(entry, index, checked) {
    var option = entry.select.options[index];
    if (!option || option.disabled || entry.select.disabled) return;
    option.selected = checked;
    entry.quiet = true;
    announce(entry.select);
    entry.quiet = false;
  }

  function setAll(entry, checked) {
    if (entry.select.disabled) return;
    var changed = false;
    optionsOf(entry.select).forEach(function (option) {
      if (option.disabled || option.selected === checked) return;
      option.selected = checked;
      changed = true;
    });
    if (!changed) return;
    rebuild(entry);
    entry.quiet = true;
    announce(entry.select);
    entry.quiet = false;
  }

  /* ------------------------------------------------------------------- wiring */

  function wire(entry) {
    entry.parts.list.addEventListener("change", function (event) {
      var box = event.target;
      if (!box || !box.classList.contains("ppm-picklist-box")) return;
      var index = Number(box.getAttribute("data-ppm-option"));
      toggle(entry, index, box.checked);
      var line = box.closest(".ppm-picklist-item");
      if (line) line.classList.toggle("selected", box.checked);
      paint(entry);
    });

    entry.parts.all.addEventListener("click", function () {
      setAll(entry, true);
    });
    entry.parts.none.addEventListener("click", function () {
      setAll(entry, false);
    });

    /*
      Rebuild when the page replaces the options, and when PPMAuth enables or disables the
      control. Both arrive after this file has run and neither fires an event of its own.
    */
    entry.observer = new MutationObserver(function () {
      if (entry.quiet) return;
      rebuild(entry);
    });
    entry.observer.observe(entry.select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"]
    });

    /* A programmatic selection change dispatches change; reflect it. Guarded by entry.quiet
       so the events this file dispatches itself do not cause a rebuild mid-interaction. */
    entry.select.addEventListener("change", function () {
      if (entry.quiet) return;
      rebuild(entry);
    });
  }

  /* --------------------------------------------------------------------- API */

  function enhance(target) {
    var select = resolve(target);
    if (!isEnhanceable(select)) return null;
    if (registry.has(select)) return registry.get(select).parts.wrapper;

    var parts = build(select);
    var entry = { select: select, parts: parts, quiet: false, observer: null };

    select.classList.add("ppm-picklist-native");
    select.setAttribute("tabindex", "-1");
    select.setAttribute("aria-hidden", "true");
    if (select.parentNode) select.parentNode.insertBefore(parts.wrapper, select.nextSibling);

    registry.set(select, entry);
    rebuild(entry);
    wire(entry);
    return parts.wrapper;
  }

  function enhanceAll(root) {
    var scope = root || document;
    var found = scope.querySelectorAll("select[multiple]");
    var done = 0;
    Array.prototype.forEach.call(found, function (select) {
      if (enhance(select)) done += 1;
    });
    return done;
  }

  function refresh(target) {
    var select = resolve(target);
    var entry = select ? registry.get(select) : null;
    if (!entry) return false;
    rebuild(entry);
    return true;
  }

  /*
    Diagnostic. PPMProjectForms.explain() earned its place during the editor work - being able
    to ask the page what it thinks it is showing, rather than inferring it from the screen,
    turned two long sessions into short ones.
  */
  function explain() {
    var report = [];
    registry.forEach(function (entry, select) {
      var options = optionsOf(select);
      report.push({
        id: select.id || "(no id)",
        options: options.length,
        selected: options
          .filter(function (option) {
            return option.selected;
          })
          .map(function (option) {
            return option.value;
          }),
        disabled: select.disabled,
        permission: select.getAttribute("data-permission") || "(none)"
      });
    });
    if (!report.length) {
      console.log("No pick lists are enhanced on this page.");
      return report;
    }
    console.table(report);
    return report;
  }

  window.PPMPicklist = Object.freeze({
    enhance: enhance,
    enhanceAll: enhanceAll,
    refresh: refresh,
    explain: explain
  });

  /* --------------------------------------------------------------- self-start

     Both entry points are needed. ppm-page-loader.js adds this script to the document after
     the page has parsed, so DOMContentLoaded has usually already fired by the time this runs
     and the listener alone would never be called; but on a page that loaded it with a plain
     <script src> in the head, the selects do not exist yet and running immediately would find
     nothing. Checking readyState covers both without caring which happened.
  */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      enhanceAll();
    });
  } else {
    enhanceAll();
  }
})();
