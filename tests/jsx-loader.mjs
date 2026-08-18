/*
  tests/jsx-loader.mjs
  --------------------------------------------------------------------------
  A Node module hook that transpiles JSX on the way in, so components can be
  imported and rendered in a plain `node` process.

      node --import ./tests/jsx-loader.mjs tests/smoke.render.test.mjs

  WHY THIS EXISTS
  Four bugs in a row were things no unit test could see, because they only
  happen when React actually renders the component:

    · "Cannot access 'openExtract' before initialization" — a hook dependency
      declared below the hook that used it
    · a ResizeObserver attached in an effect that never ran
    · a canvas render collision
    · pointer coordinates measured in the wrong space

  The first is caught by simply RENDERING the component once and seeing
  whether it throws. That's a large class of failure — anything that throws in
  the render phase — and it costs one function call to check.

  WHY TYPESCRIPT AND NOT BABEL
  typescript is already a dependency; @babel/preset-react isn't. `transpileModule`
  does a syntax-only transform with no type checking and no config file, which
  is exactly the amount of work wanted here. No new packages.

  WHAT THIS DOES NOT DO
  It doesn't run effects, lay anything out, or paint. Effects need a DOM and
  layout needs a browser engine. So this catches render-phase throws and
  nothing more — which is the honest scope, and still the class that produced
  the worst symptom (an entire block replaced by an error card).
  -------------------------------------------------------------------------- */

import { register } from 'node:module'

// import.meta.url is already a file: URL — passing it through pathToFileURL
// would encode it a second time and produce a path with the URL inside it.
register('./jsx-transform.mjs', import.meta.url)
