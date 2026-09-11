import { DEFAULT_PREFS, normalizePrefs, migratePrefs, shouldReduceMotion, GRID_SIZES } from '../lib/prefs.js'
let pass=0, fail=0
const eq=(a,b,m)=>{const A=JSON.stringify(a),B=JSON.stringify(b);A===B?(pass++,console.log('  ok   '+m)):(fail++,console.log(`  FAIL ${m}\n        got      ${A}\n        expected ${B}`))}

console.log('\n normalizePrefs — untrusted input')
eq(normalizePrefs(null), DEFAULT_PREFS, 'null → defaults')
eq(normalizePrefs(undefined), DEFAULT_PREFS, 'undefined → defaults')
eq(normalizePrefs('nonsense'), DEFAULT_PREFS, 'string → defaults')
eq(normalizePrefs(42), DEFAULT_PREFS, 'number → defaults')
eq(normalizePrefs({}).gridSize, 32, 'empty object → default gridSize')
eq(normalizePrefs({gridSize:0}).gridSize, 32, 'gridSize 0 rejected (would divide by zero in the SVG pattern)')
eq(normalizePrefs({gridSize:NaN}).gridSize, 32, 'gridSize NaN rejected')
eq(normalizePrefs({gridSize:'48'}).gridSize, 48, 'gridSize numeric string coerced')
eq(normalizePrefs({gridSize:999}).gridSize, 32, 'gridSize off-list rejected')
eq(normalizePrefs({gridSize:64}).gridSize, 64, 'gridSize on-list kept')
eq(normalizePrefs({dark:'true'}).dark, false, 'dark string is not truthy-coerced')
eq(normalizePrefs({dark:true}).dark, true, 'dark real boolean kept')
eq(normalizePrefs({gridAlways:1}).gridAlways, false, 'gridAlways 1 is not a boolean')
eq(Object.keys(normalizePrefs({evil:'x',dark:true})).includes('evil'), false, 'unknown keys dropped')
eq(normalizePrefs({reduceMotion:'yes'}).reduceMotion, null, 'reduceMotion garbage → null (follow OS)')
eq(normalizePrefs({reduceMotion:false}).reduceMotion, false, 'reduceMotion explicit false preserved, not coerced to null')

console.log('\n migratePrefs — v3 workspaces with no prefs key')
globalThis.window = {}
globalThis.localStorage = { _v:'true', getItem(k){return k==='datastudio-dark'?this._v:null}, setItem(){} }
eq(migratePrefs(undefined).dark, true, 'no prefs + dark mirror → stays dark on upgrade')
globalThis.localStorage._v='false'
eq(migratePrefs(undefined).dark, false, 'no prefs + light mirror → light')
globalThis.localStorage._v=null
eq(migratePrefs(undefined), DEFAULT_PREFS, 'no prefs + no mirror → defaults')
globalThis.localStorage._v='true'
eq(migratePrefs({dark:false, gridAlways:true}).dark, false, 'stored prefs WIN over the legacy mirror')
eq(migratePrefs({gridAlways:true}).gridAlways, true, 'stored prefs preserved')
globalThis.localStorage={getItem(){throw new Error('private mode')},setItem(){throw new Error('private mode')}}
eq(migratePrefs(undefined), DEFAULT_PREFS, 'localStorage throwing (private mode) does not crash')

console.log('\n shouldReduceMotion')
globalThis.window={matchMedia:()=>({matches:true})}
eq(shouldReduceMotion({reduceMotion:null}), true,  'null follows the OS (OS says reduce)')
eq(shouldReduceMotion({reduceMotion:false}), false,'explicit false overrides an OS that says reduce')
eq(shouldReduceMotion({reduceMotion:true}), true,  'explicit true')
globalThis.window={matchMedia:()=>({matches:false})}
eq(shouldReduceMotion({reduceMotion:null}), false, 'null follows the OS (OS says no)')
eq(shouldReduceMotion(undefined), false, 'undefined prefs does not throw')

console.log('\n imageDropMode')
eq(normalizePrefs({imageDropMode:'icon'}).imageDropMode, 'icon', 'icon is accepted')
eq(normalizePrefs({imageDropMode:'full'}).imageDropMode, 'full', 'full is accepted')
eq(normalizePrefs({imageDropMode:'compact'}).imageDropMode, 'full',
   "compact is NOT a drop mode — only a section's Compact toggle produces it")
eq(normalizePrefs({imageDropMode:'nonsense'}).imageDropMode, 'full', 'an unknown value falls back to full')
eq(normalizePrefs({}).imageDropMode, 'full', 'absent falls back to full')

console.log('\n round trip')
/* Every pref, listed. Adding one to lib/prefs.js and NOT to this line
   fails here — which is the point: a pref that does not survive a save/load
   cycle is a setting that silently forgets itself. The order has to match
   what normalizePrefs emits, because the comparison is on the serialised
   form — same reason the save payload is compared this way. */
const messy={dark:true,gridAlways:true,sidebarCollapsed:true,snapDefault:true,gridSize:16,reduceMotion:false,imageDropMode:'icon'}
eq(normalizePrefs(JSON.parse(JSON.stringify(normalizePrefs(messy)))), messy, 'survives a JSON save/load cycle unchanged')
eq(GRID_SIZES.includes(DEFAULT_PREFS.gridSize), true, 'the default gridSize is itself a legal choice')

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail?1:0)
