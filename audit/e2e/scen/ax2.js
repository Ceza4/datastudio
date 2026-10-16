const res = await page.evaluate(async () => {
  const r = await axe.run(document, { runOnly: ['button-name', 'label', 'scrollable-region-focusable'] })
  return r.violations.flatMap(v => v.nodes.map(x => { const el = document.querySelector(x.target[0]); const ctx = el?.closest('[data-ds-block-wrap]') ? 'block' : el?.closest('[data-kbd-zone]') ? 'zone' : 'page'; return v.id + ' | ' + ctx + ' | ' + (el?.parentElement?.innerText || '').replace(/\s+/g, ' ').slice(0, 50) + ' | ' + el?.innerHTML.slice(0, 120) }))
})
return res
