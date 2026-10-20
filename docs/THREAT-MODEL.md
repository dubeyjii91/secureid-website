# SecureID Threat Model

Last updated: 2026-10-20

## Assets
- Account credentials, email-verification and MFA challenges, sessions and recovery tokens.
- Identity profile fields, PAN/Aadhaar and other uploaded documents, institution membership data.
- Secure Share claim payloads and bearer tokens.
- SQLite database, encrypted document files, encryption keys, backups, provider credentials, and operational logs.

## Trust boundaries
1. Browser to public HTTPS application/API.
2. Authenticated user to per-user database and file-storage operations.
3. Share creator to a recipient holding a bearer share URL.
4. Application runtime to email/provider APIs and deployment secret manager.
5. Live storage to backup storage and restore environments.
6. Student accounts to institution reviewer/admin privileges.

## Principal threats and required controls
- Account takeover: password hashing, verified email, MFA, rate limiting, session invalidation, safe recovery, and alerting.
- IDOR/cross-user access: derive user identity from the authenticated session, authorize every record access, and test with two separate accounts.
- CSRF/origin abuse: same-origin enforcement, CSRF tokens where applicable, secure cookie flags, and strict production origin configuration.
- OTP brute force/replay: short expiry, single use, attempt caps, resend cooldown, hashed storage, and no OTP in logs/responses.
- Malicious document uploads: size limits, content-type and magic-byte validation, safe generated storage paths, encrypted storage, and no executable serving.
- Data exposure through sharing: explicit allow-list of claims, non-empty claim filtering, high-entropy token, hashed token storage, expiry, revocation, and no-store/no-referrer headers.
- Storage theft or tampering: authenticated encryption, restricted filesystem access, integrity verification, key separation, and tested backup/restore.
- Secret compromise: deployment secret manager, least privilege, secret scanning, rotation procedure, and no secrets in frontend bundles or logs.
- Supply-chain vulnerabilities: lockfile, dependency audit, Trivy, CodeQL, pinned/reviewed CI actions, and remediation tracking.
- Insider or role abuse: operator-only membership provisioning, least privilege, audit trails, and periodic reviewer access review.
- False identity assurance: clearly distinguish document storage/file integrity from government authenticity; do not enable PAN/Aadhaar claims without provider authorization and evidence.

## Residual risks
- A single-instance SQLite architecture and local rate limits do not provide multi-instance coordination or high availability.
- Application controls and automated scans cannot replace an independent penetration test, privacy/legal review, or operational restore drill.
- Email delivery depends on correct provider configuration, sender-domain verification, deliverability, and provider availability.
- Government verification is an external integration and authorization dependency, not something that can be simulated honestly.
- Backups containing encrypted payloads remain sensitive and depend on safe key custody and retention controls.

## Review cadence
Review this model after any change to authentication, MFA, document storage, share links, institution roles, providers, database topology, or deployment configuration, and at least quarterly while the product is active.
