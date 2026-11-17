import { describe, expect, expectTypeOf, it } from 'vite-plus/test'

import type { InferParams, InferRow, Tokenize } from './index.js'
import { bindSql } from './index.js'
import type { Column } from './schema.js'

type S = {
  users: {
    id: Column<number>
    name: Column<string>
    email: Column<string, true>
    age: Column<number, true>
  }
  posts: {
    id: Column<number>
    user_id: Column<number>
    title: Column<string>
    body: Column<string, true>
  }
}

type Row<Q extends string> = InferRow<Q, S>
type Params<Q extends string> = InferParams<Q, S>

describe('Tokenize', () => {
  it('splits on whitespace, punctuation and operators, keeps literals and t.*', () => {
    expectTypeOf<
      Tokenize<"SELECT u.*, count(*) AS n FROM users u WHERE name = 'a b' AND id >= ?">
    >().toEqualTypeOf<
      [
        'SELECT',
        'u.*',
        ',',
        'count',
        '(',
        '*',
        ')',
        'AS',
        'n',
        'FROM',
        'users',
        'u',
        'WHERE',
        'name',
        '=',
        "'a b'",
        'AND',
        'id',
        '>=',
        '?',
      ]
    >()
    expectTypeOf<Tokenize<'a<>b'>>().toEqualTypeOf<['a', '<>', 'b']>()
  })
})

type Repeat<Text extends string, N extends unknown[], Acc extends string = ''> = N extends [
  unknown,
  ...infer Rest,
]
  ? Repeat<Text, Rest, `${Acc}${Text}`>
  : Acc

type Ten = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

describe('Tokenize — long text', () => {
  it('reads past the 1000-step recursion limit, line by line and word by word', () => {
    // 100 lines of 20 characters: 2000 characters, twice what a character walk can reach.
    type Long =
      `SELECT name FROM users WHERE id = ?\n${Repeat<'  AND age > 18     \n', [...Ten, ...Ten, ...Ten, ...Ten, ...Ten, ...Ten, ...Ten, ...Ten, ...Ten, ...Ten]>}`
    expectTypeOf<Row<Long>>().toEqualTypeOf<Readonly<{ name: string }>>()
    expectTypeOf<Params<Long>>().toEqualTypeOf<[number]>()
  })
})

