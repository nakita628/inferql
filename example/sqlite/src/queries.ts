import { sql } from './db.js'

// No annotation, no generated file, no schema file and no driver glue: `sql()` runs the query,
// and the row and parameter types come from the query text and migrations/*.sql, which
// TypeScript 7.1 reads through inferql's content mapper (`contentMappers` in tsconfig.json).
// `vp check` still prepares every query against the real database, so a typo in a column
// name is an error here as well as in the editor.

export function findUser(id: number) {
  // rows: { id: number; name: string; email: string | null }[]
  return sql('SELECT id, name, email FROM users WHERE id = ?', id)
}

export function postsWithAuthor() {
  // rows: { title: string; body: string | null; author: string }[]
  return sql(
    'SELECT p.title, p.body, u.name AS author FROM posts p JOIN users u ON u.id = p.user_id',
  )
}

export function draftsOf(userId: number) {
  // LEFT JOIN: every column of `posts` becomes nullable on this side.
  // rows: { name: string; title: string | null }[]
  return sql(
    'SELECT u.name, p.title FROM users u LEFT JOIN posts p ON p.user_id = u.id WHERE u.id = ?',
    userId,
  )
}

export function createUser(name: string, email: string | null) {
  // params: [string, string | null] — email may be null because the column is nullable.
  return sql('INSERT INTO users (name, email) VALUES (?, ?) RETURNING id', name, email)
}

// A query beyond the type-level parser (a CTE here): `sql.as` names the row type, and the
// linter writes and maintains it from what the database reports (`vp check --fix`).
export function authorsWithPosts() {
  return sql.as<{ name: string; posts: unknown }>(`
    WITH counts AS (SELECT user_id, count(*) AS posts FROM posts GROUP BY user_id)
    SELECT u.name, counts.posts FROM users u JOIN counts ON counts.user_id = u.id
  `)
}

// The inferred types are checked by the type checker, not by trust: these would fail `vp check`.
const [first] = findUser(1)
export const greeting: string = first === undefined ? '' : `hello ${first.name}`
export const maybeEmail: string | null = first?.email ?? null
