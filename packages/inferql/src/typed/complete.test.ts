import { describe, expectTypeOf, it } from 'vite-plus/test'

import type { Complete } from './complete.js'
import { bindSql } from './index.js'
import type { Column } from './schema.js'

type S = {
  users: { id: Column<number>; name: Column<string>; email: Column<string, true> }
  posts: { id: Column<number>; user_id: Column<number>; title: Column<string> }
}

type C<Q extends string> = Complete<Q, S>

/** The words a candidate adds after the typed text, which is what an editor shows the user. */
type Added<Q extends string> = [C<Q>] extends [never]
  ? never
  : C<Q> extends `${Q}${infer Word}`
    ? Word
    : never

type UsersColumns = 'id' | 'name' | 'email'
type Functions =
  | 'COUNT('
  | 'SUM('
  | 'AVG('
  | 'MIN('
  | 'MAX('
  | 'COALESCE('
  | 'LOWER('
  | 'UPPER('
  | 'LENGTH('
  | 'ROUND('
  | 'CAST('

describe('Complete — starting a statement', () => {
  it('offers the statement keywords in an empty string and narrows them as typed', () => {
    expectTypeOf<Added<''>>().toEqualTypeOf<
      'SELECT' | 'INSERT INTO' | 'UPDATE' | 'DELETE FROM' | 'WITH'
    >()
    expectTypeOf<C<'SEL'>>().toEqualTypeOf<'SELECT'>()
    expectTypeOf<C<'sel'>>().toEqualTypeOf<'select'>()
    expectTypeOf<C<'  D'>>().toEqualTypeOf<'  DELETE FROM'>()
  })
})

describe('Complete — SELECT', () => {
  it('offers columns, *, DISTINCT and functions in the select list', () => {
    type Every = 'id' | 'name' | 'email' | 'user_id' | 'title'
    expectTypeOf<Added<'SELECT '>>().toEqualTypeOf<Every | '*' | 'DISTINCT' | Functions>()
    expectTypeOf<C<'SELECT id, e'>>().toEqualTypeOf<'SELECT id, email'>()
    expectTypeOf<C<'SELECT co'>>().toEqualTypeOf<'SELECT COUNT(' | 'SELECT COALESCE('>()
    expectTypeOf<C<'select co'>>().toEqualTypeOf<'select count(' | 'select coalesce('>()
  })

  it('offers FROM and AS after a select item', () => {
    expectTypeOf<Added<'SELECT id '>>().toEqualTypeOf<'FROM' | 'AS'>()
    expectTypeOf<Added<'SELECT * '>>().toEqualTypeOf<'FROM' | 'AS'>()
    expectTypeOf<C<'select id fr'>>().toEqualTypeOf<'select id from'>()
  })

  it('offers tables after FROM and JOIN, then what may follow them', () => {
    expectTypeOf<Added<'SELECT * FROM '>>().toEqualTypeOf<'users' | 'posts'>()
    expectTypeOf<C<'SELECT * FROM us'>>().toEqualTypeOf<'SELECT * FROM users'>()
    expectTypeOf<Added<'SELECT * FROM users '>>().toEqualTypeOf<
      | 'WHERE'
      | 'JOIN'
      | 'LEFT JOIN'
      | 'INNER JOIN'
      | 'CROSS JOIN'
      | 'GROUP BY'
      | 'ORDER BY'
      | 'LIMIT'
      | 'AS'
    >()
    expectTypeOf<Added<'SELECT * FROM users u JOIN '>>().toEqualTypeOf<'users' | 'posts'>()
    expectTypeOf<Added<'SELECT * FROM users u JOIN posts p '>>().toEqualTypeOf<
      'ON' | 'USING' | 'AS'
    >()
  })

  it('offers the columns of an alias after `alias.`', () => {
    expectTypeOf<
      Added<'SELECT p.title FROM posts p JOIN users u ON u.'>
    >().toEqualTypeOf<UsersColumns>()
    expectTypeOf<C<'SELECT users.na'>>().toEqualTypeOf<'SELECT users.name'>()
  })
})

