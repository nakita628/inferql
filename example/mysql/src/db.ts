import { connect } from 'inferql/mysql'

/**
 * `sql()` bound to the server: calling it runs the query and resolves to its rows, typed from
 * the query text and migrations/*.sql. The server is the one the lint rule checks against.
 */
export const sql = connect(
  process.env['INFERQL_MYSQL_URL'] ?? 'mysql://root@127.0.0.1:3306/inferql',
)
