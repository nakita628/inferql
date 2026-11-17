import { defineConfig } from 'vite-plus'

import { lintBase } from '../../lint/base.js'

// oxlint-disable-next-line import/no-default-export -- Vite resolves the config through its default export
export default defineConfig({
  pack: {
    entry: {
      index: './src/index.ts',
      oxlint: './src/oxlint.ts',
      sqlite: './src/dialects/sqlite.ts',
      mysql: './src/dialects/mysql.ts',
      postgres: './src/dialects/postgres.ts',
      worker: './src/worker.ts',
      // The schema as data, for tools that show it (the VS Code extension's completion).
      introspect: './src/introspect.ts',
      // TypeScript 7.1 starts it for `.sql` migrations: package.json → typescript.contentMapper.
      mapper: './src/mapper.ts',
    },
    // Drivers and oxlint stay external peers; everything else is bundled per entry.
    external: ['mysql2', 'mysql2/promise', 'postgres', 'synckit', 'oxlint'],
    dts: true,
    // tsdown defaults to `.mjs` / `.d.mts` for node; `exports` points at `.js` / `.d.ts`.
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  },
  test: {
    // lint/custom.test.ts verifies the repository's own oxlint plugin, which belongs to no
    // package; this is the suite that runs it.
    include: ['src/**/*.test.ts', '../../lint/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // The rule blocks on a worker thread per file; give a cold worker room to start.
    testTimeout: 30_000,
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/node_modules/**', '**/dist/**'],
      reporter: ['text', 'text-summary'],
    },
  },
  lint: {
    ...lintBase,
    // Fixtures are test data (a hand-written JS dialect, migrations), not code held to the rules.
    ignorePatterns: ['**/dist/**', 'src/rules/fixtures/**'],
  },
})
