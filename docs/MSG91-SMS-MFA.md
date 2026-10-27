# MSG91 SMS MFA setup

SecureID keeps email OTP enabled and treats MSG91 SMS OTP as an optional second delivery channel.

## Required hosting secrets

Set these in the deployment secret manager (Railway/Render), not in source control:

- `MSG91_AUTH_KEY`: MSG91 account authentication key.
- `MSG91_OTP_TEMPLATE_ID`: approved MSG91 OTP template ID.

Do not paste the authentication key into chat, source files, or client-side React code. The API fails closed for SMS requests if either value is missing; email OTP continues to work.

## MSG91 account and India DLT setup

1. Create/sign in to a MSG91 account using the signup choice that accurately describes your status (individual/personal use if available). Do not invent a registered company name or submit false business details.
2. Complete the account's required identity/profile verification.
3. For Indian SMS delivery, follow MSG91's current DLT onboarding requirements. A DLT principal-entity registration, approved sender/header, and approved content template may be required before production messages are delivered. If you are an individual without a registered business, ask MSG91 support which compliant registration route they currently accept before creating a template.
4. In MSG91's OTP area, create an OTP template containing the required OTP placeholder (commonly `##OTP##`) and complete any DLT mapping that MSG91 requires.
5. Copy the OTP template ID and authentication key into the deployment secrets.
6. Redeploy/restart the API, then test with a phone number you control.

MSG91's API documentation describes sending an OTP through `POST https://control.msg91.com/api/v5/otp` with `template_id`, `mobile`, and the `authkey` header, and verifying through `GET https://control.msg91.com/api/v5/otp/verify`. Provider acceptance does not guarantee delivery; check MSG91 delivery logs if a code does not arrive.

## User flow

1. Sign in and verify using email OTP.
2. Open **Account security**, enter a phone number in international format (for India, e.g. `+91 9876543210`), send the SMS code, and verify it.
3. On later sign-ins, choose **SMS OTP** or **Email OTP**.

The phone number is not linked until MSG91 confirms the OTP. A phone number already verified on another SecureID account cannot be linked again.
