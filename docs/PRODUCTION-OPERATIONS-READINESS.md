# SecureID production operations readiness

Last reviewed: 2026-11-10

This runbook records operational controls that must be evidenced before SecureID is described as production-resilient. It is not a claim that blocked items are complete.

## Verified implementation facts

- The API uses a persistent Railway volume for the SQLite database and document storage.
- Encrypted backups use AES-256-GCM and include the SQLite snapshot plus UUID-named encrypted document blobs.
- Restore validates the authenticated payload, checks SQLite integrity, stages restored files, and keeps a pre-restore database recovery copy.
- The backup manager runs its scheduler inside the API process. It schedules a startup backup and an in-process interval; the restore drill is also scheduled in-process when enabled.
- The API process is configured as a single Railway replica. Do not scale it horizontally while using local SQLite and process-local scheduling/rate limits.
- The privacy notice in `docs/PRIVACY-POLICY-RELEASE-DRAFT.md` is explicitly a draft and must not be published as final legal copy.

## Blocking operational gaps

### 1. Backup scheduling independent of API uptime

The existing backup scheduler still uses `setTimeout` and `setInterval` in the web/API process. Those timers do not run while the process is stopped or sleeping. This change adds an optional GitHub Actions schedule that calls a token-protected endpoint to run the existing encrypted backup independently of the API timer. It is not active until the same random `BACKUP_TRIGGER_TOKEN` is configured in Railway and the GitHub Actions secret `SECUREID_BACKUP_TRIGGER_TOKEN` is configured, the new application version is deployed, and a manual workflow run succeeds. The workflow retries requests while Railway wakes from sleep.

The workflow implementation downloads the newest AES-256-GCM encrypted backup through a separate token-protected HTTPS endpoint, verifies the exact file-byte SHA-256, and uploads it to a GitHub Actions artifact with 30-day retention. It fails closed unless the destination repository is private. **The current `dubeyjii91/secureid-website` repository is public, so off-site transfer remains blocked until a private destination repository is configured.** The transfer is capped at 400 MiB; the encryption key remains only in Railway. After activation, this is still temporary recovery storage: artifact quota is shared, artifacts expire, and workflow-run deletion can remove them. A successful workflow run and isolated restore from the artifact are required before recording this control as passed.

Before relying on a defined recovery-point objective:
- Configure an external scheduler or a dedicated Railway cron/worker service that invokes the backup command against the same protected persistent data, or use a managed database backup facility.
- Ensure only one backup job can run at a time (lock/lease), use a bounded timeout, and alert on missed runs.
- Verify the chosen Railway plan and any scheduler/storage service cost before enabling it.
- Record the expected schedule, maximum backup age, and alert recipient.

### 2. Off-platform encrypted copy

Backups currently default to a directory on the Railway persistent volume. This protects against some application-level failures but not loss or corruption of the volume/account/region.

Before claiming disaster recovery:
- Select an approved off-site object-storage provider and region.
- Upload only authenticated encrypted backup artifacts over TLS; never upload plaintext SQLite snapshots.
- Use a dedicated least-privilege write credential, bucket versioning/retention where available, and a separate read credential for restore.
- Keep the backup encryption key separately, with restricted access and a documented recovery owner. Never store the key beside the backup artifact.
- Verify upload, object checksum, retention, retrieval, and isolated restore from the off-site copy.
- Document provider, region, retention, expected cost, RPO, and RTO.

### 3. Restore-drill evidence

A successful CI test against a synthetic fixture is not a successful production backup restore drill. Before recording the production control as passed:
- Select the newest encrypted backup without exposing its contents.
- Restore only into a disposable isolated environment using the matching key.
- Check SQLite `PRAGMA integrity_check`, expected table presence, and a synthetic or approved non-sensitive sample record.
- Verify document count and decrypt/read one approved test document.
- Record backup timestamp, artifact hash, restore timestamp, result, and operator. Never log document contents, personal identifiers, OTPs, or encryption keys.
- Never run a restore against the live production database as a test.

### 4. Alerting

- Verify `SECURITY_ALERT_EMAIL`, `OTP_FROM_EMAIL`, and exactly one intended email provider are configured.
- Send a controlled test alert and confirm receipt at the intended mailbox.
- Alert on failed backup, stale backup age, failed off-site upload, and failed restore drill.
- Avoid including secrets, personal data, document contents, or raw tokens in alerts.

## Privacy/legal publication blockers

The privacy notice remains a draft. The service operator must supply and verify:
- Legal operator/controller name and jurisdiction.
- Monitored privacy/support contact details.
- Effective date and canonical service origin.
- Actual production data categories, purposes, retention periods, deletion behavior, and backup expiry.
- Active vendors, legal entities, processing regions, subprocessors, contracts/DPAs, and international-transfer safeguards.
- User rights/request process, complaint contact, incident/breach process, and any age-related rules that apply.
- Final legal review for the operator's jurisdiction.

Do not invent these values or publish the draft with placeholders. A technical code change cannot replace legal review or the operator's factual confirmation.

## Scale and security gates

- Keep one API replica while SQLite and process-local rate limits are in use.
- Before multiple replicas, migrate to managed PostgreSQL and shared/distributed rate limiting, then test migration and rollback.
- Keep MFA/session replay, account isolation, document authorization, share revocation, CSRF, rate limits, and upload validation in the release security suite.
- Test logout by replaying the actual old session cookie/token against a protected API route. A revoked share-link denial is a different test and must not be counted as logout/session invalidation.
- Use synthetic accounts/documents for acceptance testing. Do not use real Aadhaar/PAN identifiers in fixtures.

## Release evidence record

For every production change, record:
- Git commit SHA and Railway deployment ID.
- CI run URL and individual job conclusions.
- Health/readiness result and time.
- Backup artifact timestamp/hash (never key or contents).
- Isolated restore-drill evidence.
- Known blockers, owner, due date, and explicit go/no-go decision.

Google Play submission, signing, store listing, and publication are outside this runbook and remain out of scope until explicitly requested by the project owner.

### Production restore-drill evidence — 2026-11-11

After deployment `47ed7540-d7a4-492a-8478-1b8d2ec0ffb7` (commit `ed3d9077162eabb98416b2ce21a18a60082cf301`), the application completed an isolated restore drill at `2026-11-11T11:07:07.873Z` using the encrypted backup created at `2026-11-11T11:06:57.653Z`.

- Result: successful; isolated restore only, not the live production database.
- SQLite integrity: `ok`.
- Restored tables: 67.
- Restored document blobs: 6.
- Backup artifact SHA-256: not emitted in the production drill log, so it is not recorded here.
- Evidence source: Railway deployment logs for the deployment above.

This verifies a restore from the current Railway-volume backup after the snapshot-permission and temporary-file-cleanup fixes. It does **not** verify an off-platform copy, independent scheduler, or restore from a different provider/region. Those remain blocked until a zero-budget-compatible option or explicit hosting/storage budget is approved.
