import { defineConfig } from 'oxlint'

// The single lint config for this project. `vp check` reads it through vite.config.ts, and the
// Oxc editor extension reads it directly, so the red squiggles in the editor and the errors in
// CI come from the same rules — including inferql's database-backed check.
export default defineConfig({
  plugins: ['typescript', 'unicorn', 'oxc'],
  // The plugin is a subpath of the one package; a path to it works too.
  jsPlugins: ['inferql/oxlint'],
  // No `typeAware` here: the schema comes from migrations/*.sql through inferql's content
  // mapper, which TypeScript 7.1 runs and oxlint's type-aware engine (TypeScript 7.0) does not,
  // so it would read every row as unknown and report false positives. Types are checked by
  // `tsc --noEmit --runExternalCode`, the first half of the `check` script.
  categories: { correctness: 'error' },
  rules: {
    'inferql/check-sql': [
      'error',
      {
        connections: {
          // An in-memory SQLite database rebuilt from ./migrations on every run: no server
          // needed, so this is what CI runs. Point `databaseUrl` at a file to reuse one.
          dialect: 'sqlite',
          migrationsDir: 'migrations',
          // Default targets: sql('...') is validated; sql.as<Row>('...') also has its row
          // type written and kept in sync.
        },
      },
    ],
  },
})
