# SecureID Mobile (Android-first, iOS-ready)

This is the first native app foundation in the existing SecureID repository. It uses React Native, Expo Router, TypeScript, and native platform components. The website and API remain unchanged.

## Prerequisites

- Node.js compatible with the selected Expo SDK
- npm
- Expo Go for quick UI preview, or Android Studio/emulator for native testing
- For iOS simulator/device builds, macOS/Xcode or an EAS cloud build

## Run locally

From the repository root:

```powershell
cd mobile
npm install
npx expo start
```

Press `a` for Android (Android Studio/emulator must be installed) or scan the QR code with Expo Go. To create installable development/production builds later, configure EAS Build after the API integration and app identifiers are reviewed.

## Current scope

- Native SecureID dashboard and navigation
- Document-vault, secure-sharing, and security-center screen foundations
- Native document picker for choosing a local test file; selection does **not** upload the file
- Expo SecureStore and local-authentication packages included for later integration
- Clear UI warnings where backend actions are not yet connected

## Required before real accounts or documents

The current Express API is designed around browser cookies and CSRF validation. Native app login/session support must be designed explicitly before enabling authenticated mobile API calls. Do not disable CSRF checks or weaken same-origin protections just to make mobile requests work. Preferred next step is a reviewed native-auth design using short-lived, revocable credentials (or a secure cookie bridge with tested native cookie handling), CSRF/origin protections appropriate to each client, server-side authorization on every document/share operation, and rate limiting.

Then implement and test:
1. Login, registration, email verification, MFA and logout.
2. API client and secure token/session storage.
3. Document upload/download with server-side type/size validation and private storage.
4. Selected-claim sharing, expiry and server-side revocation.
5. Device sessions, security activity, account recovery/deletion.
6. Unit/integration tests and Android device tests; iOS verification before release.

No production API URL, credentials, secrets, or user data are embedded in this scaffold. Do not upload real identity documents until the native authentication and document-access path has passed security testing.
