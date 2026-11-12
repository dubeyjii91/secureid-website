# SecureID trust-readiness master plan

Last audited: 2026-11-12
Base commit: 910df6bd5c4ce1e8913122723b0781ce39ca9a9d
Status: implementation roadmap and evidence register; not a launch approval.

This document is deliberately evidence-led. A feature is not marked complete merely because a screen, API route, CI test, or successful deployment exists. Production claims require the relevant runtime, device, security, legal, or operational evidence.

## Five questions a college principal must be able to ask — and SecureID's evidence required

### 1. How do you protect student data?

**Implemented controls evidenced in the repository**
- Password hashing, session handling, email verification/MFA, recovery and security notifications are implemented.
- Document content is encrypted at rest with an operator-managed key.
- Share links have expiry/revocation controls and non-cacheable response protections.
- CI includes dependency audit, Trivy, CodeQL, build, lint, automated tests, and passive DAST.

**Evidence still required before making a strong assurance**
- Independent third-party penetration test with remediation and retest.
- Fresh production tests for account isolation, direct API authorization, session replay/logout, MFA bypass resistance, upload validation, CSRF, rate limiting, and share-token behavior.
- Confirm current production secret configuration, key custody/rotation and access boundaries without exposing secret values.
- A documented incident-response contact, escalation path, and breach-response procedure.

**Permitted statement today:** SecureID implements multiple security controls and automated checks. Do not claim that it is independently certified, penetration-tested, end-to-end encrypted, or immune to breaches.

### 2. What happens if hosting or storage fails?

**Implemented controls evidenced**
- Production currently uses one SecureID service replica and a persistent Railway volume mounted at /data.
- SQLite and encrypted document files are stored on that volume.
- AES-256-GCM encrypted backups include a database snapshot and encrypted document blobs.
- Restore validates the authenticated backup, checks SQLite integrity, stages restored documents, and retains a pre-restore database copy.
- An isolated restore drill was recorded on 2026-11-11: SQLite integrity OK, 67 tables and 6 document blobs restored.

**Blocking gaps**
- The recorded drill restored from the Railway volume; it did not prove recovery from an off-platform copy.
- The scheduler runs inside the API process. It cannot guarantee scheduled backups while the service is sleeping or stopped.
- The production environment currently has no object-storage bucket provisioned.
- No independent off-platform restore evidence, formally agreed RPO/RTO, or verified stale-backup alert is recorded.

**Required implementation sequence**
1. Keep single replica while SQLite and process-local rate limits remain.
2. Do not enable a paid bucket, cron service, database, or storage plan without explicit budget approval.
3. Evaluate a genuinely zero-cost, reliable off-platform copy; if none is suitable, document this as a launch blocker rather than pretending it is solved.
4. When a provider and budget are approved, upload only already-encrypted backup artifacts over TLS using least-privilege credentials; add retention/versioning, checksum verification, stale/failure alerts, and isolated restore tests.
5. Record RPO/RTO only after repeated timed restore drills.

### 3. Can SecureID verify that an identity document is genuine?

**Current boundary**
- Upload, storage, user-entered identity details, selective sharing, and on-device image OCR are not proof of authenticity.
- PR #94 is merged. The mobile release includes opt-in local OCR for JPG/PNG and local expiry reminders. User-confirmed device testing covered English/Hindi OCR previews and expiry reminders.
- PDF OCR is not implemented. OCR temporary-file cleanup and the no-persistence/no-upload privacy assertion still need explicit evidence.

**Required sequence**
1. Complete OCR privacy/temporary-file tests and unsupported-device/error handling.
2. Keep every OCR result labelled as an unverified extraction; never auto-save extracted fields.
3. Add institution-issued ID review as a distinct workflow with reviewer identity, evidence, decision, timestamp, and audit history.
4. Integrate government/third-party verification only after legal authorization, approved provider credentials, contracts, security review, and a real test environment.
5. Verify provider signatures, TLS, timeout/retry behavior, data minimization, auditability, and failure states before enabling any verified badge.

**Permitted statement today:** SecureID can manage and selectively share user-provided documents and can locally extract text from supported images. It does not currently certify PAN, Aadhaar, passport, certificate, or other government-document authenticity.

### 4. Can college staff access only what they are allowed to access?

**Required evidence**
- Role and institution membership matrix covering Owner, institution admin, admission reviewer, HOD, Warden, and student.
- Server-side authorization tests for every institution-scoped endpoint, including cross-college and cross-student isolation.
- Audit records for staff reads, exports, decisions, role changes, and membership changes.
- College onboarding and offboarding process, periodic access review, and emergency access revocation.
- Student consent and a clearly limited disclosure view for each workflow.

