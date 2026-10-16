# Open questions — decisions only Matas can make

Ordered by impact. Each says what was found, what the audit did, and what is recommended.

## Q0 · Hotfix DEF-031 to main now? (urgent)
Every database's Filter menu (and the Name column menu, empty select options, board/calendar "group by", the only view's menu) crashes the block in production. 4-line fix on the branch (`e2245d3`). Recommendation: cherry-pick `e2245d3` to main today, ahead of the rest.

## Q1 · Centre toolbar icon-only below 1700 px (DEF-002)
To stop the title island clipping, the four toolbar words are visually hidden under 1700 px (still announced, every button has a tooltip). Keep, or would you rather move the title island / shrink the sidebar?

## Q2 · Pricing page is out of date
`app/pricing/page.js` shows **Pro $12 / Max $32 per month** and storage-only bullets. Your decided pricing (AGENT_ECONOMICS_SEP27 §15, 29 Sep) is **Pro €20 / Max €50, VAT included**, with 1,500 / 5,000 credits; the app's top-ups are in euros. Not changed — public prices are yours. Recommendation: update the page to €20/€50 (+ annual €190/€480 and credits) before any paid signup.

## Q3 · Two undo stacks
A table has its own Ctrl+Z (cell edits) and the workspace has another. Undo inside the grid is itself recorded as a workspace edit, so leaving the grid and pressing Ctrl+Z re-applies what the grid just undid. Options: (a) route grid edits through the workspace history only; (b) keep both and mark grid-undo as non-recorded. Recommendation: (b) now, (a) later.

## Q4 · Contrast tokens
axe still reports contrast on design tokens (text3 on raised surfaces, accent on accentDim chips). Token changes ripple everywhere, so not touched. Recommendation: darken `--ds-text-3` one step in light theme and re-run axe.

## Q5 · Single-letter shortcuts create blocks (DEF-036)
N T K S D A C I each drop a block when the canvas has focus. Now documented and shown in the Add menu. Keep single letters, or require keyboard mode (M) first so a stray key never creates anything?

## Q6 · Shared projects from other accounts can't be opened (DEF-028)
"Shared with you" lists them, clicking does nothing, and the chip says "Shared from someone". Needs a decision: open read-only, open live (needs an RLS read path for granted docs), or copy in. Minimum interim: a message on click and the sender's name.

## Q7 · Copied blocks travel as JSON text
By design (lib/clipboard.js), but pasting a copied block into a note, an email or Word inserts `datastudio/blocks;v1 {…}`. Recommendation: also write `text/html` with a readable rendering and the payload in a data attribute; canvas paste reads the attribute.

## Q8 · Smaller ones
- Database footer counts "0 fields" next to a visible Name column (title deliberately not counted). Suggest "1 row · Name only" or count it.
- People panel docks bottom-right, ~230 px from its button; Settings/Account open under theirs. Intended?
- Tab order visits the right-hand island (Builder…Account) before the title island and toolbar (DOM order).
- Sidebar project expand/collapse state is not persisted across reloads.
- Should a new Table take the keyboard on add (type straight into A1), like Notes does?
- Ctrl+A on the canvas excludes sections (by design?).
- Sync error detail only appears in the chip's tooltip.
- Chat shows your own messages as "Someone" in the test setup (no account snapshot there); please glance at one live message — it should read "You".
- Clicking the 16 px strip left of the sidebar creates a text block hidden under it.
