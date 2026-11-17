import type { DefaultName, ExprType } from './expr.js'
import type { AliasEntries, AllEntries, ParseFrom, TableRef, Unsupported } from './tables.js'
import type { IsIdentifier, SplitComma, TakeUntil, Unquote, Upper } from './tokenize.js'

type Entry = [string, unknown]

/** Turns a union of [name, type] entries into an object type; a later duplicate wins. */
export type ObjectOf<Entries extends Entry> = {
  [E in Entries as E[0]]: E[1]
}

type ItemEntries<Item extends string[], Refs extends TableRef[], S> = Item extends ['*']
  ? AllEntries<Refs, S>
  : Item extends [`${infer Alias}.*`]
    ? AliasEntries<Refs, S, Alias>
    : Item extends [
          ...infer Expr extends string[],
          infer As extends string,
          infer Alias extends string,
        ]
      ? Upper<As> extends 'AS'
        ? [Unquote<Alias>, ExprType<Expr, Refs, S>]
        : Item extends [...infer Expr2 extends string[], infer Alias2 extends string]
          ? IsIdentifier<Alias2> extends true
            ? Expr2 extends [string] | [...string[], ')']
              ? [Unquote<Alias2>, ExprType<Expr2, Refs, S>]
              : [DefaultName<Item>, ExprType<Item, Refs, S>]
            : [DefaultName<Item>, ExprType<Item, Refs, S>]
          : [DefaultName<Item>, ExprType<Item, Refs, S>]
      : [DefaultName<Item>, ExprType<Item, Refs, S>]

/** Every [name, type] entry the select list yields, as a union. */
export type SelectEntries<Items extends string[][], Refs extends TableRef[], S> = Items extends [
  infer Head extends string[],
  ...infer Rest extends string[][],
]
  ? ItemEntries<Head, Refs, S> | SelectEntries<Rest, Refs, S>
  : never

type StripSetQuantifier<T extends string[]> = T extends [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? Upper<Head> extends 'DISTINCT' | 'ALL'
    ? Rest
    : T
  : T

/** The row type of a SELECT, given the tokens after the `SELECT` keyword. */
export type ParseSelect<T extends string[], S> =
  TakeUntil<StripSetQuantifier<T>, 'FROM'> extends {
    readonly taken: infer List extends string[]
    readonly rest: infer Rest extends string[]
  }
    ? Rest extends [string, ...infer FromTokens extends string[]]
      ? ParseFrom<FromTokens> extends { readonly tables: infer Refs extends TableRef[] }
        ? ObjectOf<SelectEntries<SplitComma<List>, Refs, S>>
        : Unsupported
      : ObjectOf<SelectEntries<SplitComma<List>, [], S>>
    : Unsupported

/** The row type of a `RETURNING ...` list against one table. */
export type ParseReturning<T extends string[], Refs extends TableRef[], S> = ObjectOf<
  SelectEntries<SplitComma<T>, Refs, S>
>
