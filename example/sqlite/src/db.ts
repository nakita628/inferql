import { connect } from 'inferql/sqlite'

/**
 * `sql()` bound to the database: calling it runs the query and returns its rows, typed from
 * the query text and migrations/*.sql. Point it at a file (`connect('app.db')`) to keep data.
 */
export const sql = connect(':memory:')
