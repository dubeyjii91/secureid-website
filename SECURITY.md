# Security Policy

## Scope
This policy covers the SecureID website, its API, authentication and MFA flows, encrypted identity profiles and document vault, Secure Share links, backup/restore scripts, and production deployment configuration.

## Reporting a vulnerability
Do not publish exploitable details or submit real identity documents, PAN/Aadhaar numbers, passwords, OTPs, session cookies, API keys, or production database files in an issue. Report the affected component, impact, reproducible steps using synthetic accounts/data, and a safe contact method through a private channel controlled by the project maintainers. Do not access, modify, or retain other users' data while testing.

## Safe testing rules
- Test only systems and accounts you own or have explicit written authorization to assess.
- Use synthetic identity data and non-production accounts.
- Do not run destructive, high-volume, denial-of-service, or social-engineering tests against production.
- Never attempt Aadhaar authentication or PAN verification against government/provider systems without the required authorization and approved integration.
- Do not treat an uploaded file, a checksum, or a local format check as proof that an identity document is authentic.

## Production security baseline
- HTTPS only; secure, HttpOnly, SameSite cookies; strict same-origin/CSRF protections.
- Keep session, OTP, document-encryption, provider, and mail secrets in the deployment secret manager; never commit them.
- Use separate strong secrets for session/OTP hashing and document encryption. Keep the document-encryption key stable and backed up securely; rotating or losing it without a migration plan can make stored documents unrecoverable.
- Require MFA for sensitive vault and sharing actions; rate-limit authentication, OTP, recovery, and share endpoints.
- Store identity data encrypted at rest and minimize the claims shared with recipients.
- Use short-lived, revocable share links and no-store response headers.
- Keep encrypted backups access-controlled and regularly test restores in an isolated environment.
- Review dependency, secret, filesystem-misconfiguration, and static-analysis findings before release.

## Release gate
A green build or successful deployment is not a security certification. Before broad production onboarding, complete the release checklist in [docs/SECURITY-TEST-PLAN.md](docs/SECURITY-TEST-PLAN.md), test restore/recovery using a disposable copy, and obtain an independent security review. Record any accepted risk with an owner and review date.
