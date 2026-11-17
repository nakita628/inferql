import type { Complete } from './complete.js'
import type { DialectName, InferSchema } from './ddl.js'
import type { InferParams, InferRow } from './parse.js'
import type { Migrations } from './schema.js'

export type { Column, Migrations, Table, Tables } from './schema.js'
export type { DialectName, InferSchema } from './ddl.js'
export type { InferParams, InferRow, Parse, UnknownRow } from './parse.js'
export type { Tokenize } from './tokenize.js'
export type { Complete } from './complete.js'

/**
 * `sql()` bound to a database: what `connect` returns. The call runs the query and returns
 * its rows, typed from the query text and the schema. The rows are read-only, the array and
 * each row: they are what the database answered, not state to change in place.
 *
 * `text` also accepts `Complete<Q, S>` — the text typed so far with one more table, column or
 * keyword — only so that an editor offers those as completions inside the string; any string
 * still infers as itself.
 */
export type SyncSql<S> = {
  <const Q extends string>(
    text: Q | Complete<Q, S>,
    ...params: InferParams<Q, S>
  ): readonly InferRow<Q, S>[]
  /**
   * Names the row type by hand, for a query the parser does not type; the linter writes the
   * type argument from what the database reports and keeps it in sync.
   */
  readonly as: <Row>(text: string, ...params: readonly unknown[]) => readonly Readonly<Row>[]
}

/** The same for a driver that answers asynchronously (MySQL, PostgreSQL). */
export type AsyncSql<S> = {
  <const Q extends string>(
    text: Q | Complete<Q, S>,
    ...params: InferParams<Q, S>
  ): Promise<readonly InferRow<Q, S>[]>
  readonly as: <Row>(
    text: string,
    ...params: readonly unknown[]
  ) => Promise<readonly Readonly<Row>[]>
}

/**
 * Binds `sql` to something that runs a statement: `run(text, params)` returns its rows. The
 * driver hands back plain objects; the row type is what the query text says they hold. The
 * typed signatures are overloads over an implementation returning `unknown[]`, which is how a
 * driver's untyped answer gets its type without an assertion.
 */
export function bindSql<S extends object>(
  run: (text: string, params: readonly unknown[]) => readonly unknown[],
): SyncSql<S> {
  function sql<const Q extends string>(
    text: Q | Complete<Q, S>,
    ...params: InferParams<Q, S>
  ): readonly InferRow<Q, S>[]
  function sql(text: string, ...params: readonly unknown[]): readonly unknown[] {
    return run(text, params)
  }
  function as<Row>(text: string, ...params: readonly unknown[]): readonly Readonly<Row>[]
  function as(text: string, ...params: readonly unknown[]): readonly unknown[] {
    return run(text, params)
  }
  return Object.assign(sql, { as })
}

/** `bindSql` for a driver whose `run` returns a promise. */
export function bindAsyncSql<S extends object>(
  run: (text: string, params: readonly unknown[]) => Promise<readonly unknown[]>,
): AsyncSql<S> {
  function sql<const Q extends string>(
    text: Q | Complete<Q, S>,
    ...params: InferParams<Q, S>
  ): Promise<readonly InferRow<Q, S>[]>
  function sql(text: string, ...params: readonly unknown[]): Promise<readonly unknown[]> {
    return run(text, params)
  }
  function as<Row>(text: string, ...params: readonly unknown[]): Promise<readonly Readonly<Row>[]>
  function as(text: string, ...params: readonly unknown[]): Promise<readonly unknown[]> {
    return run(text, params)
  }
  return Object.assign(sql, { as })
}

/** The registered migrations' texts in order: entry 0, 1, 2, ... up to the first one missing. */
type MigrationTexts<
  M,
  Seen extends unknown[] = [],
  Acc extends string[] = [],
> = Seen['length'] extends keyof M
  ? M[Seen['length']] extends { readonly sql: infer Text extends string }
    ? MigrationTexts<M, [...Seen, 0], [...Acc, Text]>
    : Acc
  : Acc

/** The dialect the mapper registered the migrations under. */
type MigrationDialect<M> = M[keyof M] extends { readonly dialect: infer D extends DialectName }
  ? D
  : 'sqlite'

/**
 * The schema the content mapper's migrations build, through `InferSchema`; no tables when no
 * migration is registered, and then rows and parameters are `unknown`.
 */
export type MigrationsSchema<M> = keyof M extends never
  ? Record<never, never>
  : InferSchema<MigrationDialect<M>, MigrationTexts<M>>

/**
 * The schema `connect`'s `sql()` reads: the migrations inferql's content mapper registered
 * from the project's `.sql` files (TypeScript 7.1+, a `contentMappers` entry in tsconfig.json).
 */
export type ActiveSchema = MigrationsSchema<Migrations>