describe('InferRow', () => {
  it('types plain columns, aliases and nullability', () => {
    expectTypeOf<Row<'SELECT id, name, email FROM users'>>().toEqualTypeOf<
      Readonly<{
        id: number
        name: string
        email: string | null
      }>
    >()
    expectTypeOf<Row<'select id as user_id, email mail from users'>>().toEqualTypeOf<
      Readonly<{
        user_id: number
        mail: string | null
      }>
    >()
    expectTypeOf<Row<'SELECT u.id, u.email FROM users AS u'>>().toEqualTypeOf<
      Readonly<{
        id: number
        email: string | null
      }>
    >()
  })

  it('expands * and alias.*', () => {
    expectTypeOf<Row<'SELECT * FROM users'>>().toEqualTypeOf<
      Readonly<{
        id: number
        name: string
        email: string | null
        age: number | null
      }>
    >()
    expectTypeOf<Row<'SELECT p.* FROM users u JOIN posts p ON p.user_id = u.id'>>().toEqualTypeOf<
      Readonly<{
        id: number
        user_id: number
        title: string
        body: string | null
      }>
    >()
  })

  it('makes the right side of a LEFT JOIN nullable', () => {
    expectTypeOf<
      Row<'SELECT u.name, p.title FROM users u LEFT JOIN posts p ON p.user_id = u.id'>
    >().toEqualTypeOf<Readonly<{ name: string; title: string | null }>>()
    expectTypeOf<
      Row<'SELECT u.name, p.title FROM users u INNER JOIN posts p ON p.user_id = u.id'>
    >().toEqualTypeOf<Readonly<{ name: string; title: string }>>()
    expectTypeOf<
      Row<'SELECT u.name, p.title FROM users u RIGHT JOIN posts p ON p.user_id = u.id'>
    >().toEqualTypeOf<Readonly<{ name: string | null; title: string }>>()
  })

  it('types aggregates and functions', () => {
    expectTypeOf<Row<'SELECT count(*) AS total, max(age) AS oldest FROM users'>>().toEqualTypeOf<
      Readonly<{
        total: number
        oldest: number | null
      }>
    >()
    expectTypeOf<Row<'SELECT count(*) FROM users'>>().toEqualTypeOf<
      Readonly<{ 'count(*)': number }>
    >()
    expectTypeOf<
      Row<"SELECT coalesce(email, 'none') AS email, lower(name) AS n FROM users">
    >().toEqualTypeOf<
      Readonly<{
        email: string
        n: string
      }>
    >()
    expectTypeOf<
      Row<'SELECT cast(age AS text) AS a, upper(email) AS e FROM users'>
    >().toEqualTypeOf<
      Readonly<{
        a: string | null
        e: string | null
      }>
    >()
  })

  it('types literals and unknown expressions', () => {
    expectTypeOf<Row<"SELECT 1 AS one, 'x' AS s, NULL AS n FROM users">>().toEqualTypeOf<
      Readonly<{
        one: number
        s: string
        n: null
      }>
    >()
    expectTypeOf<Row<'SELECT nope FROM users'>>().toEqualTypeOf<Readonly<{ nope: unknown }>>()
  })

  it('falls back to unknown rows for what it cannot parse', () => {
    expectTypeOf<Row<'WITH x AS (SELECT 1) SELECT * FROM x'>>().toEqualTypeOf<
      Readonly<{
        readonly [column: string]: unknown
      }>
    >()
    expectTypeOf<InferRow<'SELECT * FROM users', Record<never, never>>>().toEqualTypeOf<
      Readonly<{
        readonly [column: string]: unknown
      }>
    >()
  })

  it('types RETURNING and gives DML without it no rows', () => {
    expectTypeOf<Row<'INSERT INTO users (name) VALUES (?) RETURNING id'>>().toEqualTypeOf<
      Readonly<{
        id: number
      }>
    >()
    expectTypeOf<Row<'DELETE FROM users WHERE id = ?'>>().toEqualTypeOf<never>()
  })
})

describe('InferParams', () => {
  it('types comparisons, IN lists, LIMIT and lookahead', () => {
    expectTypeOf<Params<'SELECT id FROM users WHERE id = ? AND name LIKE ?'>>().toEqualTypeOf<
      [number, string]
    >()
    expectTypeOf<Params<'SELECT id FROM users WHERE email IN (?, ?) LIMIT ?'>>().toEqualTypeOf<
      [string, string, number]
    >()
    expectTypeOf<Params<'SELECT id FROM users WHERE ? = age'>>().toEqualTypeOf<[number]>()
    expectTypeOf<Params<'SELECT id FROM users WHERE u.id = ?'>>().toEqualTypeOf<[unknown]>()
  })

  it('types INSERT values by column, allowing null for nullable columns', () => {
    expectTypeOf<Params<'INSERT INTO users (name, email) VALUES (?, ?)'>>().toEqualTypeOf<
      [string, string | null]
    >()
    expectTypeOf<Params<'INSERT INTO users (name, email) VALUES (?, ?), (?, ?)'>>().toEqualTypeOf<
      [string, string | null, string, string | null]
    >()
  })

  it('types UPDATE assignments and conditions', () => {
    expectTypeOf<Params<'UPDATE users SET name = ?, age = ? WHERE id = ?'>>().toEqualTypeOf<
      [string, number, number]
    >()
  })
})

describe('bindSql', () => {
  it('runs the statement through `run` and types the rows from the query text', () => {
    const calls: unknown[] = []
    const sql = bindSql<S>((text, params) => {
      calls.push([text, params])
      return [{ id: 1, name: 'ada' }]
    })
    const rows = sql('SELECT id, name FROM users WHERE id = ?', 1)
    expect(rows).toEqual([{ id: 1, name: 'ada' }])
    expect(calls).toEqual([['SELECT id, name FROM users WHERE id = ?', [1]]])
    expectTypeOf(rows).toEqualTypeOf<readonly { readonly id: number; readonly name: string }[]>()
  })

  it('lets `as` name the row type by hand, read-only like an inferred one', () => {
    const sql = bindSql<S>(() => [])
    const rows = sql.as<{ n: number }>('WITH x AS (SELECT 1 AS n) SELECT n FROM x')
    expectTypeOf(rows).toEqualTypeOf<readonly { readonly n: number }[]>()
  })
})

