import type { ConnectionConfig, Dialect } from './core/index.js'
import { closeSession, session } from './session.js'

/** One column as the database describes it, with the TypeScript type `sql()` gives it. */
export type SchemaColumn = {
  readonly name: string
  /** The type as the database names it, e.g. `VARCHAR(255)` or `timestamptz`. */
  readonly dataType: string
  readonly nullable: boolean
  /** The TypeScript type, rendered as source (`string`, `'admin' | 'member'`, `Date`). */
  readonly tsType: string
}

export type SchemaTable = {
  readonly name: string
  readonly columns: readonly SchemaColumn[]
}

export type SchemaInfo = {
  /** The dialect's name (`sqlite`, `mysql`, `postgres`, or a custom dialect's). */
  readonly dialect: string
  readonly tables: readonly SchemaTable[]
}

/**
 * The tables and columns of a database, read the way the lint rule and `inferql schema` read
 * them: the dialect connects, `migrationsDir` is applied, and the dialect introspects the
 * result. For tools that show the schema — an editor's completion, a schema browser.
 *
 * The session is closed afterwards, so each call sees the migrations as they are now. Against
 * a server, the migrations run on every call, as they do on every lint session.
 */
export async function describeSchema(
  config: ConnectionConfig,
  projectDir: string,
  overrides: Readonly<Record<string, string>> = {},
): Promise<SchemaInfo> {
  const settings = {
    dialect: config.dialect,
    databaseUrl: config.databaseUrl,
    migrationsDir: config.migrationsDir,
  }
  try {
    const current = await session(settings, projectDir)
    if (current.connection.introspect === undefined) {
      throw new Error(`dialect \`${current.dialect.name}\` cannot introspect a schema`)
    }
    const introspected = await current.connection.introspect()
    const learned = introspected.types ?? {}
    return {
      dialect: current.dialect.name,
      tables: introspected.tables.map((table) => ({
        name: table.name,
        columns: table.columns.map((column) => ({
          name: column.name,
          dataType: column.dataType,
          nullable: column.nullability === 'nullable',
          tsType: tsTypeOf(column.dataType, learned, current.dialect, overrides),
        })),
      })),
    }
  } finally {
    await closeSession(settings, projectDir)
  }
}

/**
 * The TypeScript type of a database type: an override first, then a type the schema itself
 * taught (an enum, an array), then the dialect's mapping, else `unknown`.
 */
export function tsTypeOf(
  dataType: string,
  learned: Readonly<Record<string, string>>,
  dialect: Pick<Dialect, 'toTsType'>,
  overrides: Readonly<Record<string, string>> = {},
): string {
  return (
    lookup(overrides, dataType) ??
    lookup(learned, dataType) ??
    dialect.toTsType(dataType) ??
    'unknown'
  )
}

function lookup(map: Readonly<Record<string, string>>, dataType: string): string | undefined {
  const wanted = dataType.toLowerCase()
  for (const [name, value] of Object.entries(map)) {
    if (name.toLowerCase() === wanted) return value
  }
  return undefined
}
