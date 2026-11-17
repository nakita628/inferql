import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { RuleTester } from 'oxlint/plugins-dev'
import { describe, expect, it, test } from 'vite-plus/test'

import { checkSql, locateProjectDir } from './check-sql.js'

RuleTester.describe = (name, fn) => {
  describe(name, fn)
}
RuleTester.it = (name, fn) => {
  test(name, fn)
}
RuleTester.itOnly = (name, fn) => {
  test.only(name, fn)
}

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))
const filename = path.join(fixtures, 'src', 'queries.ts')

/** What a rule option can be made of: the tester wants plain JSON. */
type Json = string | number | boolean | null | Json[] | { readonly [key: string]: Json }

const sqlite: Json = {
  connections: { dialect: 'sqlite', migrationsDir: 'migrations' },
}

function withOptions(code: string, options: Json = sqlite) {
  return { code, filename, options: [options] }
}

const tester = new RuleTester({ languageOptions: { sourceType: 'module' } })

describe('locateProjectDir', () => {
  it('walks up to the nearest package.json', () => {
    expect(locateProjectDir(filename, '/fallback')).toBe(path.resolve(fixtures))
    expect(locateProjectDir('/no/such/dir/file.ts', '/fallback')).toBe('/fallback')
  })
})

tester.run('check-sql', checkSql, {
  valid: [
    // sql('...') is validated and never asked for an annotation: the type comes from the schema.
    withOptions("const q = sql('SELECT id, name FROM users WHERE id = ?', 1)"),
    withOptions('const q = sql(`SELECT id\n  FROM users`)'),
    // sql.as<Row> is compared with what the database reports.
    withOptions("const q = sql.as<{ id: number; name: string }>('SELECT id, name FROM users')"),
    withOptions("const q = sql.as<{ email: null | string }>('SELECT email FROM users')"),
    withOptions(
      "type User = { id: number; name: string }\nconst q = sql.as<User>('SELECT id, name FROM users')",
    ),
    withOptions("const q = sql.as<{ total: unknown }>('SELECT count(*) AS total FROM users')"),
    withOptions("const q = sql.as<{ email: 'a' | 'b' | null }>('SELECT email FROM users')", {
      connections: {
        dialect: 'sqlite',
        migrationsDir: 'migrations',
        overrides: { types: { 'VARCHAR(255)': "'a' | 'b'" } },
      },
    }),
    // Not a plain string, or not a target: nothing to check statically.
    withOptions('const q = sql(text)'),
    withOptions("const q = other('SELECT nope FROM missing')"),
    withOptions("const q = db.query('SELECT id FROM users')", {
      connections: {
        dialect: 'sqlite',
        migrationsDir: 'migrations',
        targets: [{ call: 'db.query' }],
      },
    }),
  ],
  invalid: [
    {
      ...withOptions("const q = sql('SELECT id FROM nowhere')"),
      errors: [{ messageId: 'invalidQuery' }],
    },
    {
      ...withOptions("const q = sql('SELECT id, id FROM users')"),
      errors: [{ messageId: 'duplicateColumns' }],
    },
    {
      ...withOptions("const q = sql.as('SELECT id, name FROM users')"),
      output: "const q = sql.as<{ id: number; name: string }>('SELECT id, name FROM users')",
      errors: [{ messageId: 'missingTypeAnnotations' }],
    },
    {
      ...withOptions("const q = sql.as<{ id: string }>('SELECT id, name FROM users')"),
      output: "const q = sql.as<{ id: number; name: string }>('SELECT id, name FROM users')",
      errors: [{ messageId: 'incorrectTypeAnnotations' }],
    },
    {
      ...withOptions(
        "import type { User } from './types.js'\nconst q = sql.as<User>('SELECT id FROM users')",
      ),
      errors: [{ messageId: 'invalidTypeAnnotations' }],
    },
    {
      ...withOptions("const q = sql.as('SELECT id FROM users')", {
        connections: { dialect: 'sqlite', migrationsDir: 'migrations', enforceType: 'suggest' },
      }),
      errors: [
        {
          messageId: 'missingTypeAnnotations',
          suggestions: [
            {
              messageId: 'applyFix',
              output: "const q = sql.as<{ id: number }>('SELECT id FROM users')",
            },
          ],
        },
      ],
    },
    {
      ...withOptions("const q = db.query('SELECT id FROM users')", {
        connections: {
          dialect: 'sqlite',
          migrationsDir: 'migrations',
          targets: [{ call: 'db.query', annotate: true }],
        },
      }),
      output: "const q = db.query<{ id: number }>('SELECT id FROM users')",
      errors: [{ messageId: 'missingTypeAnnotations' }],
    },
    {
      ...withOptions("const q = sql('SELECT 1')", {
        connections: { dialect: './no-such-dialect.js' },
      }),
      errors: [{ messageId: 'setupFailed' }],
    },
  ],
})
