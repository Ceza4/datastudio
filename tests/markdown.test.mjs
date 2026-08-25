/*
  tests/markdown.test.mjs
  --------------------------------------------------------------------------
  The Markdown importer.

  WHY THIS FILE EXISTS
  DataStudio could already EXPORT Markdown and could not read it back, so the
  importer's job is defined by the exporter: whatever blocksToMarkdown emits
  has to survive a round trip, plus the basics people type by hand.

  THE PART THAT MATTERS MOST is the escaping order. Every character of the
  source is HTML-escaped BEFORE a single tag is generated, so raw HTML in a
  .md file is inert by construction rather than by a filter. The assertions
  below prove that for script tags, event handlers and javascript: URLs — and
  one of them (`the escaped output is not escaped AGAIN`) exists because the
  first version ran the result through lib/sanitize.js as a second defence,
  which escapes every ampersand in a text node and therefore turned every
  entity and every code block into visible garbage. A non-idempotent transform
  at the end of a generator is a bug, not a belt.
  -------------------------------------------------------------------------- */

import { markdownToHtml, markdownTitle, MARKDOWN_EXTS } from '../lib/markdown.js'

let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }
const md = (...lines) => markdownToHtml(lines.join('\n'))
const has = (html, frag) => html.includes(frag)

console.log('\n blocks')
{
  ok(md('# One') === '<h1>One</h1>', 'an h1')
  ok(md('###### Six') === '<h6>Six</h6>', 'and an h6')
  ok(md('####### Seven').startsWith('<p>'), 'seven hashes is not a heading, it is a paragraph')
  ok(md('#NoSpace').startsWith('<p>'), 'and a hash with no space is a paragraph too')
  ok(md('---') === '<hr>', 'a horizontal rule')
  ok(md('***') === '<hr>', 'in either spelling')
  ok(markdownToHtml('') === '' && markdownToHtml('   ') === '', 'empty input produces nothing, not an empty paragraph')
  ok(markdownToHtml(null) === '' && markdownToHtml(42) === '', 'non-strings, without throwing')
}

console.log('\n paragraphs')
{
  ok(md('one', 'two') === '<p>one two</p>',
     'wrapped lines JOIN with a space, per CommonMark — hard-wrapped prose has to reflow, not arrive as a column')
  ok(has(md('one  ', 'two'), '<br>'), 'two trailing spaces is an explicit hard break')
  ok(has(md('one' + String.fromCharCode(92), 'two'), '<br>'), 'and so is a trailing backslash')
  ok(md('a', '', 'b') === '<p>a</p>\n<p>b</p>', 'a blank line separates paragraphs')
}

console.log('\n inline')
{
  ok(has(md('a **b** c'), '<strong>b</strong>'), 'bold')
  ok(has(md('a *b* c'), '<em>b</em>'), 'emphasis')
  ok(has(md('a ~~b~~ c'), '<s>b</s>'), 'strikethrough')
  ok(!has(md('a snake_case_name b'), '<em>'),
     'snake_case survives — mid-word underscores are far more common here than mid-word emphasis')
  ok(!has(md('a * b * c'), '<em>'), 'a bare asterisk with spaces around it is not emphasis')
  ok(has(md('use `a*b*c` here'), '<code>a*b*c</code>'),
     'markdown INSIDE a code span is not markdown — the one place characters must mean themselves')
  ok(!has(md('use `a*b*c` here'), '<em>'), 'and really is not, not even a little')
}

console.log('\n code blocks')
{
  const out = md('```js', 'if (a < b && c) x = "y";', '```')
  ok(has(out, '<pre><code>'), 'a fenced block')
  ok(has(out, '&lt;') && has(out, '&amp;&amp;') && has(out, '&quot;'), 'with its contents escaped exactly once')
  ok(!has(out, '&amp;lt;'),
     'the escaped output is not escaped AGAIN — running a sanitiser over generated html double-escapes every entity')
  ok(has(md('```', 'never closed'), '<pre><code>never closed</code></pre>'),
     'an unclosed fence still produces a block rather than swallowing the document')
}

