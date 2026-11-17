import type { ScanParams } from './params.js'
import type { HasTables, Column } from './schema.js'
import type { ParseReturning, ParseSelect } from './select.js'
import type { ParseFrom, ParseTableRef, ResolveColumn, TableRef, Unsupported } from './tables.js'
import type { SplitComma, TakeUntil, Tokenize, Unquote, Upper } from './tokenize.js'

/** A row type the parser could not determine; `sql.as<Row>()` names it by hand. */
export type UnknownRow = { readonly [column: string]: unknown }

/** The row as `sql()` returns it: flattened, and read-only — it is what the database answered. */
type Prettify<T> = { readonly [K in keyof T]: T[K] } & {}

type StripSemicolon<T extends string[]> = T extends [...infer Init extends string[], ';'] ? Init : T

type Result<Row, Params extends unknown[]> = { readonly row: Row; readonly params: Params }

// --- SELECT ---------------------------------------------------------------------------------

type SelectResult<T extends string[], S> =
  ParseSelect<T, S> extends infer Row
    ? Row extends Unsupported
      ? Result<UnknownRow, unknown[]>
      : Result<Prettify<Row>, ScanParams<T, RefsOfSelect<T>, S>>
    : never

/** The tables a SELECT reads from, for typing its parameters. */
type RefsOfSelect<T extends string[]> = TakeUntil<T, 'FROM'>['rest'] extends [
  string,
  ...infer FromTokens extends string[],
]
  ? ParseFrom<FromTokens> extends {
      readonly tables: infer Refs extends TableRef[]
    }
    ? Refs
    : []
  : []

// --- INSERT ---------------------------------------------------------------------------------

/** `?` placeholders of one VALUES group, typed by position against the column list. */
type ValueParams<
  Values extends string[][],
  Cols extends string[],
  Refs extends TableRef[],
  S,
> = Values extends [infer Head extends string[], ...infer Rest extends string[][]]
  ? Cols extends [infer Col extends string, ...infer ColsRest extends string[]]
    ? Head extends ['?' | `$${number}` | `:${string}` | `@${string}`]
      ? [ValueParam<ResolveColumn<Refs, S, Col>>, ...ValueParams<Rest, ColsRest, Refs, S>]
      : [...ScanParams<Head, Refs, S>, ...ValueParams<Rest, ColsRest, Refs, S>]
    : [...ScanParams<Head, Refs, S>, ...ValueParams<Rest, [], Refs, S>]
  : []

/** An inserted value may be null when the column is nullable. */
type ValueParam<C> =
  C extends Column<infer Type, infer Nullable>
    ? Nullable extends true
      ? Type | null
      : Type
    : unknown

type ColumnNames<T extends string[][]> = {
  [K in keyof T]: T[K] extends [infer Name extends string] ? Unquote<Name> : never
}

type ValueGroups<
  T extends string[],
  Cols extends string[],
  Refs extends TableRef[],
  S,
  Acc extends unknown[] = [],
> = T extends ['(', ...infer Rest extends string[]]
  ? GroupEnd<Rest> extends {
      readonly group: infer Group extends string[]
      readonly rest: infer After extends string[]
    }
    ? ValueGroups<
        SkipComma<After>,
        Cols,
        Refs,
        S,
        [...Acc, ...ValueParams<SplitComma<Group>, Cols, Refs, S>]
      >
    : Acc
  : { readonly params: Acc; readonly rest: T }

type SkipComma<T extends string[]> = T extends [',', ...infer Rest extends string[]] ? Rest : T

/** Splits `( ... ) rest` at the matching close parenthesis (the leading `(` already consumed). */
type GroupEnd<
  T extends string[],
  Acc extends string[] = [],
  Depth extends unknown[] = [],
> = T extends [infer Head extends string, ...infer Rest extends string[]]
  ? Head extends '('
    ? GroupEnd<Rest, [...Acc, Head], [...Depth, 0]>
    : Head extends ')'
      ? Depth extends []
        ? { readonly group: Acc; readonly rest: Rest }
        : GroupEnd<Rest, [...Acc, Head], Depth extends [unknown, ...infer D] ? D : []>
      : GroupEnd<Rest, [...Acc, Head], Depth>
  : { readonly group: Acc; readonly rest: [] }

