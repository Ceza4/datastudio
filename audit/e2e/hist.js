// Reads AppPage's undo history out of React's fiber tree (debug only).
H.history = async () => page.evaluate(() => {
  const el = document.querySelector('[role=application]') || document.body.firstElementChild
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber'))
  let f = el[key]
  while (f) {
    let hk = f.memoizedState
    while (hk && typeof hk === 'object' && 'next' in hk) {
      const v = hk.memoizedState
      if (v && typeof v === 'object' && v.current && Array.isArray(v.current.past) && Array.isArray(v.current.future)) {
        const sum = e => {
          const diff = []
          const B = e.before, A = e.after
          for (const nb of A || []) {
            const ob = (B || []).find(x => x.id === nb.id)
            if (!ob) { diff.push('+nb ' + nb.name); continue }
            if (ob === nb) continue
            for (const k of Object.keys(nb)) if (ob[k] !== nb[k]) diff.push(nb.name + '.' + k)
          }
          return e.label + ' [' + diff.join(',') + ']'
        }
        return { past: v.current.past.map(sum), future: v.current.future.map(sum) }
      }
      hk = hk.next
    }
    f = f.return
  }
  return null
})
