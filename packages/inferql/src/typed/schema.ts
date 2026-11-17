/**
 * One column of a table as the schema describes it: the TypeScript type of a value and
 * whether the column can hold NULL.
 */
export type Column<Type, Nullable extends boolean = false> = {
  readonly type: Type
  readonly nullable: Nullable
}

export type AnyColumn = Column<unknown, boolean>

export type Table = { readonly [column: string]: AnyColumn }

export type Tables = { readonly [table: string]: Table }

/**
 * The migrations inferql's TypeScript content mapper registers: one entry per `.sql` file of
 * the configured migrations directory, keyed by its position in name order (the order the lint
 * rule applies them in), holding the dialect and the file's text as a string literal type.
 * Empty without the mapper (no `contentMappers` entry in tsconfig.json).
 */
// It must stay an interface (a type alias cannot be augmented) and empty (the mapper's
// modules fill it in), which two rules in the shared set would otherwise rewrite.
// oxlint-disable-next-line typescript/consistent-type-definitions, typescript/no-empty-object-type -- augmentation target
export interface Migrations {}

/** Whether a schema has any table; without one, rows and parameters stay `unknown`. */
export type HasTables<S> = keyof S extends never ? false : true
