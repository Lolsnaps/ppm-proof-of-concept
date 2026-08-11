# Portfolio Manager

A portfolio and project management tool for organisations that need governance-grade PPM —
stage gates, RAID, benefits, resource capacity and a real audit trail — without an enterprise
licence.

It is static HTML and plain JavaScript talking to a PostgreSQL database. No framework, no build
step, no bundler, no package manager at runtime. Clone it, point it at a database, serve the
folder.

## What it does

- **Projects, programmes, portfolios** with a configurable lifecycle and stage gates
- **Project plans** with baselines, rebaseline approval, critical path and slippage
- **RAID** with scoring and escalation
- **Registers** for actions, decisions, documents and status reports
- **Benefits** at project and programme level
- **Financials** with budgets, forecasts, actuals, cost lines and an approval workflow
- **Resource management** with demand, capacity, absence, utilisation and a day-to-year timeline
- **Reporting** with saved views, dashboards and PDF export
- **Audit history** recording who changed what, field by field, written by the database
- **Nine access roles and four access scopes**, enforced per row in PostgreSQL

## The bit that matters architecturally

Authorisation is enforced by the database, not by the application. 150 row-level security
policies decide what each identity can see and change, and nothing is returned at all until
multi-factor authentication is complete. A defect in the browser code cannot expose a record,
because the database will not return it.

The application reads and writes through a single interface (`PPMStore`), and only two files
know a database exists. That is what keeps the other 34,000 lines portable if you ever want to
put a different backend behind it.

## What you need

- A PostgreSQL database. The migrations assume [Supabase](https://supabase.com) because that is
  what it was built against — its auth, row-level security and PostgREST are all used. Plain
  PostgreSQL will need an API layer and an auth provider in front of it.
- Somewhere to serve static files. GitHub Pages is enough.
- Node, only for the build and verification scripts. The application itself does not need it.

## Standing it up

```bash
# 1. Create a Supabase project and run the migrations in order
#    STAGE-*.sql, oldest first. Read the header of each; several are annotated
#    with what they change and why.

# 2. Point the application at your project
#    Edit the Supabase URL and publishable key in the <script> block of each page.

# 3. Optionally load the demo portfolio
node STAGE-14A-DEMO-BUILD.mjs        # generates the SQL
node STAGE-14A-DEMO-VERIFY.mjs       # 81,000+ checks on it

# 4. Verify before you deploy
node VERIFY-ALL.mjs                  # five gates, all must pass

# 5. Build the set a browser actually needs
node BUILD-DEPLOY-SET.mjs
```

The first account is created through Supabase Auth and linked to a person record. See
`README-ACCESS.txt` for the administration and governance quick start.

## Documentation

Two specifications, both generated from the source so they cannot drift:

- **`USER-SPECIFICATION.html`** — what each page does, what each record holds, how the workflows
  move, and what each role can and cannot do.
- **`DEVELOPER-SPECIFICATION.html`** — architecture, data model, security model, triggers,
  transactional workflows, a change map, two worked examples, and a catalogue of the traps this
  codebase has already fallen into.

Both are single files, so they survive being emailed and archived.

## Verification

There is more test and gate machinery here than is usual for a project this size, because the
security model is in the database and a mistake there is silent.

```bash
node VERIFY-ALL.mjs
```

Five gates: a behavioural harness (513 assertions), static verification (3,300+ checks), schema
drift, SQL lint and demo data. A build that cannot pass them should not ship.

Every gate and harness section was proved by reintroducing, on purpose, the fault it exists to
catch. The developer specification records which bug each one came from.

## Status and support

This was built and run as a working pilot, then opened up. It is not a product and there is no
support. It is offered in case it is useful to somebody with the same problem, and because a
governance-grade PPM tool that a small team can actually run should exist.

Issues and pull requests are welcome but may not be answered quickly.

## Licence

MIT. See [LICENSE](LICENSE).
