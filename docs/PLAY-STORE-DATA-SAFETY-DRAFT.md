# SecureID — Google Play Data safety draft

> **Draft for operator review only. Do not submit this as a final Data safety declaration without checking the live production configuration, all SDK/network behavior, vendor contracts, and the app's actual user flows.** This is a technical inventory, not legal advice.

## Product and account scope

- Android application ID: `com.secureid.mobile`
- Expo SDK: `~54.0.0`
- Account creation and login are supported.
- Current Android Expo config declares no additional Android runtime permissions. The app uses the system document picker for user-selected files.
- The app does not currently claim government verification of PAN, Aadhaar, passports, or academic certificates.

## Data types that appear to be collected or processed

| Google Play data category | Data in SecureID | Purpose |
|---|---|---|
| Personal info — Email address | Account email; verification, MFA, password-recovery, and security-message destination | Account creation, authentication, recovery, security |
| Personal info — Other info / account identifiers | Internal account ID and account/profile fields actually enabled in production | Account management and access control |
| App activity — App interactions | Authentication events, MFA challenges, session creation/revocation, document and share actions, security events | Core features, fraud prevention, and account security |
| Files and docs | User-selected uploaded documents, filenames, MIME types, file sizes, and document/share metadata | Document vault, download, and user-directed sharing |
| Device or other IDs / diagnostics — verify exact classification | User-agent, connection metadata, session identifiers, and security logs processed by the service/host | Session management, abuse prevention, diagnostics, and security |

**Credential handling:** Users submit passwords for authentication. The server stores password hashes rather than plaintext passwords. Native session tokens are returned to the native client and stored in Android SecureStore; the server stores token hashes. Do not interpret hashing as meaning credentials are not collected.

**Analytics review:** The repository contains an optional analytics preference flag that defaults to off in the database and Privacy Center. A repository-wide search found no Firebase Analytics, Sentry, Mixpanel, Amplitude, PostHog, AdMob, or equivalent analytics SDK/event pipeline. Treat this as a codebase finding only; verify the final release binary, hosting-side integrations, and any manually enabled provider before answering the Play Console question.

**Email content:** Transactional messages may contain verification codes, MFA codes, recovery links, or security notifications. Production startup logs identify Brevo as the selected email-delivery provider.

## Data sharing and service providers

- **Railway:** production API hosting, SQLite database, persistent document storage, and operational infrastructure. The production volume is configured in the SFO region in the United States. Confirm the active contract, subprocessors, support/log access, and data processing terms.
- **Brevo:** transactional email delivery. Email addresses, message content, and delivery metadata may be processed for the messages listed above. Confirm the active account entity, data region, DPA, and enabled email features.
- **Recipients selected by a user:** when a user creates a document share, the selected recipient can access the document through the generated share link until it expires or is revoked. This is user-directed sharing, not advertising.
- Expo/EAS is used for build-time Android packaging and is not identified as a runtime recipient of users' documents by the current architecture.

Official provider notices:
- Railway: https://railway.com/legal/privacy
- Brevo: https://www.brevo.com/legal/privacypolicy/
- Brevo DPA: https://www.brevo.com/legal/termsofuse/#appendix-3-data-processing-agreement-dpa

## Security practices to confirm in Play Console

- App/API communication uses HTTPS/TLS in production.
- Passwords are stored as one-way hashes.
- Document content is encrypted at rest by the server's document-storage layer.
- Session tokens are stored hashed server-side; the Android native client stores its bearer token in SecureStore.
- Email MFA and session revocation are supported.
- Account deletion is available in the Android Security Center and through the public web resource: https://secureid-production-b732.up.railway.app/delete-account.html
- The production smoke test verifies the public deletion page and confirms an unauthenticated DELETE /api/account request is rejected after valid CSRF validation.

## Retention and deletion caveats

- Account deletion removes active account records and attempts to remove active encrypted document files.
- Historical encrypted backups may retain prior copies until those backups expire or are securely destroyed.
- The backup implementation defaults to one encrypted backup every 24 hours and seven retained backup files. Production variables `BACKUP_INTERVAL_HOURS`, `BACKUP_RETENTION_COUNT`, and `BACKUP_DIR` are configured but their values are redacted in the connected Railway view; the operator must verify the actual values before declaring a precise retention period.
- Backups currently reside on the same Railway persistent volume as the live service. They are not an independent off-site disaster-recovery copy.
- Verify Railway log retention and Brevo message/delivery metadata retention from the actual account settings and provider terms.

## Questions that must be answered before submission

1. Confirm the optional analytics preference is not connected to any external analytics/event collection, and verify no analytics, crash reporting, marketing pixels, session replay, or other tracking is enabled outside this repository.
2. Are any user documents or profile fields processed by additional integrations or manually accessed by support staff?
3. Which exact account/profile fields are collected in the deployed registration flow?
4. What are the actual production backup interval and retention count?
5. What retention periods apply to Railway logs, Brevo messages, and delivery metadata?
6. Confirm whether the developer account is personal or organization, and whether any special declarations apply.
7. Review the final answers against the current Google Play Data safety form and privacy-policy requirements.

## Important

Do not claim that SecureID verifies government identity documents, provides certified identity assurance, or has an independent off-site backup. Do not claim that data is never shared: infrastructure providers and user-selected share recipients receive/process data as described above.
