# SecureID PostgreSQL Migration — Readiness and Safe Cutover

## Current production state

- The live application still uses Node's synchronous `node:sqlite` `DatabaseSync` driver and `DATABASE_PATH` on the mounted `/data` volume.
- SQL is issued directly from multiple server modules (authentication, admissions, institutions, documents, shares, scholarships, hostel, audit and billing). It is not yet behind a database repository interface.
- The existing schema and several feature schemas are created through additive SQLite DDL at startup and in feature-registration functions. Some queries use SQLite-specific `PRAGMA`, `INSERT OR IGNORE`, `INSERT OR REPLACE`, and `COLLATE NOCASE`.
- The production PostgreSQL service is not active yet. A PostgreSQL template was inspected, but no production database was provisioned or connected.
- The `secureid-documents-prod` object-storage bucket exists as an S3-compatible Railway bucket. The application currently persists encrypted document blobs to the `/data` volume; it does not yet use an S3 client to store or retrieve them from that bucket.

## Why this is not a one-variable switch

The existing code imports `DatabaseSync` and performs synchronous `.get()`, `.all()`, `.run()` and `.exec()` calls throughout the backend. The supported Node PostgreSQL client is asynchronous. Simply adding `DATABASE_URL` or setting it on Railway would not move queries or make these modules PostgreSQL-compatible.

A safe migration therefore has to be incremental:
1. Inventory every table, column, foreign key, index, trigger and view from the live SQLite database.
2. Convert all schema definitions to explicit, versioned PostgreSQL migrations.
3. Introduce an asynchronous repository/query layer and port server modules in groups, preserving transaction boundaries, row-count semantics, case-insensitive email uniqueness, IDs and timestamps.
4. Add PostgreSQL integration tests for authentication, MFA, rate limits, account deletion, shares, SmartFill, admissions, institution memberships, hostel, scholarships, fees, audit and backup.
5. Create a production PostgreSQL database with durable storage and private networking. Keep SQLite live while validating a separately migrated copy.
6. Take and verify an encrypted backup, copy data into PostgreSQL, reconcile row counts and foreign keys, run application smoke tests against the copy, then schedule a controlled cutover.
7. Keep the SQLite backup and documented rollback path until the PostgreSQL deployment has been proven stable.

## Read-only preflight

Run this on a machine/container that has access to the production SQLite file:

```bash
npm run db:preflight
```

Or specify an explicit path and machine-readable output:

```bash
npm run db:preflight -- --database /data/secureid.sqlite --format json
```

The report contains schema metadata, per-table row counts, indexes, foreign-key relationships, SQLite-only schema features, dependency order, database integrity and foreign-key-check results. It never exports row values, emails, document names, hashes, tokens or other personal data. It opens the source file read-only and does not change the active database.

## Infrastructure constraints

The current Railway Free project already uses its single 500 MB persistent volume for `secureid-data`. The Free plan's included volume allowance is one 0.5 GB volume, so an additional persistent PostgreSQL service cannot be safely made live without changing the plan/resource arrangement. Do not detach or reuse the existing volume: it contains the active SQLite database and document-storage directory.

The next infrastructure step is to provision PostgreSQL with its own persistent volume, after the resource plan is agreed. Only then should a migration copy be created. Until then the live app must continue using its current SQLite file.

## Non-negotiable safety rules

- Never point the production app at an empty PostgreSQL database.
- Never overwrite or delete the existing SQLite file or `secureid-data` volume during migration.
- Never migrate unencrypted document contents or expose a public PostgreSQL endpoint.
- Never write production PII into GitHub Actions logs or migration reports.
- Do not switch `DATABASE_PATH` or introduce a production `DATABASE_URL` cutover until schema/data reconciliation and application tests pass.
- Do not remove SQLite rollback artifacts until the new production database has passed operational verification.
