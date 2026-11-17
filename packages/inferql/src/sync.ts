import { fileURLToPath } from 'node:url'

import { createSyncFn } from 'synckit'

import type { CheckRequest, CheckResponse } from './protocol.js'

// oxlint's JS plugin API is synchronous, and every database driver is not. `synckit` runs
// the worker on its own thread and blocks this one with `Atomics.wait` until it answers,
// which is the same bridge SafeQL uses under ESLint.
// When this file runs as source (the test suite), the worker is the built one under dist/:
// Node's type stripping does not rewrite `./session.js` to the `.ts` sibling, so the source
// worker cannot resolve its own imports. `vp test` therefore runs after `vp pack`.
const isSource = import.meta.url.endsWith('.ts')
const workerPath = fileURLToPath(
  new URL(isSource ? '../dist/worker.js' : './worker.js', import.meta.url),
)

const FIVE_MINUTES = 5 * 60 * 1000

export const checkSync: (request: CheckRequest) => CheckResponse = createSyncFn(workerPath, {
  timeout: FIVE_MINUTES,
  tsRunner: 'node',
})
