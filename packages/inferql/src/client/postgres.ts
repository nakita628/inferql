import postgres from 'postgres'

import { bindAsyncSql } from '../typed/index.js'
import type { ActiveSchema, AsyncSql } from '../typed/index.js'

/** What `connect` returns: `sql()` that runs the query, and the client for everything else. */
export type PostgresSql = AsyncSql<ActiveSchema> & { readonly client: postgres.Sql }

type Value = string | number | boolean | Date | Uint8Array | null | readonly Value[]

function toValue(value: unknown): Value {
  if (value === undefined || value === null) return null
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date ||
    value instanceof Uint8Array
  ) {
    return value
  }
  // `int8` and `numeric` arrive as strings; a bigint goes back the same way.
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map((item: unknown) => toValue(item))
  throw new TypeError(`postgres cannot bind a ${typeof value} parameter`)
}

/**
 * Opens a PostgreSQL client (`postgres`) and returns `sql()` bound to it: the call runs the
 * query and resolves to its rows, typed from the query text and the schema like any `sql()`.
 *
 * ```ts
 * const sql = connect('postgres://localhost/app')
 * const users = await sql('SELECT id, name FROM users WHERE id = $1', 1)
 * ```
 *
 * A statement without rows resolves to `[]`; `sql.client` is the `postgres` client for the
 * rest (`end()`, transactions).
 */
export function connect(url: string): PostgresSql {
  const client = postgres(url)
  const sql = bindAsyncSql<ActiveSchema>(async (text, params) => [
    ...(await client.unsafe(
      text,
      params.map((value) => toValue(value)),
    )),
  ])
  return Object.assign(sql, { client })
}
