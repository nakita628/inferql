import { describe, expect, expectTypeOf, it } from 'vite-plus/test'

import { connect } from '../dialects/sqlite.js'
import { bindSql } from '../typed/index.js'
import type { Column } from '../typed/schema.js'

type S = {
  users: { id: Column<number>; name: Column<string>; email: Column<string, true> }
}

describe('connect (SQLite)', () => {
  it('runs sql() against the database and returns the rows', () => {
    const sql = connect()
    sql.database.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT)')
    expect(sql('INSERT INTO users (name, email) VALUES (?, ?)', 'ada', null)).toEqual([])
    expect(sql('INSERT INTO users (name) VALUES (?) RETURNING id', 'bob')).toEqual([{ id: 2 }])
    expect(sql('SELECT id, name, email FROM users WHERE id = ?', 1)).toEqual([
      { id: 1, name: 'ada', email: null },
    ])
    expect(sql.as<{ n: number }>('SELECT count(*) AS n FROM users')).toEqual([{ n: 2 }])
    expect(Object.getPrototypeOf(sql.as('SELECT 1 AS n')[0])).toBe(Object.prototype)
  })

  it('binds booleans as 1 / 0 and refuses what SQLite cannot store', () => {
    const sql = connect()
    expect(sql.as<{ t: number; f: number }>('SELECT ? AS t, ? AS f', true, false)).toEqual([
      { t: 1, f: 0 },
    ])
    expect(() => sql.as('SELECT ?', { a: 1 })).toThrow('node:sqlite cannot bind a object parameter')
  })
})

describe('bindSql', () => {
  it('types the rows and parameters from the query text', () => {
    const sql = bindSql<S>(() => [])
    expectTypeOf(sql('SELECT id, email FROM users WHERE name = ?', 'ada')).toEqualTypeOf<
      readonly { readonly id: number; readonly email: string | null }[]
    >()
    // @ts-expect-error -- id is a number
    sql('SELECT id FROM users WHERE id = ?', 'one')
    expectTypeOf(sql.as<{ n: number }>('SELECT 1 AS n')).toEqualTypeOf<
      readonly { readonly n: number }[]
    >()
  })
})