describe('Complete — conditions', () => {
  it('offers the columns in scope, NOT and EXISTS where a condition starts', () => {
    expectTypeOf<Added<'SELECT id FROM users WHERE '>>().toEqualTypeOf<
      UsersColumns | 'NOT' | 'EXISTS'
    >()
    expectTypeOf<
      C<'SELECT id FROM posts WHERE user_id = 1 AND t'>
    >().toEqualTypeOf<'SELECT id FROM posts WHERE user_id = 1 AND title'>()
  })

  it('offers the operators after a column', () => {
    expectTypeOf<Added<'SELECT id FROM users WHERE email '>>().toEqualTypeOf<
      '=' | '<>' | 'IS NULL' | 'IS NOT NULL' | 'LIKE' | 'IN' | 'BETWEEN' | 'NOT'
    >()
    expectTypeOf<Added<'SELECT id FROM users WHERE email IS '>>().toEqualTypeOf<
      'NULL' | 'NOT NULL'
    >()
    expectTypeOf<Added<'SELECT id FROM users WHERE email IS NOT '>>().toEqualTypeOf<'NULL'>()
    expectTypeOf<Added<'SELECT id FROM users WHERE email NOT '>>().toEqualTypeOf<
      'LIKE' | 'IN' | 'BETWEEN'
    >()
    expectTypeOf<Added<'SELECT id FROM users WHERE id IN '>>().toEqualTypeOf<never>()
  })

  it('offers columns as the right side of a comparison, with or without a space', () => {
    expectTypeOf<Added<'SELECT * FROM posts p JOIN users u ON u.id = '>>().toEqualTypeOf<
      'id' | 'user_id' | 'title' | 'name' | 'email'
    >()
    expectTypeOf<
      C<'SELECT id FROM users WHERE id=na'>
    >().toEqualTypeOf<'SELECT id FROM users WHERE id=name'>()
  })

  it('offers what follows a finished condition, per clause', () => {
    expectTypeOf<Added<'SELECT id FROM users WHERE id = ? '>>().toEqualTypeOf<
      'AND' | 'OR' | 'GROUP BY' | 'ORDER BY' | 'LIMIT' | 'RETURNING'
    >()
    expectTypeOf<Added<"SELECT id FROM users WHERE name = 'a' ">>().toEqualTypeOf<
      'AND' | 'OR' | 'GROUP BY' | 'ORDER BY' | 'LIMIT' | 'RETURNING'
    >()
    expectTypeOf<Added<'SELECT id FROM users WHERE email IS NULL '>>().toEqualTypeOf<
      'AND' | 'OR' | 'GROUP BY' | 'ORDER BY' | 'LIMIT' | 'RETURNING'
    >()
    expectTypeOf<Added<'SELECT * FROM posts p JOIN users u ON u.id = p.user_id '>>().toEqualTypeOf<
      'AND' | 'OR' | 'WHERE' | 'JOIN' | 'LEFT JOIN' | 'ORDER BY' | 'LIMIT'
    >()
  })
})

describe('Complete — ORDER BY, GROUP BY, LIMIT', () => {
  it('offers columns after BY and what may follow an item', () => {
    expectTypeOf<Added<'SELECT id FROM users ORDER BY '>>().toEqualTypeOf<UsersColumns>()
    expectTypeOf<Added<'SELECT id FROM users ORDER BY name '>>().toEqualTypeOf<
      'ASC' | 'DESC' | 'LIMIT'
    >()
    expectTypeOf<Added<'SELECT name FROM users GROUP BY name '>>().toEqualTypeOf<
      'HAVING' | 'ORDER BY' | 'LIMIT'
    >()
    expectTypeOf<Added<'SELECT id FROM users LIMIT 10 '>>().toEqualTypeOf<'OFFSET'>()
  })
})

