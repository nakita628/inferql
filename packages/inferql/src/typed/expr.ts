import type { ResolveColumn, TableRef, ValueOf } from './tables.js'
import type { JoinTokens, SplitComma, Unquote, Upper } from './tokenize.js'

type NumericLiteral = `${number}`
type StringLiteral = `'${string}'`

type ArgTypes<Args extends string[][], Refs extends TableRef[], S> = {
  [K in keyof Args]: Args[K] extends string[] ? ExprType<Args[K], Refs, S> : never
}

type Nullish<T> = null extends T ? null : never

type AnyNonNull<Types extends unknown[]> = Types extends [infer Head, ...infer Rest]
  ? null extends Head
    ? AnyNonNull<Rest>
    : true
  : false

/** COALESCE / IFNULL: the non-null parts of every argument, null only if all can be null. */
type Coalesce<Types extends unknown[]> =
  AnyNonNull<Types> extends true ? Exclude<Types[number], null> : Types[number]

type CastTarget<T extends string> =
  Upper<T> extends `${'INT' | 'BIGINT' | 'SMALLINT' | 'TINYINT'}${string}`
    ? number
    : Upper<T> extends `${'REAL' | 'FLOAT' | 'DOUBLE' | 'NUMERIC' | 'DECIMAL'}${string}`
      ? number
      : Upper<T> extends `${'TEXT' | 'VARCHAR' | 'CHAR' | 'NVARCHAR' | 'CLOB'}${string}`
        ? string
        : Upper<T> extends `BOOL${string}`
          ? boolean
          : unknown

type SplitArgs<T extends string[]> = SplitComma<T>

/** The type of one function call, given its uppercased name and argument tokens. */
type FunctionType<
  Name extends string,
  Args extends string[],
  Refs extends TableRef[],
  S,
> = Name extends 'COUNT'
  ? number
  : Name extends 'TOTAL'
    ? number
    : Name extends 'SUM' | 'AVG'
      ? number | null
      : Name extends 'MIN' | 'MAX'
        ? ExprType<Args, Refs, S> | null
        : Name extends 'COALESCE' | 'IFNULL' | 'NVL'
          ? Coalesce<ArgTypes<SplitArgs<Args>, Refs, S>>
          : Name extends
                | 'LOWER'
                | 'UPPER'
                | 'TRIM'
                | 'LTRIM'
                | 'RTRIM'
                | 'SUBSTR'
                | 'SUBSTRING'
                | 'REPLACE'
                | 'CONCAT'
                | 'GROUP_CONCAT'
                | 'STRING_AGG'
            ? string | Nullish<ExprType<FirstArg<Args>, Refs, S>>
            : Name extends 'LENGTH' | 'CHAR_LENGTH' | 'ABS' | 'ROUND' | 'FLOOR' | 'CEIL' | 'CEILING'
              ? number | Nullish<ExprType<FirstArg<Args>, Refs, S>>
              : Name extends 'CAST'
                ? Args extends [
                    ...infer Value extends string[],
                    infer As extends string,
                    infer Target extends string,
                  ]
                  ? Upper<As> extends 'AS'
                    ? CastTarget<Target> | Nullish<ExprType<Value, Refs, S>>
                    : unknown
                  : unknown
                : unknown

type FirstArg<Args extends string[]> =
  SplitArgs<Args> extends [infer First extends string[], ...string[][]] ? First : Args

type ArithmeticOperator = '+' | '-' | '/' | '%' | '*'

/** The TypeScript type of an expression's tokens against the tables in scope. */
export type ExprType<E extends string[], Refs extends TableRef[], S> = E extends [
  infer Only extends string,
]
  ? Only extends '?'
    ? unknown
    : Only extends StringLiteral
      ? string
      : Only extends NumericLiteral
        ? number
        : Upper<Only> extends 'NULL'
          ? null
          : Upper<Only> extends 'TRUE' | 'FALSE'
            ? boolean
            : ValueOf<ResolveColumn<Refs, S, Only>>
  : E extends ['(', ...infer Inner extends string[], ')']
    ? ExprType<Inner, Refs, S>
    : E extends [infer Name extends string, '(', ...infer Args extends string[], ')']
      ? Upper<Name> extends 'DISTINCT'
        ? unknown
        : Args extends [infer Modifier extends string, ...infer Plain extends string[]]
          ? Upper<Modifier> extends 'DISTINCT'
            ? FunctionType<Upper<Name>, Plain, Refs, S>
            : FunctionType<Upper<Name>, Args, Refs, S>
          : FunctionType<Upper<Name>, Args, Refs, S>
      : E extends [
            infer Left extends string,
            infer Operator extends string,
            infer Right extends string,
          ]
        ? Operator extends ArithmeticOperator
          ? number | Nullish<ExprType<[Left], Refs, S>> | Nullish<ExprType<[Right], Refs, S>>
          : Operator extends '||'
            ? string | Nullish<ExprType<[Left], Refs, S>> | Nullish<ExprType<[Right], Refs, S>>
            : unknown
        : unknown

/** The name a database gives an unaliased select item. */
export type DefaultName<E extends string[]> = E extends [infer Only extends string]
  ? Unquote<Only> extends `${string}.${infer Col}`
    ? Unquote<Col>
    : Unquote<Only>
  : JoinTokens<E>
