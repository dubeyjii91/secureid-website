# SecureID production operations readiness

Last reviewed: 2026-11-19

This runbook records operational controls that must be evidenced before SecureID is described as production-resilient. It is not a claim that blocked items are complete.

## Verified implementation facts

- The API uses a persistent Railway volume for the SQLite database and document storage.
- Encrypted backups use AES-256-GCM and include the SQLite snapshot plus UUID-named encrypted document blobs.
- Restore validates the authenticated payload, checks SQLite integrity, stages restored files, and keeps a pre-restore database recovery copy.
- The API retains an in-process startup/interval backup mechanism, but its timers do not run while the service is stopped or sleeping. The private `secureid-backup-vault` GitHub Actions workflow is now the separate daily trigger for off-site encrypted artifact creation and upload.
- The API process is configured as a single Railway replica. Do not scale it horizontally while using local SQLite and process-local scheduling/rate limits.
- The privacy notice in `docs/PRIVACY-POLICY-RELEASE-DRAFT.md` is explicitly a draft and must not be published as final legal copy.

## Remaining operational gaps

### 1. Backup scheduling independent of API uptime

The private `dubeyjii91/secureid-backup-vault` workflow is active and has completed seven scheduled encrypted exports from 13–19 November 2026. It triggers the protected Railway backup endpoint, downloads the encrypted artifact, verifies its SHA-256, and uploads it to a private GitHub Actions artifact with 30-day retention. The workflow is configured for 09:25 Asia/Kolkata (03:55 UTC), but observed run creation times were approximately 11:05–12:39 UTC. Investigate the delay; do not promise a precise completion time. The in-process API timers remain supplementary and do not run while the service is sleeping or stopped.

The private artifact workflow is a temporary off-site copy, not permanent archival storage. It is subject to GitHub Actions retention, quota, and workflow-run deletion. The backup encryption key remains in Railway and must never be copied to GitHub or the artifact. The transfer is capped at 400 MiB. A successful upload does not prove recoverability; a successful isolated restore from the actual artifact is still required.

Before relying on a defined recovery-point objective:
- Ensure only one backup job can run at a time, use bounded timeouts, and alert on missed/failed runs.
- Verify artifact retention, quota, workflow-run deletion behavior, and actual retrieval.
- Record the expected maximum backup age, alert recipient, and recovery owner.

### 2. Off-platform encrypted copy

An encrypted off-platform copy now exists as a private GitHub Actions artifact. It has 30-day retention and is not a durable object-storage archive. No object-storage bucket is provisioned. Before claiming disaster recovery:
- Restore the actual downloaded artifact in a disposable isolated environment using the approved key-recovery process.
- Verify SQLite integrity and decrypt/read a synthetic document.
- Keep the backup encryption key separately, with restricted access and a documented recovery owner. Never store the key beside the backup artifact.
- Document provider, region, retention, expected cost, RPO, and RTO.
- Consider durable object storage only after an explicit budget and provider approval.

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

### Production runtime observation — 2026-11-20

- Railway runtime logs show repeated container starts during 17–20 November while the service is configured to sleep when idle. The sampled log window contains 107 deploy entries; it does not include a reliable application-ready event for measuring exact cold-start duration.
- At `2026-11-20T12:21:16Z`, the backup trigger request returned HTTP 200 after proxy-level upstream connection-refused retries during container wake-up. The subsequent encrypted-backup download returned HTTP 200 at `12:21:19Z`.
- The sampled 211 HTTP log entries contain one HTTP 500: `POST /api/institutions/hostel-rooms` at `2026-11-18T12:49:28Z`. This matches the duplicate-room SQLite conflict reported in the production runbook and targeted by draft PR #208. The sampled window contains no later HTTP 500, but PR #208 remains undeployed, so the bug must not be marked fixed in production.
- These observations confirm transient wake-up connection retries and the historical duplicate-room failure. They do not establish an uptime percentage, exact cold-start SLO, or successful post-fix production behavior. Continue monitoring and verify after an approved deployment.
- Railway's seven-day HTTP metrics sample reports 1,194 requests: 962 2xx, 230 4xx, and 2 5xx (0.1675% 5xx). The 24-hour sample reports 35 requests and zero 5xx. The retrievable seven-day HTTP log sample exposes only one 500 event, so one metric-counted 5xx is not individually identified in the returned logs. Traffic volume is small and the service sleeps when idle; these figures are not an uptime/SLA claim.

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