describe('InferRow — more shapes', () => {
  it('handles DISTINCT, quoted identifiers, arithmetic and concatenation', () => {
    expectTypeOf<Row<'SELECT DISTINCT "id", `name` FROM "users"'>>().toEqualTypeOf<
      Readonly<{
        id: number
        name: string
      }>
    >()
    expectTypeOf<Row<'SELECT age + 1 AS next, name || email AS label FROM users'>>().toEqualTypeOf<
      Readonly<{
        next: number | null
        label: string | null
      }>
    >()
    expectTypeOf<Row<'SELECT count(DISTINCT email) AS n FROM users'>>().toEqualTypeOf<
      Readonly<{
        n: number
      }>
    >()
  })

  it('handles comma joins, FULL JOIN and a missing alias', () => {
    expectTypeOf<
      Row<'SELECT users.name, posts.title FROM users, posts WHERE posts.user_id = users.id'>
    >().toEqualTypeOf<
      Readonly<{
        name: string
        title: string
      }>
    >()
    expectTypeOf<
      Row<'SELECT u.name, p.title FROM users u FULL OUTER JOIN posts p ON p.user_id = u.id'>
    >().toEqualTypeOf<Readonly<{ name: string | null; title: string | null }>>()
    expectTypeOf<Row<'SELECT x.name FROM users u'>>().toEqualTypeOf<Readonly<{ name: unknown }>>()
  })

  it('handles RETURNING * and UPDATE ... RETURNING', () => {
    expectTypeOf<
      Row<'INSERT INTO posts (user_id, title) VALUES (?, ?) RETURNING *'>
    >().toEqualTypeOf<
      Readonly<{
        id: number
        user_id: number
        title: string
        body: string | null
      }>
    >()
    expectTypeOf<Row<'UPDATE users SET name = ? WHERE id = ? RETURNING id, name'>>().toEqualTypeOf<
      Readonly<{
        id: number
        name: string
      }>
    >()
  })

  it('gives unknown rows for a non-literal query and for FROM subqueries', () => {
    expectTypeOf<InferRow<string, S>>().toEqualTypeOf<
      Readonly<{ readonly [column: string]: unknown }>
    >()
    expectTypeOf<Row<'SELECT n FROM (SELECT 1 AS n) t'>>().toEqualTypeOf<
      Readonly<{
        readonly [column: string]: unknown
      }>
    >()
  })
})

describe('InferParams — more shapes', () => {
  it('handles $n, :name, BETWEEN, OFFSET and DELETE', () => {
    expectTypeOf<
      Params<'SELECT id FROM users WHERE name = $1 AND age BETWEEN $2 AND $3'>
    >().toEqualTypeOf<[string, number, number]>()
    expectTypeOf<Params<'SELECT id FROM users LIMIT :limit OFFSET :offset'>>().toEqualTypeOf<
      [number, number]
    >()
    expectTypeOf<Params<'DELETE FROM posts WHERE user_id = ? AND title LIKE ?'>>().toEqualTypeOf<
      [number, string]
    >()
  })

  it('types an INSERT ... SELECT by its WHERE clause and unknown placeholders as unknown', () => {
    expectTypeOf<
      Params<'INSERT INTO posts (user_id, title) SELECT id, name FROM users WHERE id = ?'>
    >().toEqualTypeOf<[number]>()
    expectTypeOf<Params<'SELECT id FROM users WHERE ? IS NULL'>>().toEqualTypeOf<[unknown]>()
    expectTypeOf<Params<'WITH x AS (SELECT 1) SELECT * FROM x WHERE 1 = ?'>>().toEqualTypeOf<
      unknown[]
    >()
  })

  it('rejects a wrong argument type at the call', () => {
    const sql = bindSql<S>(() => [])
    // @ts-expect-error -- id is a number
    sql('SELECT id FROM users WHERE id = ?', 'one')
    // @ts-expect-error -- one placeholder, two arguments
    sql('SELECT id FROM users WHERE id = ?', 1, 2)
    expectTypeOf(sql('SELECT id FROM users WHERE id = ?', 1)).toEqualTypeOf<
      readonly { readonly id: number }[]
    >()
  })
})
