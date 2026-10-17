# Government Identity Verification — Onboarding and Integration Gate

## Current state

SecureID currently supports private document storage and a readiness endpoint. It does **not** perform live PAN or Aadhaar verification. Uploading a document, entering identity details, or receiving a local SecureID status is not proof that a government database was queried.

The readiness endpoint is:
- `GET /api/identity/government-verification/readiness`
- Authenticated and MFA-protected.
- Configuration-only; it must never be interpreted as a successful verification result.

## PAN: approval and provider selection

The Income Tax Department's PAN Verification Webservice documentation says an external agency must request access and receive approval before calling the webservice. The bulk PAN/TAN service has separate eligibility and approval rules and is not a generic public API.

Official references:
- PAN verification service: https://www.incometax.gov.in/iec/foportal/central-state-government-approved-undertaking-agency
- Verify PAN help/FAQ: https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/verify-your-pan

Before implementation, the organization responsible for SecureID must establish which official service or authorized provider it is eligible to use, complete the provider's onboarding, and obtain the provider's current API contract and credentials. Do not assume that a private app is automatically eligible for a government webservice.

## Aadhaar: authorization and data minimization

UIDAI describes AUA/KUA and Sub-AUA/Sub-KUA requesting-entity arrangements, eligibility and security requirements. Direct Aadhaar authentication is not an unrestricted public API. The proposed use case must be accepted by UIDAI or an eligible existing requesting entity, and the applicable consent, purpose limitation, security and data-retention requirements must be satisfied.

Official references:
- UIDAI Authentication Requesting Agency: https://uidai.gov.in/hi/authentication-requesting-agency
- UIDAI Authentication Documents and current onboarding/checklist material: https://uidai.gov.in/en/authentication-documents

Do not collect Aadhaar OTPs or biometrics in SecureID unless the exact approved flow and legal/technical requirements explicitly permit the interaction. Never store Aadhaar OTPs, biometrics, or authentication PID data. Prefer a provider-approved redirect/hosted flow when required by the provider.

## Required information before a live adapter can be written

For each separate PAN and Aadhaar integration, obtain from the authorized provider:
1. Written evidence that the SecureID operating entity and stated use case are approved.
2. Current API specification and sandbox documentation.
3. Sandbox endpoint, authentication method, request/response schemas, error codes, rate limits and idempotency rules.
4. Production onboarding steps and confirmation of the permitted production endpoint.
5. Data-processing terms, retention rules, audit requirements, consent language and incident escalation procedure.

Do not send real identity numbers or documents in GitHub issues, source code, chat, test fixtures or logs. Do not commit API secrets. Supply secrets only through the production secret manager after the provider confirms the production account is authorized.

## Implementation gates

### Gate A — sandbox
- Implement a separate server-side adapter per provider, based only on its published contract.
- Keep provider secrets on the server; never expose them to the browser.
- Require authenticated session, recent MFA where appropriate, explicit user consent, purpose, CSRF protection and rate limiting.
- Validate provider responses against a schema; reject unknown or malformed results.
- Use correlation IDs that do not contain identity numbers; redact sensitive values from logs.
- Test positive, mismatch, invalid input, timeout, provider outage, rate-limit, malformed response, replay and duplicate-submit cases.
- Keep sandbox results visibly labelled **TEST — NOT GOVERNMENT VERIFIED**.

### Gate B — production approval
- Require written production approval and production credentials.
- Run only provider-approved test cases and a controlled release.
- A result may be labelled **Verified** only when a valid, authenticated provider response explicitly confirms the required check.
- Distinguish `pending`, `verified`, `not_verified`, `failed` and `unavailable`; never convert a timeout or missing response to success.
- Store the minimum necessary outcome and audit metadata, not raw provider payloads, unless the approved contract and applicable law require otherwise.
- Verify revocation, retention, deletion, monitoring and incident-response procedures before enabling real users.

## Environment variable safety

The repository currently uses these readiness names:
- PAN: `PAN_VERIFICATION_ENDPOINT`, `PAN_VERIFICATION_CLIENT_ID`, `PAN_VERIFICATION_CLIENT_SECRET`, `PAN_VERIFICATION_APPROVED`
- Aadhaar: `AADHAAR_AUTH_ENDPOINT`, `AADHAAR_AUTH_CLIENT_ID`, `AADHAAR_AUTH_CLIENT_SECRET`, `AADHAAR_AUTH_APPROVED`

These names are placeholders for readiness/configuration only. Setting them does **not** create an integration, confer authorization, or make verification live. The current endpoint intentionally returns `officialVerificationConnected: false` and `live: false` until a real adapter and verified approval gate are implemented.

## Release acceptance criteria

Do not call this feature production-ready until:
- Provider authorization and production contract are confirmed.
- Server-side adapters and response validation are implemented and reviewed.
- Automated tests pass against provider sandbox fixtures.
- A controlled live verification succeeds with explicit consent and approved test conditions.
- Logs and database are checked to ensure secrets and unnecessary identity data are not retained.
- UI accurately reports unavailable/error states and never fabricates a verification result.
