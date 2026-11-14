# SecureID

SecureID is a React/Vite identity-wallet interface with an Express API. The local setup is intended for development and product iteration; production email delivery and deployment secrets must be configured before real users are onboarded.

## Local development

Use Node.js 24 or newer. Copy `.env.example` to `.env` and fill `SESSION_HASH_SECRET` and `OTP_HASH_SECRET` with separate random values of at least 32 characters. Keep these values stable between runs; they let the API validate stored session and OTP hashes after it restarts. Then run the API and frontend in separate terminals:

```powershell
npm run dev:api
npm run dev
```

Open `http://127.0.0.1:5173`. The API persists accounts, sessions, OTP challenges, and rate-limit counters in `data/secureid.sqlite`. Passwords are hashed with bcrypt. The example `.env` keeps the API runnable in local `OTP_DELIVERY=console` mode, but email OTP delivery fails closed until an email provider is configured. Codes are never written to logs or returned by the API.

To use MFA locally or in production, select an email provider explicitly with `OTP_DELIVERY`. For SMTP, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `OTP_FROM_EMAIL`; for Resend, configure `RESEND_API_KEY` and `OTP_FROM_EMAIL`; for Brevo API, configure `BREVO_API_KEY` and `OTP_FROM_EMAIL`. The API refuses to start when the selected provider is missing required settings. Resend's `onboarding@resend.dev` sender is suitable only with its test recipient `delivered@resend.dev`; real users require an `OTP_FROM_EMAIL` on a domain verified in Resend. A `resend.dev` sender is reported as test-only and cannot be used for production OTP delivery. `OTP_RESEND_COOLDOWN_SECONDS` controls the per-account resend cooldown (default 60 seconds).

## Production configuration

Production startup deliberately fails closed unless `SESSION_HASH_SECRET`, `OTP_HASH_SECRET`, and a fully configured `OTP_DELIVERY` provider are set. In addition, production document storage requires `DOCUMENT_ENCRYPTION_KEY`, and encrypted backups require `BACKUP_ENCRYPTION_KEY`. Configure `APP_ORIGIN` as the exact frontend origin allowed by CORS, `DATABASE_PATH` to durable protected storage, and `TRUST_PROXY_HOPS` to the actual trusted proxy count. The frontend uses `/api`; route it through a same-origin or same-site HTTPS reverse proxy. Use HTTPS, durable encrypted backups, monitoring, and a deployment secret manager. Never commit `.env`, credentials, or database files.

Generate independent 32-byte base64 keys (run twice, using a different result each time) with Node.js:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Set one result as `DOCUMENT_ENCRYPTION_KEY` and the other as `BACKUP_ENCRYPTION_KEY` in the hosting secret manager. Do not use the example file itself as a source of real secrets, and do not rotate the document key without a planned re-encryption migration. Losing the document key can make stored files permanently unreadable; losing the backup key can make encrypted backups unrestorable.

The current storage is single-instance SQLite. For a horizontally scaled deployment, migrate the repository to a managed PostgreSQL database and use shared/distributed rate limiting before adding replicas. Email verification, password recovery, trusted-device/session management, account export/deletion, security email alerts, encrypted automated backups, and privacy-safe operational error alerting are implemented. Production onboarding should still include a managed PostgreSQL migration before horizontal scaling and an independent security review.

### Off-site encrypted backup vault

The private repository dubeyjii91/secureid-backup-vault owns the daily 09:25 Asia/Kolkata backup schedule. It authenticates to Railway using BACKUP_TRIGGER_TOKEN, creates a new AES-256-GCM encrypted snapshot, verifies its SHA-256 against the download response, and stores only the encrypted file in a private GitHub Actions artifact. The encryption key remains in Railway and is never copied to GitHub. See docs/SECUREID-OFFSITE-BACKUP.md for retention and restore steps.
## Security and release documentation

- [Security policy and responsible disclosure](SECURITY.md)
- [Production security test plan and release evidence checklist](docs/SECURITY-TEST-PLAN.md)
- [Threat model and residual risks](docs/THREAT-MODEL.md)
- [Android production release runbook](docs/ANDROID-RELEASE.md)
- [Google Play listing draft](docs/PLAY-STORE-LISTING-DRAFT.md)
- [Privacy policy release draft — not yet approved for publication](docs/PRIVACY-POLICY-RELEASE-DRAFT.md)

## Project checks

```powershell
npm run lint
npm run build
```


## Institution partnership and subscription payments

The owner-only Institution Partnership panel tracks institution identity evidence, representative authority, signed agreements, subscription payment, and technical connection as separate checks. An AISHE code or a college name is not proof of partnership. Operators must independently compare institution details against official records and retain a non-sensitive evidence reference.

For paid institution plans, SecureID can create Razorpay Payment Links from the saved subscription amount. Configure the following server-side secrets in the deployment environment (never in Vite/browser variables):

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

In the Razorpay Dashboard, configure the HTTPS webhook endpoint `https://YOUR_SECUREID_DOMAIN/api/webhooks/razorpay` and subscribe to `payment_link.paid`. Use test-mode credentials and a test webhook secret for integration testing first. SecureID verifies the webhook HMAC over the exact raw request body, checks the INR amount against the stored payment link, processes duplicate events idempotently, and only then marks the payment verified and reactivates the institution subscription. A browser redirect or manually entered transaction reference does not activate paid access.

Razorpay merchant onboarding/KYC and live credentials are external prerequisites. AISHE institution identity and representative legal authority still require independent verification; this repository does not claim access to a public AISHE verification API. API/ERP connection status must not be marked connected until a real institution endpoint has been configured and data exchange tested.
