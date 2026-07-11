# Email Sending for Chiron

> **TL;DR.** Use **Resend** as the email provider, wired into Supabase Auth as a custom SMTP server. The free tier covers 3,000 emails a month with a 100/day cap, which is plenty for a nonprofit event app in its first year. Supabase's official "Send Email Auth Hook" template also ships a ready-made Resend example if you ever want React Email templates inside auth flows.

## The free-tier shortlist for 2026

Eight providers still publish a free transactional tier in 2026, but most cap volume so low they're effectively trial plans. The ones worth a real look for a small community app:

- **Resend** — 3,000 emails/month, 100/day hard cap, one verified domain [1].
- **Brevo** — 300 emails/day on the free tier, no published monthly cap [2].
- **Mailgun** — 100 emails/day, no rollover, one custom domain [3].
- **Twilio SendGrid** — 100 emails/day forever, no overage path on the free plan [4].
- **Amazon SES** — 3,000 messages/month free for 12 months under the legacy model, or $200 in AWS credits under the July 2025 free-tier program; new accounts also start in the SES sandbox at 200/day to verified recipients only [5][6].
- **Postmark** — 100 emails/month, "doesn't expire" but explicitly designed for testing [7].
- **MailerSend** — 500 emails/month, but the API is gated behind the $5.60 Hobby tier [8].
- **SMTP2GO** — 1,000 emails/month with a 200/day cap that drops to 25/hour until you verify a domain [9].

Resend is the only one that combines a free quota large enough for production with a recent SDK and a Supabase-native integration path. The rest sit at "good for a side project, painful as a real app."

## How Supabase wants to send email

Supabase Auth ships with a built-in email sender that handles sign-up confirmations, magic links, and password resets out of the box. It uses an address Supabase owns (`noreply@mail.app.supabase.io`) and renders Go-template emails you can edit in the dashboard [10]. Two restrictions make this default a dead end for production.

The built-in sender only delivers to addresses inside your Supabase organization, and it caps volume at 2 emails per hour — a value Supabase says "can change at any time without notice" [11][12]. The official docs recommend every other customer plug in a custom SMTP provider, and the recommended list leads with **Resend**, followed by SES, Postmark, SendGrid, ZeptoMail, and Brevo [11].

You can go one of two ways:

1. **Point Supabase at a custom SMTP server** (one-time dashboard config). All auth emails go through that server using Supabase's editable Go templates.
2. **Use the Send Email Auth Hook** to take over rendering. The hook fires on each auth email event and lets you reply with the rendered email — useful if you want React Email templates, regional provider routing, or provider features (S/MIME, attachments) that SMTP can't express [13].

For Chiron's scope — auth emails plus a handful of event notifications — path #1 is enough. You get Supabase's templates for free and only reach for the hook when a specific email needs a custom design.

## Why Resend is the right pick

Resend was built by the team that created React Email, and its Next.js integration is one short file. The Node SDK is official, TypeScript-native, and works in both Next.js Server Actions and Route Handlers [14][15]. One line item that mattered for the comparison: Resend's SDK is the only one of the eight providers with a first-party Supabase Send Email Auth Hook example published in the official Supabase docs.

The free tier specifics that matter for Chiron:

- 3,000 emails per month with a hard 100/day cap. The daily limit trips before the monthly one, so a viral event listing can briefly starve you out, but for steady traffic at a nonprofit this is plenty [1].
- One verified domain, so you'd send from something like `hello@chiron.app`.
- 30-day retention on sending logs, webhooks, and tracking — no enterprise features hidden behind the paywall.

There's also a **one-click Supabase integration** in the Resend dashboard that pre-fills the SMTP settings: `smtp.resend.com`, port 465, username `resend`, password = your API key [16][17]. That's the lowest-friction path to "Supabase auth emails, from my domain" — no JSON patching, no manual wiring.

If Chiron qualifies as a verified nonprofit, **MailerSend offers a 30% discount on paid plans** [8]. That's a future negotiation, not a reason to pick them today — their free tier still gates the API behind a paid plan.

## Wiring it up: the two minimal moves

You need two things: a Resend account with a verified domain, and the SMTP settings in Supabase pointed at Resend.

**1. Verify your domain in Resend.** Add the DKIM, SPF, and DMARC records Resend shows you in the dashboard to your DNS provider. Once verified, Resend signs your emails so they pass Gmail and Outlook spam filters.

**2. Configure Supabase Auth to send through Resend.** In the Supabase dashboard go to **Authentication → Sign In / Up → SMTP Settings**, enable custom SMTP, and fill in [11]:

```json
{
  "smtp_host": "smtp.resend.com",
  "smtp_port": 465,
  "smtp_user": "resend",
  "smtp_pass": "<RESEND_API_KEY>",
  "smtp_admin_email": "hello@chiron.app",
  "smtp_sender_name": "Chiron"
}
```

