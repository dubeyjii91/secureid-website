# SecureID Production Deployment Checklist

This checklist is a release gate, not a statement that production is already configured. Complete it for the exact target environment before merging or deploying security-sensitive changes.

## 1. Release and source

- [ ] Review the pull request diff and all changed files.
- [ ] Confirm CI is green for the exact commit intended for release (dependency audit, Trivy, build, lint, tests, backup/restore smoke test, and CodeQL).
- [ ] Confirm the deployment service is connected to the intended repository and branch.
- [ ] Confirm the release commit and rollback deployment are recorded.
- [ ] Deploy to a staging environment first when one is available.

## 2. Required production configuration

Set secrets in the hosting provider's secret/variable manager. Never commit secret values or paste them into issues, chat, or logs.

- [ ] `NODE_ENV=production`
- [ ] `APP_ORIGIN` is the exact HTTPS origin users access.
- [ ] `SESSION_HASH_SECRET` is a randomly generated secret with at least 32 bytes of entropy.
- [ ] `OTP_HASH_SECRET` is a separate randomly generated secret with at least 32 bytes of entropy.
- [ ] `DOCUMENT_ENCRYPTION_KEY` is a base64-encoded 32-byte key. Back it up securely; losing it can make stored documents unreadable.
- [ ] `BACKUP_ENCRYPTION_KEY` is a separately generated base64-encoded 32-byte key. Store it separately from backup files.
- [ ] Configure one supported real email delivery provider (`resend`, `smtp`, or `brevo`) and verify sender/domain configuration before relying on email OTP.
- [ ] Configure `DATABASE_PATH` and `DOCUMENT_STORAGE_PATH` to persistent storage paths appropriate for the host.
- [ ] Set `TRUST_PROXY_HOPS` only to the number of trusted reverse-proxy hops in front of the app; do not guess this value.
- [ ] Confirm the production database and document storage are on persistent volumes and survive a redeploy.

## 3. Privacy and security checks

- [ ] HTTPS works and the application is not exposed over an unintended plain-HTTP origin.
- [ ] Sign-up, email verification, sign-in, MFA, recovery codes, password reset, logout, and session revocation work end-to-end.
- [ ] A user cannot list, download, delete, or share another user's documents.
- [ ] Shared document links expire and can be revoked; responses are non-cacheable.
- [ ] Verify rate limits and lockouts using controlled test accounts, not real users' accounts.
- [ ] Verify security notifications are delivered without logging OTPs, passwords, bearer tokens, or document contents.
- [ ] Do not enable real PAN/Aadhaar authenticity claims until an authorized provider and compliant integration are in place. File integrity checks are not identity verification.

## 4. Backup, restore, and recovery

- [ ] Create an encrypted backup with production-like data in a controlled environment.
- [ ] Restore the backup into isolated storage using the matching backup key.
- [ ] Verify the restored SQLite database and encrypted document blobs are readable by the application with the matching document-encryption key.
- [ ] Record backup location, retention policy, access permissions, and recovery owner.
- [ ] Keep backup encryption keys separate from the backup storage.
- [ ] Confirm rollback steps do not discard newer user data or mix SQLite files with stale WAL/SHM sidecars.

## 5. Post-deploy verification

- [ ] Check `/api/health/ready` and confirm database and document storage are ready.
- [ ] Test a new account using a non-sensitive test email and verify the email/MFA path.
- [ ] Upload, download, share, revoke, and delete a synthetic test document.
- [ ] Confirm logs contain no secrets or personal document data.
- [ ] Review runtime logs, HTTP 5xx rate, latency, and resource usage after release.
- [ ] Record the deployed commit SHA and rollback target.

**Release rule:** a green CI run alone does not prove the hosting environment, secret configuration, persistent storage, domain, email delivery, or production recovery path is correct. Do not describe SecureID as production-ready until the applicable checks above have been performed and evidenced.
