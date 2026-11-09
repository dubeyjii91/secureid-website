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
- Account export includes institution memberships and review submissions. Account deletion removes linked membership/review records and their user-linked audit rows in dependency-safe order.

## Important privacy and verification boundaries

The institution review queue currently receives **metadata only** (document filename/category, purpose, and submission status). It does not expose encrypted document bytes, storage paths, or a download endpoint to college staff. If colleges need to inspect document contents, a separate explicit student-authorized viewing mechanism must be designed and security-tested before enabling it.

An institution's `approved` or `rejected` status is only an administrative workflow decision. It is not a government verification, identity authenticity check, proof of enrollment, or official credential. SecureID must not claim that Aadhaar/PAN or any other identity is government-verified without an authorized provider integration and appropriate consent.

Pilot-interest forms must contain only a college name, general role/population/workflow preferences, and a short non-sensitive note. Never enter student names, identity numbers, document images, OTPs, passwords, or other sensitive personal data in the interest form.

## Not yet ready for real college data

Before inviting real institutions or uploading real student documents, complete and review:

1. Staff invitation/onboarding and verified institutional-domain checks where appropriate.
2. Consent text versioning, purpose limitation, retention schedule, student withdrawal and institution offboarding/deletion workflows.
3. A separately designed student-authorized document-viewing flow if file contents are needed by reviewers.
4. Student credential issuance using existing selective-share, expiry and revocation controls, with clear issuer and verification semantics.
5. Cross-tenant and role tests, membership suspension/revocation tests, audit completeness and deletion/retention tests.
6. Support procedures, a legally reviewed data-processing agreement and privacy review.

Keep student access free initially. Do not sell student identity data. No Google Play launch or paid college pilot is required while SecureID is being built and tested.
