# SecureID founder pilot-readiness checklist

Last evidence review: 2026-11-21 (updated after the 2026-11-21 Parent Portal release and isolated off-site restore)

This checklist separates verified engineering evidence from operator decisions and external proof. A checked item means the specific evidence exists; it does not imply that the whole product is certified or ready for a public launch.

## 1. Production reliability

Status: **Partially verified — latest release deployed; cold-start and external monitoring checks remain**

- [x] Production homepage and health/readiness endpoints returned HTTP 200 in the 2026-11-19 production smoke.
- [x] Unauthenticated smoke requests to protected API endpoints were rejected.
- [x] Duplicate hostel-room conflict fix and regression assertion from PR #208 were merged on 2026-11-20 (merge commit `4ba22e09cb9fbe21747f9fc27da4c69608e904d0`).
- [x] Parent Portal active-membership authorization fix from PR #221 was merged as `ec4c93e7578c0958f3f00b21a4e8d60f53c62191` and Railway production deployment `1aba807d-bf79-4d94-bef6-999c6e8e73c0` reached SUCCESS on 2026-11-21; Railway reported 1/1 replica running and zero recent failures at verification time.
- [ ] Re-test duplicate room creation against the deployed version using an authorized synthetic institution account; CI coverage is not a substitute for production acceptance.
- [ ] Investigate Railway wake-up retries/connection-refused events and measure cold-start behavior.
- [ ] Establish external uptime and error alerts with a verified recipient.

## 2. Backup and document recovery

Status: **Off-site artifact integrity, AES-GCM decryption and isolated database restore verified; document recovery remains unproven**

- [x] Private backup-vault repository is configured.
- [x] Seven scheduled exports (13–19 November) completed successfully.
- [x] Latest encrypted artifact and SHA-256 evidence are recorded in the production operations runbook.
- [x] Independently downloaded the latest private-vault artifact on 20 November; ZIP integrity passed and the extracted encrypted-file SHA-256 matched its manifest.
- [ ] Complete actual AES-GCM decryption and isolated restore from that artifact; verify a synthetic document can be read.
- [ ] Resolve the configured-vs-observed schedule timing discrepancy.
- [ ] Restore the actual GitHub artifact in a disposable isolated environment using the approved key-recovery process.
- [ ] Test decryption and reading of a synthetic document after restore.
- [ ] Investigate why the 2026-11-19 production restore drill contained zero document records and zero document blobs; do not infer that user data was lost or recovered without evidence.
- [ ] Record recovery-point and recovery-time objectives, key custodian, retention and expiry process.

Never run a restore drill over the live production database and never place the backup encryption key in GitHub or this repository.

## 3. Security and operational reliability

Status: **Automated evidence good; operational and independent checks remain**

- [x] SecureID CI on PR #208 passed 178 security/unit tests, build/lint, dependency audit, Trivy, CodeQL and isolated backup/document round-trip smoke.
- [x] Documentation PR #209 CI also passed on 19 November: build, lint, dependency audit, Trivy, 178 tests, mobile TypeScript, CodeQL, owner-console browser smoke, and visual appearance smoke.
- [x] Owner-console browser smoke passed on the 2026-11-21 Parent Portal release commit `ec4c93e`; build/lint, dependency audit, Trivy, unit tests, mobile TypeScript, native authentication bootstrap smoke and isolated backup/restore smoke also passed. CodeQL was still running at the time this checklist update was prepared.
- [ ] Reduce the current 88 non-blocking lint warnings (0 lint errors) and review deprecated transitive npm dependencies; avoid broad refactors without targeted tests.
- [ ] Perform authenticated manual acceptance tests with synthetic accounts for registration, email verification, MFA, logout/session revocation, document ownership, share expiry/revocation and account deletion.
- [ ] Verify alert delivery end-to-end and missed-backup alerting.
- [ ] Review privacy-minimized production logs and monitor 5xx/cold-start rates.
- [ ] Commission an independent security/penetration test before broad public onboarding.
- [ ] Keep one API replica while SQLite and process-local rate limits remain in use.

## 4. Privacy and legal readiness

