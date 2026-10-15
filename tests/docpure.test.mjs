/* The Document block's pure pieces: history, comments threads and card
   stacking, citations, case changes, autoformat, footnotes and TOC. */
import { createHistory, inputKind } from '../lib/dochistory.js'
import { addThread, editThread, replyTo, setResolved, removeThread, stackCards } from '../lib/doccomments.js'
import { parseAuthors, inText, referenceHtml, bibInner } from '../lib/doccite.js'
import { caseText, nextCase, smartQuote, autoformatFor, isRuleLine, dateFormats } from '../lib/docformat.js'
import { renumberNotes, pruneNotes, tocInner } from '../lib/docnotes.js'
import { pageInches, validCustom } from '../lib/pagesetup.js'
import { finalHtml } from '../lib/doctrack.js'
let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }

console.log('\n history')
const h = createHistory()
h.reset({ html: 'a', sel: null })
h.record({ html: 'ab', sel: 1 }, 'type')
h.record({ html: 'abc', sel: 2 }, 'type')
ok(h.size === 2, 'a typing burst is one step')
h.record({ html: 'abc<p></p>', sel: 3 }, 'para')
h.record({ html: 'abc<p>d</p>', sel: 4 }, 'type')
ok(h.size === 4, 'Enter breaks the burst')
ok(h.undo().html === 'abc<p></p>' && h.undo().html === 'abc' && h.undo().html === 'a' && h.undo() === null, 'undo walks back to the load state and stops')
ok(h.redo().html === 'abc' && h.canRedo(), 'redo walks forward')
h.record({ html: 'X', sel: 0 }, 'cmd')
ok(!h.canRedo(), 'a new edit drops the redo branch')
h.record({ html: 'X', sel: 5 }, 'cmd')
ok(h.size === 3, 'the same HTML is not a new step')
h.record({ html: 'XY', sel: 1 }, 'type'); h.record({ html: 'X', sel: 0 }, 'delete')
ok(h.size === 5, 'switching between typing and deleting starts a new step')
ok(inputKind('insertText') === 'type' && inputKind('deleteContentBackward') === 'delete' && inputKind('insertParagraph') === 'para' && inputKind(null) === 'cmd', 'input kinds')

console.log('\n comment threads')
const me = { id: 'u1', name: 'Matas' }
let list = addThread([], { id: 'c1', text: '', author: me, at: '2026-09-26T10:00:00Z' })
ok(list.length === 1 && list[0].by === 'Matas' && !list[0].resolved, 'a new thread')
list = editThread(list, 'c1', 'Source?')
ok(list[0].text === 'Source?' && !list[0].edited, 'posting the first words is not an edit')
list = editThread(list, 'c1', 'Source please')
ok(list[0].edited, 'changing them is')
list = replyTo(list, 'c1', { text: 'Oke 1982', author: { id: 'u2', name: 'Ana' } })
ok(list[0].replies.length === 1 && list[0].replies[0].by === 'Ana', 'reply')
ok(setResolved(list, 'c1', true)[0].resolved && removeThread(list, 'c1').length === 0, 'resolve and remove')
const st = stackCards([{ id: 'a', y: 100, h: 80 }, { id: 'b', y: 120, h: 50 }, { id: 'c', y: 400, h: 40 }], null)
ok(st.get('a') === 100 && st.get('b') === 188 && st.get('c') === 400, 'cards stack without overlapping')
const st2 = stackCards([{ id: 'a', y: 100, h: 80 }, { id: 'b', y: 120, h: 50 }], 'b')
ok(st2.get('b') === 120 && st2.get('a') + 80 + 8 <= 120, 'the active card sits level with its text; others make room')

console.log('\n citations')
ok(parseAuthors('Oke, Timothy R.; Smith, Jane').map(a => a.last).join() === 'Oke,Smith', 'authors as Last, First')
ok(parseAuthors('Jane Smith and John Doe').map(a => a.last).join() === 'Smith,Doe', 'authors as First Last')
const src = { id: 's', authors: 'Oke, Timothy R.', year: '1982', title: 'The energetic basis', container: 'QJRMS', pages: '1–24' }
ok(inText(src) === '(Oke, 1982)' && inText(src, 'mla') === '(Oke)', 'in-text APA and MLA')
ok(inText({ ...src, authors: 'A, B; C, D; E, F' }) === '(A et al., 1982)', 'three authors: et al.')
ok(inText({ ...src, authors: 'A, B; C, D' }) === '(A & C, 1982)', 'two authors: &')
ok(referenceHtml(src).startsWith('Oke, T. R. (1982). The energetic basis. <i>QJRMS</i>'), 'APA reference')
ok(referenceHtml({ ...src, title: '<script>' }).includes('&lt;script&gt;'), 'reference text is escaped')
ok(bibInner([]).includes('References') && bibInner([], 'mla').includes('Works Cited'), 'bibliography heading per style')

console.log('\n case, quotes, autoformat')
ok(caseText('hello world. again', 'sentence') === 'Hello world. Again', 'sentence case')
ok(caseText('the urban-heat island', 'title') === 'The Urban-Heat Island', 'capitalise each word')
ok(caseText('AbC', 'toggle') === 'aBc', 'toggle case')
ok(nextCase('HELLO') === 'lower' && nextCase('hello') === 'title' && nextCase('Hello There') === 'upper', 'Shift+F3 cycle')
ok(smartQuote('"', '') === '“' && smartQuote('"', 'word') === '”' && smartQuote("'", 'it') === '’', 'smart quotes')
ok(autoformatFor('- ').kind === 'ul' && autoformatFor('1. ').kind === 'ol' && autoformatFor('## ').kind === 'h2' && autoformatFor('> ').kind === 'blockquote', 'autoformat triggers')
ok(autoformatFor('a- ') === null && autoformatFor('word ') === null, 'not mid-text')
ok(isRuleLine('---') && isRuleLine('***') && !isRuleLine('--'), 'rule lines')
ok(dateFormats(new Date(2026, 8, 26)).includes('26/09/2026'), 'date formats')

console.log('\n footnotes, TOC, page size, final text')
ok(pruneNotes({ a: 'x', b: 'y' }, ['a']).b === undefined && pruneNotes({ a: 'x' }, ['a']).a === 'x', 'unreferenced notes are pruned')
ok(renumberNotes(null).length === 0, 'no editor, no notes')
const toc = tocInner([{ level: 1, text: 'One', page: 1 }, { level: 2, text: 'A <b>', page: 3 }, { level: 4, text: 'deep', page: 3 }])
ok(toc.includes('>One<') && toc.includes('A &lt;b&gt;') && !toc.includes('deep'), 'TOC: levels 1–3, escaped')
ok(pageInches('custom', 'portrait', { w: 5, h: 7 }).w === 5 && pageInches('custom', 'portrait', { w: 50, h: 7 }).w === 8.27, 'custom size, and a bad one falls back to A4')
ok(validCustom({ w: 2, h: 22 }) && !validCustom({ w: 1, h: 5 }), 'custom size limits')
ok(pageInches('b5').label === 'B5' && pageInches('executive', 'landscape').w === 10.5, 'B5 and Executive')
ok(finalHtml('<p>a</p>') === '<p>a</p>', 'final text without a DOM is left alone')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
