/*
  RETIRED - replaced by STAGE-14-HARNESS.mjs.

  This harness tested the migration machinery that Stage 14 removed: per-collection
  source switching, shadow mode, the staged cutover functions, the batch seeders and
  the legacy audit importer. Roughly half of its assertions were true statements
  about code that no longer exists, and it fails to load for that reason.

  It is emptied rather than left in place because a test file that cannot run is
  worse than no test file: it looks like coverage.

  Run the current harness instead:

      node STAGE-14-HARNESS.mjs

  The assertions worth keeping were carried across - append-only status history,
  the two write-through seams, the mapping round trip, the pending-write ledger,
  and the backup and restore refusals - alongside new ones that assert the
  retirement actually happened rather than assuming it.
*/
console.error(
  "STAGE-11E-12-HARNESS.mjs is retired. Run: node STAGE-14-HARNESS.mjs"
);
process.exitCode = 1;
