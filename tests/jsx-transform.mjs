/*
  tests/jsx-transform.mjs
  --------------------------------------------------------------------------
  The load hook registered by jsx-loader.mjs.

  Transpiles any project .js file that contains JSX. Files without JSX are
  passed straight through, so lib/ modules load at full speed and this can't
  change their semantics.
  -------------------------------------------------------------------------- */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/* Cheap and sufficient: a `<Tag` or `</Tag` that isn't a comparison. Being
   wrong in the permissive direction is harmless — transpiling a file with no
   JSX is a no-op. */
const LOOKS_LIKE_JSX = /<[A-Za-z][\w.]*[\s/>]|<\/[A-Za-z]/

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !url.endsWith('.js')) return nextLoad(url, context)
  if (url.includes('/node_modules/')) return nextLoad(url, context)

  const path = fileURLToPath(url)
  let source
  try { source = await readFile(path, 'utf8') } catch { return nextLoad(url, context) }

  if (!LOOKS_LIKE_JSX.test(source)) {
    return { format: 'module', shortCircuit: true, source }
  }

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      /* Keep line numbers aligned with the original, so a stack trace points
         at the real file rather than at transpiled output. */
      inlineSourceMap: true,
      inlineSources: true,
    },
    fileName: path,
  })

  return { format: 'module', shortCircuit: true, source: outputText }
}

/* Project imports omit extensions ('./blockRegistry'), which Node's ESM
   resolver rejects. Resolve them the way webpack would. */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (!specifier.startsWith('.')) throw err
    for (const ext of ['.js', '/index.js']) {
      try { return await nextResolve(specifier + ext, context) } catch { /* try the next */ }
    }
    throw err
  }
}
