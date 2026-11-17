import { createRequire } from 'node:module'
import path from 'node:path'

import { defineConfig } from 'oxlint'

import demo from './example/demo/oxlint.config.ts'
import mysql from './example/mysql/oxlint.config.ts'
import postgres from './example/postgres/oxlint.config.ts'
import sqlite from './example/sqlite/oxlint.config.ts'

// The config the Oxc editor extension reads when the repository root is the open folder. Its
// language server only loads the config at the workspace root (a nested oxlint.config.ts or
// .oxlintrc.json is ignored), so without this file no `sql('...')` in an example would show
// an error while typing. Each example keeps its own oxlint.config.ts for `vp check`; this file
// scopes that same config to the example's directory instead of repeating it. The rule finds
// `migrationsDir` from the nearest package.json, so the paths stay relative to the example.
//
// A plugin specifier is resolved from the config that names it, and `inferql` is a dependency
// of the examples, not of the repository root, so `inferql/oxlint` does not resolve from here
// (only pnpm's `.bin/oxlint` shim happens to make it work, through NODE_PATH). The editor
// starts oxlint without that shim and would drop the plugin silently. Each plugin is therefore
// resolved to a file path from its example's directory.
function scoped(dir: string, config: typeof sqlite) {
  const require = createRequire(path.join(import.meta.dirname, dir, 'package.json'))
  return {
    files: [`${dir}/**/*.{ts,tsx,mts,cts,js,mjs}`],
    plugins: config.plugins,
    jsPlugins: config.jsPlugins?.map((plugin) =>
      typeof plugin === 'string' ? require.resolve(plugin) : plugin,
    ),
    rules: config.rules,
  }
}

export default defineConfig({
  // Only the examples are linted from here; packages/ and lint/ are checked by their own
  // vite.config.ts through `vp check`.
  ignorePatterns: ['**/dist/**', '**/node_modules/**', 'packages/**', 'lint/**'],
  overrides: [
    scoped('example/demo', demo),
    scoped('example/sqlite', sqlite),
    scoped('example/mysql', mysql),
    scoped('example/postgres', postgres),
  ],
})
