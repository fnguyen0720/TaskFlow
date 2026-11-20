# TaskFlow verified sending domain — staged rollout

## Safe-by-default sequence

1. **Select a domain actually controlled by the TaskFlow operator.**
   Prefer a dedicated transactional subdomain, such as
   `mail.example.com`. Do not change the apex domain's existing MX,
   SPF or other mail records. Do not use the Vercel-generated
   `vercel.app` name as a verified sender.
2. In **Resend → Domains**, add that owned sending domain with the
   sending capability enabled. Add the *exact* DKIM and SPF
   verification records that Resend displays in the domain's authoritative
   DNS zone. Add or review DMARC for the sending domain; do not overwrite
   existing unrelated records. The record values and hostnames vary by
   domain. Verify status is **verified for sending**, not merely for
   receiving, in Resend and double-check DNS propagation.
3. Use a provider API key restricted to email sending, stored only in
   Render server environment variables. Do not paste keys into GitHub
   issues, ChatGPT, browser developer tools, or `VITE_*` variables.
4. In Render, configure `Email__DeliveryMode=Test` plus
   `Email__TestRecipients=your-owned-mailbox@example.com`.
   Configure the four existing email settings: `Email__ResendApiKey`,
   `Email__FromAddress`, `Email__PublicApiOrigin`, and
   `Email__FrontendOrigin`. `Email__FromAddress` must use the
   verified sending domain. The public API origin is
   `https://taskflow-k63f.onrender.com`, and frontend origin is
   `https://task-flow-pi-lake.vercel.app`.
5. Deploy only after the staged configuration passes CI. Check that
   `GET /api/account/capabilities` returns
   `{"emailDeliveryEnabled":false}` in Test mode.
   Unallowlisted recipients must not generate provider requests.
6. On a **disposable confirmed-email test account using an owned inbox**,
   verify signup confirmation, resend, and password reset with a real
   delivery. Inspect provider delivery status and inbox receipt. Check
   wrong-address handling, used-token replay rejection, and reset-to-login.
   Verify the reset link uses the trusted app origin and that browser
   history promptly loses its fragment. Never use or reset someone else's
   account for acceptance testing.
7. Record provider and DNS verification results, number of test messages,
   and post-delivery smoke results. Review CORS allowlists, auth rate limits,
   upstream provider sending caps, provider error rates, and cost/quota
   alerts. No production user account changes are required during staging.
8. **Only after these checks pass**, set `Email__DeliveryMode=Live`
   in a separately approved operator action. Recheck the public
   capability, successful recovery of a controlled account, production
   smoke and monitoring. Leave mandatory confirmation at login disabled
   until legacy accounts have a verification path and grace period.

## Safeguards enforced by the application

- **Disabled** (default): never sends, even if credentials exist.
- **Test**: only addresses explicitly named in
  `Email__TestRecipients` can be sent mail. All other deliveries are
  silently suppressed, preserving account enumeration protection; public
  recovery capability stays false.
- **Live**: intentional operator-only activation, never inferred from
  the presence of a key. This is not a substitute for DNS verification.
- The existing auth endpoint group is rate-limited by trusted client IP.
  Link hosts are pinned to configured HTTPS origins; reset tokens use a
  URL fragment; provider error responses and tokens are not logged.
- Provider requests include an HMAC-based idempotency key scoped to the
  exact sender, recipient, subject and message content. Resend retains
  idempotency keys for approximately 24 hours; this protects retries of
  the same request, not separate reset-link generations.
- Provider HTTP timeout is bounded; non-2xx responses fail safely.

## Rollback

Return `Email__DeliveryMode=Disabled` and redeploy. This requires no
database migration, password resets, account locks or DNS deletion.
Do not remove email authentication DNS records without reviewing other
systems that may rely on them.
