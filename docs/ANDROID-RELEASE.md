# Android production release runbook

## Build the signed production AAB

1. Review the Android source and security changes for the exact release commit.
2. Run **Actions → SecureID CI → Run workflow** on a trusted branch and enable `build_android_production_aab`.
3. Confirm CI, dependency audit, Trivy, CodeQL, backup/restore smoke tests, and EAS production build all succeed.
4. Download the `secureid-android-production-aab` artifact and archive the AAB with the commit SHA in approved release storage. GitHub artifacts expire after 14 days.
5. Upload the AAB to a Google Play **internal testing** track manually. The workflow does not submit or publish to Play Console.

The production build uses the existing EAS project and remote Android signing credentials. Do not rotate the signing key; existing installs must be able to update.

## Release gates before Play Console submission

- Complete and approve `docs/PRIVACY-POLICY-RELEASE-DRAFT.md`; publish a public HTTPS privacy URL. The current file is a draft and is not a public policy.
- Confirm the legal operator, monitored support/privacy contact, privacy request channel, retention schedule, backup expiry, age/target-audience position, and relevant Indian DPDP / other market compliance with qualified counsel.
- Reconcile the Play Console Data safety form with the actual production SDKs, network behavior, hosting/email providers, and data retention.
- Complete `docs/PLAY-STORE-LISTING-DRAFT.md`: final icon, feature graphic, screenshots from the final app on real devices, support contact, app access instructions, content rating, ads declaration, and account deletion details.
- Verify package ID `com.secureid.mobile`, release version, version code, signing identity, and target API requirements.
- Test a clean install and upgrade from the current preview APK on real Android devices. Exercise login, email MFA, biometric lock/unlock, app background/foreground, Android Back handling, vault upload/download/delete, share creation/expiry/revocation, and session revocation.
- Run an independent security/privacy review and an operational backup-restore drill before onboarding real users.

## Infrastructure constraints

The current backend is a single-instance SQLite deployment on persistent Railway storage. Do not horizontally scale it until migrating to managed PostgreSQL and shared/distributed rate limiting. Monitor database capacity, disk usage, backup success, email delivery, HTTP 5xx, and restore readiness.

## Product claims

Do not claim government verification, PAN/Aadhaar authenticity checks, end-to-end encryption, or certification unless the corresponding authorized integration and independent evidence exist. The current app provides document storage/sharing and account security controls.