**Implementation sequence**
1. Map every existing institution route and permission to a role matrix.
2. Add or close authorization gaps with tests before adding more screens.
3. Deliver institution onboarding, reviewer assignment, admission/document review, and auditable decisions.
4. Connect existing Warden hostel inventory to student/institution records only after authorization boundaries are tested.
5. Pilot with synthetic data, then one institution under a written agreement.

### 5. Can the college run its admission and student workflows on SecureID?

**Required workflow**
- Institution registration and operator approval.
- Institution admin and staff invitations with least-privilege roles.
- Student application and document submission.
- Review, request-correction, approve/reject, and status history.
- Confirmed enrollment record.
- Hostel allocation connected to the enrolled student, with occupancy history.
- Institution reports and export with access audit.
- Support, dispute, correction, retention, and deletion processes.

**Commercial boundary**
- The intended model is institution subscriptions, institution-paid admission service fees for confirmed enrollments, optional premium storage, and transparent sponsorships.
- Basic student access should remain free where feasible.
- Monetization work must remain draft/inactive; no payment gateway, live charge, or paid infrastructure without separate explicit approval.
- Never charge students automatically for institution admission fees.

## Prioritized implementation backlog

### P0 — trust and safety gates (before onboarding real student records)
- [ ] Re-run the full production security test suite against the current release commit; attach current run links and record manual test evidence separately.
- [ ] Independent penetration test; remediate and retest findings.
- [ ] Test account A/B isolation for every document, identity, share, institution, and admin API.
- [ ] Test actual old-session-cookie replay after logout and session revocation.
- [ ] Verify MFA, recovery, CSRF, rate limits, upload validation, share expiry/revocation, cache headers, and alert delivery.
- [ ] Verify backup scheduler behavior while the service is sleeping; replace in-process-only scheduling only with an approved, affordable external mechanism.
- [ ] Establish off-platform encrypted backup and isolated restore proof; if no free provider is viable, keep this as a disclosed blocker.
- [ ] Verify production encryption keys and separate key custody without copying secrets into Git, chat, or logs.
- [ ] Complete legal operator, contact, retention, vendor/DPA, processing-region, rights, complaint, incident, and deletion facts; obtain jurisdiction-appropriate legal review before publishing the privacy notice.
- [ ] Confirm the data-deletion and backup-retention behavior with synthetic accounts.

### P1 — institution pilot readiness
- [ ] Complete a server-side role/permission matrix and endpoint authorization tests.
- [ ] Complete college onboarding and staff invitation/revocation.
- [ ] Complete auditable admission and document review workflows.
- [ ] Connect hostel allocation to approved student records without weakening Warden boundaries.
- [ ] Finish mobile backend integration and physical-device tests for login, MFA, vault, upload/download/delete, sharing, revocation, offline/error states, and session expiry.
- [ ] Complete OCR temporary-file cleanup/no-upload evidence; implement PDF OCR only after a safe local rendering approach is validated.
- [ ] Complete notification permission granted/denied tests and native upgrade compatibility.

### P2 — scale and product expansion
- [ ] Migrate SQLite to PostgreSQL with a tested migration, rollback, backup, and data-integrity plan before multiple replicas.
- [ ] Add shared/distributed rate limiting and coordination before horizontal scaling.
- [ ] Add institution analytics and admission reporting after workflows are stable.
- [ ] Add a digital identity card/QR only with server-side, auditable verification semantics; a QR code alone is not proof.
- [ ] Build monetization foundation behind inactive/draft state; do not enable payment collection.
- [ ] Add document categories, expiry, OCR-assisted field suggestions, and duplicate detection only where they improve the existing Vault; do not create a duplicate vault.

## Hard constraints and change controls
- Preserve existing user documents and existing Vault, Share ID, Share Management, Security Center, and Warden features. Improve and integrate; do not create duplicate modules or remove current capabilities.
- Do not change the existing visual theme or user-facing text unless a specific UX change is approved.
- Do not add a paid Railway resource, paid external service, payment gateway, or paid API without separate explicit approval.
- Do not change production secrets, rotate encryption keys, run a restore against live data, or migrate production data without a reviewed runbook and explicit approval.
- Work through small reviewable PRs. Run CI and inspect the exact diff before merge. Deploy only after release checks pass; do not infer deployment success from a queued build.
- Keep Google Play submission/publication out of scope until separately requested.
- Never invent legal facts, provider authorization, penetration-test results, RPO/RTO, or user acceptance evidence.

## Evidence record template

For every completed gate, record:
- Requirement and test case:
- Environment and commit SHA:
- CI/manual test link:
- Synthetic test account/data only:
- Result and timestamp:
- Reviewer/operator:
- Remaining limitations:
- Related deployment ID (if deployed):

A checkbox is complete only when its evidence record exists. A successful build or healthy deployment alone is not proof that the five principal questions have been answered.
