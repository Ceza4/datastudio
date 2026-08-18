/*
  lib/renderqueue.js
  --------------------------------------------------------------------------
  Serialises work that can't overlap, and drops work that's been superseded.

  Written for pdf.js page rendering, which has an awkward pair of properties:

    · only one render() may target a given canvas at a time, and
    · cancel() does NOT release the canvas synchronously — it flags the task,
      and the canvas stays claimed until that task's promise settles.

  Break either and you get:
      "Cannot use the same canvas during multiple render() operations."

  WHY THIS ISN'T A "CURRENT TASK" REF
  The obvious implementation holds the in-flight task, cancels it, and awaits
  it before starting the next. That still races, and the hole is easy to miss
  by reading: whoever cancels clears the ref FIRST, so a third caller arriving
  in between sees nothing in flight, concludes the canvas is free, and starts
  while the cancelled render still holds it.

  This shipped, and a simulation of the real constraint found it — which is
  why tests/renderqueue.test.mjs exists and reproduces exactly that sequence.

  A chain has no such hole. Each job appends to the previous one, and a link
  can't resolve before its own await settles. Cancelling becomes a pure
  optimisation — it makes the queue advance sooner — and correctness never
  depends on it.

  SUPERSESSION
  Rapid input queues work nobody wants any more: hold the next-page key and
  you'll schedule six renders to see the last one. Each job takes a generation
  number at SCHEDULE time and is skipped if a newer one has arrived by the
  time it reaches the front. Only the newest ever paints.
  -------------------------------------------------------------------------- */

export function createRenderQueue() {
  let chain = Promise.resolve()
  let generation = 0
  let current = null          // the running cancellable, if any

  return {
    /**
     * Queue a job.
     *
     * @param fn receives a context:
     *   isCurrent()   false once a newer job has been scheduled — check it
     *                 after every await, before painting or setting state
     *   track(task)   register a cancellable (anything with .cancel())
     *   untrack(task) deregister it once finished
     * @returns a promise for this job. Rejections are contained and never
     *          poison the queue for later work.
     */
    run(fn) {
      const gen = ++generation
      // Ask whatever's running to stop early. The queue still waits for it.
      try { current?.cancel?.() } catch { /* already finished */ }

      const step = () => {
        if (gen !== generation) return undefined     // superseded while queued
        return fn({
          isCurrent: () => gen === generation,
          track: t => { current = t },
          untrack: t => { if (current === t) current = null },
        })
      }

      // Both handlers: a cancelled predecessor rejecting is the normal path.
      const next = chain.then(step, step)
      chain = next.catch(() => {})
      return next
    },

    /**
     * Invalidate everything queued or running. Call on unmount, so a job that
     * resumes after teardown can't touch a component that's gone.
     */
    cancelAll() {
      generation++
      try { current?.cancel?.() } catch { /* already finished */ }
      current = null
    },

    /** Test and debugging affordances. */
    get generation() { return generation },
    get busy() { return current !== null },
  }
}
