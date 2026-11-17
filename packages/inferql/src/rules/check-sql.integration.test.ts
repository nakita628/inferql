import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { RuleTester } from 'oxlint/plugins-dev'
import { describe, expect, it, test } from 'vite-plus/test'

import { describeSchema } from '../introspect.js'
import { checkSql } from './check-sql.js'

// End to end through the worker and `describeSchema`, against real servers. Enabled per dialect by
// INFERQL_TEST_POSTGRES_URL / INFERQL_TEST_MYSQL_URL; the fixture migrations recreate the
// tables, so any scratch database will do.
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

type Live = {
  readonly dialect: 'postgres' | 'mysql'
  readonly url: string | undefined
  readonly migrationsDir: string
  readonly placeholder: string
  readonly rowOfUsers: string
}

const servers: readonly Live[] = [
  {
    dialect: 'postgres',
    url: process.env.INFERQL_TEST_POSTGRES_URL,
    migrationsDir: 'migrations-postgres',
    placeholder: '$1',
    rowOfUsers: "{ id: number; name: string; email: string | null; role: 'admin' | 'member' }",
  },
  {
    dialect: 'mysql',
    url: process.env.INFERQL_TEST_MYSQL_URL,
    migrationsDir: 'migrations-mysql',
    placeholder: '?',
    rowOfUsers: "{ id: number; name: string; email: string | null; role: 'admin' | 'member' }",
  },
]

function caseFor(server: Live, code: string) {
  const connection = {
    dialect: server.dialect,
    databaseUrl: server.url ?? '',
    migrationsDir: server.migrationsDir,
  }
  return { code, filename, options: [{ connections: connection }] }
}

for (const server of servers) {
  const withOptions = (code: string) => caseFor(server, code)

  describe.skipIf(server.url === undefined)(`${server.dialect} (live)`, () => {
    const tester = new RuleTester({ languageOptions: { sourceType: 'module' } })
    tester.run('check-sql', checkSql, {
      valid: [
        withOptions(
          `const q = sql('SELECT id, name, email, role FROM users WHERE id = ${server.placeholder}', 1)`,
        ),
        withOptions(
          `const q = sql.as<${server.rowOfUsers}>('SELECT id, name, email, role FROM users')`,
        ),
      ],
      invalid: [
        {
          ...withOptions("const q = sql('SELECT nope FROM users')"),
          errors: [{ messageId: 'invalidQuery' }],
        },
        {
          ...withOptions("const q = sql.as('SELECT id, name, email, role FROM users')"),
          output: `const q = sql.as<${server.rowOfUsers}>('SELECT id, name, email, role FROM users')`,
          errors: [{ messageId: 'missingTypeAnnotations' }],
        },
      ],
    })

    it('describes the schema the lint rule checks against', async () => {
      const schema = await describeSchema(
        { dialect: server.dialect, databaseUrl: server.url, migrationsDir: server.migrationsDir },
        fixtures,
      )
      const users = schema.tables.find((table) => table.name === 'users')
      expect(users?.columns.find((column) => column.name === 'email')).toMatchObject({
        nullable: true,
        tsType: 'string',
      })
      expect(users?.columns.find((column) => column.name === 'role')?.tsType).toBe(
        "'admin' | 'member'",
      )
    })
  })
}
