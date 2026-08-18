/*
  lib/sanitize.js
  --------------------------------------------------------------------------
  Turning stored block HTML into HTML that is safe to write into a document.

  WHY THE PREVIOUS VERSION WAS NOT JUST INCOMPLETE BUT ACTIVELY DANGEROUS

  It was two regexes over the input:

      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')

  Three separate failures, and the third is the one that matters:

  1. A BLOCKLIST. `<iframe src="javascript:…">`, `<object data=…>`,
     `<meta http-equiv=refresh>`, `<base href=//evil>`, `<form action=…>` and
     `<svg><animate attributeName=href values=javascript:…>` all sail through,
     because none of them are the two things being looked for.

  2. `\son\w+` NEEDS LEADING WHITESPACE. HTML also accepts `/` as an attribute
     separator, so `<img/src=x/onerror=alert(1)>` parses as a real handler and
     never matches. That one fires with no user interaction.

  3. String.replace SPLICES AND NEVER RESCANS. Removing the inner match from

         <sc<script>x</script>ript>alert(1)</sc<script>y</script>ript>

     joins `<sc` to `ript>` and PRODUCES `<script>alert(1)</script>`. The
     sanitiser manufactured the tag. No amount of patching a blocklist fixes
     that, because the flaw is the splice, not the pattern.

  And it mattered more than "it's only your own content", because `exportPdf`
  does `window.open('')` then `document.write(...)` — and a script-opened
  about:blank INHERITS THIS ORIGIN. Anything surviving here runs as DataStudio,
  with every notebook, spreadsheet, image and PDF in IndexedDB in reach.

  HOW THIS ONE WORKS

  A single forward scan that BUILDS THE OUTPUT FROM SCRATCH. Nothing from the
  input is ever spliced into the result — a tag is re-emitted from an allowlist
  of names and attributes, or it is escaped into text. That makes failure 3
  structurally impossible rather than patched.

  It is fail-closed at every branch: an unknown element, an unknown attribute,
  an unparseable `<`, a malformed comment — all become escaped text, which is
  visible and harmless, rather than being passed through, which is invisible
  and might not be. A few dangerous containers have their CONTENTS dropped as
  well, because the text inside <script> is not text, it is code.

  WHY NOT DOMParser, OR DOMPurify

  DOMParser needs a browser, and `blocksToHtml` is exercised by the Node test
  suite — a sanitiser that cannot be unit-tested is the wrong trade for this.
  DOMPurify is the better answer if the threat model hardens (it has years of
  mXSS hardening this does not), and it is the recommended upgrade the day §9
  starts accepting templates written by other people. Until then, this is
  auditable in one sitting, has no dependency, and is covered both by unit
  tests and by an execution test in a real browser — tests/browser/run.mjs
  injects the output into a live page and asserts nothing runs.
  -------------------------------------------------------------------------- */

import { safeLinkUrl } from './urls.js'

/* Elements a document can legitimately contain. Deliberately small: this is
   the output of a rich-text field, not a web page. Notably absent and staying
   absent — svg and math (foreign content is where mXSS lives), iframe, object,
   embed, form and its inputs, style, link, base, meta, template, noscript. */
const ALLOWED = new Set([
  'p', 'div', 'span', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'mark', 'small', 'sub', 'sup',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'a', 'img', 'figure', 'figcaption',
])

/* No closing tag, so they must not go on the open-element stack. */
const VOID = new Set(['br', 'hr', 'img', 'wbr', 'col', 'area', 'base', 'input', 'link', 'meta', 'source'])

/* Dropping the TAG is not enough for these — what is between them is not text.
   Everything up to the matching close tag goes with it. */
const DROP_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math', 'title', 'textarea'])

/* Per-element attribute allowlist. Everything global — class, id, style, data-*
   — is dropped: the export stylesheet targets classes this module's CALLER
   emits, never one that arrived in user content, and `style` is a vector
   (behavior:, expression(), url(javascript:)) with no benefit here. */
const ATTRS = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  ins: new Set(['datetime']),
  del: new Set(['datetime']),
}

/* Teleporter links are the one piece of app-specific markup that has to
   survive an export — a span carrying an internal address. The VALUE is
   escaped like any other, and it never becomes a URL. */
const DATA_OK = new Set(['data-ds-link'])

const escText = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escAttr = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/* Attribute values are read with the SAME leniency a browser reads them:
   `/` and whitespace both separate, quotes are optional. Being stricter than
   the browser here is the `\son\w+` bug — a handler the parser sees and the
   sanitiser does not. */
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g

