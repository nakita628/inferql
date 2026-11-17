import { connect } from 'inferql/postgres'

/**
 * `sql()` bound to the server: calling it runs the query and resolves to its rows, typed from
 * the query text and migrations/*.sql. The server is the one the lint rule checks against.
 */
export const sql = connect(
  process.env['INFERQL_POSTGRES_URL'] ?? 'postgres://postgres@127.0.0.1:5432/inferql',
)
