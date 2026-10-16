//@include fresh.js
await page.getByText('New Sheet', { exact: true }).first().click(); await sleep(500)
await page.locator('[role=application]').focus()
const out = []
for (let i = 0; i < 5; i++) {
  await page.keyboard.press('Tab'); await sleep(60)
  out.push(await page.evaluate(() => {
    const a = document.activeElement
    const chain = []; let e = a
    for (let k = 0; e && k < 7; k++, e = e.parentElement) chain.push(e.tagName + (e.getAttribute('data-ds-block-wrap') ? '[wrap ' + e.getAttribute('data-ds-block-wrap') + ']' : '') + (e.getAttribute('data-block-id') ? '[bid]' : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '') + (e.style?.display === 'none' ? '(none)' : '') + (e.getAttribute('aria-hidden') ? '(aria-hidden)' : ''))
    return { tab: a.tabIndex, attrs: [...a.attributes].map(x => x.name + '=' + x.value.slice(0, 40)).join(' '), chain: chain.join(' < ') }
  }))
}
out.push(await page.evaluate(() => [...document.querySelectorAll('[data-ds-block-wrap]')].map(b => b.getAttribute('data-ds-block-wrap') + ' ' + b.getBoundingClientRect().x)))
return out
