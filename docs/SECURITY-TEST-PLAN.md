# SecureID Production Security Test Plan

Last updated: 2026-10-20

This is a repeatable release checklist, not a claim that every item has passed. Record evidence for each test and rerun after authentication, storage, sharing, or deployment changes. Use synthetic data and a separate test account. Never use real PAN/Aadhaar values in test fixtures.

## 1. Automated checks
Run on the exact release commit in CI:
- [ ] `npm ci` (prefer a committed lockfile and reproducible installs).
- [ ] `npm audit --audit-level=low`; triage every finding and document any exception.
- [ ] Trivy filesystem scan for vulnerabilities, misconfiguration, and secrets.
- [ ] CodeQL JavaScript/TypeScript security-extended analysis.
- [ ] `npm run build`.
- [ ] `npm run lint`.
- [ ] `npm test` (Node test runner).
- [ ] Confirm CI results are attached to the release commit; a deployment status alone is not a CI result.

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
- [ ] Restore is tested on an isolated disposable instance, never over the live production database.
- [ ] Restored records and encrypted documents can be read with the correct key; corruption/wrong-key cases fail safely.
- [ ] Retention, deletion, recovery-point objective, recovery-time objective, and off-platform copy are documented.
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
