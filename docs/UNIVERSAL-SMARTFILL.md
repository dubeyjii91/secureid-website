# Universal SmartFill

SmartFill is a consent-scoped form assistant available in the authenticated SecureID workspace. It reads encrypted My Identity profile fields and encrypted manual fields, discovers editable native form controls, and lets the user map approved suggestions by stable field key. Each form/workflow has an independent consent context.

## Consent, review and submission protection

- The user selects both source(s) and exact field keys before granting consent.
- Consent can be revoked for the current form context. Revocation also invalidates any outstanding review session.
- Suggestions are validated and conflicts are marked ambiguous. My Identity values are unverified; manually saved values are user-confirmed. No OCR or file integrity result is presented as government verification.
- Confidence is rule/source based (0.90 for available My Identity values and 1.00 for user-saved manual values), not an AI/OCR confidence score. Suggestions below 0.85 are withheld.
- Applying a suggestion tags only the target native form. Editing the form clears its review token.
- The user must acknowledge the review after values are applied. The server issues a random, 15-minute, form-scoped review token and stores only its SHA-256 hash.
- Mutating API requests made from a tagged native form carry the form ID and review token. The API middleware rejects missing, invalid, expired or superseded tokens with HTTP 409 and `SMARTFILL_REVIEW_REQUIRED`. A successful request is recorded as a value-free `submitted` audit event.
- This review token is a short-lived review attestation, not a general authorization grant. Existing authentication, MFA, CSRF, wallet-unlock and route-specific authorization checks still apply.
- SmartFill never presses submit or submits a form on the user's behalf.

## Data and privacy

- All SmartFill API reads/writes require authentication and MFA. Sensitive read/write operations also require the wallet to be unlocked.
- Values are encrypted with SecureID's existing server-side document encryption key before being stored. No field values are written to the SmartFill audit log.
- Audit records contain only user/form identifiers, stable field keys, source identifiers and timestamps.
- Aadhaar and government ID values are masked in the suggestion UI. The full value is used in the selected browser form only when the user explicitly selects and applies that field.
- Invalid email, phone, date, age, Aadhaar, PAN, passport, postal-code and year values are rejected or marked invalid.

## Current source coverage and limitations

- My Identity: name, date of birth, age, email, phone, full address, institution, SecureID identity ID, student ID and government ID, when those profile values exist.
- Manual SmartFill vault: up to 40 encrypted personal, address, identity, education, professional or custom key/value fields.
- Document Vault: document OCR suggestions are not enabled. The current API exposes document metadata and authenticated encrypted downloads, but no user-scoped OCR extraction, confidence, correction and provenance contract. OCR is not silently inferred from file names or categories.
- Parent Portal is currently read-only and has no parent-facing editable form controls. Scholarship and institutional form contexts can use a distinct consent ID within the College workspace.

## API

- `GET /api/smartfill/schema`
- `POST /api/smartfill/consent` with `formId`, `fields`, `sources` and `consent=true`
- `GET /api/smartfill/suggestions?formId=...`
- `PUT /api/smartfill/data` with encrypted manual fields
- `POST /api/smartfill/review` returns a short-lived `reviewToken`
- `DELETE /api/smartfill/consent/:formId` revokes consent and associated review sessions

Mutating requests use SecureID same-origin/CSRF protection. The client attaches review headers only when the active form has been tagged by applying SmartFill data.
