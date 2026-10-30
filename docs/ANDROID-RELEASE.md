# SecureID Android Release

This guide separates an installable internal preview APK from a signed production Android App Bundle (AAB).

## Build a production AAB

1. Confirm the Android app has passed the release checks in `docs/SECURITY-TEST-PLAN.md`.
2. Open **Actions → SecureID CI → Run workflow** on the `main` branch.
3. Leave `build_android_preview_apk` disabled and enable `build_android_production_aab`.
4. Run the workflow and wait for both the CI/security job and EAS build to finish successfully.
5. Download the `secureid-android-production-aab` artifact. The artifact contains `SecureID-production.aab`.
6. Keep the artifact and its release commit SHA together in the release record. Workflow artifacts expire after 14 days; archive the AAB in the team's approved release storage.

The production EAS profile uses remote Android versioning and the production signing credentials already associated with the existing EAS project. The workflow checks that `EXPO_TOKEN` and the existing EAS project ID are available. It does not create a new EAS project.

## Play Console submission is a separate approval step

The workflow only builds and stores the signed AAB. It does not upload the bundle to Google Play, create a Play Console release, publish to production, or change staged rollout percentages. Before submission:

- Confirm ownership and access to the Google Play Console developer account.
- Verify the application ID `com.secureid.mobile`, app name, version, signing identity, and store listing.
- Prepare the 512×512 high-resolution app icon, feature graphic, phone screenshots, short/full descriptions, support contact, and privacy-policy URL.
- Complete the Play Console Data safety form, app access instructions, target audience/content declarations, ads declaration, and any financial/identity-document related policy disclosures that apply.
- Test the AAB on an internal testing track with a clean install and upgrade path; verify login, email MFA, biometric lock, vault upload/download/delete, share creation/revocation/expiry, and session revocation.
- Review the current Google Play target API requirements and any policy updates at submission time.
- Start with internal testing, then closed testing, and only proceed to production after the required review and tester feedback.

Do not describe file-format checks or document storage as government verification. PAN/Aadhaar authenticity verification requires an authorized provider integration and separate legal/privacy approval.

## Release safety

- Never paste Expo, Play Console, SMTP, Resend, Brevo, or Railway secrets into issues or chat.
- Do not commit keystores, service-account JSON files, signing passwords, or `.env` files.
- Do not rotate or replace the existing Android signing key; doing so can prevent upgrades for users who already installed the app.
- A green CI run and a successful AAB build are release evidence, not a penetration-test certification.
- The current backend is a single-instance SQLite deployment with a persistent Railway volume. Do not scale it horizontally until the database and rate-limiting architecture are migrated to shared services.
