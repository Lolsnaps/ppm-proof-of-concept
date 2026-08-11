/*
  Wiring for PREVIEW-CONTROLS.html only. Not part of the application.

  Two jobs: enhance the "after" pick list, and show what the page would read back from the
  hidden select. The read-back is deliberately written the way the real page scripts write it -
  [...select.selectedOptions].map(o => o.value) - because the claim being demonstrated is that
  those reads keep working untouched, and a demonstration that used a different read would
  prove nothing.
*/

(function () {
  "use strict";

  function readBack() {
    var select = document.getElementById("after-roles");
    var box = document.getElementById("readback");
    if (!select || !box) return;

    var values = Array.prototype.slice.call(select.selectedOptions).map(function (option) {
      return option.value;
    });

    box.value = values.length
      ? JSON.stringify(values, null, 0) + "\n\n" + values.length + " selected"
      : "[]\n\nnothing selected";
  }

  function start() {
    if (!window.PPMPicklist) {
      var box = document.getElementById("readback");
      if (box) box.value = "ppm-picklist.js did not load, so nothing was enhanced.";
      return;
    }

    /* Only the "after" side. The "before" side is left native on purpose - it is the
       comparison. enhanceAll() would take both. */
    window.PPMPicklist.enhance("after-roles");

    var select = document.getElementById("after-roles");
    if (select) select.addEventListener("change", readBack);
    readBack();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