After that, every Supabase auth email (confirmations, magic links, password resets, invites) flows through Resend using your domain and the templates you edit in the Supabase dashboard. No code changes required.

## Sending a custom email from the Next.js app

For non-auth emails — "your event was published," "you RSVP'd to X" — call the Resend SDK from a Next.js Route Handler or Server Action. Minimal sketch [14]:

```ts
// app/api/notify/route.ts
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  const { to, subject, html } = await req.json();

  const { data, error } = await resend.emails.send({
    from: 'Chiron <hello@chiron.app>',
    to,
    subject,
    html,
  });

  if (error) return Response.json({ error }, { status: 500 });
  return Response.json(data);
}
```

The same `Resend` instance works in a Server Action — call `resend.emails.send()` from any `'use server'` function and let Next.js handle the transport. If you want React Email components instead of raw HTML, install `@react-email/components` and pass `react: <MyTemplate />` instead of `html` [15][18].

Store `RESEND_API_KEY` in `.env.local` and add it to Vercel's environment variables when you deploy. The API returns `{ data, error }` instead of throwing on API-level errors, so the explicit `if (error)` branch is the right pattern [14].

## When to revisit

Stay on the free tier until one of these comes up:

- **The 100/day cap fires.** That's the daily ceiling, not the monthly one. A single big event push can saturate it; if you start seeing queued or dropped emails, you're at the wall.
- **You send more than 3,000 emails in a month.** Resend's first paid tier is $20/mo for 50,000 emails, roughly 17× the free quota [1].
- **You need branded tracking links, longer log retention, or dedicated IPs.** All gated behind Pro ($20/mo) or Scale ($90/mo) [1].
- **You want richer auth emails.** Move from the SMTP path to the **Send Email Auth Hook** and render React Email templates inside a Supabase Edge Function that calls `resend.emails.send()` directly [19][20].

Don't switch providers just because the daily cap stings once. The SMTP path is the cheapest way to ship, and only the trigger volume of a real campaign justifies leaving Resend.

## References

1. Resend. "Pricing." https://resend.com/pricing. Accessed 2026-07-11.
2. Brevo. "Pricing Plans." https://www.brevo.com/pricing. Accessed 2026-07-11.
3. Mailgun. "Mailgun Send Pricing." https://www.mailgun.com/pricing/. Accessed 2026-07-11.
4. Twilio SendGrid. "SendGrid Email API Pricing." https://www.twilio.com/en-us/products/email-api/pricing. Accessed 2026-07-11.
5. Amazon Web Services. "Amazon SES Pricing." https://aws.amazon.com/ses/pricing/. Accessed 2026-07-11.
6. Amazon Web Services. "Sandbox." https://docs.aws.amazon.com/ses/latest/dg/sandbox.html. Accessed 2026-07-11.
7. Postmark. "Postmark Pricing and Free Trial." https://postmarkapp.com/pricing. Accessed 2026-07-11.
8. MailerSend. "Pricing." https://www.mailersend.com/pricing. Accessed 2026-07-11.
9. SMTP2GO. "SMTP2GO Pricing." https://www.smtp2go.com/pricing. Accessed 2026-07-11.
10. Supabase. "Email Templates." https://supabase.com/docs/guides/auth/auth-email-templates. Accessed 2026-07-11.
11. Supabase. "Send emails with custom SMTP." https://supabase.com/docs/guides/auth/auth-smtp. Accessed 2026-07-11.
12. Supabase. "Rate limits." https://supabase.com/docs/guides/auth/rate-limits. Accessed 2026-07-11.
13. Supabase. "Send Email Hook." https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook. Accessed 2026-07-11.
14. Resend. "Send emails with Next.js." https://resend.com/docs/send-with-nextjs. Accessed 2026-07-11.
15. React Email. "Send email using Resend." https://react.email/docs/integrations/resend. Accessed 2026-07-11.
16. Supabase Partners. "Resend." https://supabase.com/partners/integrations/resend. Accessed 2026-07-11.
17. Resend. "Get Started with Resend and Supabase." https://resend.com/docs/knowledge-base/getting-started-with-resend-and-supabase. Accessed 2026-07-11.
18. Resend. "resend – Node.js SDK." https://www.npmjs.com/package/resend. Accessed 2026-07-11.
19. Supabase. "Custom Auth Emails with React Email and Resend." https://supabase.com/docs/guides/functions/examples/auth-send-email-hook-react-email-resend. Accessed 2026-07-11.
20. Resend Blog. "How to configure Supabase to send emails from your domain." https://resend.com/blog/how-to-configure-supabase-to-send-emails-from-your-domain. Accessed 2026-07-11.