### Off-site backup export implementation — 2026-11-12

- PR: https://github.com/dubeyjii91/secureid-website/pull/147
- Merge commit: `ba02250a55d4936bb0396c3f18f40472c8bf0a63`
- Railway deployment: `0d8deaef-88de-4555-bbdc-10983a47535b` — SUCCESS
- Production service: online, one running replica, no active warnings or critical issues.
- New authenticated export route: `GET /api/internal/backup/download`; it returns only the encrypted artifact, is bearer-token protected, no-store, rate-limited, SHA-256 verified, and capped at 400 MiB.
- The scheduled workflow verifies repository visibility before downloading/exporting; it still creates the on-volume backup first so the existing external scheduler remains useful while the destination is not private.
- Startup backup after deployment: `secureid-2026-11-12T15-18-25-719Z.backup.json`.
- Isolated restore drill after deployment: success; SQLite integrity `ok`; 67 tables; 2 document blobs; isolated restore only.
- CI: build/lint and security unit tests passed; CodeQL passed; visual smoke and owner-console browser checks passed.
- **Off-site artifact upload is now active:** the private destination `dubeyjii91/secureid-backup-vault` is verified private, and its scheduled workflow successfully created, downloaded, SHA-256-verified, and uploaded the encrypted backup as a private GitHub Actions artifact on 2026-11-19. The latest run and evidence are recorded below. Artifacts expire after 30 days and are not permanent archival storage.
- No paid hosting or storage resources were provisioned. The GitHub Actions artifact retention and shared-quota limitations remain applicable once the private destination is configured.


### Production verification record — 2026-11-19

- Production source commit: `0890eb75fb7d5731bd4f043378ef921341fc11b9`; Railway deployment `65a1731b-a4a9-4408-a486-0443e7df181c` is currently `SLEEPING`, with the 500 MiB persistent volume still attached at `/data`.
- Private off-site vault: `dubeyjii91/secureid-backup-vault` (repository visibility verified `private`).
- Latest scheduled export: [workflow run 12](https://github.com/dubeyjii91/secureid-backup-vault/actions/runs/44522980025), completed successfully at `2026-11-19T12:20:44Z`.
- Fresh encrypted backup: `secureid-2026-11-19T12-20-39-248Z.backup.json`; raw encrypted-file size 3,080,487 bytes; SHA-256 `89325117f76faa27353ffae77ffbf448cc72df8a1383d176628a634e13485452`.
- Private Actions artifact: `secureid-encrypted-backup-44522980025`, artifact ID `14528981106`, ZIP size 3,081,097 bytes, ZIP SHA-256 `3bbc62a065449f01c2822fc101da03f32b3ff90c40007f3b7ba686cfadb31a85`, expires `2026-12-19T12:20:40Z`.
- The private vault workflow's last seven scheduled runs (13–19 November) all completed successfully. The workflow is configured for `03:55 UTC / 09:25 Asia/Kolkata`, but the observed run creation times were approximately 11:05–12:39 UTC. Investigate schedule delay; do not claim the actual run occurs at 09:25 until timing is confirmed.
- Production's isolated on-volume restore drill at `2026-11-19T12:21:09Z` passed SQLite integrity (`ok`) and restored 109 tables. It reported zero active document records and zero document blobs in both source and restored backup; `documentStorageReconciled=true`, but `documentRestoreVerified=false`. This does not prove recovery of a real user document and does not verify a restore from the off-site artifact.
- The SecureID CI run for the duplicate-hostel-room fix (PR #208) passed build, lint, dependency audit, Trivy, 178 security/unit tests, mobile TypeScript checks, isolated encrypted backup/document round-trip smoke, CodeQL, owner-console browser smoke, and visual appearance smoke. Production native smoke and all APK/AAB/OTA release steps were skipped; no production release artifact was created.
- A production duplicate hostel room request on 2026-11-18 returned HTTP 500 because SQLite surfaced the unique-room constraint as `ERR_SQLITE_ERROR`. The corrected HTTP 409 handling and regression assertion are in draft PR #208; they are not merged or deployed.
- Production HTTP metrics showed zero requests in the one-hour sample ending at this review, so zero 5xx in that window is not evidence of successful user traffic. External browser access could not be independently verified in this environment.
