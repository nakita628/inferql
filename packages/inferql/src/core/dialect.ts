/**
 * The contract a database dialect fulfils.
 *
 * Everything inferql knows about a query comes through `describe`: the dialect prepares the
 * statement (with the placeholders written as-is: `?`, `$1`, ...) against a real database and
 * reports the result columns and the parameters the statement expects. The engine never
 * parses SQL itself, so any database that can prepare a statement can be plugged in by
 * implementing this type.
 */
export type Dialect = {
  /** Short name used in configs and messages: `sqlite`, `mysql`, `postgres`, ... */
  readonly name: string
  /**
   * Maps a dialect-native data type (as reported by `describe`) to a TypeScript type.
   * Returns `undefined` for a type the dialect does not know; the engine then reports the
   * column as `unknown` unless a user override names it.
   */
  readonly toTsType: (dataType: string) => string | undefined
  readonly connect: (databaseUrl: string, context: ConnectContext) => Promise<Connection>
}

export type ConnectContext = {
  /** Directory relative paths in `databaseUrl` (a SQLite file, say) are resolved against. */
  readonly projectDir: string
}

export type Connection = {
  /** Prepares `queryText` (without executing it) and reports what it would return. */
  readonly describe: (queryText: string) => Promise<DescribeResult>
  /** Executes DDL/DML text as-is; used to apply migration files. */
  readonly exec: (sqlText: string) => Promise<void>
  /**
   * Lists the tables and their columns, for `inferql schema` to turn into the `Schema` type
   * `sql()` infers query results from. Optional: a dialect without it still lints.
   */
  readonly introspect?: (() => Promise<IntrospectResult>) | undefined
  readonly close: () => Promise<void>
}

export type IntrospectedColumn = {
  readonly name: string
  readonly dataType: string
  readonly nullability: ColumnNullability
}

export type IntrospectedTable = {
  readonly name: string
  readonly columns: readonly IntrospectedColumn[]
}

export type IntrospectResult = {
  readonly tables: readonly IntrospectedTable[]
  /** Types learned from the schema, keyed like `dataType` (see `DescribeResult.types`). */
  readonly types?: Readonly<Record<string, string>> | undefined
}

export type ColumnNullability = 'not-null' | 'nullable' | 'unknown'

export type DescribedColumn = {
  readonly name: string
  /**
   * Dialect-native type name, e.g. `int4`, `VARCHAR`, `TEXT`. `null` when the dialect cannot
   * tell (SQLite reports no type for an expression column).
   */
  readonly dataType: string | null
  readonly nullability: ColumnNullability
  /** Source table when the column maps straight onto one. */
  readonly table?: string | undefined
  /** Source column name when it maps straight onto one. */
  readonly column?: string | undefined
}

export type DescribedParameter = {
  readonly dataType: string | null
}

export type DescribeResult =
  | {
      readonly ok: true
      readonly columns: readonly DescribedColumn[]
      /** `undefined` when the dialect cannot count the statement's parameters. */
      readonly parameters?: readonly DescribedParameter[] | undefined
      /**
       * Types the connection learned from the schema (an enum's labels, an array's element),
       * keyed like `dataType`. They sit between the dialect's static mapping and the user's
       * `overrides.types`.
       */
      readonly types?: Readonly<Record<string, string>> | undefined
    }
  | {
      readonly ok: false
      readonly message: string
      /** 0-based offset into the query text, when the database reports one. */
      readonly position?: number | undefined
    }

/**
 * Turns a thrown value into the failure branch of `DescribeResult`.
 */
export function describeFailure(error: unknown, position?: number): DescribeResult {
  const message = error instanceof Error ? error.message : String(error)
  return position === undefined ? { ok: false, message } : { ok: false, message, position }
}
