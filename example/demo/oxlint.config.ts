import { defineConfig } from 'oxlint'

// The demo's lint config: every sql('...') is prepared against an in-memory SQLite database
// built from ./migrations. No `typeAware`: types come from the content mapper, which only
// TypeScript 7.1 runs (`tsc --noEmit --runExternalCode`, the first half of `check`).
export default defineConfig({
  plugins: ['typescript', 'unicorn', 'oxc'],
  jsPlugins: ['inferql/oxlint'],
  categories: { correctness: 'error' },
  rules: {
    'inferql/check-sql': [
      'error',
      { connections: { dialect: 'sqlite', migrationsDir: 'migrations' } },
    ],
  },
})
