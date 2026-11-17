import type { Column } from './schema.js'
import type { ResolveColumn, TableRef } from './tables.js'
import type { Upper } from './tokenize.js'

/** A placeholder token: `?`, `$1`, `:name`, `@name`. */
export type Placeholder = '?' | `$${number}` | `:${string}` | `@${string}`

type ComparisonOperator =
  | '='
  | '<>'
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | '=='
  | 'LIKE'
  | 'ILIKE'
  | 'GLOB'
  | 'IS'

/** The value a parameter compared with a column should have (never null). */
type ParamOf<C> = [C] extends [never]
  ? unknown
  : C extends Column<infer Type, boolean>
    ? Type
    : unknown

type DropTrailingParams<T extends string[]> = T extends [
  ...infer Init extends string[],
  infer Last extends string,
]
  ? Last extends Placeholder | ','
    ? DropTrailingParams<Init>
    : T
  : T

/** The type of one placeholder from the tokens before it (`Prev`) and after it (`Next`). */
type ParamType<
  Prev extends string[],
  Next extends string[],
  Refs extends TableRef[],
  S,
> = Prev extends [...string[], infer Col extends string, infer Operator extends string]
  ? Upper<Operator> extends ComparisonOperator
    ? ParamOf<ResolveColumn<Refs, S, Col>>
    : Upper<Operator> extends 'LIMIT' | 'OFFSET'
      ? number
      : Upper<Operator> extends 'BETWEEN'
        ? ParamOf<ResolveColumn<Refs, S, Col>>
        : Upper<Operator> extends 'AND'
          ? FromBetween<Prev, Refs, S>
          : FromInList<Prev, Refs, S> extends infer Found
            ? unknown extends Found
              ? FromLookahead<Next, Refs, S>
              : Found
            : unknown
  : Prev extends [...string[], infer Keyword extends string]
    ? Upper<Keyword> extends 'LIMIT' | 'OFFSET'
      ? number
      : FromLookahead<Next, Refs, S>
    : FromLookahead<Next, Refs, S>

/** `col BETWEEN ? AND ?` — the second bound: the column sits before `BETWEEN`. */
type FromBetween<Prev extends string[], Refs extends TableRef[], S> = Prev extends [
  ...string[],
  infer Col extends string,
  infer Between extends string,
  string,
  string,
]
  ? Upper<Between> extends 'BETWEEN'
    ? ParamOf<ResolveColumn<Refs, S, Col>>
    : unknown
  : unknown

/** `col IN (?, ?, ...)` — the column is the token before `IN (`. */
type FromInList<Prev extends string[], Refs extends TableRef[], S> =
  DropTrailingParams<Prev> extends [
    ...string[],
    infer Col extends string,
    infer In extends string,
    '(',
  ]
    ? Upper<In> extends 'IN'
      ? ParamOf<ResolveColumn<Refs, S, Col>>
      : unknown
    : unknown

/** `? = col` — the column follows the operator. */
type FromLookahead<Next extends string[], Refs extends TableRef[], S> = Next extends [
  infer Operator extends string,
  infer Col extends string,
  ...string[],
]
  ? Upper<Operator> extends ComparisonOperator
    ? ParamOf<ResolveColumn<Refs, S, Col>>
    : unknown
  : unknown

/** The types of every placeholder in `T`, in order of appearance. */
export type ScanParams<
  T extends string[],
  Refs extends TableRef[],
  S,
  Acc extends unknown[] = [],
  Prev extends string[] = [],
> = T extends [infer Head extends string, ...infer Rest extends string[]]
  ? Head extends Placeholder
    ? ScanParams<Rest, Refs, S, [...Acc, ParamType<Prev, Rest, Refs, S>], [...Prev, Head]>
    : ScanParams<Rest, Refs, S, Acc, [...Prev, Head]>
  : Acc
