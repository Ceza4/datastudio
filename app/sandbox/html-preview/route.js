/*
  app/sandbox/html-preview/route.js
  --------------------------------------------------------------------------
  The empty page an HTML prototype block runs in. lib/htmlblock.js explains
  why it is a separate route rather than a srcdoc frame: its own CSP, so a
  prototype can load its libraries from a CDN, while the sandbox attribute on
  the frame keeps it away from everything that is DataStudio's.

  The shell announces itself to its parent, takes ONE page from it, writes it
  and gets out of the way. It holds no data and knows nothing about the user,
  which is why it needs no session check.
  -------------------------------------------------------------------------- */

import { previewCsp } from '../../../lib/htmlblock'

const SHELL = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"></head><body><script>
(function(){
  function onMessage(e){
    if (e.source !== parent) return;
    var d = e.data;
    if (!d || d.dsHtmlRun !== 1 || typeof d.html !== 'string') return;
    removeEventListener('message', onMessage);
    document.open(); document.write(d.html); document.close();
  }
  addEventListener('message', onMessage);
  parent.postMessage({ dsHtmlReady: 1 }, '*');
})();
</script></body></html>`

export const dynamic = 'force-static'

export function GET() {
  return new Response(SHELL, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': previewCsp(),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
