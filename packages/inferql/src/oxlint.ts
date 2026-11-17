import { checkSql } from './rules/check-sql.js'

export { checkSql } from './rules/check-sql.js'

/**
 * The oxlint plugin. Reference it from `jsPlugins` and enable `inferql/check-sql` with the
 * connections it should validate against:
 *
 * ```ts
 * lint: {
 *   jsPlugins: ['inferql/oxlint'],
 *   rules: {
 *     'inferql/check-sql': ['error', { connections: { dialect: 'sqlite', migrationsDir: 'migrations' } }],
 *   },
 * }
 * ```
 *
 * Every `sql('...')` is prepared against the database; `sql.as<Row>('...')` additionally gets
 * its row type written and kept in sync.
 *
 * ```ts
 * lint: {
 *   },
 * }
 * ```
 */
const plugin = {
  meta: { name: 'inferql' },
  rules: { 'check-sql': checkSql },
} as const

// oxlint-disable-next-line import/no-default-export -- oxlint loads a JS plugin through its default export
export default plugin
