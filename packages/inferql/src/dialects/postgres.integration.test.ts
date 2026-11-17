import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vite-plus/test'

import { inferResultTarget } from '../core/index.js'
import { printTarget } from '../core/target.js'
import { dialect } from './postgres.js'

// Runs only against a real server: INFERQL_TEST_POSTGRES_URL=postgres://user@host:port/db
const url = process.env.INFERQL_TEST_POSTGRES_URL
const migration = new URL('../rules/fixtures/migrations-postgres/001_schema.sql', import.meta.url)

describe.skipIf(url === undefined)('postgres dialect (live)', () => {
  it('describes columns, enums, arrays, nullability and parameters', async () => {
    const connection = await dialect.connect(url ?? '', { projectDir: process.cwd() })
    await connection.exec(await readFile(migration, 'utf8'))
    const result = await connection.describe(
      'SELECT id, name, email, role, tags, created_at, count(*) AS n FROM users WHERE id = $1 GROUP BY id',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.columns.map((column) => [column.name, column.dataType, column.nullability]),
    ).toEqual([
      ['id', 'int4', 'not-null'],
      ['name', 'text', 'not-null'],
      ['email', 'varchar', 'nullable'],
      ['role', 'role', 'not-null'],
      ['tags', '_text', 'not-null'],
      ['created_at', 'timestamptz', 'not-null'],
      ['n', 'int8', 'unknown'],
    ])
    expect(result.parameters).toEqual([{ dataType: 'int4' }])
    expect(result.types).toEqual({ role: "'admin' | 'member'", _text: 'string[]' })
    const inferred = inferResultTarget(result.columns, {
      toTsType: (dataType) => result.types?.[dataType] ?? dialect.toTsType(dataType),
    })
    expect(printTarget(inferred.target)).toBe(
      "{ id: number; name: string; email: string | null; role: 'admin' | 'member'; tags: string[]; created_at: Date; n: string }",
    )
    await connection.close()
  })

  it('reports an invalid query with its position', async () => {
    const connection = await dialect.connect(url ?? '', { projectDir: process.cwd() })
    const result = await connection.describe('SELECT nope FROM users')
    expect(result).toEqual({
      ok: false,
      message: 'column "nope" does not exist',
      position: 7,
    })
    await connection.close()
  })

  it('introspects the schema with learned enum and array types', async () => {
    const connection = await dialect.connect(url ?? '', { projectDir: process.cwd() })
    const result = await connection.introspect?.()
    const users = result?.tables.find((table) => table.name === 'users')
    expect(
      users?.columns.map((column) => `${column.name}:${column.dataType}:${column.nullability}`),
    ).toEqual([
      'id:int4:not-null',
      'name:text:not-null',
      'email:varchar:nullable',
      'role:role:not-null',
      'tags:_text:not-null',
      'created_at:timestamptz:not-null',
    ])
    expect(result?.types).toMatchObject({ role: "'admin' | 'member'", _text: 'string[]' })
    await connection.close()
  })
})