type InsertResult<T extends string[], S> = T extends [
  infer Into extends string,
  ...infer AfterInto extends string[],
]
  ? Upper<Into> extends 'INTO'
    ? ParseTableRef<AfterInto, false> extends {
        readonly ref: infer Ref extends TableRef
        readonly rest: infer Rest extends string[]
      }
      ? Rest extends ['(', ...infer AfterParen extends string[]]
        ? GroupEnd<AfterParen> extends {
            readonly group: infer ColTokens extends string[]
            readonly rest: infer AfterCols extends string[]
          }
          ? InsertBody<AfterCols, ColumnNames<SplitComma<ColTokens>>, [Ref], S>
          : Result<UnknownRow, unknown[]>
        : InsertBody<Rest, [], [Ref], S>
      : Result<UnknownRow, unknown[]>
    : Result<UnknownRow, unknown[]>
  : Result<UnknownRow, unknown[]>

type InsertBody<T extends string[], Cols extends string[], Refs extends TableRef[], S> = T extends [
  infer Values extends string,
  ...infer AfterValues extends string[],
]
  ? Upper<Values> extends 'VALUES'
    ? ValueGroups<AfterValues, Cols, Refs, S> extends {
        readonly params: infer Params extends unknown[]
        readonly rest: infer Rest extends string[]
      }
      ? Result<ReturningRow<Rest, Refs, S>, [...Params, ...ScanParams<Rest, Refs, S>]>
      : Result<ReturningRow<[], Refs, S>, unknown[]>
    : Upper<Values> extends 'SELECT'
      ? Result<never, ScanParams<AfterValues, RefsOfSelect<AfterValues>, S>>
      : Result<UnknownRow, unknown[]>
  : Result<never, []>

/** `RETURNING ...` at the end of a DML statement, or `never` rows without it. */
type ReturningRow<T extends string[], Refs extends TableRef[], S> = TakeUntil<
  T,
  'RETURNING'
>['rest'] extends [string, ...infer List extends string[]]
  ? Prettify<ParseReturning<List, Refs, S>>
  : never

// --- UPDATE / DELETE ------------------------------------------------------------------------

type UpdateResult<T extends string[], S> =
  ParseTableRef<T, false> extends {
    readonly ref: infer Ref extends TableRef
    readonly rest: infer Rest extends string[]
  }
    ? Result<
        ReturningRow<Rest, [Ref], S>,
        ScanParams<TakeUntil<Rest, 'RETURNING'>['taken'], [Ref], S>
      >
    : Result<UnknownRow, unknown[]>

type DeleteResult<T extends string[], S> = T extends [
  infer From extends string,
  ...infer AfterFrom extends string[],
]
  ? Upper<From> extends 'FROM'
    ? UpdateResult<AfterFrom, S>
    : Result<UnknownRow, unknown[]>
  : Result<UnknownRow, unknown[]>

// --- entry ----------------------------------------------------------------------------------

export type ParseTokens<T extends string[], S> = T extends [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? Upper<Head> extends 'SELECT'
    ? SelectResult<Rest, S>
    : Upper<Head> extends 'INSERT' | 'REPLACE'
      ? InsertResult<Rest, S>
      : Upper<Head> extends 'UPDATE'
        ? UpdateResult<Rest, S>
        : Upper<Head> extends 'DELETE'
          ? DeleteResult<Rest, S>
          : Result<UnknownRow, unknown[]>
  : Result<UnknownRow, unknown[]>

/** The row and parameter types of a query string against a schema. */
export type Parse<Q extends string, S> =
  HasTables<S> extends true
    ? string extends Q
      ? Result<UnknownRow, unknown[]>
      : ParseTokens<StripSemicolon<Tokenize<Q>>, S>
    : Result<UnknownRow, unknown[]>

/** The row type `sql(Q)` yields against schema `S`. */
export type InferRow<Q extends string, S> = Parse<Q, S>['row']

/** The parameter tuple `sql(Q, ...params)` expects against schema `S`. */
export type InferParams<Q extends string, S> = Parse<Q, S>['params']
