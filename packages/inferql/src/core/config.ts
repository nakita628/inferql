import type { TypeOverrides } from './infer.js'

export type Pattern = string | { readonly regex: string }

/**
 * `sql('...')` — a call whose first argument is the query as a string literal. The query is
 * prepared against the database; with `annotate`, its row type is also required as the call's
 * type argument (`sql.as<Row>('...')`) and written by `--fix` from what the database reports.
 */
export type Target = {
  readonly call: Pattern
  /** Require and maintain a type argument on the call. Default: only check one if written. */
  readonly annotate?: boolean | undefined
}

export type ConnectionConfig = {
  /**
   * Which dialect answers for this connection: a built-in name (`sqlite`, `mysql`, `postgres`)
   * or a package / path exporting a `dialect`.
   */
  readonly dialect: string
  /** Connection string handed to the dialect. SQLite defaults to an in-memory database. */
  readonly databaseUrl?: string | undefined
  /**
   * Directory of `.sql` migrations applied in name order before the first query is described
   * — the same files TypeScript reads the schema from through inferql's content mapper.
   * With SQLite this is all a CI needs: the schema is rebuilt in memory on every lint run.
   */
  readonly migrationsDir?: string | undefined
  /** Default: `[{ call: 'sql' }, { call: 'sql.as', annotate: true }]`. */
  readonly targets?: readonly Target[] | undefined
  /** Dialect type name → TypeScript type; keep it in step with `inferql schema --override`. */
  readonly overrides?: TypeOverrides | undefined
  /** `fix` writes the annotation under `--fix`; `suggest` offers it as an editor suggestion. */
  readonly enforceType?: 'fix' | 'suggest' | undefined
}

export type Config = {
  readonly connections: ConnectionConfig | readonly ConnectionConfig[]
}

function isConnectionList(
  value: ConnectionConfig | readonly ConnectionConfig[],
): value is readonly ConnectionConfig[] {
  return Array.isArray(value)
}

export function connectionsOf(config: Config): readonly ConnectionConfig[] {
  return isConnectionList(config.connections) ? config.connections : [config.connections]
}

export function matchesPattern(pattern: Pattern, text: string): boolean {
  return typeof pattern === 'string' ? pattern === text : new RegExp(pattern.regex, 'u').test(text)
}
