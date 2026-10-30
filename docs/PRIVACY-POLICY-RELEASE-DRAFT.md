# SecureID Privacy Notice — Release Draft (Not for publication)

> **Release blocker:** This is an engineering draft, not approved legal copy. Replace every `[REQUIRED BEFORE PUBLICATION]` item, confirm the actual production configuration, and obtain privacy/legal review before linking this notice in Google Play or onboarding real users.

**Effective date:** [REQUIRED BEFORE PUBLICATION]  
**Service operator / data controller:** [REQUIRED BEFORE PUBLICATION: legal name and jurisdiction]  
**Contact:** [REQUIRED BEFORE PUBLICATION: monitored privacy/support email and postal address if required]  
**Public service URL:** [REQUIRED BEFORE PUBLICATION: canonical HTTPS origin]

## 1. What SecureID does

SecureID provides account access, email verification and multi-factor authentication, a personal document vault, document sharing with expiry/revocation controls, session management, biometric app locking on supported Android devices, and security notifications. SecureID does not itself establish that a government identity document is authentic. Any future government or institution verification integration must be described separately after authorization and privacy review.

## 2. Information the service may process

The current application implementation can process the following categories when a user supplies or uses them:

- **Account and authentication:** email address, password verifier (passwords are hashed rather than stored as plaintext), email verification and MFA challenge metadata, recovery data, and account status.
- **Session and security data:** session token hashes, session creation/expiry and last-activity timestamps, MFA/trusted-device state, limited user-agent information, a keyed hash of the network address for security/session controls, and security events/notifications.
- **Documents and sharing:** uploaded file contents, filenames, MIME types, sizes, document metadata, share-link identifiers/tokens in protected server-side form, share expiry/revocation state, and access events.
- **Identity profile data:** only information a user chooses to enter or provide for identity-sharing features. Do not upload government identifiers unless the feature is explicitly enabled and the user has reviewed the applicable notice.
- **Preferences and diagnostics:** privacy/security notification preferences and operational events needed to maintain service security and reliability.

The Android app uses the device's local biometric capability to gate access to the app. Biometric templates are handled by the operating system/device authentication APIs; SecureID does not receive a fingerprint or face scan. The app stores its native session credential in Android secure storage.

## 3. Why information is used

Information is processed to create and protect accounts, deliver verification codes, authenticate users, store and retrieve user-requested documents, create and revoke time-limited shares, manage sessions, respond to support requests, detect abuse, maintain backups, and operate and secure the service. Any optional analytics must remain disabled unless the exact analytics provider, data collected, purpose, consent mechanism, and opt-out behavior are verified and disclosed here.

## 4. Document protection and sharing

The server is configured to encrypt document content at rest using an operator-managed encryption key. Access is restricted through authenticated API checks. A user-created share may expose the selected document to anyone holding its share link until it expires or is revoked; users should treat such links as sensitive. Do not claim end-to-end encryption: the service processes uploaded documents on its server.

**Before publication:** verify the production encryption-key configuration, backup-key custody, storage permissions, share-link entropy, expiry defaults, and actual deletion/backup retention behavior.

## 5. Service providers and disclosures

SecureID relies on infrastructure and service providers to host the API/database/files, deliver verification and security email, and build/distribute the Android application. The exact legal names, roles, processing locations, and applicable transfer safeguards must be added here after the operator confirms the production Railway and email-provider configuration.

**[REQUIRED BEFORE PUBLICATION]** List each production provider, its purpose, processing location, and link to its privacy notice. Do not include Expo/EAS as a recipient of user documents unless that is actually part of runtime processing.

SecureID may disclose information where required by law, to protect users or the service from abuse, or as part of a business transfer subject to appropriate safeguards. The final wording must be reviewed for the operator's jurisdiction.

## 6. Retention and deletion

Account, session, document, share, security-event, email-provider, and encrypted-backup retention periods must be defined and disclosed before launch. The application includes account deletion and document deletion workflows, but the operator must verify what is removed immediately, what remains in encrypted backups, how long backups are retained, and when provider logs expire.

**[REQUIRED BEFORE PUBLICATION]** Add concrete retention periods for each data category, backup expiry, and the process for deletion requests.

## 7. Your choices and rights

Depending on your location, you may have rights to access, correct, export, delete, or object to certain processing of personal information. The service must provide a working contact route and respond within the applicable legal time limits. Users can manage supported security-notification preferences and revoke active sessions and shares in the app.

**[REQUIRED BEFORE PUBLICATION]** Add the verified method for submitting privacy requests and the operator's response process.

## 8. Children

**[REQUIRED BEFORE PUBLICATION]** The operator must decide whether SecureID is directed to children, the minimum permitted age, and any parental-consent process required by the target jurisdictions and Google Play declarations. Do not publish until this is settled.

## 9. Security incidents

The operator maintains technical and organizational safeguards intended to protect account and document data. No online service can guarantee absolute security. The operator must document incident response, user/regulator notification triggers, and a monitored contact channel before launch.

## 10. Changes

Material changes to this notice should be dated and communicated through the service where required by law.

---

## Mandatory operator sign-off before publication

- [ ] Legal operator name, jurisdiction, address, and monitored privacy contact supplied.
- [ ] Production domain and effective date supplied.
- [ ] Production hosting and email providers/locations verified and listed.
- [ ] Data categories, optional analytics, retention, backup expiry, and deletion behavior checked against production.
- [ ] Children/age-rating and target-audience position confirmed.
- [ ] Applicable Indian DPDP Act/rules and other target-market obligations reviewed by qualified counsel.
- [ ] Privacy request and breach-response workflows tested.
- [ ] Google Play Data safety answers reconciled against this notice and actual release binary.
