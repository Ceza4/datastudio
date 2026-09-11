'use client'

import { useTheme } from '../providers'
import { makeColors } from '../../lib/theme'

/*
  app/pricing/page.js
  --------------------------------------------------------------------------
  Three tiers, and no checkout button that does not work.

  THE "UPGRADE" BUTTON IS AN EMAIL LINK, ON PURPOSE. Billing is not wired —
  there is no Stripe account, no webhook, no subscriptions row being written by
  anything. A button that opened a checkout that did not exist would be the
  same class of lie the login form used to tell with its setTimeout, and this
  time it would be about money.

  When billing lands, this page changes and nothing else does: `subscriptions`
  is already the authority on entitlement (migration 0004), the webhook writes
  it as the service role, and org_plan() reads it. The plumbing is finished;
  the payment provider is the missing part.

  THE NUMBERS ARE THE ONES IN THE `plans` TABLE. If they disagree, the table is
  right and this page is stale — it is marketing copy, not a source of truth,
  and quota is enforced against the table by triggers.
  -------------------------------------------------------------------------- */

const TIERS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    cadence: '',
    line: 'Everything, on one computer.',
    points: [
      'The whole editor — no feature is behind a plan',
      'Unlimited projects, stored in your browser',
      'Nothing leaves this device',
      'Export whenever you like',
    ],
    /* Said plainly rather than buried. The single most likely support ticket
       from a free user is "I cleared my browser and lost my work", and the
       only honest defence against it is having told them here, in the place
       where they chose this tier. */
    caveat: 'Your browser is the only copy. Clear it, or switch machines, and the work does not follow.',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$12',
    cadence: '/month',
    line: 'Your work, on every machine you use.',
    points: [
      'Everything in Free',
      '50 GB of files — images, PDFs, attachments',
      '2 GB of documents',
      'Up to 250 MB per file',
      'Sync across devices, with conflict copies rather than lost work',
      '30-day recovery bin',
    ],
    featured: true,
  },
  {
    id: 'max',
    name: 'Max',
    price: '$32',
    cadence: '/month',
    line: 'For a library that outgrew a laptop.',
    points: [
      'Everything in Pro',
      '250 GB of files',
      '20 GB of documents',
      'Up to 1 GB per file',
      'Priority support',
    ],
  },
]

/* WHY THIS IS AN ENVIRONMENT VARIABLE AND NOT A STRING.

   It used to be a hardcoded `hello@datastudio.app`, which was invented while
   writing this page and belongs to nobody. A support address that bounces is
   worse than no support address: the person who clicks it believes they have
   asked for something, and then waits.

   So the address is configuration. Set NEXT_PUBLIC_CONTACT_EMAIL when a real
   mailbox exists (see SUPABASE_SETUP.md § contact address) and the button
   appears; leave it unset and the tier reads "Not on sale yet", which is
   accurate while there is no payment provider anyway.

   NEXT_PUBLIC_ means this is inlined into the client bundle at build time —
   correct for a public address, and a reminder never to put a secret behind
   that prefix. */
const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL || ''

export default function Pricing() {
  const { dark } = useTheme()
  const t = makeColors(dark)

  return (
    <main style={{
      minHeight: '100vh', background: t.base, color: t.text,
      fontFamily: 'var(--ds-font-body)', padding: '56px 24px',
    }}>
      <div style={{ maxWidth: 940, margin: '0 auto' }}>
        <a href="/app" style={{ fontSize: 13, color: t.text3, textDecoration: 'none' }}>← Back</a>

        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.4, margin: '18px 0 6px' }}>
          Plans
        </h1>
        <p style={{ fontSize: 14, color: t.text2, margin: '0 0 34px', lineHeight: 1.6, maxWidth: 560 }}>
          Every plan has the whole editor. What you pay for is storage and sync —
          not features held hostage.
        </p>

        <div style={{
          display: 'grid', gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        }}>
          {TIERS.map(tier => (
            <div key={tier.id} style={{
              background: t.surface,
              border: `1px solid ${tier.featured ? t.accent : t.border}`,
              borderRadius: 12, padding: 22,
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: tier.featured ? t.accent : t.text2 }}>
                {tier.name}
              </div>
              <div style={{ margin: '10px 0 4px', display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: -1 }}>{tier.price}</span>
                <span style={{ fontSize: 13, color: t.text3 }}>{tier.cadence}</span>
              </div>
              <p style={{ fontSize: 13, color: t.text2, margin: '0 0 16px', lineHeight: 1.5 }}>{tier.line}</p>

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', flex: 1 }}>
                {tier.points.map(p => (
                  <li key={p} style={{
                    fontSize: 13, color: t.text2, lineHeight: 1.5,
                    padding: '4px 0 4px 16px', position: 'relative',
                  }}>
                    <span aria-hidden style={{ position: 'absolute', left: 0, color: t.accent }}>·</span>
                    {p}
                  </li>
                ))}
              </ul>

              {tier.caveat && (
                <p style={{ fontSize: 12, color: t.text3, lineHeight: 1.5, margin: '0 0 14px' }}>
                  {tier.caveat}
                </p>
              )}

              {tier.id === 'free' ? (
                <a href="/app" style={{
                  display: 'block', textAlign: 'center', padding: '10px 0', borderRadius: 8,
                  border: `1px solid ${t.border}`, color: t.text2, fontSize: 13, textDecoration: 'none',
                }}>Current plan</a>
              ) : CONTACT ? (
                <a href={`mailto:${CONTACT}?subject=${encodeURIComponent(`${tier.name} plan`)}`}
                  style={{
                    display: 'block', textAlign: 'center', padding: '10px 0', borderRadius: 8,
                    background: tier.featured ? t.accent : 'transparent',
                    border: `1px solid ${tier.featured ? t.accent : t.border}`,
                    color: tier.featured ? '#fff' : t.text2,
                    fontSize: 13, fontWeight: 600, textDecoration: 'none',
                  }}>Get in touch</a>
              ) : (
                <div style={{
                  textAlign: 'center', padding: '10px 0', borderRadius: 8,
                  border: `1px dashed ${t.border}`, color: t.text3, fontSize: 13,
                }}>Not on sale yet</div>
              )}
            </div>
          ))}
        </div>

        <p style={{ fontSize: 12, color: t.text3, marginTop: 26, lineHeight: 1.6, maxWidth: 560 }}>
          Card payments aren&apos;t switched on yet, so upgrading is
          {CONTACT ? ' a conversation for now.' : ' not possible yet.'} Nothing is ever deleted for non-payment — if a subscription lapses,
          existing work keeps syncing down and only new uploads wait.
        </p>
      </div>
    </main>
  )
}
