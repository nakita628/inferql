import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vite-plus/test'

import { inferResultTarget } from '../core/index.js'
import { printTarget } from '../core/target.js'
import { dialect } from './mysql.js'

// Runs only against a real server: INFERQL_TEST_MYSQL_URL=mysql://user:pass@host:port/db
const url = process.env.INFERQL_TEST_MYSQL_URL
const migration = new URL('../rules/fixtures/migrations-mysql/001_schema.sql', import.meta.url)

describe.skipIf(url === undefined)('mysql dialect (live)', () => {
  it('describes columns, enums, nullability and parameters', async () => {
    const connection = await dialect.connect(url ?? '', { projectDir: process.cwd() })
    await connection.exec(await readFile(migration, 'utf8'))
    const result = await connection.describe(
      'SELECT id, name, email, role, bio, created_at FROM users WHERE id = ? AND name = ?',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.columns.map((column) => [column.name, column.dataType, column.nullability]),
    ).toEqual([
      ['id', 'int', 'not-null'],
      ['name', 'varchar', 'not-null'],
      ['email', 'varchar', 'nullable'],
      ['role', "enum('admin','member')", 'not-null'],
      ['bio', 'text', 'nullable'],
      ['created_at', 'datetime', 'not-null'],
    ])
    expect(result.parameters).toHaveLength(2)
    expect(result.types).toEqual({ "enum('admin','member')": "'admin' | 'member'" })
    const inferred = inferResultTarget(result.columns, {
      toTsType: (dataType) => result.types?.[dataType] ?? dialect.toTsType(dataType),
    })
    expect(printTarget(inferred.target)).toBe(
      "{ id: number; name: string; email: string | null; role: 'admin' | 'member'; bio: string | null; created_at: Date }",
    )
    await connection.close()
  })

  it('types an aggregate the server computes as NOT NULL', async () => {
    const connection = await dialect.connect(url ?? '', { projectDir: process.cwd() })
    const result = await connection.describe('SELECT count(*) AS n FROM users')
    expect(result.ok && result.columns).toEqual([
      {
        name: 'n',
        dataType: 'bigint',
        nullability: 'not-null',
        table: undefined,
        column: undefined,
      },
    ])
    await connection.close()
  })

  it('reports an invalid query', async () => {
    const connection = await dialect.connect(url ?? '', { projectDir: process.cwd() })
    const result = await connection.describe('SELECT nope FROM users')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("Unknown column 'nope'")
    await connection.close()
  })

  it('introspects the schema with learned enum types', async () => {
    const connection = await dialect.connect(url ?? '', { projectDir: process.cwd() })
    const result = await connection.introspect?.()
    const users = result?.tables.find((table) => table.name === 'users')
    expect(
      users?.columns.map((column) => `${column.name}:${column.dataType}:${column.nullability}`),
    ).toEqual([
      'id:int:not-null',
      'name:varchar:not-null',
      'email:varchar:nullable',
      "role:enum('admin','member'):not-null",
      'bio:text:nullable',
      'created_at:datetime:not-null',
    ])
    expect(result?.types).toEqual({ "enum('admin','member')": "'admin' | 'member'" })
    await connection.close()
  })
})
