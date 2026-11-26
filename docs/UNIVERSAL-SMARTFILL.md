# Universal SmartFill

SmartFill is a consent-scoped form assistant. It currently reads encrypted My Identity profile fields and encrypted manual fields. Each form has its own consent record with stable field keys and allowed sources.

## Security
- All routes require an authenticated session and MFA.
- The wallet must be unlocked before consent, private data writes, or suggestion retrieval.
- Values use the existing server-side encryption key.
- Audit rows contain form IDs, stable field keys, source identifiers and timestamps only; never field values.
- My Identity suggestions are unverified; manually saved values are user-confirmed. Suggestions below the 0.85 confidence threshold are withheld. Conflicting values across selected sources are marked ambiguous and cannot be applied until the user resolves the conflict.
- SmartFill never submits forms or claims OCR is government verification.

## Limitations
The current Document Vault API exposes metadata and encrypted downloads, but no user-scoped OCR extraction contract is available. OCR/document-derived suggestions are therefore intentionally not enabled. Additional address, identity, education and professional fields can be stored as encrypted manual fields through PUT /api/smartfill/data.

## API
- GET /api/smartfill/schema
- POST /api/smartfill/consent with formId, fields, sources and consent=true
- GET /api/smartfill/suggestions?formId=...
- PUT /api/smartfill/data with encrypted manual fields
- POST /api/smartfill/review to record review metadata
- DELETE /api/smartfill/consent/:formId to revoke consent

Mutation requests use SecureID same-origin/CSRF protection.
