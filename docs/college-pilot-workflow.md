# College pilot and review workflow

## Current implementation

SecureID reuses the existing Document Vault and selective identity-sharing controls. It does not create a second student vault.

- Authenticated users can submit non-sensitive college pilot interest. Request data is encrypted at rest and visible only to the submitting account.
- Institutions and memberships use the roles `student`, `reviewer`, `institution_admin`, and `read_only`.
- Memberships are provisioned only by a trusted SecureID owner with verified MFA. The owner console can create institutions, provision memberships, and suspend/reactivate memberships. Provisioning and membership changes are audited.
- Students with an active student membership can select a document already in their own SecureID Vault, choose a limited purpose, and explicitly consent to submit a metadata reference to the institution.
- Reviewers and institution administrators with active memberships can view their institution's queue and record `needs_correction`, `approved`, or `rejected` administrative outcomes. Read-only members can view but cannot change status.
- Students can view their own submission status and encrypted review note, inspect audit history, and withdraw open submissions.
- Deleting a source document automatically withdraws its open review submissions.
- Each student submission records the consent timestamp and immutable consent text identifier (`college-review-v1`); the student can retrieve this evidence with their submission history.

### Consent text — college-review-v1

“I consent to submit the selected document reference, filename, document category, selected institution, and stated review purpose to that institution for the purpose shown. I understand that this workflow shares document metadata only and does not grant the institution access to the document file itself. I can withdraw an open submission while it is still awaiting review or correction. An institution’s review outcome is an administrative decision and is not government or identity verification.”

The version identifier and acceptance timestamp are stored with each submission. This is an implementation record, not a substitute for formal legal/privacy review or institution-specific consent terms. Any wording change must use a new version identifier rather than silently changing this text.
- Account export includes institution memberships and review submissions. Account deletion removes linked membership/review records and their user-linked audit rows in dependency-safe order.

## Important privacy and verification boundaries

The institution review queue currently receives **metadata only** (document filename/category, purpose, and submission status). It does not expose encrypted document bytes, storage paths, or a download endpoint to college staff. If colleges need to inspect document contents, a separate explicit student-authorized viewing mechanism must be designed and security-tested before enabling it.

An institution's `approved` or `rejected` status is only an administrative workflow decision. It is not a government verification, identity authenticity check, proof of enrollment, or official credential. SecureID must not claim that Aadhaar/PAN or any other identity is government-verified without an authorized provider integration and appropriate consent.

Pilot-interest forms must contain only a college name, general role/population/workflow preferences, and a short non-sensitive note. Never enter student names, identity numbers, document images, OTPs, passwords, or other sensitive personal data in the interest form.


## Institution partnership and connection gate

The Owner/Admin dashboard now has an Institution Partnership Verification panel. It keeps these states separate:
- Institution identity (AISHE code, official HTTPS website, address, and independently checked evidence).
- Authorized representative (name, designation, official institutional-domain email, and independently checked authority evidence).
- Signed partnership agreement (agreement reference and verification evidence).
- Subscription/payment (a pilot is explicitly not a paid subscription; an active paid plan requires a separately verified payment reference and amount).
- Technical connection (cannot be marked connected until the preceding identity, representative, agreement and subscription gates pass).

Each check stores an append-only evidence reference, outcome, operator and timestamp. The evidence reference is a pointer to the source record, not proof by itself. The SecureID owner must independently inspect official sources, contact the institution through an independently obtained official channel, review the signed agreement, and confirm settled funds in the bank/payment provider before recording a verified outcome. Never record an institution as verified based only on a typed college name, an email-domain match, a screenshot, or an unverified payment receipt.

The institution admin can view their institution's partnership status from an authenticated, MFA-protected endpoint. No public institution self-approval or self-role assignment is provided. Selecting API/ERP/CSV as an integration mode is a planning label only; a technical connection is not complete until the corresponding real integration has been tested and its evidence recorded.

Live payment gateway collection and automatic AISHE/UGC/AICTE verification are not enabled by this module. Payment verification is a controlled manual check for the current zero-budget setup. Do not claim government verification or automated institutional validation. Legal review, data-processing agreement, retention/deletion policy, and the two-account cross-tenant acceptance test remain required before production use with real student data.

## Not yet ready for real college data

Before inviting real institutions or uploading real student documents, complete and review:

1. Staff invitation/onboarding and verified institutional-domain checks where appropriate.
2. Formal legal/privacy review and approval of the versioned consent wording, retention schedule, and institution offboarding/deletion workflows.
3. A separately designed student-authorized document-viewing flow if file contents are needed by reviewers.
4. Student credential issuance using existing selective-share, expiry and revocation controls, with clear issuer and verification semantics.
5. Cross-tenant and role tests, membership suspension/revocation tests, audit completeness and deletion/retention tests.
6. Support procedures, a legally reviewed data-processing agreement and privacy review.

Keep student access free initially. Do not sell student identity data. No Google Play launch or paid college pilot is required while SecureID is being built and tested.

## Two-account manual acceptance test (test accounts only)

Use two accounts controlled by the tester; never share passwords, MFA codes, recovery codes, or real identity documents with another person.

1. Sign in to the owner console with the trusted SecureID owner account and complete MFA.
2. Create a clearly labelled test institution, for example `SecureID QA Sandbox`.
3. In the registered-account selector, provision account A as `student` and account B as `reviewer`. Confirm both memberships are active in the institution directory and that the audit trail records both provisions.
4. Sign out. Sign in as account A (student), complete MFA, and confirm the institution appears in the student review-submission flow. Use only a synthetic/test document already in the test vault. Submit it for one allowed purpose with explicit consent.
5. Sign out. Sign in as account B (reviewer), complete MFA, open the institution review queue, and confirm only metadata is visible (filename/category/purpose/status; no file bytes or download control).
6. As reviewer, set the test submission to `needs_correction` and add a non-sensitive test note. Return to account A and verify the status and note are visible; withdraw the open submission.
7. Repeat with a second synthetic test submission and have the reviewer mark it `approved`. Confirm the student sees the administrative outcome and that the audit trail records submission, queue access and decision.
8. In the owner console, suspend the reviewer's institution membership. Sign in as account B again and confirm the institution queue is denied. Reactivate only if another test is needed; otherwise leave the test memberships suspended after testing.

Expected security results: the student cannot act as reviewer; the reviewer cannot access the student's vault bytes through the queue; missing MFA is denied; a suspended membership loses access; the student can see and withdraw their own open submission. An `approved` result is an institution workflow decision only, not proof of identity or official enrollment.

Record pass/fail and the app version/build used. Do not mark this manual gate complete until both accounts have actually completed the steps against the same deployed test environment.
