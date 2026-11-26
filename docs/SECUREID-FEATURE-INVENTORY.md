# SecureID feature inventory

**Last checked:** 26 November 2026  
**Source of truth:** current `main` branch and the production app at `https://secureid-production-b732.up.railway.app/`  
**Current database:** SQLite on the existing Railway `/data` volume. PostgreSQL migration is not live.

This document describes what the code currently contains and separates production features from features that still need a partner, secret, external approval or merge. A feature being present in source does not mean a user has permission to access it or that an external provider is configured.

## Production web app

### Account and security
- Account registration, sign-in and password recovery.
- Email verification and email OTP multi-factor authentication when the delivery provider is configured.
- Server-side sessions, sign-out/revocation, active-session review and account security controls.
- Security dashboard with score/summary, privacy settings and recent security activity.
- Safety Check for reviewing a website/address.
- Emergency wallet lock/unlock.
- Selective identity-share management, expiry and revocation.

### Identity and document wallet
- Identity profile and selective sharing of identity claims (including name, age, DOB, address, email, phone, SecureID/identity ID, institution/student details, masked government ID and verification status).
- Share ID links and secure document-sharing workflows; users choose the claims/documents and consent before sharing.
- Existing Document Vault: upload, list, category, search/filter, document metadata and expiry handling.
- Encrypted document storage and authenticated owner-scoped document access.
- Optional OCR preview for supported image/PDF inputs in the web Vault/SmartFill flow. OCR is text extraction only; it is not document authenticity or government verification.
- Universal SmartFill workspace: reusable identity/contact/address/education fields, manual field mapping, validation, user review and explicit consent before values are used.
- Vault OCR candidates can be reviewed and explicitly approved before they are saved as encrypted SmartFill data. OCR text is not automatically saved to the identity profile.
- SmartFill deliberately does not fill passwords, OTPs, PINs, CAPTCHA, checkboxes/radio controls or browser file-upload inputs. Third-party sites must still receive a photo/signature/document through the user's own file selection.

### School, college and family workflows
These require the appropriate active institution membership/role; they are not all shown to every ordinary account.
- School/College Management and institution membership/workspace.
- Institution admissions, student records, institution staff and academic workflows.
- Institution Management modules in the current source: Students, Staff, Academics, Finance/Fees, Homework/Assignments, Notices, Service Queue, Library, Academic Calendar, Examinations, Grievances/Helpdesk, Certificates, Reports/Exports, HR and School Posts.
- Hostel/Warden inventory and occupancy/history workflows.
- Parent Portal with authorized linked-child access to published attendance, fee, homework and result records. Parent access is read-only and requires an active link/membership.
- Student-facing Scholarship Finder: domicile/study-level filters, official Bihar PMS/Jharkhand e-Kalyan/NSP links, and a local document-readiness checklist. Students still submit on the government portal; SecureID does not submit the form.
- Partner/institution-funded scholarship publishing, applications and consented document-reference review. This is not a government scholarship submission service.

### Owner / Admin
Owner-only and MFA-protected controls include:
- User/account administration and platform health.
- Owner document administration.
- Institution partnership/readiness and evidence checks.
- Test-institution cleanup preview/execute with audit-backed completion and preservation checks.
- Monetization catalogue/ledger controls in draft/inactive mode; live charges are not enabled by this inventory.
- SecureCloud/project controls that fail closed when a real isolated deployment worker is not configured.

## Operational status and limits

| Area | Actual status |
|---|---|
| Production hosting | Railway SecureID service; latest checked deployment was successful and health endpoint returned HTTP 200 |
| Database | SQLite on the existing persistent volume |
| PostgreSQL | Read-only migration preflight and migration plan only; no live PostgreSQL service or database switch |
| Object storage | Railway bucket exists, but the app's document storage path is not yet integrated with that bucket/R2 |
| Encrypted backups | Existing encrypted backup/restore capability is present |
| Off-site scheduled backup | Workflow merged; it remains inactive until matching `SECUREID_BACKUP_TRIGGER_TOKEN` GitHub Actions secret and Railway `BACKUP_TRIGGER_TOKEN` are configured. When absent, the workflow warns and skips. Private workflow artifacts retain encrypted backup files for 7 days; they are not permanent disaster recovery. |
| Payment gateway | Razorpay integration work is not active for live collection; merchant onboarding/KYC and provider secrets are prerequisites. No payment may be treated as paid without a verified gateway event. |
| SMS OTP | MSG91 branch is not merged/activated; provider credentials and a security review are required. Email OTP remains the configured MFA path. |
| Government scholarships | Scholarship Finder and official portal handoffs are live. Students apply and submit on the official scheme portal. SecureID does not submit Bihar PMS, Jharkhand e-Kalyan or NSP forms, does not handle portal passwords/OTPs/bank credentials and does not guarantee eligibility/approval. |
| Passport photo/signature attachment | Vault can store images, but SmartFill does not auto-attach files to third-party forms. The browser requires the user to choose files on the external portal. |
| Android / Play Store | Android preview app exists; no Play Store launch or production release is claimed. |

## Pending work tracked separately
- PR #238: Scholarship Finder plus consolidated sitewide UI layer is merged. CI, CodeQL, visual smoke and owner-console checks passed; Railway deployment for commit `f3c9443f4ddd607be13e4e4d2904f4969c5ade94` succeeded.
- Issue #91: Vault roadmap items and release-readiness checks not yet completed.
- Issue #93: mobile OCR/expiry reminders are delivered, but physical-device/privacy/upgrade checks and PDF OCR remain open.
- Issue #121: monetization foundation scope remains open; real payment activation requires separate approval and provider setup.

## Change-control rule
When a feature is added, changed or removed, update the implementation, tests and this inventory in the same pull request. Mark a feature **production**, **membership/role-gated**, **provider-dependent**, **in review**, or **not implemented** accurately. Never list a draft PR or an unconfigured integration as a live production feature.
