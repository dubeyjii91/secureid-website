# SecureID

SecureID is a React/Vite identity-wallet interface with an Express API. The local setup is intended for development and product iteration; production email delivery and deployment secrets must be configured before real users are onboarded.

## Local development

Use Node.js 24 or newer. Copy `.env.example` to `.env` and fill `SESSION_HASH_SECRET` and `OTP_HASH_SECRET` with separate random values of at least 32 characters. Keep these values stable between runs; they let the API validate stored session and OTP hashes after it restarts. Then run the API and frontend in separate terminals:

```powershell
npm run dev:api
npm run dev
```

Open `http://127.0.0.1:5173`. The API persists accounts, sessions, OTP challenges, and rate-limit counters in `data/secureid.sqlite`. Passwords are hashed with bcrypt. The example `.env` keeps the API runnable in local `OTP_DELIVERY=console` mode, but OTP delivery fails closed until Resend is configured. Codes are never written to logs or returned by the API.

To use MFA locally or in production, set `OTP_DELIVERY=resend`, `RESEND_API_KEY`, and `OTP_FROM_EMAIL` in `.env` or the deployment secret manager. The API refuses to start in email mode until both provider values are configured. For a provider smoke test, Resend's `onboarding@resend.dev` sender is suitable only with its test recipient `delivered@resend.dev`; it is not a way to send OTPs to real users. Real users require an `OTP_FROM_EMAIL` on a domain verified in your Resend account. Production startup rejects `resend.dev` senders. `OTP_RESEND_COOLDOWN_SECONDS` controls the per-account resend cooldown (default 60 seconds).

## Production configuration

Production startup deliberately fails closed unless `SESSION_HASH_SECRET`, `OTP_HASH_SECRET`, `OTP_DELIVERY=resend`, `RESEND_API_KEY`, and `OTP_FROM_EMAIL` are set. Configure `APP_ORIGIN` as the exact frontend origin allowed by CORS, `DATABASE_PATH` to durable protected storage, and `TRUST_PROXY_HOPS` to the actual trusted proxy count. The frontend uses `/api`; route it through a same-origin or same-site HTTPS reverse proxy. Use HTTPS, durable encrypted backups, monitoring, and a deployment secret manager. Never commit `.env`, credentials, or database files.

The current storage is single-instance SQLite. For a horizontally scaled deployment, migrate the repository to a managed PostgreSQL database and use shared/distributed rate limiting before adding replicas. Email verification, password recovery, trusted-device/session management, account export/deletion, security email alerts, encrypted automated backups, and privacy-safe operational error alerting are implemented. Production onboarding should still include a managed PostgreSQL migration before horizontal scaling and an independent security review.

## Project checks

```powershell
npm run lint
npm run build
```
