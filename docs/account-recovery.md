# TaskFlow account recovery and email verification — PR #22

## Why this release is gated

TaskFlow uses ASP.NET Core Identity's built-in cryptographically protected
confirmation and password-reset tokens and endpoints. This change adds an
optional verified outbound email sender, a password reset UI and a signed-in
email confirmation reminder. **No emails are sent by default**, and the
public capability endpoint reports `emailDeliveryEnabled: false` until
the operator supplies a complete configuration. The UI explicitly explains
that recovery is unavailable without a sender.

Existing users retain sign-in access. Do **not** change
`IdentityOptions.SignIn.RequireConfirmedEmail` to true until all
existing users have had a working verification path and an intentional
migration/grace period. Identity's built-in `/forgotPassword` only
generates a reset token for **already confirmed** email addresses; new
users should verify their email as soon as delivery is enabled.

## Endpoints, tokens, and defenses

- Existing Identity endpoints: `POST /register`, `POST /login`,
  `POST /forgotPassword`, `POST /resetPassword`,
  `POST /resendConfirmationEmail`, `GET /confirmEmail`.
- New `GET /api/account/capabilities` exposes **only** whether delivery
  is configured, not secrets, account existence or provider details.
- Reset requests return an indistinguishable success response for
  unknown/unconfirmed addresses. The frontend repeats the same generic
  message. Invalid and replayed reset codes are rejected by Identity.
- The data protection token lifespan is two hours, and a successful
  password reset changes the user's security stamp, invalidating old
  password reset tokens. Tokens are never logged or stored in application
  tables.
- The login/registration/recovery endpoints share the existing
  per-source authentication rate limiter (20 per minute in production).
  A disposable-only Development test override is unchanged.
- Confirmation URLs from Identity are **re-anchored to a configured HTTPS
  API origin**, so untrusted Host headers cannot place attacker origins
  in outbound mail. Reset links use a configured HTTPS frontend origin
  and a URL fragment (scrubbed from the browser's history immediately).
  No tokens are included in diagnostic telemetry.
- No new database tables, external npm packages or production dependencies
  are added when delivery is disabled.

## Configuring a verified sender (separate operator action)

A real sender requires a verified domain with the email provider and
four **server-only** credentials/origin values on Render plus an explicit
delivery mode. The mode defaults to `Disabled` even when credentials are present:

```text
Email__DeliveryMode=Test
Email__TestRecipients=you@your-owned-inbox.example
Email__ResendApiKey=<secret from verified Resend account>
Email__FromAddress=TaskFlow <no-reply@your-verified-domain.example>
Email__PublicApiOrigin=https://taskflow-k63f.onrender.com
Email__FrontendOrigin=https://task-flow-pi-lake.vercel.app
```

The four provider/origin settings are required for `Test` or `Live` mode.
`Test` requires an exact allowlist of recipient mailboxes and suppresses delivery
to all other accounts. Public `/api/account/capabilities` continues to report
`emailDeliveryEnabled: false` in Test mode; the UI does not advertise account
recovery to users. After independent DNS verification, a successful test
inbox delivery and manual operator review, change `Email__DeliveryMode=Live`
in a separate approved deployment. Do not enable it automatically on a
provider status alone. Configuration is resolved eagerly at API startup;
an incomplete configuration aborts backend startup before any requests are served.
A reset link opened by an already signed-in browser also opens the recovery
screen and immediately scrubs the fragment token from the URL. Sender errors contain no
token or provider response body. Do **not** put these keys in
`VITE_*` variables, client code, GitHub Actions logs or the repository.
The provider receives the destination address and recovery link only
when sending has been explicitly enabled. Provider message retention
depends on the operator's account.

Test actual delivery to an owned mailbox before exposing the enabled
feature widely. Verify registration confirmation, resend, reset,
expired/used code rejection, unknown-account handling, authentication
rate limits and post-reset sign-in.

## Deployment / rollback

This is code-only; there is no PostgreSQL migration. The sender remains
disabled until `Email__DeliveryMode` is explicitly set to `Test` or `Live`, so existing logins and tasks are
unaffected. Verify GitHub checks and Vercel preview before merge.
After deployment, check Render health, existing login, `/api/account/capabilities`
(false), and production smoke. Do not claim real email delivery works
until a verified sender has actually been configured and tested.

In the disabled state, built-in Identity recovery endpoints still
return their standard responses, but no email is sent. Do not represent
those endpoints as usable account recovery before configuration.