function attrsFor(tag, raw) {
  const allowed = ATTRS[tag]
  const out = []
  ATTR_RE.lastIndex = 0
  let m
  while ((m = ATTR_RE.exec(raw)) !== null) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ''

    /* Belt and braces. No `on*` attribute is on any allowlist above, so this
       cannot trigger — it is here so that adding an element to ATTRS can never
       accidentally open the door. */
    if (name.startsWith('on')) continue

    if (DATA_OK.has(name)) { out.push(`${name}="${escAttr(value)}"`); continue }
    if (!allowed || !allowed.has(name)) continue

    if (name === 'href' || name === 'src') {
      /* One allowlist for URLs, shared with the link prompt and the ctrl-click
         handler, so all three agree about what a safe scheme is. */
      const safe = safeLinkUrl(value)
      if (!safe) continue
      out.push(`${name}="${escAttr(safe)}"`)
      continue
    }
    if (name === 'width' || name === 'height' || name === 'colspan' || name === 'rowspan') {
      if (!/^\d{1,5}$/.test(value.trim())) continue
      out.push(`${name}="${value.trim()}"`)
      continue
    }
    out.push(`${name}="${escAttr(value)}"`)
  }

  /* Any link that survived is external and opens in a new tab, so it needs
     rel — target="_blank" without it hands the destination a live opener. */
  if (tag === 'a' && out.some(a => a.startsWith('href='))) {
    out.push('target="_blank"', 'rel="noopener noreferrer nofollow"')
  }
  return out.length ? ' ' + out.join(' ') : ''
}

/**
 * Allowlist-sanitise a fragment of HTML.
 *
 * @param {string} input
 * @returns {string} HTML safe to insert into a document
 */
export function sanitizeHtml(input) {
  const src = String(input ?? '')
  let out = ''
  let i = 0
  const open = []          // element stack, so unclosed tags get closed
  let skipUntil = null     // inside a DROP_CONTENT element

  while (i < src.length) {
    const lt = src.indexOf('<', i)

    if (lt === -1) {
      if (!skipUntil) out += escText(src.slice(i))
      break
    }
    if (lt > i) {
      if (!skipUntil) out += escText(src.slice(i, lt))
    }

    /* Comments. Dropped entirely — conditional comments are an execution
       vector in older engines and there is no reason to carry one into an
       exported document. An UNTERMINATED comment consumes the rest of the
       input, exactly as a parser would; stopping early would let markup after
       a `<!--` be treated as live by the sanitiser and as comment by the
       browser, or the reverse. */
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4)
      i = end === -1 ? src.length : end + 3
      continue
    }
    /* Doctypes, CDATA, processing instructions: dropped the same way. */
    if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
      const end = src.indexOf('>', lt)
      i = end === -1 ? src.length : end + 1
      continue
    }

    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/.exec(src.slice(lt))
    if (!m) {
      /* A `<` that does not begin a tag is a literal less-than. Escaping it
         is what makes `a < b` survive, and what makes a malformed construct
         visible instead of ambiguous. */
      if (!skipUntil) out += '&lt;'
      i = lt + 1
      continue
    }

    const [full, closing, rawName, rawAttrs] = m
    const tag = rawName.toLowerCase()
    i = lt + full.length

    if (skipUntil) {
      // Only the matching close tag ends a dropped region.
      if (closing && tag === skipUntil) skipUntil = null
      continue
    }

    if (closing) {
      if (!ALLOWED.has(tag) || VOID.has(tag)) continue
      /* A close tag with no matching open is a stray — dropping it beats
         emitting one that would close something it never opened. */
      const at = open.lastIndexOf(tag)
      if (at === -1) continue
      /* Implicitly close anything left open inside it, so the output is
         balanced even when the input was not. */
      while (open.length > at) out += `</${open.pop()}>`
      continue
    }

    if (DROP_CONTENT.has(tag)) {
      /* Self-closing form (`<svg/>`) has no content to skip. */
      if (!/\/\s*$/.test(rawAttrs)) skipUntil = tag
      continue
    }
    if (!ALLOWED.has(tag)) continue

    const attrs = attrsFor(tag, rawAttrs)
    /* An <img> whose src was refused has nothing left to show. Emitting the
       bare element leaves a broken-image icon in the export standing in for
       something that was never going to load — dropping it is both cleaner and
       one less element for a reader to wonder about. */
    if (tag === 'img' && !/\ssrc=/.test(attrs)) continue

    out += `<${tag}${attrs}>`
    if (!VOID.has(tag) && !/\/\s*$/.test(rawAttrs)) open.push(tag)
  }

  while (open.length) out += `</${open.pop()}>`
  return out
}

/** True when sanitising would change the markup — for tests and diagnostics. */
export const isCleanHtml = html => sanitizeHtml(html) === String(html ?? '')
