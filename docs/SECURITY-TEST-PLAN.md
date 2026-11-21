# SecureID Production Security Test Plan

Last updated: 2026-11-21

This is a repeatable release checklist, not a claim that every item has passed. Record evidence for each test and rerun after authentication, storage, sharing, or deployment changes. Use synthetic data and a separate test account. Never use real PAN/Aadhaar values in test fixtures.

## Latest recorded production verification — 2026-11-11

The following automated checks completed successfully against production commit `6db2842dd59c11d44ec6884f19fc0c38c13635b0`:

- SecureID CI: https://github.com/dubeyjii91/secureid-website/actions/runs/43019902358
- Owner-console browser smoke: https://github.com/dubeyjii91/secureid-website/actions/runs/43019902419
- Production smoke test: https://github.com/dubeyjii91/secureid-website/actions/runs/43020098596
- Production passive OWASP ZAP scan: https://github.com/dubeyjii91/secureid-website/actions/runs/43020127567

The CI run reports successful dependency installation/audit, Trivy filesystem scan, CodeQL analysis, frontend build, lint, security unit tests, native Android TypeScript checks, deployed native-auth bootstrap smoke test, and isolated encrypted backup/restore test. The EAS preview APK, OTA update, signed production AAB, and artifact-upload steps were **skipped**, not passed. These results do not complete the manual checks below, prove a full penetration test, or establish legal/operational launch readiness. Do not infer a manual pass from a successful deployment.



## Latest production smoke evidence — 2026-11-19

A production smoke sequence against `https://secureid-production-b732.up.railway.app` completed at approximately `2026-11-19T11:46Z`:

- Homepage: HTTP 200 after Railway initially returned connection-refused upstream attempts; total observed request time was about 1.4 seconds. This is a cold-start/retry reliability issue, not a clean first-attempt pass.
- `/api/health` and `/api/health/ready`: HTTP 200.
- Unknown API route: HTTP 404.
- Unauthenticated session, privacy, and government-verification readiness requests: HTTP 401 as expected.
- Malformed share token: HTTP 404 as expected.
- Login without a valid CSRF token: HTTP 403 as expected; a valid CSRF token with deliberately invalid credentials returned HTTP 401 as expected.
- Unauthenticated account deletion request: HTTP 401 as expected.

These checks verify selected public health and negative authorization paths only. They do not replace authenticated end-to-end student acceptance tests, physical-device mobile testing, a penetration test, or a restore from the actual off-site backup artifact. Railway wake-up retries remain a reliability issue to investigate.

PR #208's duplicate-hostel-room fix was merged on 2026-11-20 (merge commit `4ba22e09cb9fbe21747f9fc27da4c69608e904d0`) and is included in the current Railway production deployment at commit `2c4d948ae8f159ff65bae055145dbd32c1acc3f4`. The PR reports passing build/lint/security CI, owner-console browser smoke, and visual appearance smoke. Production duplicate-room acceptance using an authorized synthetic institution account remains unchecked.

## Current deployment snapshot — 2026-11-21

Railway reports the production service on branch `main`, commit `2c4d948ae8f159ff65bae055145dbd32c1acc3f4`, with one replica and a live 500 MB persistent volume. The latest deployment is in `SLEEPING` (autosleep) state, with no active warnings/criticals or failed deployments reported in the preceding seven days. This is a platform status snapshot, not a fresh HTTP health check; the public endpoint could not be independently fetched during this review. Investigate cold-start behavior and establish external uptime/error monitoring before broad onboarding. The service uses SQLite and one replica; do not scale horizontally without the documented database and shared-rate-limit migration.

## 1. Automated checks
Run on the exact release commit in CI:
- [x] Dependency installation completed in CI (`npm ci`).
- [x] `npm audit --audit-level=low` completed in CI.
- [x] Trivy filesystem scan completed in CI.
- [x] CodeQL JavaScript/TypeScript analysis completed in CI.
- [x] `npm run build` completed in CI.
- [x] `npm run lint` completed in CI.
- [x] Security unit tests (`npm test`) completed in CI.
- [x] CI results are attached to the exact release commit (links above).
- [ ] Confirm a committed lockfile and reproducible installs for every separately built app/package; native EAS artifact steps were skipped in this run.

## 2. Authentication, sessions and MFA
- [ ] New account registration with a valid email; duplicate email/phone behavior is safe and non-enumerating.
- [ ] Email verification succeeds; expired, invalid, replayed, and rate-limited OTPs fail.
- [ ] OTP is never returned in API responses or logs; resend cooldown and attempt limits work.
- [ ] Login works for correct credentials and fails for wrong credentials without account enumeration.
- [ ] MFA is required for sensitive actions and cannot be bypassed by calling API routes directly.
- [ ] Logout invalidates the server-side session; replaying the old cookie fails.
- [ ] Password reset/recovery tokens expire, are single-use, and do not reveal account existence.
- [ ] Session cookies use Secure, HttpOnly, and appropriate SameSite settings in production.
- [ ] CSRF and same-origin checks reject missing/invalid tokens and untrusted origins.
- [ ] Authentication, OTP, recovery, and sensitive routes have tested rate limits.