Status: **Blocked on operator facts and qualified review**

- [x] A privacy notice engineering draft exists and is explicitly marked not for publication.
- [x] Draft describes the private encrypted artifact workflow and accurately distinguishes successful isolated database restore from the still-unproven recovery of an active document blob.
- [ ] Supply the legal operator/controller name and jurisdiction.
- [ ] Supply a monitored privacy/support contact and the canonical public domain.
- [ ] Confirm data categories, purposes, lawful basis/consent flow, retention, deletion, backup expiry and provider contracts/processing locations.
- [ ] Decide target audience/minimum age and any applicable parental-consent process.
- [ ] Define data access/correction/export/deletion request handling and incident/breach response.
- [ ] Obtain qualified legal review and operator sign-off before publishing the notice or onboarding real users.

Do not fill legal placeholders with guessed names, addresses, dates, retention periods or compliance claims.

## 5. Institution verification

Status: **Manual evidence required**

- [ ] Verify each institution against authoritative records.
- [ ] Verify the representative's authority to act for that institution.
- [ ] Obtain and retain a signed pilot/partnership agreement.
- [ ] Confirm institution administrator identity and least-privilege access.
- [ ] Test institution onboarding and student-review workflows using synthetic data.
- [ ] Do not label a college as a partner or verified until evidence and approval are recorded.
- [ ] Do not label a student or document as government-verified without an authorised provider and real verification evidence.

## 6. Native mobile integration

Status: **Backend integration exists in code; full device acceptance remains unverified**

- [x] Mobile API client targets the current SecureID Railway API.
- [x] Mobile TypeScript check passed in PR #209 CI.
- [x] Native sign-in obtains a native session token and stores it in Android secure storage.
- [x] Mobile client includes session, MFA, identity profile, document upload/download/delete, sharing and security/session API calls.
- [x] Mobile screens use the API client for the Vault and Secure Sharing flows.
- [ ] Run a full physical-device acceptance test with a synthetic account: sign in, receive/verify MFA, upload, list, download, share, revoke, logout and re-login.
- [ ] Verify plaintext temporary-file cleanup and behavior after interrupted downloads.
- [ ] Complete a fresh internal Android build and test the exact build against production without using real identity documents. EAS preview APK, OTA, and production AAB steps were skipped in the documentation PR CI; no new mobile artifact was created.
- [ ] Do not publish an APK/AAB or claim store readiness until the owner explicitly approves release preparation.

## 7. Scale preparation and controlled college pilot

Status: **Scale plan and pilot preparation; no expansion approval**

### Scale preparation

- [ ] Keep one API replica while production uses SQLite and process-local rate limits.
- [ ] Prepare a managed PostgreSQL migration plan with data validation, rollback, backup and downtime procedures before considering multiple replicas.
- [ ] Plan shared/distributed rate limiting and independently managed background jobs.
- [ ] Evaluate durable encrypted object storage and retention controls only after the provider, region and cost are approved.
- [ ] Define capacity/load-test targets and monitor database size, document volume, CPU, memory, HTTP 5xx, wake-up latency and backup age.
- [ ] Produce a realistic zero-budget pilot capacity estimate and a paid-growth cost estimate; do not activate paid services without explicit approval.

### Controlled college pilot

- [ ] Choose one pilot institution and obtain written permission.
- [ ] Define the pilot scope, duration, support contact, participating roles and success criteria.
- [ ] Prepare a demo using synthetic students and synthetic documents.
- [ ] Prepare onboarding instructions, support/escalation process and incident contact.
- [ ] Agree on data ownership, retention, deletion and exit/offboarding with the institution.
- [ ] Run a limited acceptance pilot before broad public promotion.
- [ ] Review feedback, reliability, support burden and costs before expanding.

## Current release decision

**No broad public launch recommendation yet.** The immediate technical blockers are recovery of a synthetic document from an artifact containing an active document blob, Railway wake-up reliability, and remaining authenticated acceptance tests. Privacy/legal sign-off and verified institution permission are separate operator gates.

Production merges, deployments, secrets, Railway variables, production data, paid services and public app-store releases require the project owner's explicit approval.