console.log('\n lists')
{
  ok(md('- a', '- b') === '<ul><li>a</li><li>b</li></ul>', 'a bullet list')
  ok(md('1. a', '2. b') === '<ol><li>a</li><li>b</li></ol>', 'an ordered list')
  ok(has(md('- a', '  - b'), '<li>a<ul><li>b</li></ul></li>'),
     'a nested list opens INSIDE its parent item — a sibling list renders almost the same and exports completely differently')
  ok(has(md('- [x] done'), '&#9745;') && has(md('- [ ] todo'), '&#9744;'),
     'task items become glyphs — a real checkbox is a form control, and a form control in a note is a lie about being interactive')
  ok(md('---') === '<hr>',
     'three dashes is a rule, not an empty bullet — the list pattern matches it too, so order of tests is load-bearing')
}

console.log('\n blockquotes and tables')
{
  ok(has(md('> **hi**'), '<blockquote><p>hi'.replace('hi', '<strong>hi</strong>')),
     'a quote contains parsed markdown, not raw text')
  const t = md('| a | b |', '|---|---|', '| 1 | 2 |')
  ok(has(t, '<th>a</th>') && has(t, '<td>2</td>'), 'a pipe table')
  ok(!has(md('A pipe | in a sentence.'), '<table>'),
     'and a sentence containing a pipe is NOT a table — the separator row is what makes it one')
  ok(has(md('| a | b |', '|---|---|', '| 1 |'), '<td></td>'),
     'a short row is padded rather than dropped')
}

console.log('\n links — every one is checked, and every one opens safely')
{
  const good = md('[x](https://a.com)')
  ok(has(good, 'href="https://a.com/"'), 'an https link')
  ok(has(good, 'target="_blank"') && has(good, 'rel="noopener noreferrer nofollow"'),
     'with target and rel — without noopener the opened page gets a handle back into this origin')
  ok(has(md('[x](https://a.com "t")'), 'title="t"'), 'a title')
  ok(has(md('<https://a.com>'), '<a href="https://a.com/"'), 'an autolink')

  const bad = md('[bad](javascript:alert(1))')
  ok(!has(bad, '<a'), 'a javascript: URL does not become a link')
  ok(has(bad, '[bad]'),
     'and its text is returned INTACT — returning only the label left a stray bracket behind and visibly damaged the line')
  ok(!has(md('[x](data:text/html,<script>alert(1)</script>)'), '<a'), 'nor a data: URL')
  ok(!has(md('[x](vbscript:msgbox(1))'), '<a'), 'nor vbscript:')
}

console.log('\n raw HTML is inert by construction')
{
  const s = md('<script>alert(1)</script>')
  ok(!has(s, '<script'), 'a script tag does not survive')
  ok(has(s, '&lt;script&gt;'), 'it is shown as the text it looks like')
  ok(!has(md('<img src=x onerror=alert(1)>'), '<img'), 'an img with an event handler does not survive')
  /* The STRINGS "javascript:" and "onclick" do still appear in the output,
     and that is correct: they are inert text now, displayed the way the file
     wrote them. Asserting their absence would be asserting that the importer
     censors prose about javascript URLs. What must be absent is a live tag. */
  const inlineA = md('<a href="javascript:alert(1)">x</a>')
  ok(!has(inlineA, '<a ') && has(inlineA, '&lt;a href='),
     'an inline anchor with a javascript: href is shown as text, never as a link')
  const div = md('<div onclick="x()">y</div>')
  ok(!has(div, '<div') && has(div, '&lt;div'),
     'and an event handler cannot attach to anything, because nothing from the source is a tag')
  ok(!has(md('<iframe src="//evil"></iframe>'), '<iframe'), 'nor an iframe')
  /* Escaping happens BEFORE generation, so there is no order in which a tag
     from the source can be reassembled out of fragments. */
  ok(!has(md('<scr<script>ipt>alert(1)</script>'), '<script'),
     'nor a tag spliced together out of two halves — the classic way a regex-based stripper MANUFACTURES the tag it removed')
}

console.log('\n titles')
{
  ok(markdownTitle('# Hello', 'fb') === 'Hello', 'the first heading is the title')
  ok(markdownTitle('intro text', 'fb') === 'fb', 'a document that does not start with a heading falls back')
  ok(markdownTitle('some text\n# Later', 'fb') === 'fb',
     'and a heading further down is a SECTION, not a title')
  ok(markdownTitle('', 'fb') === 'fb' && markdownTitle(null, 'fb') === 'fb', 'empty and null')
  ok(markdownTitle('# ' + 'x'.repeat(400), 'fb').length === 120, 'a runaway title is truncated')
}

console.log('\n extensions')
{
  ok(MARKDOWN_EXTS.includes('.md') && MARKDOWN_EXTS.includes('.markdown'), 'the extensions people actually use')
}

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
