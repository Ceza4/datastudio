# Custom verification email

Supabase's built-in mailer is rate-limited to roughly **two emails per hour**
across the whole project. That is not a production constraint, it is a
development one — it is what will stop you testing two accounts in an
afternoon — and it is the reason to do this before launch rather than after.

## 1. A domain you control

All three templates below are worthless without one. A verification email sent
from a domain with no SPF, DKIM or DMARC records lands in spam, and the person
who never receives it never becomes a user. This is the single highest-leverage
thing on the list.

## 2. Resend

Chosen over Postmark and SES, and the reasoning is worth keeping because it is
not "Resend is best":

- **Postmark** has the better transactional deliverability reputation. If
  verification emails start landing in spam, switch — it is the reason to.
- **SES** is an order of magnitude cheaper at volume and considerably more work
  (sandbox removal, your own bounce and complaint handling, raw HTML
  templates). Worth it later, painful now.
- **Resend** is free to 3,000/month, and — the actual deciding factor —
  switching away from it later costs three DNS records and an SMTP credential.
  It is not a decision worth agonising over, because it is not a decision that
  locks anything in.

Sign up, add the domain, add the three DNS records it gives you, wait for
verification.

## 3. Point Supabase at it

Dashboard → **Project Settings → Authentication → SMTP Settings**:

```
Host      smtp.resend.com
Port      465
Username  resend
Password  <your Resend API key>
Sender    noreply@yourdomain
Name      DataStudio
```

Saving this also **lifts the two-per-hour limit**, which is the immediate
practical win.

## 4. Paste the templates

Dashboard → **Authentication → Email Templates**. One per file here.

Supabase substitutes `{{ .ConfirmationURL }}`, `{{ .Email }}` and friends.
Everything else is ordinary HTML — inline styles only, because email clients
strip `<style>` blocks, and no external images, because most clients block
them by default and a template whose only content is a blocked image reads as
a blank message.

## What these templates deliberately do NOT do

- **No tracking pixel.** You are asking researchers to trust you with
  unpublished work; a beacon in the email that confirms their address is a
  strange first impression.
- **No "click here".** The button and the fallback plain URL both say where
  they go. Phishing training has taught people to distrust anonymous links, and
  a verification email is the one message you most need them to trust.
- **They state the expiry.** A link that silently stops working is a support
  ticket; a link that said it lasts an hour is a person who requests a new one.
