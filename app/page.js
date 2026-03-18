'use client'

import { useTheme } from './providers'

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
  }

  const btnPrimary = {
    background:t.accent, color:'white', border:'none',
    borderRadius:'8px', fontSize:'15px', fontWeight:500,
    cursor:'pointer', fontFamily:'var(--font-dm-sans)',
    textDecoration:'none', display:'inline-block'
  }

  const btnGhost = {
    background:'none', color:t.text, border:`1.5px solid ${t.border}`,
    borderRadius:'8px', fontSize:'15px',
    cursor:'pointer', fontFamily:'var(--font-dm-sans)',
    textDecoration:'none', display:'inline-block'
  }

  return (
    <main style={{background: t.base, color: t.text, minHeight:'100vh'}}>

      {/* NAV */}
      <nav style={{
        position:'sticky', top:0, zIndex:100,
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'0 48px', height:'60px',
        background: dark ? 'rgba(26,25,23,0.95)' : 'rgba(245,243,238,0.95)',
        borderBottom:`1px solid ${t.border}`,
        backdropFilter:'blur(8px)',
      }}>
        <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
          <div style={{width:'28px', height:'28px', borderRadius:'6px', background:t.accent, display:'flex', alignItems:'center', justifyContent:'center'}}>
            <svg viewBox="0 0 13 13" fill="none" width="14" height="14">
              <rect x="0" y="0" width="5.5" height="5.5" rx="1" fill="white"/>
              <rect x="7.5" y="0" width="5.5" height="5.5" rx="1" fill="white" opacity=".6"/>
              <rect x="0" y="7.5" width="5.5" height="5.5" rx="1" fill="white" opacity=".6"/>
              <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1" fill="white" opacity=".3"/>
            </svg>
          </div>
          <span style={{fontFamily:'var(--font-syne)', fontWeight:700, fontSize:'16px', color:t.text}}>DataStudio</span>
        </div>
        <div style={{display:'flex', alignItems:'center', gap:'32px'}}>
          <a href="#how" style={{fontSize:'14px', color:t.text2, textDecoration:'none'}}>How it works</a>
          <a href="#features" style={{fontSize:'14px', color:t.text2, textDecoration:'none'}}>Features</a>
          <a href="#pricing" style={{fontSize:'14px', color:t.text2, textDecoration:'none'}}>Pricing</a>
        </div>
        <div style={{display:'flex', alignItems:'center', gap:'12px'}}>
          <button onClick={() => setDark(!dark)} style={{
            width:'32px', height:'32px', borderRadius:'6px',
            background:'none', border:`1px solid ${t.border}`,
            display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', color:t.text2
          }}>
            {dark ? (
              <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M8 3V1M8 15v-2M3 8H1M15 8h-2M4.2 4.2L2.8 2.8M13.2 13.2l-1.4-1.4M4.2 11.8l-1.4 1.4M13.2 2.8l-1.4 1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2"/></svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M13.5 8.5A5.5 5.5 0 016 2a6 6 0 100 12 5.5 5.5 0 007.5-5.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            )}
          </button>
          <a href="/signup" style={{...btnPrimary, padding:'8px 20px', fontSize:'14px'}}>Get started free</a>
        </div>
      </nav>

      {/* HERO */}
      <section style={{minHeight:'90vh', display:'flex', alignItems:'center', padding:'80px 48px', gap:'60px'}}>
        <div style={{flex:1}}>
          <div style={{
            display:'inline-flex', alignItems:'center', gap:'6px',
            background:t.accentDim, color:t.accentText,
            fontSize:'12px', fontWeight:500, padding:'4px 12px',
            borderRadius:'20px', marginBottom:'24px',
            border:`1px solid ${t.accent}33`
          }}>
            <span style={{width:'6px', height:'6px', background:t.accent, borderRadius:'50%', display:'inline-block'}}></span>
            Now in early access
          </div>
          <h1 style={{fontSize:'64px', fontWeight:800, lineHeight:1.05, letterSpacing:'-0.02em', marginBottom:'24px', color:t.text}}>
            Your Excel files,<br/>
            <span style={{color:t.accent}}>finally</span> talking<br/>
            to each other.
          </h1>
          <p style={{fontSize:'18px', color:t.text2, fontWeight:300, maxWidth:'440px', marginBottom:'40px', lineHeight:1.7}}>
            Import multiple spreadsheets, drag columns onto a blank canvas,
            crosscheck data and export a clean custom file in seconds.
          </p>
          <div style={{display:'flex', alignItems:'center', gap:'16px'}}>
            <a href="/signup" style={{...btnPrimary, padding:'14px 28px'}}>Start for free →</a>
            <a href="/login" style={{...btnGhost, padding:'13px 24px'}}>Sign in</a>
          </div>
          <p style={{fontSize:'12px', color:t.text3, marginTop:'16px'}}>
            No credit card required · Free plan available · Export to .xlsx & .csv
          </p>
        </div>

        {/* MOCK APP */}
        <div style={{flex:1, maxWidth:'520px'}}>
          <div style={{background:t.surface, border:`1px solid ${t.border}`, borderRadius:'12px', overflow:'hidden'}}>
            <div style={{display:'flex', alignItems:'center', gap:'6px', padding:'10px 14px', borderBottom:`1px solid ${t.border}`, background:t.raised}}>
              <div style={{width:'10px', height:'10px', borderRadius:'50%', background:'#ff5f57'}}></div>
              <div style={{width:'10px', height:'10px', borderRadius:'50%', background:'#febc2e'}}></div>
              <div style={{width:'10px', height:'10px', borderRadius:'50%', background:'#28c840'}}></div>
              <span style={{fontSize:'10px', color:t.text3, marginLeft:'8px', fontFamily:'var(--font-dm-mono)'}}>datastudio — workspace</span>
            </div>
            <div style={{display:'flex', alignItems:'center', gap:'6px', padding:'6px 10px', borderBottom:`1px solid ${t.border}`, background:t.surface}}>
              {['Crosscheck','Duplicates','Gap finder','Sort'].map(tb => (
                <div key={tb} style={{
                  padding:'3px 9px', borderRadius:'4px', fontSize:'10px',
                  background: tb==='Crosscheck' ? t.accent : 'none',
                  color: tb==='Crosscheck' ? 'white' : t.text3,
                  border: `1px solid ${tb==='Crosscheck' ? t.accent : t.border}`
                }}>{tb}</div>
              ))}
            </div>
            <div style={{display:'grid', gridTemplateColumns:'130px 1fr', height:'220px'}}>
              <div style={{borderRight:`1px solid ${t.border}`, padding:'8px 0', background:t.base}}>
                {[{name:'Sales_Q1.xlsx',color:t.accent},{name:'Customers.xlsx',color:'#E8B85B'}].map(f => (
                  <div key={f.name}>
                    <div style={{display:'flex', alignItems:'center', gap:'6px', padding:'5px 10px'}}>
                      <div style={{width:'12px', height:'12px', borderRadius:'2px', background:f.color, flexShrink:0}}></div>
                      <span style={{fontSize:'9px', color:t.text2, fontWeight:500}}>{f.name}</span>
                    </div>
                    {['Company','Client ID','Revenue'].map(c => (
                      <div key={c} style={{display:'flex', alignItems:'center', gap:'4px', padding:'3px 8px 3px 22px'}}>
                        <div style={{width:'4px', height:'4px', borderRadius:'50%', background:t.text3}}></div>
                        <span style={{fontSize:'8px', color:t.text3}}>{c}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div style={{padding:'10px', background:t.base, overflowX:'auto'}}>
                <table style={{borderCollapse:'collapse', fontSize:'8px', width:'100%'}}>
                  <thead>
                    <tr>{['Company','Client ID','Revenue','Status'].map(h => (
                      <th key={h} style={{background:t.surface, padding:'4px 8px', textAlign:'left', border:`1px solid ${t.border}`, color:t.text3, fontWeight:500, fontFamily:'var(--font-dm-sans)'}}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {[['Acme Corp','C001','$12,400','Active'],['Bolt Inc','C002','$8,900','Active'],['Coda Ltd','C003','$34,200','Active'],['Edge Co','C005','$5,600','Inactive']].map((row,i) => (
                      <tr key={i}>{row.map((cell,j) => (
                        <td key={j} style={{padding:'4px 8px', border:`1px solid ${t.border}`, color:j===1?t.accent:t.text2, fontFamily:'var(--font-dm-mono)'}}>{cell}</td>
                      ))}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" style={{padding:'96px 48px', background:t.surface}}>
        <div style={{marginBottom:'60px'}}>
          <div style={{fontSize:'11px', fontWeight:600, letterSpacing:'.1em', textTransform:'uppercase', color:t.accent, marginBottom:'14px'}}>How it works</div>
          <h2 style={{fontSize:'42px', fontWeight:700, letterSpacing:'-0.02em', marginBottom:'16px', color:t.text}}>Three steps to a clean dataset</h2>
          <p style={{fontSize:'17px', color:t.text2, fontWeight:300, maxWidth:'520px'}}>No formulas. No VLOOKUP. No copying between tabs.</p>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'1px', border:`1px solid ${t.border}`, borderRadius:'12px', overflow:'hidden'}}>
          {[
            {num:'01', title:'Import your files', desc:'Drop in any number of .xlsx, .xls, or .csv files. Every sheet and column loads instantly in the sidebar.'},
            {num:'02', title:'Drag to build', desc:'Click and drag any column onto the blank canvas. Mix data from different files into one clean table.'},
            {num:'03', title:'Clean and export', desc:'Run crosscheck, find duplicates, merge columns — then export as .xlsx or .csv with one click.'},
          ].map(s => (
            <div key={s.num} style={{background:t.base, padding:'40px 32px'}}>
              <div style={{fontFamily:'var(--font-syne)', fontSize:'48px', fontWeight:800, color:t.border, lineHeight:1, marginBottom:'20px'}}>{s.num}</div>
              <h3 style={{fontSize:'18px', fontWeight:700, marginBottom:'10px', color:t.text}}>{s.title}</h3>
              <p style={{fontSize:'14px', color:t.text2, lineHeight:1.7}}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" style={{padding:'96px 48px', background:t.base}}>
        <div style={{marginBottom:'60px'}}>
          <div style={{fontSize:'11px', fontWeight:600, letterSpacing:'.1em', textTransform:'uppercase', color:t.accent, marginBottom:'14px'}}>Features</div>
          <h2 style={{fontSize:'42px', fontWeight:700, letterSpacing:'-0.02em', marginBottom:'16px', color:t.text}}>Everything an analyst needs</h2>
          <p style={{fontSize:'17px', color:t.text2, fontWeight:300, maxWidth:'520px'}}>Powerful tools that used to take hours — now done in seconds.</p>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'1px', border:`1px solid ${t.border}`, borderRadius:'12px', overflow:'hidden'}}>
          {[
            {title:'Multi-file import', icon:<><path d="M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z" stroke={t.accent} strokeWidth="1.1" strokeLinejoin="round"/></>, desc:'Import as many spreadsheets as you need. All files stay loaded in the sidebar, expandable by sheet and column.'},
            {title:'Drag & drop canvas', icon:<><path d="M8 2v12M2 8h12" stroke={t.accent} strokeWidth="1.2" strokeLinecap="round"/></>, desc:'Drag individual columns, rows, or entire sheets onto a blank canvas to assemble your custom dataset visually.'},
            {title:'Fuzzy crosscheck', icon:<><circle cx="5" cy="8" r="3.5" stroke={t.accent} strokeWidth="1.2"/><circle cx="11" cy="8" r="3.5" stroke={t.accent} strokeWidth="1.2"/></>, desc:'Matches company names across files even with typos, abbreviations, or legal suffix differences (Ltd, GmbH, Inc).'},
            {title:'Duplicate finder', icon:<><rect x="2" y="5" width="7" height="7" rx="1.2" stroke={t.accent} strokeWidth="1.2"/><path d="M5 5V4a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1h-1" stroke={t.accent} strokeWidth="1.2"/></>, desc:'Scan any column for repeated values within or across files. Highlights duplicates instantly.'},
            {title:'Gap finder', icon:<><circle cx="8" cy="8" r="6" stroke={t.accent} strokeWidth="1.2"/><path d="M5 8h6M8 5v6" stroke={t.accent} strokeWidth="1.2" strokeLinecap="round"/></>, desc:"See what's in file A but missing from file B. The visual anti-join no Excel formula can replicate."},
            {title:'Export anywhere', icon:<><path d="M8 3v8M5 8l3 3 3-3" stroke={t.accent} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 13h10" stroke={t.accent} strokeWidth="1.2" strokeLinecap="round"/></>, desc:'Download your finished table as a proper .xlsx or .csv — perfectly formatted, ready for any tool.'},
          ].map(f => (
            <div key={f.title} style={{background:t.base, padding:'32px 28px', borderTop:`1px solid ${t.border}`}}>
              <div style={{width:'32px', height:'32px', borderRadius:'7px', background:t.accentDim, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:'14px'}}>
                <svg viewBox="0 0 16 16" fill="none" width="16" height="16">{f.icon}</svg>
              </div>
              <h4 style={{fontSize:'15px', fontWeight:600, marginBottom:'8px', fontFamily:'var(--font-syne)', color:t.text}}>{f.title}</h4>
              <p style={{fontSize:'13px', color:t.text2, lineHeight:1.65}}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{padding:'96px 48px', background:t.surface}}>
        <div style={{marginBottom:'48px'}}>
          <div style={{fontSize:'11px', fontWeight:600, letterSpacing:'.1em', textTransform:'uppercase', color:t.accent, marginBottom:'14px'}}>Pricing</div>
          <h2 style={{fontSize:'42px', fontWeight:700, letterSpacing:'-0.02em', marginBottom:'16px', color:t.text}}>Simple, honest pricing</h2>
          <p style={{fontSize:'17px', color:t.text2, fontWeight:300}}>Start free. Upgrade when you need more power.</p>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'1px', border:`1px solid ${t.border}`, borderRadius:'12px', overflow:'hidden'}}>
          {[
            {name:'Free', price:'$0', per:'forever', desc:'For trying it out', features:['3 file imports','500 rows per export','CSV export only'], missing:['Crosscheck','XLSX export'], cta:'Get started', href:'/signup'},
            {name:'Pro', price:'$12', per:'per month, billed yearly', desc:'For analysts & power users', features:['Unlimited file imports','Unlimited rows','CSV + XLSX export','Crosscheck & fuzzy match','Save workspaces'], missing:[], cta:'Start free 14-day trial', featured:true, href:'/signup'},
            {name:'Team', price:'$29', per:'per seat / month, billed yearly', desc:'For data teams', features:['Everything in Pro','Shared workspaces','Admin controls','Priority support','SSO / SAML'], missing:[], cta:'Contact sales', href:'/signup'},
          ].map(plan => (
            <div key={plan.name} style={{
              background: plan.featured ? (dark ? '#E8E6E1' : '#1A1917') : t.base,
              padding:'40px 32px', position:'relative'
            }}>
              {plan.featured && (
                <div style={{
                  position:'absolute', top:'16px', right:'16px',
                  background:t.accent, color:'white',
                  fontSize:'10px', fontWeight:600, padding:'3px 10px',
                  borderRadius:'10px', textTransform:'uppercase', letterSpacing:'.05em'
                }}>Most popular</div>
              )}
              <div style={{fontSize:'11px', fontWeight:600, letterSpacing:'.08em', textTransform:'uppercase', color: plan.featured ? (dark ? '#9A9790' : '#6B6860') : t.text3, marginBottom:'8px', fontFamily:'var(--font-syne)'}}>{plan.name}</div>
              <div style={{fontFamily:'var(--font-syne)', fontWeight:800, fontSize:'52px', letterSpacing:'-0.03em', color: plan.featured ? (dark ? '#1A1917' : '#E8E6E1') : t.text, lineHeight:1, marginBottom:'6px'}}>{plan.price}</div>
              <div style={{fontSize:'13px', color: plan.featured ? (dark ? '#9A9790' : '#5A5955') : t.text3, marginBottom:'8px'}}>{plan.per}</div>
              <div style={{fontSize:'13px', color: plan.featured ? (dark ? '#6B6860' : '#9A9790') : t.text3, marginBottom:'24px'}}>{plan.desc}</div>
              <div style={{height:'1px', background: plan.featured ? (dark ? '#D5D1C7' : '#2E2D29') : t.border, marginBottom:'24px'}}></div>
              {plan.features.map(f => (
                <div key={f} style={{display:'flex', alignItems:'center', gap:'8px', marginBottom:'10px', fontSize:'13px', color: plan.featured ? (dark ? '#1A1917' : '#E8E6E1') : t.text2}}>
                  <div style={{width:'16px', height:'16px', borderRadius:'50%', background:t.accentDim, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-4" stroke={t.accent} strokeWidth="1.2" strokeLinecap="round"/></svg>
                  </div>
                  {f}
                </div>
              ))}
              {plan.missing.map(f => (
                <div key={f} style={{display:'flex', alignItems:'center', gap:'8px', marginBottom:'10px', fontSize:'13px', color:t.text3}}>
                  <div style={{width:'16px', height:'16px', borderRadius:'50%', background:t.raised, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M2 2l4 4M6 2L2 6" stroke={t.text3} strokeWidth="1.2" strokeLinecap="round"/></svg>
                  </div>
                  {f}
                </div>
              ))}
              <a href={plan.href} style={{
                display:'block', width:'100%', padding:'12px', borderRadius:'7px',
                fontFamily:'var(--font-dm-sans)', fontSize:'14px', fontWeight:500,
                cursor:'pointer', marginTop:'8px', border:'none', textAlign:'center',
                textDecoration:'none',
                background: plan.featured ? (dark ? '#1A1917' : '#E8E6E1') : t.raised,
                color: plan.featured ? (dark ? 'white' : '#1A1917') : t.text2,
              }}>{plan.cta}</a>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{padding:'120px 48px', textAlign:'center', background:t.base}}>
        <h2 style={{fontSize:'52px', fontWeight:800, letterSpacing:'-0.02em', marginBottom:'16px', lineHeight:1.1, color:t.text}}>
          Stop wrestling with Excel.<br/>Start shipping clean data.
        </h2>
        <p style={{fontSize:'17px', color:t.text2, marginBottom:'40px', fontWeight:300}}>
          Join analysts already using DataStudio to save hours every week.
        </p>
        <div style={{display:'flex', alignItems:'center', justifyContent:'center', gap:'16px'}}>
          <a href="/signup" style={{...btnPrimary, padding:'16px 36px', fontSize:'16px'}}>Get started free →</a>
          <a href="/login" style={{...btnGhost, padding:'15px 28px'}}>Sign in</a>
        </div>
        <p style={{fontSize:'12px', color:t.text3, marginTop:'20px'}}>No credit card · Cancel anytime · GDPR compliant</p>
      </section>

      {/* FOOTER */}
      <footer style={{
        padding:'32px 48px', borderTop:`1px solid ${t.border}`,
        display:'flex', alignItems:'center', justifyContent:'space-between',
        fontSize:'13px', color:t.text3, background:t.surface
      }}>
        <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
          <div style={{width:'20px', height:'20px', borderRadius:'4px', background:t.accent, display:'flex', alignItems:'center', justifyContent:'center'}}>
            <svg viewBox="0 0 13 13" fill="none" width="11" height="11">
              <rect x="0" y="0" width="5.5" height="5.5" rx="1" fill="white"/>
              <rect x="7.5" y="0" width="5.5" height="5.5" rx="1" fill="white" opacity=".6"/>
              <rect x="0" y="7.5" width="5.5" height="5.5" rx="1" fill="white" opacity=".6"/>
              <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1" fill="white" opacity=".3"/>
            </svg>
          </div>
          <span style={{fontFamily:'var(--font-syne)', fontWeight:700, fontSize:'14px', color:t.text}}>DataStudio</span>
        </div>
        <div style={{display:'flex', gap:'24px'}}>
          <a href="#" style={{color:t.text3, textDecoration:'none'}}>Privacy</a>
          <a href="#" style={{color:t.text3, textDecoration:'none'}}>Terms</a>
          <a href="#" style={{color:t.text3, textDecoration:'none'}}>Contact</a>
        </div>
        <span>© 2026 DataStudio</span>
      </footer>

    </main>
  )
}