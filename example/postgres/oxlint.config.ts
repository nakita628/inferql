import { defineConfig } from 'oxlint'

// The single lint config for this project. `vp check` reads it through vite.config.ts, and the
// Oxc editor extension reads it directly, so the red squiggles in the editor and the errors in
// CI come from the same rules — including inferql's database-backed check.
//
// This example needs a running postgres server. `INFERQL_POSTGRES_URL` names it; the default matches a
// local install with an `inferql` database. The migrations recreate their tables on every
// lint session, so point it at a scratch database.
export default defineConfig({
  plugins: ['typescript', 'unicorn', 'oxc'],
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
          dialect: 'postgres',
          databaseUrl:
            process.env['INFERQL_POSTGRES_URL'] ?? 'postgres://postgres@127.0.0.1:5432/inferql',
          migrationsDir: 'migrations',
        },
      },
    ],
  },
})
