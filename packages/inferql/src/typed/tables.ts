import type { AnyColumn, Column } from './schema.js'
import type { IsIdentifier, TakeUntil, Unquote, Upper } from './tokenize.js'

/** A table brought into scope by FROM / JOIN, and whether an outer join made it nullable. */
export type TableRef = {
  readonly alias: string
  readonly table: string
  readonly nullable: boolean
}

/** A construct the parser does not understand; the query falls back to `unknown` rows. */
export type Unsupported = { readonly unsupported: true }

export type ClauseKeyword =
  | 'WHERE'
  | 'GROUP'
  | 'ORDER'
  | 'LIMIT'
  | 'OFFSET'
  | 'HAVING'
  | 'UNION'
  | 'RETURNING'
  | 'ON'
  | 'USING'
type JoinKeyword = 'JOIN' | 'LEFT' | 'RIGHT' | 'INNER' | 'OUTER' | 'CROSS' | 'FULL' | 'NATURAL'

type MakeRef<Alias extends string, Table extends string, Nullable extends boolean> = {
  readonly alias: Unquote<Alias>
  readonly table: Unquote<Table>
  readonly nullable: Nullable
}

/** `name`, `name alias` or `name AS alias`; a parenthesised subquery is unsupported. */
export type ParseTableRef<T extends string[], Nullable extends boolean> = T extends [
  infer Name extends string,
  ...infer Rest extends string[],
]
  ? Name extends '('
    ? Unsupported
    : Rest extends [
          infer As extends string,
          infer Alias extends string,
          ...infer After extends string[],
        ]
      ? Upper<As> extends 'AS'
        ? { readonly ref: MakeRef<Alias, Name, Nullable>; readonly rest: After }
        : IsIdentifier<As> extends true
          ? { readonly ref: MakeRef<As, Name, Nullable>; readonly rest: [Alias, ...After] }
          : { readonly ref: MakeRef<Name, Name, Nullable>; readonly rest: Rest }
      : Rest extends [infer Alias extends string, ...infer After extends string[]]
        ? IsIdentifier<Alias> extends true
          ? { readonly ref: MakeRef<Alias, Name, Nullable>; readonly rest: After }
          : { readonly ref: MakeRef<Name, Name, Nullable>; readonly rest: Rest }
        : { readonly ref: MakeRef<Name, Name, Nullable>; readonly rest: Rest }
  : Unsupported

type MarkNullable<Refs extends TableRef[]> = {
  [K in keyof Refs]: { alias: Refs[K]['alias']; table: Refs[K]['table']; nullable: true }
}

type JoinKind = 'left' | 'right' | 'full' | 'inner'

