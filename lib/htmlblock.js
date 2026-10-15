/*
  lib/htmlblock.js
  --------------------------------------------------------------------------
  THE HTML PROTOTYPE BLOCK — the pure half.

  Paste a whole HTML page (a prototype from Claude, a CodePen export, a saved
  file) and see it run next to your data. The page runs in an iframe that is
  isolated three ways, and every one of them matters:

    1. sandbox="allow-scripts allow-forms allow-modals" and NO allow-same-origin.
       The frame gets an opaque origin: it cannot read DataStudio's cookies,
       localStorage, IndexedDB or Supabase session, cannot touch the parent's
       DOM, and cannot navigate the top window.

    2. It is loaded from its OWN route, /sandbox/html-preview, which proxy.js
       serves with its own CSP instead of the app's. A srcdoc frame would
       inherit the app's CSP, and that CSP (rightly) blocks every script not
       from our origin — so CDN-loaded React or Chart.js, the usual shape of a
       Claude prototype, would silently fail to load.

    3. The code crosses by postMessage, checked on both ends: the shell only
       accepts from its parent, the canvas only accepts from that frame's
       contentWindow.

  Everything here is string and number work, so it is unit-tested without a
  browser.
  -------------------------------------------------------------------------- */

/** The route that serves the empty shell. */
export const PREVIEW_PATH = '/sandbox/html-preview'

/** Stored in the block, so it syncs like any other content. Past this, a
 *  prototype belongs in a file, and a block this size would make every sync
 *  of the notebook slow. */
export const MAX_HTML_BYTES = 500 * 1024

/** Log lines kept per run, and the longest single line shown. */
export const MAX_LOGS = 200
export const MAX_LOG_CHARS = 2000

export const SANDBOX = 'allow-scripts allow-forms allow-modals'

/** Device widths for the preview. `null` = fill the block. */
export const VIEWPORTS = [
  { id: 'fill', label: 'Fill', w: null },
  { id: 'desktop', label: 'Desktop', w: 1280 },
  { id: 'tablet', label: 'Tablet', w: 768 },
  { id: 'phone', label: 'Phone', w: 390 },
]

/** The CSP the shell route is served with. Permissive on purpose about WHERE
 *  scripts come from (https CDNs, inline), strict about what the frame may do
 *  to anyone else: it may only be framed by us, may not submit forms off-site,
 *  and has no base-uri to rewrite. The sandbox is what protects the app; this
 *  is what lets prototypes actually load their libraries. */
export function previewCsp() {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' https: blob: data:",
    "style-src 'unsafe-inline' https:",
    "img-src https: data: blob:",
    "font-src https: data:",
    "media-src https: data: blob:",
    "connect-src https:",
    "worker-src blob:",
    "frame-src https:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join('; ')
}

export const byteLength = s => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(String(s ?? '')).length : String(s ?? '').length)

/** The console bridge, injected ahead of the user's code: forwards console
 *  output, uncaught errors and unhandled rejections to the canvas. `token`
 *  ties each message to the run that produced it, so a slow message from the
 *  previous run cannot land in the new run's console. */
export function bridgeScript(token) {
  const t = JSON.stringify(String(token))
  return `<script>(function(){var T=${t};function f(x){try{if(x instanceof Error)return x.name+': '+x.message;if(typeof x==='object'&&x!==null)return JSON.stringify(x);return String(x)}catch(e){return String(x)}}
function s(k,a){try{parent.postMessage({dsHtml:1,token:T,kind:k,text:Array.prototype.map.call(a,f).join(' ')},'*')}catch(e){}}
['log','info','warn','error','debug'].forEach(function(k){var o=console[k];console[k]=function(){s(k==='debug'?'log':k,arguments);if(o)o.apply(console,arguments)}});
addEventListener('error',function(e){s('error',[(e.message||'Error')+(e.lineno?' (line '+e.lineno+')':'')])});
addEventListener('unhandledrejection',function(e){var r=e.reason;s('error',['Unhandled promise rejection: '+(r&&r.message||r)])});})();<\/script>`
}

/** The user's page with the bridge placed first thing in it: after <head>
 *  when there is one, after <html> when that is all there is, otherwise in
 *  front. Never before a doctype — that would drop the page into quirks mode. */
export function withBridge(html, token) {
  const src = String(html ?? '')
  const b = bridgeScript(token)
  const head = /<head(\s[^>]*)?>/i.exec(src)
  if (head) return src.slice(0, head.index + head[0].length) + b + src.slice(head.index + head[0].length)
  const root = /<html(\s[^>]*)?>/i.exec(src)
  if (root) return src.slice(0, root.index + root[0].length) + b + src.slice(root.index + root[0].length)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(src)
  if (doctype) return doctype[0] + b + src.slice(doctype[0].length)
  return b + src
}

/** A console line from the frame, cleaned for display, or null when it is
 *  not ours (wrong shape, stale run). */
export function readLog(data, token) {
  if (!data || data.dsHtml !== 1 || data.token !== token) return null
  const kind = ['log', 'info', 'warn', 'error'].includes(data.kind) ? data.kind : 'log'
  const text = String(data.text ?? '').slice(0, MAX_LOG_CHARS)
  return { kind, text }
}

/** How a device width fits into the preview area: the scale (never above 1)
 *  and the frame's own size in CSS px. */
export function fitViewport(vw, area) {
  const W = Math.max(0, area?.w || 0), H = Math.max(0, area?.h || 0)
  if (!vw) return { w: W, h: H, scale: 1, left: 0, top: 0 }
  const pad = 12
  const scale = Math.min(1, Math.max(0.1, (W - pad * 2) / vw))
  const h = Math.max(0, (H - pad * 2) / scale)
  return { w: vw, h, scale, left: Math.max(pad, (W - vw * scale) / 2), top: pad }
}

/** A readable title from the page, for the block name on paste or drop. */
export function titleOf(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html ?? ''))
  if (!m) return ''
  return m[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim().slice(0, 80)
}

export const STARTER_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Prototype</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 32px; color: #1a1917; background: #f6f5f1; }
    .card { max-width: 360px; background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 6px 24px rgba(0,0,0,.08); }
    button { margin-top: 12px; border: 0; border-radius: 8px; padding: 8px 14px; background: #1d9e75; color: #fff; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1 style="font-size:18px;margin:0 0 6px">Paste your HTML here</h1>
    <p style="margin:0;color:#6b6860">Replace this page with any prototype. It runs sandboxed, and console output shows below.</p>
    <button onclick="console.log('Clicked at', new Date().toLocaleTimeString())">Try the console</button>
  </div>
</body>
</html>
`
