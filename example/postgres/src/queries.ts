import { sql } from './db.js'

// No annotation, no generated file, no schema file and no driver glue: `sql()` runs the query,
// and the row and parameter types come from the query text and migrations/*.sql, which
// TypeScript 7.1 reads through inferql's content mapper (`contentMappers` in tsconfig.json).
// The enum comes through as a union of its labels and the array as `string[]`. `vp check` still prepares every query against the real server, so a typo in a
// column name is an error here as well as in the editor.

export function findUser(id: number) {
  // rows: readonly { id: number; name: string; email: string | null; role: 'admin' | 'member'; tags: string[] }[]
  return sql('SELECT id, name, email, role, tags FROM users WHERE id = $1', id)
}

export function postsWithAuthor() {
  // rows: readonly { title: string; body: string | null; author: string }[]
  return sql(
    'SELECT p.title, p.body, u.name AS author FROM posts p JOIN users u ON u.id = p.user_id',
  )
}

export function createUser(name: string, email: string | null) {
  // params: [string, string | null]; rows: { id: number }[]
  return sql('INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id', name, email)
}

// A query beyond the type-level parser (a CTE here): `sql.as` names the row type, and the
// linter writes and maintains it from what the server reports (`vp check --fix`).
export function authorsWithPosts() {
  return sql.as<{ name: string; posts: string }>(`
    WITH counts AS (SELECT user_id, count(*) AS posts FROM posts GROUP BY user_id)
    SELECT u.name, counts.posts FROM users u JOIN counts ON counts.user_id = u.id
  `)
}