/** Reads the join words before `JOIN`; `rest` is the token after `JOIN`. */
type ParseJoinWords<T extends string[], Kind extends JoinKind = 'inner'> = T extends [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? Upper<Head> extends 'JOIN'
    ? { readonly kind: Kind; readonly rest: Rest }
    : Upper<Head> extends 'LEFT'
      ? ParseJoinWords<Rest, 'left'>
      : Upper<Head> extends 'RIGHT'
        ? ParseJoinWords<Rest, 'right'>
        : Upper<Head> extends 'FULL'
          ? ParseJoinWords<Rest, 'full'>
          : Upper<Head> extends 'OUTER' | 'INNER' | 'CROSS' | 'NATURAL'
            ? ParseJoinWords<Rest, Kind>
            : Unsupported
  : Unsupported

type AfterJoin<Refs extends TableRef[], Kind extends JoinKind, Parsed> = Parsed extends {
  readonly ref: infer R extends TableRef
  readonly rest: infer Rest extends string[]
}
  ? ParseJoins<
      SkipCondition<Rest>,
      Kind extends 'left'
        ? [...Refs, { alias: R['alias']; table: R['table']; nullable: true }]
        : Kind extends 'right'
          ? [...MarkNullable<Refs>, R]
          : Kind extends 'full'
            ? [...MarkNullable<Refs>, { alias: R['alias']; table: R['table']; nullable: true }]
            : [...Refs, R]
    >
  : Unsupported

/** Skips an `ON ...` / `USING (...)` condition up to the next join or clause. */
type SkipCondition<T extends string[]> = T extends [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? Upper<Head> extends 'ON' | 'USING'
    ? TakeUntil<Rest, JoinKeyword | Exclude<ClauseKeyword, 'ON' | 'USING'> | ','>['rest']
    : T
  : T

/** Parses the joins and comma-separated tables that follow the first table. */
export type ParseJoins<T extends string[], Refs extends TableRef[]> = T extends [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? Head extends ','
    ? AfterJoin<Refs, 'inner', ParseTableRef<Rest, false>>
    : Upper<Head> extends JoinKeyword
      ? ParseJoinWords<T> extends {
          readonly kind: infer Kind extends JoinKind
          readonly rest: infer After extends string[]
        }
        ? AfterJoin<Refs, Kind, ParseTableRef<After, Kind extends 'left' | 'full' ? true : false>>
        : Unsupported
      : { readonly tables: Refs; readonly rest: T }
  : { readonly tables: Refs; readonly rest: [] }

/** Parses everything after `FROM`: the tables in scope and the remaining tokens. */
export type ParseFrom<T extends string[]> =
  ParseTableRef<T, false> extends {
    readonly ref: infer R extends TableRef
    readonly rest: infer Rest extends string[]
  }
    ? ParseJoins<Rest, [R]>
    : Unsupported

type FindAlias<Refs extends TableRef[], Alias extends string> = Refs extends [
  infer Head extends TableRef,
  ...infer Rest extends TableRef[],
]
  ? Head['alias'] extends Alias
    ? Head
    : FindAlias<Rest, Alias>
  : never

type ColumnIn<S, Ref extends TableRef, Name extends string> = Ref['table'] extends keyof S
  ? Name extends keyof S[Ref['table']]
    ? S[Ref['table']][Name] extends Column<infer Type, infer Nullable>
      ? Column<Type, Ref['nullable'] extends true ? true : Nullable>
      : never
    : never
  : never

type FindColumn<Refs extends TableRef[], S, Name extends string> = Refs extends [
  infer Head extends TableRef,
  ...infer Rest extends TableRef[],
]
  ? [ColumnIn<S, Head, Name>] extends [never]
    ? FindColumn<Rest, S, Name>
    : ColumnIn<S, Head, Name>
  : never

/** Resolves `col` or `alias.col` against the tables in scope; `never` when not found. */
export type ResolveColumn<Refs extends TableRef[], S, Name extends string> =
  Unquote<Name> extends `${infer Alias}.${infer Col}`
    ? ColumnIn<S, FindAlias<Refs, Unquote<Alias>>, Unquote<Col>>
    : FindColumn<Refs, S, Unquote<Name>>

/** The value type of a column, with `null` added when it is nullable. */
export type ValueOf<C> = [C] extends [never]
  ? unknown
  : C extends Column<infer Type, infer Nullable>
    ? Nullable extends true
      ? Type | null
      : Type
    : unknown

type EntriesOfTable<S, Ref extends TableRef> = Ref['table'] extends keyof S
  ? {
      [K in keyof S[Ref['table']] & string]: [
        K,
        ValueOf<
          S[Ref['table']][K] extends AnyColumn
            ? Column<
                S[Ref['table']][K]['type'],
                Ref['nullable'] extends true ? true : S[Ref['table']][K]['nullable']
              >
            : never
        >,
      ]
    }[keyof S[Ref['table']] & string]
  : never

/** `*` — every column of every table in scope, as [name, type] entries (a union). */
export type AllEntries<Refs extends TableRef[], S> = Refs extends [
  infer Head extends TableRef,
  ...infer Rest extends TableRef[],
]
  ? EntriesOfTable<S, Head> | AllEntries<Rest, S>
  : never

/** `alias.*` — every column of one table in scope. */
export type AliasEntries<Refs extends TableRef[], S, Alias extends string> = EntriesOfTable<
  S,
  FindAlias<Refs, Unquote<Alias>>
>
