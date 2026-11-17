import { describe, expect, it } from 'vite-plus/test'

import { dialect, resolveDatabasePath, toTsType } from './sqlite.js'

describe('toTsType', () => {
  it('follows SQLite affinity rules', () => {
    expect(toTsType('INTEGER')).toBe('number')
    expect(toTsType('BIGINT')).toBe('number')
    expect(toTsType('VARCHAR(255)')).toBe('string')
    expect(toTsType('TEXT')).toBe('string')
    expect(toTsType('BLOB')).toBe('Uint8Array')
    expect(toTsType('')).toBe('Uint8Array')
    expect(toTsType('REAL')).toBe('number')
    expect(toTsType('DOUBLE PRECISION')).toBe('number')
    expect(toTsType('DATETIME')).toBe('string')
    expect(toTsType('JSON')).toBe('string')
    expect(toTsType('NUMERIC')).toBe('number')
    expect(toTsType('BOOLEAN')).toBe('number')
  })
})

describe('resolveDatabasePath', () => {
  it('keeps memory databases and resolves relative files', () => {
    expect(resolveDatabasePath(':memory:', '/p')).toBe(':memory:')
    expect(resolveDatabasePath('', '/p')).toBe(':memory:')
    expect(resolveDatabasePath('file:./dev.db', '/p')).toBe('/p/dev.db')
    expect(resolveDatabasePath('dev.db', '/p')).toBe('/p/dev.db')
    expect(resolveDatabasePath('/abs/dev.db', '/p')).toBe('/abs/dev.db')
  })
})

describe('dialect', () => {
  it('describes columns, sources and nullability of a prepared statement', async () => {
    const connection = await dialect.connect(':memory:', { projectDir: process.cwd() })
    await connection.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email VARCHAR(255),
        created_at DATETIME NOT NULL
      );
    `)
    const result = await connection.describe(
      'SELECT id, name, email AS mail, count(*) AS total FROM users WHERE id = ?',
    )
    expect(result).toEqual({
      ok: true,
      columns: [
        { name: 'id', dataType: 'INTEGER', nullability: 'not-null', table: 'users', column: 'id' },
        { name: 'name', dataType: 'TEXT', nullability: 'not-null', table: 'users', column: 'name' },
        {
          name: 'mail',
          dataType: 'VARCHAR(255)',
          nullability: 'nullable',
          table: 'users',
          column: 'email',
        },
        {
          name: 'total',
          dataType: null,
          nullability: 'unknown',
          table: undefined,
          column: undefined,
        },
      ],
    })
    await connection.close()
  })

  it('reports a failure for a statement SQLite rejects', async () => {
    const connection = await dialect.connect(':memory:', { projectDir: process.cwd() })
    const result = await connection.describe('SELECT * FROM missing')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('no such table: missing')
    await connection.close()
  })
})

describe('introspect', () => {
  it('lists tables with column types and nullability', async () => {
    const connection = await dialect.connect(':memory:', { projectDir: process.cwd() })
    await connection.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, note TEXT)')
    const result = await connection.introspect?.()
    expect(result).toEqual({
      tables: [
        {
          name: 't',
          columns: [
            { name: 'id', dataType: 'INTEGER', nullability: 'not-null' },
            { name: 'name', dataType: 'TEXT', nullability: 'not-null' },
            { name: 'note', dataType: 'TEXT', nullability: 'nullable' },
          ],
        },
      ],
    })
    await connection.close()
  })
})
