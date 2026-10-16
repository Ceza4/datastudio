const chip = page.getByText('Sync error').first()
await chip.click().catch(() => {}); await sleep(400)
return await page.evaluate(() => [...document.querySelectorAll('[role=dialog],[role=status],[role=tooltip],[title]')].map(e => (e.getAttribute('title') || e.innerText || '').slice(0, 200)).filter(t => /sync|upload|asset|storage|error/i.test(t)).slice(0, 8))
