'use client'

import { useTheme } from './providers'

/* ══════════════════════════════════════════════════════════════════
   DataStudio landing page — reconciliation wedge positioning

   Sections (top to bottom):
   1. Nav
   2. Hero — tagline + visual Crosscheck mockup + CTA
   3. Problem — 3 concrete scenarios with hours wasted
   4. How it works — 3 visual steps
   5. Before / After comparison
   6. Who it's for — 3 personas
   7. Pricing
   8. FAQ
   9. Final CTA + footer

   All positioning targets sales ops / CRM managers / business users.
   No mention of notebooks on the landing page — that's the expansion
   story, not the wedge.
   ══════════════════════════════════════════════════════════════════ */

export default function Home() {
  const { dark, setDark } = useTheme()

  const t = {
    base:      dark ? '#1A1917' : '#F5F3EE',
    surface:   dark ? '#201F1C' : '#EDEAE3',
    raised:    dark ? '#262522' : '#E4E1D8',
    border:    dark ? '#2E2D29' : '#D5D1C7',
    text:      dark ? '#E8E6E1' : '#1A1917',
    text2:     dark ? '#9A9790' : '#6B6860',
    text3:     dark ? '#5A5955' : '#A09D97',
    accent:    dark ? '#5B5FE8' : '#1D9E75',
    accentDim: dark ? '#2a2d6e' : '#E1F5EE',
    accentText:dark ? '#a5a8f5' : '#0F6E56',
    amber:     '#E8B85B',
    green:     '#4ade80',
    red:       '#f87171',
  }

  const btnPrimary = {
    background: t.accent, color: 'white', border: 'none',
    borderRadius: '8px', fontSize: '15px', fontWeight: 500,
    cursor: 'pointer', fontFamily: 'var(--font-dm-sans)',
    textDecoration: 'none', display: 'inline-block',
  }

  const btnGhost = {
    background: 'none', color: t.text, border: `1.5px solid ${t.border}`,
    borderRadius: '8px', fontSize: '15px',
    cursor: 'pointer', fontFamily: 'var(--font-dm-sans)',
    textDecoration: 'none', display: 'inline-block',
  }

  const sectionLabel = {
    fontSize: '11px', fontWeight: 600, letterSpacing: '.12em',
    textTransform: 'uppercase', color: t.accent, marginBottom: '14px',
  }

  const h2Style = {
    fontSize: '44px', fontWeight: 700, letterSpacing: '-0.025em',
    marginBottom: '18px', color: t.text, lineHeight: 1.1,
  }

  return (
    <main style={{ background: t.base, color: t.text, minHeight: '100vh' }}>

      {/* ════════ NAV ════════ */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 48px', height: '64px',
        background: dark ? 'rgba(26,25,23,0.92)' : 'rgba(245,243,238,0.92)',
        borderBottom: `1px solid ${t.border}`,
        backdropFilter: 'blur(10px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 13 13" fill="none" width="14" height="14">
              <rect x="0" y="0" width="5.5" height="5.5" rx="1" fill="white" />
              <rect x="7.5" y="0" width="5.5" height="5.5" rx="1" fill="white" opacity=".6" />
              <rect x="0" y="7.5" width="5.5" height="5.5" rx="1" fill="white" opacity=".6" />
              <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1" fill="white" opacity=".3" />
            </svg>
          </div>
          <span style={{ fontFamily: 'var(--font-syne)', fontWeight: 700, fontSize: '17px', color: t.text }}>DataStudio</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <a href="#problem" style={{ fontSize: '14px', color: t.text2, textDecoration: 'none' }}>The problem</a>
          <a href="#how" style={{ fontSize: '14px', color: t.text2, textDecoration: 'none' }}>How it works</a>
          <a href="#who" style={{ fontSize: '14px', color: t.text2, textDecoration: 'none' }}>Who it's for</a>
          <a href="#pricing" style={{ fontSize: '14px', color: t.text2, textDecoration: 'none' }}>Pricing</a>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => setDark(!dark)} style={{
            width: '34px', height: '34px', borderRadius: '7px',
            background: 'none', border: `1px solid ${t.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: t.text2,
          }}>
            {dark ? (
              <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M8 3V1M8 15v-2M3 8H1M15 8h-2M4.2 4.2L2.8 2.8M13.2 13.2l-1.4-1.4M4.2 11.8l-1.4 1.4M13.2 2.8l-1.4 1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" /></svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M13.5 8.5A5.5 5.5 0 016 2a6 6 0 100 12 5.5 5.5 0 007.5-5.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
            )}
          </button>
          <a href="/app" style={{ ...btnPrimary, padding: '9px 22px', fontSize: '14px' }}>Try free →</a>
        </div>
      </nav>

      {/* ════════ HERO ════════ */}
      <section style={{ padding: '100px 48px 120px', position: 'relative' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '80px', alignItems: 'center' }}>

          {/* Left — headline + CTA */}
          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px',
              background: t.accentDim, color: t.accentText,
              fontSize: '12px', fontWeight: 500, padding: '5px 14px',
              borderRadius: '20px', marginBottom: '28px',
              border: `1px solid ${t.accent}33`,
            }}>
              <span style={{ width: '6px', height: '6px', background: t.accent, borderRadius: '50%', display: 'inline-block' }}></span>
              For sales ops, CRM managers &amp; analysts
            </div>

            <h1 style={{
              fontSize: '68px', fontWeight: 800, lineHeight: 1.02,
              letterSpacing: '-0.035em', marginBottom: '24px', color: t.text,
              fontFamily: 'var(--font-syne)',
            }}>
              The <span style={{ color: t.accent }}>4 hours a week</span><br />
              Excel can't give you back.
            </h1>

            <p style={{ fontSize: '19px', color: t.text2, fontWeight: 400, maxWidth: '520px', marginBottom: '36px', lineHeight: 1.65 }}>
              DataStudio reconciles company names across your spreadsheets — even when they're spelled differently, abbreviated, or formatted inconsistently. No VLOOKUP. No manual cleanup.
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '20px' }}>
              <a href="/app" style={{ ...btnPrimary, padding: '16px 32px', fontSize: '16px', fontWeight: 600 }}>Try it free →</a>
              <a href="#how" style={{ ...btnGhost, padding: '15px 26px' }}>See how it works</a>
            </div>
            <p style={{ fontSize: '13px', color: t.text3 }}>
              No signup. No credit card. Works in your browser.
            </p>
          </div>

          {/* Right — hero visual: Crosscheck in action */}
          <CrosscheckVisual t={t} dark={dark} />
        </div>
      </section>

      {/* ════════ THE PROBLEM ════════ */}
      <section id="problem" style={{ padding: '100px 48px', background: t.surface }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ marginBottom: '60px', maxWidth: '640px' }}>
            <div style={sectionLabel}>The problem</div>
            <h2 style={h2Style}>You know this scene.</h2>
            <p style={{ fontSize: '18px', color: t.text2, fontWeight: 400, lineHeight: 1.7 }}>
              Your CRM says <strong style={{ color: t.text }}>"Acme Corp"</strong>. The lead list your marketing team bought says <strong style={{ color: t.text }}>"ACME Corporation, Inc."</strong>. Excel thinks these are two different companies. So does VLOOKUP. So does every formula you can write.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
            {[
              {
                hours: '4 hours',
                title: 'Matching exhibitor lists to accounts',
                body: 'Event wrapped, 500 new contacts in a CSV, and you need to know which ones are already clients. You start typing company names into filter boxes.',
              },
              {
                hours: '3 hours',
                title: 'Cleaning CRM imports',
                body: '"Microsoft Corp", "Microsoft Corporation", "microsoft corp.", "MSFT Inc" — four records, one company. Excel shows four rows. Your reports show four rows.',
              },
              {
                hours: '2 hours',
                title: 'Gap analysis between lead lists',
                body: 'Marketing sends a target list. You need to know which companies are NEW and which are already in the pipeline. Excel has no fuzzy compare.',
              },
            ].map((scenario, i) => (
              <div key={i} style={{
                background: t.base,
                border: `1px solid ${t.border}`,
                borderRadius: '14px',
                padding: '32px 28px',
                position: 'relative',
              }}>
                <div style={{
                  display: 'inline-block',
                  background: t.accentDim,
                  color: t.accentText,
                  fontSize: '12px',
                  fontWeight: 700,
                  padding: '4px 12px',
                  borderRadius: '12px',
                  marginBottom: '16px',
                  fontFamily: 'var(--font-dm-mono)',
                  letterSpacing: '-0.01em',
                }}>
                  {scenario.hours} / week
                </div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: t.text, marginBottom: '10px', fontFamily: 'var(--font-syne)' }}>
                  {scenario.title}
                </h3>
                <p style={{ fontSize: '14px', color: t.text2, lineHeight: 1.7 }}>
                  {scenario.body}
                </p>
              </div>
            ))}
          </div>

          <p style={{ fontSize: '14px', color: t.text3, marginTop: '40px', textAlign: 'center', fontStyle: 'italic' }}>
            That's 9 hours a week spent on work a computer should be doing for you.
          </p>
        </div>
      </section>

      {/* ════════ HOW IT WORKS ════════ */}
      <section id="how" style={{ padding: '100px 48px', background: t.base }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ marginBottom: '60px', maxWidth: '640px' }}>
            <div style={sectionLabel}>How it works</div>
            <h2 style={h2Style}>Reconcile two lists in three steps.</h2>
            <p style={{ fontSize: '17px', color: t.text2, fontWeight: 400, lineHeight: 1.7 }}>
              Drop in your files, point at the columns you want to match, run Crosscheck. DataStudio handles the fuzzy matching — you just review the results.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', border: `1px solid ${t.border}`, borderRadius: '14px', overflow: 'hidden' }}>
            {[
              {
                num: '01',
                title: 'Drop in your files',
                desc: 'Import any .xlsx or .csv. Your CRM export. A lead list. An event attendance sheet. DataStudio loads every sheet and column into a sidebar.',
              },
              {
                num: '02',
                title: 'Drag the columns to compare',
                desc: 'Drag "Company Name" from your CRM into the canvas. Drag "Organization" from the lead list next to it. That\'s your reconciliation setup.',
              },
              {
                num: '03',
                title: 'Run Crosscheck',
                desc: 'Every row is matched against every row on the other side — ignoring punctuation, legal suffixes, casing, and common typos. You get Matched, Maybe, and Unmatched buckets with confidence scores.',
              },
            ].map(s => (
              <div key={s.num} style={{ background: t.surface, padding: '44px 36px' }}>
                <div style={{
                  fontFamily: 'var(--font-syne)',
                  fontSize: '56px',
                  fontWeight: 800,
                  color: t.accent,
                  opacity: 0.25,
                  lineHeight: 1,
                  marginBottom: '24px',
                }}>
                  {s.num}
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '12px', color: t.text, fontFamily: 'var(--font-syne)' }}>{s.title}</h3>
                <p style={{ fontSize: '14px', color: t.text2, lineHeight: 1.75 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ BEFORE / AFTER ════════ */}
      <section style={{ padding: '100px 48px', background: t.surface }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ marginBottom: '60px', maxWidth: '640px' }}>
            <div style={sectionLabel}>Before vs after</div>
            <h2 style={h2Style}>The same job, minus the soul-destroying parts.</h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            {/* Before */}
            <div style={{
              background: t.base,
              border: `1px solid ${t.border}`,
              borderRadius: '14px',
              padding: '32px 32px 36px',
            }}>
              <div style={{
                display: 'inline-block',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: t.text3,
                background: t.raised,
                padding: '4px 12px',
                borderRadius: '10px',
                marginBottom: '20px',
              }}>
                Before
              </div>
              <h3 style={{ fontSize: '19px', fontWeight: 700, color: t.text, marginBottom: '18px', fontFamily: 'var(--font-syne)' }}>
                In Excel
              </h3>
              <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {[
                  'Open CRM export in one tab',
                  'Open lead list in another tab',
                  'Sort both by company name',
                  'Eyeball the first 20 rows',
                  'Write a VLOOKUP that doesn\'t quite work',
                  'Give up, use CTRL+F one name at a time',
                  'Copy matches into a third spreadsheet',
                  'Realize "Ltd" vs "Limited" broke your logic',
                  'Start over',
                ].map((step, i) => (
                  <li key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '10px',
                    padding: '7px 0', fontSize: '14px', color: t.text2,
                  }}>
                    <span style={{ color: t.red, flexShrink: 0, marginTop: '2px' }}>✕</span>
                    {step}
                  </li>
                ))}
              </ol>
              <div style={{
                marginTop: '24px',
                paddingTop: '20px',
                borderTop: `1px solid ${t.border}`,
                fontSize: '13px',
                color: t.text3,
                fontFamily: 'var(--font-dm-mono)',
              }}>
                <strong style={{ color: t.red }}>Time:</strong> 3–4 hours
              </div>
            </div>

            {/* After */}
            <div style={{
              background: t.base,
              border: `1.5px solid ${t.accent}`,
              borderRadius: '14px',
              padding: '32px 32px 36px',
              position: 'relative',
            }}>
              <div style={{
                display: 'inline-block',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: t.accentText,
                background: t.accentDim,
                padding: '4px 12px',
                borderRadius: '10px',
                marginBottom: '20px',
              }}>
                After
              </div>
              <h3 style={{ fontSize: '19px', fontWeight: 700, color: t.text, marginBottom: '18px', fontFamily: 'var(--font-syne)' }}>
                In DataStudio
              </h3>
              <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {[
                  'Drop both files into the sidebar',
                  'Drag one Company column and the other onto the canvas',
                  'Click "Crosscheck"',
                  'Review matched / maybe / unmatched results',
                  'Export the cleaned file',
                ].map((step, i) => (
                  <li key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '10px',
                    padding: '7px 0', fontSize: '14px', color: t.text,
                  }}>
                    <span style={{ color: t.accent, flexShrink: 0, marginTop: '2px' }}>✓</span>
                    {step}
                  </li>
                ))}
              </ol>
              <div style={{
                marginTop: '24px',
                paddingTop: '20px',
                borderTop: `1px solid ${t.border}`,
                fontSize: '13px',
                color: t.text3,
                fontFamily: 'var(--font-dm-mono)',
              }}>
                <strong style={{ color: t.accent }}>Time:</strong> 4 minutes
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════ WHO IT'S FOR ════════ */}
      <section id="who" style={{ padding: '100px 48px', background: t.base }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ marginBottom: '60px', maxWidth: '640px' }}>
            <div style={sectionLabel}>Who it's for</div>
            <h2 style={h2Style}>Built for people whose job is data.</h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
            {[
              {
                role: 'Sales operations',
                icon: '◆',
                problems: [
                  'Reconciling new leads against existing accounts',
                  'Cleaning territory handoffs between reps',
                  'Preparing lists for sales engagement tools',
                ],
              },
              {
                role: 'CRM managers',
                icon: '◈',
                problems: [
                  'Finding duplicate accounts before import',
                  'Merging CRM data from acquired companies',
                  'Keeping company records consistent',
                ],
              },
              {
                role: 'Event & marketing',
                icon: '▲',
                problems: [
                  'Matching exhibitor lists to existing customers',
                  'Identifying net-new leads from event downloads',
                  'Cleaning bought lists before a campaign',
                ],
              },
            ].map(persona => (
              <div key={persona.role} style={{
                background: t.surface,
                border: `1px solid ${t.border}`,
                borderRadius: '14px',
                padding: '36px 32px',
              }}>
                <div style={{
                  fontSize: '28px',
                  color: t.accent,
                  marginBottom: '14px',
                  fontFamily: 'var(--font-syne)',
                }}>
                  {persona.icon}
                </div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: t.text, marginBottom: '18px', fontFamily: 'var(--font-syne)' }}>
                  {persona.role}
                </h3>
                <p style={{ fontSize: '12px', color: t.text3, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: '14px' }}>
                  This is for you if…
                </p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {persona.problems.map((p, i) => (
                    <li key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: '10px',
                      padding: '7px 0', fontSize: '13.5px', color: t.text2, lineHeight: 1.65,
                    }}>
                      <span style={{ color: t.accent, flexShrink: 0, marginTop: '1px' }}>→</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ PRICING ════════ */}
      <section id="pricing" style={{ padding: '100px 48px', background: t.surface }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ marginBottom: '56px', maxWidth: '640px' }}>
            <div style={sectionLabel}>Pricing</div>
            <h2 style={h2Style}>Free until it pays for itself.</h2>
            <p style={{ fontSize: '17px', color: t.text2, fontWeight: 400, lineHeight: 1.7 }}>
              Start free. Upgrade when you're reconciling lists every week and want the advanced tools.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', border: `1px solid ${t.border}`, borderRadius: '14px', overflow: 'hidden' }}>
            {[
              {
                name: 'Free',
                price: '$0',
                per: 'forever',
                desc: 'For occasional reconciliation',
                features: ['3 file imports', '500 rows per export', 'CSV export', 'All Crosscheck features'],
                missing: ['Unlimited imports', 'XLSX export'],
                cta: 'Start free',
                href: '/app',
              },
              {
                name: 'Pro',
                price: '$12',
                per: 'per month, billed yearly',
                desc: 'For weekly reconciliation work',
                features: ['Unlimited file imports', 'Unlimited rows', 'CSV + XLSX export', 'Save workspaces', 'Priority support'],
                missing: [],
                cta: 'Start 14-day trial',
                featured: true,
                href: '/signup',
              },
              {
                name: 'Team',
                price: '$29',
                per: 'per seat / month',
                desc: 'For data teams',
                features: ['Everything in Pro', 'Shared workspaces', 'Admin controls', 'SSO / SAML', 'Dedicated support'],
                missing: [],
                cta: 'Contact sales',
                href: 'mailto:hello@datastudio.app',
              },
            ].map(plan => (
              <div key={plan.name} style={{
                background: plan.featured ? (dark ? '#E8E6E1' : '#1A1917') : t.base,
                padding: '44px 34px',
                position: 'relative',
              }}>
                {plan.featured && (
                  <div style={{
                    position: 'absolute', top: '18px', right: '18px',
                    background: t.accent, color: 'white',
                    fontSize: '10px', fontWeight: 700, padding: '4px 11px',
                    borderRadius: '10px', textTransform: 'uppercase', letterSpacing: '.06em',
                  }}>Most popular</div>
                )}
                <div style={{
                  fontSize: '11px', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase',
                  color: plan.featured ? (dark ? '#9A9790' : '#6B6860') : t.text3,
                  marginBottom: '10px', fontFamily: 'var(--font-syne)',
                }}>{plan.name}</div>
                <div style={{
                  fontFamily: 'var(--font-syne)', fontWeight: 800, fontSize: '56px',
                  letterSpacing: '-0.035em',
                  color: plan.featured ? (dark ? '#1A1917' : '#E8E6E1') : t.text,
                  lineHeight: 1, marginBottom: '8px',
                }}>{plan.price}</div>
                <div style={{ fontSize: '13px', color: plan.featured ? (dark ? '#9A9790' : '#5A5955') : t.text3, marginBottom: '10px' }}>{plan.per}</div>
                <div style={{ fontSize: '13px', color: plan.featured ? (dark ? '#6B6860' : '#9A9790') : t.text3, marginBottom: '28px' }}>{plan.desc}</div>
                <div style={{ height: '1px', background: plan.featured ? (dark ? '#D5D1C7' : '#2E2D29') : t.border, marginBottom: '24px' }}></div>

                {plan.features.map(f => (
                  <div key={f} style={{
                    display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '11px',
                    fontSize: '13.5px', color: plan.featured ? (dark ? '#1A1917' : '#E8E6E1') : t.text2,
                  }}>
                    <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: t.accentDim, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-4" stroke={t.accent} strokeWidth="1.4" strokeLinecap="round" /></svg>
                    </div>
                    {f}
                  </div>
                ))}
                {plan.missing.map(f => (
                  <div key={f} style={{
                    display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '11px',
                    fontSize: '13.5px', color: t.text3,
                  }}>
                    <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: t.raised, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M2 2l4 4M6 2L2 6" stroke={t.text3} strokeWidth="1.2" strokeLinecap="round" /></svg>
                    </div>
                    {f}
                  </div>
                ))}

                <a href={plan.href} style={{
                  display: 'block', width: '100%', padding: '13px', borderRadius: '8px',
                  fontFamily: 'var(--font-dm-sans)', fontSize: '14px', fontWeight: 600,
                  cursor: 'pointer', marginTop: '20px', border: 'none', textAlign: 'center',
                  textDecoration: 'none',
                  background: plan.featured ? (dark ? '#1A1917' : '#E8E6E1') : t.raised,
                  color: plan.featured ? (dark ? 'white' : '#1A1917') : t.text2,
                }}>{plan.cta}</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ FAQ ════════ */}
      <section style={{ padding: '100px 48px', background: t.base }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <div style={{ marginBottom: '56px' }}>
            <div style={sectionLabel}>Questions</div>
            <h2 style={h2Style}>Answered before you ask.</h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: t.border, borderRadius: '14px', overflow: 'hidden', border: `1px solid ${t.border}` }}>
            {[
              {
                q: 'Does my data leave my browser?',
                a: 'No. DataStudio runs entirely in your browser — your files are never uploaded to a server. Your imported data and canvas work persists in your browser\'s local storage.',
              },
              {
                q: 'How accurate is Crosscheck?',
                a: 'Crosscheck combines three fuzzy-match algorithms (token sort, token set, partial ratio) with rescue rules for prefix and substring matches. It strips legal suffixes (Ltd, GmbH, Inc.) and common geographic words before comparing. Every match includes a confidence score — you choose the threshold.',
              },
              {
                q: 'What file sizes work?',
                a: 'The free tier supports files up to ~10,000 rows per sheet. Pro and Team tiers handle unlimited rows. Anything beyond ~500,000 rows will be slow in a browser — that\'s a limitation of running without a backend.',
              },
              {
                q: 'Can I use DataStudio for things other than company names?',
                a: 'Yes. Crosscheck works on any text column — product names, email addresses, SKUs, addresses. The fuzzy matching is general-purpose; company names are just the most common use case.',
              },
              {
                q: 'Is there an API?',
                a: 'Not yet. We\'re focused on the interactive reconciliation workflow first. If you need programmatic access, email us — we\'re interested in what you\'re building.',
              },
              {
                q: 'Who built this?',
                a: 'A small team based in Vilnius, Lithuania. We started DataStudio because we\'d done this job ourselves, too many times, in too many spreadsheets.',
              },
            ].map((faq, i) => (
              <details key={i} style={{ background: t.surface, padding: '22px 28px', cursor: 'pointer' }}>
                <summary style={{
                  fontSize: '16px', fontWeight: 600, color: t.text,
                  fontFamily: 'var(--font-dm-sans)', listStyle: 'none',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  {faq.q}
                  <span style={{ color: t.text3, fontSize: '18px', fontWeight: 400 }}>+</span>
                </summary>
                <p style={{ fontSize: '14.5px', color: t.text2, lineHeight: 1.75, marginTop: '14px' }}>
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ FINAL CTA ════════ */}
      <section style={{ padding: '140px 48px', textAlign: 'center', background: t.surface }}>
        <h2 style={{
          fontSize: '56px', fontWeight: 800, letterSpacing: '-0.03em',
          marginBottom: '20px', lineHeight: 1.08, color: t.text,
          fontFamily: 'var(--font-syne)',
        }}>
          Get those 4 hours back.
        </h2>
        <p style={{ fontSize: '18px', color: t.text2, marginBottom: '44px', fontWeight: 400, maxWidth: '500px', margin: '0 auto 44px' }}>
          Free, in your browser, no signup. Try it on one of your own spreadsheets.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
          <a href="/app" style={{ ...btnPrimary, padding: '18px 40px', fontSize: '17px', fontWeight: 600 }}>Open DataStudio →</a>
        </div>
        <p style={{ fontSize: '13px', color: t.text3, marginTop: '22px' }}>
          No credit card · No account required · Your data stays in your browser
        </p>
      </section>

      {/* ════════ FOOTER ════════ */}
      <footer style={{
        padding: '40px 48px', borderTop: `1px solid ${t.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: '13px', color: t.text3, background: t.base,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '22px', height: '22px', borderRadius: '5px', background: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 13 13" fill="none" width="12" height="12">
              <rect x="0" y="0" width="5.5" height="5.5" rx="1" fill="white" />
              <rect x="7.5" y="0" width="5.5" height="5.5" rx="1" fill="white" opacity=".6" />
              <rect x="0" y="7.5" width="5.5" height="5.5" rx="1" fill="white" opacity=".6" />
              <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1" fill="white" opacity=".3" />
            </svg>
          </div>
          <span style={{ fontFamily: 'var(--font-syne)', fontWeight: 700, fontSize: '15px', color: t.text }}>DataStudio</span>
        </div>
        <div style={{ display: 'flex', gap: '28px' }}>
          <a href="#" style={{ color: t.text3, textDecoration: 'none' }}>Privacy</a>
          <a href="#" style={{ color: t.text3, textDecoration: 'none' }}>Terms</a>
          <a href="mailto:hello@datastudio.app" style={{ color: t.text3, textDecoration: 'none' }}>Contact</a>
        </div>
        <span>© 2026 DataStudio · Built in Vilnius</span>
      </footer>

    </main>
  )
}


/* ══════════════════════════════════════════════════════════════════
   CrosscheckVisual — the hero-right mockup
   A CSS/SVG rendering of the Crosscheck results screen. Not a
   screenshot — drawn from scratch so it loads fast and responds
   to the theme. Looks like the actual product without requiring
   an actual screenshot that would go stale.
   ══════════════════════════════════════════════════════════════════ */

function CrosscheckVisual({ t, dark }) {
  const matches = [
    { name: 'Acme Corp', match: 'ACME Corporation, Inc.', score: 98, status: 'matched' },
    { name: 'Globex Ltd', match: 'Globex Limited', score: 96, status: 'matched' },
    { name: 'Initech LLC', match: 'Initech', score: 92, status: 'matched' },
    { name: 'Umbrella Co.', match: 'Umbrella Corporation', score: 87, status: 'maybe' },
    { name: 'Stark Industries', match: 'Stark Indust.', score: 84, status: 'maybe' },
    { name: 'Wayne Enterprises', match: '—', score: 0, status: 'unmatched' },
  ]

  return (
    <div style={{
      background: t.surface,
      border: `1px solid ${t.border}`,
      borderRadius: '16px',
      overflow: 'hidden',
      boxShadow: dark
        ? '0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)'
        : '0 24px 60px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.02)',
    }}>
      {/* Window chrome */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '7px',
        padding: '12px 16px', borderBottom: `1px solid ${t.border}`,
        background: t.raised,
      }}>
        <div style={{ width: '11px', height: '11px', borderRadius: '50%', background: '#ff5f57' }}></div>
        <div style={{ width: '11px', height: '11px', borderRadius: '50%', background: '#febc2e' }}></div>
        <div style={{ width: '11px', height: '11px', borderRadius: '50%', background: '#28c840' }}></div>
        <span style={{ fontSize: '11px', color: t.text3, marginLeft: '10px', fontFamily: 'var(--font-dm-mono)' }}>crosscheck — step 4 of 4</span>
      </div>

      {/* Header */}
      <div style={{ padding: '18px 22px 14px', borderBottom: `1px solid ${t.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ fontSize: '15px', color: t.accent }}>⚡</span>
          <span style={{ fontFamily: 'var(--font-syne)', fontSize: '15px', fontWeight: 800, color: t.accent, letterSpacing: '-0.2px' }}>Crosscheck results</span>
        </div>
        <div style={{ fontSize: '11px', color: t.text3, fontFamily: 'var(--font-dm-mono)' }}>
          sales_leads.csv × crm_accounts.xlsx
        </div>
      </div>

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: '8px', padding: '14px 22px 10px' }}>
        {[
          { label: 'Matched', value: 3, color: t.green, bg: dark ? '#0d2a1a' : '#dcfce7' },
          { label: 'Review', value: 2, color: t.amber, bg: dark ? '#2a1f0d' : '#fef3c7' },
          { label: 'Not found', value: 1, color: t.red, bg: dark ? '#2a0d0d' : '#fee2e2' },
        ].map(chip => (
          <div key={chip.label} style={{
            flex: 1,
            background: chip.bg,
            borderRadius: '8px',
            padding: '10px 12px',
            textAlign: 'center',
            border: `1px solid ${chip.color}33`,
          }}>
            <div style={{ fontSize: '20px', fontWeight: 800, color: chip.color, fontFamily: 'var(--font-syne)', lineHeight: 1 }}>
              {chip.value}
            </div>
            <div style={{ fontSize: '9px', color: chip.color, marginTop: '3px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>
              {chip.label}
            </div>
          </div>
        ))}
      </div>

      {/* Rows */}
      <div style={{ padding: '4px 14px 18px' }}>
        <div style={{
          display: 'flex',
          padding: '6px 10px',
          fontSize: '9px',
          color: t.text3,
          textTransform: 'uppercase',
          letterSpacing: '.5px',
          fontWeight: 700,
          borderBottom: `1px solid ${t.border}`,
        }}>
          <div style={{ flex: 1.5 }}>Your name</div>
          <div style={{ flex: 1.5 }}>Best match</div>
          <div style={{ width: '55px', textAlign: 'right' }}>Score</div>
        </div>
        {matches.map((r, i) => {
          const scoreColor = r.status === 'matched' ? t.green : r.status === 'maybe' ? t.amber : t.red
          const bg = r.status === 'maybe'
            ? (dark ? 'rgba(232, 184, 91, 0.08)' : 'rgba(232, 184, 91, 0.08)')
            : r.status === 'unmatched'
              ? (dark ? 'rgba(248, 113, 113, 0.08)' : 'rgba(248, 113, 113, 0.08)')
              : 'transparent'
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center',
              padding: '9px 10px',
              borderBottom: i < matches.length - 1 ? `1px solid ${t.border}66` : 'none',
              background: bg,
              fontSize: '11px',
              fontFamily: 'var(--font-dm-mono)',
            }}>
              <div style={{ flex: 1.5, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '8px' }}>
                {r.name}
              </div>
              <div style={{ flex: 1.5, color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '8px' }}>
                {r.match}
              </div>
              <div style={{ width: '55px', textAlign: 'right' }}>
                {r.score > 0 ? (
                  <>
                    <span style={{ color: scoreColor, fontWeight: 700 }}>{r.score}%</span>
                    <div style={{
                      height: '2.5px',
                      background: t.raised,
                      borderRadius: '2px',
                      marginTop: '3px',
                      overflow: 'hidden',
                    }}>
                      <div style={{ height: '100%', width: `${r.score}%`, background: scoreColor }}></div>
                    </div>
                  </>
                ) : (
                  <span style={{ color: t.red, fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' }}>Not found</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}