describe('Complete — INSERT, UPDATE, DELETE', () => {
  it('walks an INSERT', () => {
    expectTypeOf<Added<'INSERT '>>().toEqualTypeOf<'INTO'>()
    expectTypeOf<Added<'INSERT INTO '>>().toEqualTypeOf<'users' | 'posts'>()
    expectTypeOf<Added<'INSERT INTO posts '>>().toEqualTypeOf<
      'VALUES' | 'SELECT' | 'DEFAULT VALUES'
    >()
    expectTypeOf<Added<'INSERT INTO posts ('>>().toEqualTypeOf<'id' | 'user_id' | 'title'>()
    expectTypeOf<Added<'INSERT INTO posts (user_id, '>>().toEqualTypeOf<
      'id' | 'user_id' | 'title'
    >()
    expectTypeOf<Added<'INSERT INTO posts (user_id, title) '>>().toEqualTypeOf<
      'VALUES' | 'SELECT'
    >()
    expectTypeOf<
      Added<'INSERT INTO posts (user_id, title) VALUES (?, ?) '>
    >().toEqualTypeOf<'RETURNING'>()
    expectTypeOf<Added<'INSERT INTO posts (title) VALUES (?) RETURNING '>>().toEqualTypeOf<
      'id' | 'user_id' | 'title' | '*'
    >()
  })

  it('walks an UPDATE', () => {
    expectTypeOf<Added<'UPDATE '>>().toEqualTypeOf<'users' | 'posts'>()
    expectTypeOf<Added<'UPDATE posts '>>().toEqualTypeOf<'SET'>()
    expectTypeOf<C<'UPDATE posts SET ti'>>().toEqualTypeOf<'UPDATE posts SET title'>()
    expectTypeOf<Added<'UPDATE posts SET title = ? '>>().toEqualTypeOf<'WHERE' | 'RETURNING'>()
    expectTypeOf<Added<'UPDATE posts SET title = ?, '>>().toEqualTypeOf<
      'id' | 'user_id' | 'title'
    >()
  })

  it('walks a DELETE', () => {
    expectTypeOf<Added<'DELETE '>>().toEqualTypeOf<'FROM'>()
    expectTypeOf<Added<'DELETE FROM '>>().toEqualTypeOf<'users' | 'posts'>()
    expectTypeOf<Added<'DELETE FROM posts '>>().toEqualTypeOf<'WHERE' | 'RETURNING'>()
  })
})

describe('Complete — where it offers nothing', () => {
  it('never runs a word into a value, and needs a schema and a literal', () => {
    expectTypeOf<C<'SELECT id FROM users WHERE id = ?'>>().toEqualTypeOf<never>()
    expectTypeOf<C<"SELECT id FROM users WHERE name = 'a'">>().toEqualTypeOf<never>()
    expectTypeOf<C<'SELECT * FROM x'>>().toEqualTypeOf<never>()
    expectTypeOf<Complete<'SELECT * FROM ', Record<never, never>>>().toEqualTypeOf<never>()
    expectTypeOf<Complete<string, S>>().toEqualTypeOf<never>()
  })

  it('reads a multi-line backtick query', () => {
    type Q = `
      SELECT id, name
      FROM users
      WHERE em`
    expectTypeOf<C<Q>>().toEqualTypeOf<`${Q}ail`>()
  })
})

describe('sql() with completions in its parameter', () => {
  const sql = bindSql<S>(() => [])

  it('still infers rows and parameters from the text as written', () => {
    const rows = sql(`SELECT id, name FROM users WHERE email = ?`, 'a@example.com')
    expectTypeOf(rows).toEqualTypeOf<readonly { readonly id: number; readonly name: string }[]>()
    // @ts-expect-error -- id is a number
    sql('SELECT id FROM users WHERE id = ?', 'one')
  })
})
