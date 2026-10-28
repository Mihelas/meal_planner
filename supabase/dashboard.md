# The settings that are not in a migration

Four things live in the Supabase dashboard rather than in `migrations/`, because
they are project configuration rather than schema. They are written down here so
a second project can be set up from scratch, and so nobody has to rediscover why
sign-in stopped working.

---

## 1. Authentication → URL Configuration

**Site URL**

```
https://pikaeats.com
```

**Redirect URLs** — add

```
https://pikaeats.com/**
```

The `**` is not decoration, even now the app sits at a domain root. GitHub Pages
serves the same page at both `https://pikaeats.com/` and
`https://pikaeats.com/index.html`, and a redirect URL without a wildcard matches
only the one spelling it was written as. When `redirect_to` does not match,
Supabase does not fail loudly — it silently redirects to the **Site URL**
instead. That is why a bad allow-list showed up as landing on
`http://localhost:3000/#error=...`: `localhost:3000` is the factory default Site
URL, and the app was never there to read the error.

For local development, add `http://localhost:4173/**` as well.

---

## 2. Authentication → Email Templates

Both templates need `{{ .Token }}` added. The code is the half of sign-in that
survives a corporate mailbox: Outlook Safe Links and scanners like it *fetch* a
link before the recipient ever sees it, which spends the one-time token. The
human then clicks a link that is already dead and is told it has expired, which
is true and useless. A code cannot be spent by something that never types it.

Two templates, not one, because which email is sent depends on whether the
address already has an account: an established one gets **Magic Link**, a
brand-new one gets **Confirm signup**. Editing only the first means the very
first sign-in of every new person is the one that fails.

### Magic Link

```html
<h2>Your meal plan</h2>

<p>Open this on the phone you want to sign in:</p>
<p><a href="{{ .ConfirmationURL }}">Sign in</a></p>

<p>Or type this code into the app:</p>
<p style="font-size:28px;letter-spacing:4px"><b>{{ .Token }}</b></p>

<p>If the link says it has expired before you ever clicked it, your email
provider opened it on the way in. Use the code instead.</p>
```

### Confirm signup

```html
<h2>Your meal plan</h2>

<p>Open this on the phone you want to sign in:</p>
<p><a href="{{ .ConfirmationURL }}">Sign in</a></p>

<p>Or type this code into the app:</p>
<p style="font-size:28px;letter-spacing:4px"><b>{{ .Token }}</b></p>
```

The app sends both verification types in turn (`email`, then `signup`) so it does
not need to know which email a given code arrived in — see `verifyCode()` in
`src/remote.js`.

---

## 3. Authentication → Sign In / Providers → Email

- **Enable email provider**: on
- **Confirm email**: on
- **Secure email change**: on (default)

Nothing else is enabled. There is no password sign-in to configure, because
there are no passwords.

---

## 4. Authentication → Emails → SMTP Settings

**Custom SMTP is not optional.** Supabase's built-in email service exists for
poking at templates, not for running anything. Two hard limits, both from
[Supabase's own SMTP docs](https://supabase.com/docs/guides/auth/auth-smtp):

- **2 messages per hour, project-wide** — not per user. Two sign-in attempts by
  anyone exhausts the hour for everybody. Supabase notes this number "can change
  without notice".
- **It only delivers to members of the project's organization team.** Any other
  address fails with *Email address not authorized*. So every person who is not
  in the Team tab simply never receives anything — no bounce, no error they can
  see, just silence.

The second one is the real blocker. Rate limits pass; a hard allow-list on
recipients does not, and no amount of waiting fixes it.

With custom SMTP configured, auth email goes to **all** addresses, and the cap
becomes a default of **30 per hour**, adjustable at
`Authentication → Rate Limits` (`/project/_/auth/rate-limits`).

We use [Resend](https://resend.com) (3,000/month free, 100/day). Per
[its SMTP docs](https://resend.com/docs/send-with-smtp):

```
Host      smtp.resend.com
Port      587
Username  resend
Password  <a Resend API key>
```

Sender address `no-reply@pikaeats.com`, sender name `Pika Eats`.

**The sender domain must be verified in Resend.** The `onboarding@resend.dev`
address is for testing only and
[delivers solely to the address that owns the Resend account](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
-- which reproduces, exactly, the Supabase limitation we are here to escape.
`pikaeats.com` is registered for this; add it under Domains → Add Domain, paste
the DNS records Resend hands you into the registrar, and wait for the status to
read verified before expecting mail to reach anyone else.

The API key is a secret. It goes in the Supabase dashboard and nowhere else --
not in this repository, not in a commit message, not pasted into a chat.

---

## What is deliberately *not* here

The publishable key and the project URL are in `src/remote.js` and ship in the
built HTML, which is what a publishable key is for. Security is the RLS policies
in `migrations/0002_rls.sql`, never the secrecy of that string. An
`sb_secret_...` key has no business anywhere in this repository.
