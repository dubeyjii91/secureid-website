# PAN and Aadhaar verification: onboarding gates

## Current status
SecureID is an individual student project with no registered company or college pilot partner. Document Vault upload is not government verification. No live provider is approved or connected.

## Aadhaar: enquire with UIDAI about OVSE eligibility
Official portal: https://ovse.uidai.gov.in/
Requirements and guidance: https://uidai.gov.in/pa/ovse
Published support contact: ovse.registration@uidai.net.in

UIDAI lists education as a possible offline-verification use case. Published OVSE requirements include an SVG logo, callback URL, organization name, verification domain, and a Class 2 or Class 3 public certificate; an app ID is conditional for app-to-app flows. UIDAI reviews applications. Because SecureID has no registered organization or college partner, ask UIDAI whether an individual student project is eligible and which legal-entity documents are required before making plans or purchases.

OVSE is offline verification; it does not automatically grant Aadhaar OTP authentication or e-KYC access. Offline verification must not be performed on behalf of another entity. Follow UIDAI's consent, purpose limitation, alternative identification, data minimization, masking, and retention requirements.

## PAN: confirm eligibility before paying or integrating
Income Tax Department information:
https://www.incometax.gov.in/iec/foportal/central-state-government-approved-undertaking-agency

Protean eligibility FAQ:
https://tinpan.proteantech.in/faqs/online-pan-verification/faq-pan-verify-general.html
Protean registration procedure:
https://tinpan.proteantech.in/services/online-pan-verification/pan-verification-register.html
Published contact: PAN-verification@proteantech.in

PAN verification is restricted to eligible entity categories and requires approval. The published list includes specified regulated entities and educational institutions established by regulatory bodies. SecureID must not assume an individual student project qualifies. Ask Protean whether a qualifying institution must apply in its own name, what documents and fees apply, and what official test/UAT process is required.

## Enquiry content
Describe SecureID as a privacy-first student/college workflow. State the current setup honestly: individual student project, no registered company, no college partner. Explain both intended use cases: students requesting verification of their own documents and a college verifying a student's claim only with consent and appropriate authorization. Ask about applicant eligibility, legal entity requirements, permitted use, consent, data retention/deletion, test environment, approval process, and fees. Do not send PAN/Aadhaar copies, numbers, OTPs, or other sensitive data in the enquiry.

## Implementation gates in SecureID
1. Keep Document Vault upload distinct from verification status.
2. The existing MFA-protected `GET /api/identity/government-verification/readiness` endpoint is configuration-only; it is not evidence of verification.
3. Do not enable provider approval flags until written approval and official provider credentials are received.
4. Build adapters only against the authorized provider's current technical specification; do not invent endpoints or response fields.
5. Minimize stored results and logs; never log full identity numbers, OTPs, or document contents.
6. Require purpose-specific consent, MFA for sensitive actions, server-side authorization, rate limits, request validation, safe timeout handling, and provider-specified signature/replay checks.
7. Enforce institution-scoped access; a college must not receive a student's document merely because it was uploaded to SecureID.
8. Test provider failure, invalid responses, expiry, withdrawn consent, duplicate requests, cross-account/cross-college access, and log redaction.
9. Label all simulations as test data. Show “Not connected” or “Pending approval” until authorized integration is live and independently tested.

Live verification is blocked until eligibility, approval, official specifications, credentials, privacy review, and security testing are complete. This checklist is not evidence of approval or legal advice.
