# College pilot workflow

## What this release adds

- An authenticated College Pilot page for recording institutional interest.
- A limited form for institution name, submitter role, approximate student population, workflow interests, and a short non-sensitive note.
- An account-scoped API: `GET /api/college-pilot/requests` and `POST /api/college-pilot/requests`.
- Request payloads are encrypted using the existing production-features encryption key before being stored in SQLite.
- Requests are visible only to the signed-in account that created them. Routes require the existing MFA-verified session, and writes use same-origin protection.
- The page explicitly warns users not to submit student identity numbers, documents, OTPs, or other sensitive data.

## Important product boundaries

This is an interest-capture foundation, not a full college administration portal. It does not yet provide college tenant accounts, staff invitations, review queues, document access delegation, service-level agreements, payments, or verified institutional partnerships. The UI labels these as future workflow capabilities instead of claiming they are live.

The current pilot request is not a paid subscription and does not automatically contact or promise a response from a college. It records the interest for the account owner to review. Before inviting institutions to use real student data, implement and independently test tenant isolation, institutional staff roles, consent and retention controls, audit events, deletion, operational support, and a legally reviewed data-processing agreement.

## Suggested commercial validation

1. Use this page to capture non-sensitive pilot interest.
2. Interview a small number of colleges about onboarding, document review, and follow-up pain points.
3. Build the institution-side review queue only after agreeing on a real pilot workflow and data responsibilities.
4. Test willingness to pay with a written pilot offer before publishing pricing.
5. Keep student access free initially; charge institutions only for validated administrative workflow and support value.

Never sell student identity data or describe saved documents as government-verified. Government verification requires a separate authorized provider integration and explicit, appropriate consent.