## 3. Document Vault and identity profile
- [ ] Upload valid synthetic PDF/JPEG/PNG/WebP under the configured size limit.
- [ ] Reject oversized files, MIME/type mismatches, malformed files, and unsupported formats.
- [ ] Verify uploaded bytes are encrypted at rest; tampering with ciphertext fails authentication/decryption.
- [ ] User A cannot list, download, alter, or delete User B's documents by changing IDs.
- [ ] Download preserves expected bytes and safe content disposition; filenames cannot inject headers or paths.
- [ ] Delete removes access immediately and follows the documented retention/backup policy.
- [ ] Empty/invalid identity fields do not leak into API responses or sharing.
- [ ] Document category labels do not imply that a government authority verified the document.

## 4. Secure Share
- [ ] Share creation requires authentication, MFA, an unlocked wallet, and at least one non-empty selected claim.
- [ ] Recipient sees only explicitly selected claims; unselected values and internal IDs stay private.
- [ ] Tokens are unpredictable, stored hashed, expire at the configured TTL, and cannot be reused after expiry/revocation.
- [ ] Empty claims display a safe empty state rather than blank claim cards.
- [ ] Share pages send no-store/no-referrer protections and do not expose tokens to analytics/logging.
- [ ] Revoke invalidates existing links; guessed, malformed, expired, and revoked tokens fail safely.
- [ ] Cross-account authorization is tested against every share-management endpoint.

## 5. Backups, restore and data durability
- [ ] Backup artifact is encrypted, access-controlled, and stored outside the application source tree.
- [ ] Backup logs never contain identity values, OTPs, session tokens, keys, or document contents.
- [ ] A backup is created on schedule and alert delivery is tested end-to-end.
- [ ] If the external GitHub Actions trigger is enabled, verify missing/incorrect bearer tokens are rejected, a valid token returns only a SHA-256 digest and completion time, and the scheduled/manual workflow completes successfully.
- [x] Confirm that the private GitHub Actions workflow stores a temporary encrypted off-platform artifact with 30-day retention.
- [ ] Restore the actual off-platform artifact in an isolated disposable environment; artifact upload alone is not proof of disaster recovery.
- [ ] Restore is tested on an isolated disposable instance, never over the live production database.
- [ ] Restored records and encrypted documents can be read with the correct key; corruption/wrong-key cases fail safely.
- [ ] Verify artifact expiry/quota and document retention, deletion, recovery-point objective, recovery-time objective, and restore evidence.
- [ ] Encryption keys are backed up separately under restricted access; a database backup alone may be unusable without the matching key.

## 6. Production and privacy
- [ ] Required secrets are present and strong; no secrets exist in Git history, client bundles, logs, or public artifacts.
- [ ] Exact production origin/CORS, trusted proxy hops, HTTPS, security headers, and error responses are checked.
- [ ] Database and document storage are durable and permission-restricted; disk-full and permission failures fail safely.
- [ ] Operational logs are privacy-minimized; alerts do not include document data or credentials.
- [ ] Data export/deletion, retention, consent, privacy notice, and incident response are reviewed.
- [ ] Single-instance SQLite and local rate limits are not treated as horizontally scalable; use managed PostgreSQL and shared rate limiting before scaling replicas.

## 7. Government and college verification
- [ ] PAN/Aadhaar verification remains unavailable until a legally authorized provider, credentials, approved use case, and privacy/security review are in place.
- [ ] Verify provider signatures, TLS, timeouts, retries, audit trails, data minimization, and failure handling before enabling an integration.
- [ ] Never label a document as government-verified based only on upload, OCR, a checksum, or user-provided claims.
- [ ] Institution reviewer roles and memberships are granted only by trusted operators; test least privilege and auditability.
- [ ] College pilot requests are encrypted, access-controlled, and handled under a documented retention policy.

## 8. Release evidence
For each release, record:
- Commit SHA and deployment ID:
- CI run URL and results:
- Date and tester:
- Test environment and synthetic account IDs (no personal data):
- Passed/failed/blocked items with evidence:
- Security findings, severity, owner, mitigation, due date:
- Rollback decision and tested rollback procedure:

## Current known limitations / external dependencies
- Automated CI cannot prove that a real user can complete email delivery, registration, MFA, recovery, or sharing end-to-end in production without controlled test accounts and receipt checks.
- A successful Railway deployment is not equivalent to a complete application security test or independent penetration test.
- Real PAN/Aadhaar verification requires an authorized provider integration; do not represent this as complete until authorization and a successful provider sandbox/live test are documented.
- Production restore should only be considered passed after a controlled isolated restore with matching encryption keys and verified sample records.
