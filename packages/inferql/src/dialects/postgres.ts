import postgres from 'postgres'

import { describeFailure } from '../core/index.js'
import type {
  ColumnNullability,
  Connection,
  DescribeResult,
  DescribedColumn,
  Dialect,
  IntrospectedTable,
  IntrospectResult,
} from '../core/index.js'

/**
 * What `postgres.js` hands back at runtime for each built-in type: `int8` and `numeric` stay
 * strings, timestamps become `Date`, `json`/`jsonb` are parsed into whatever they hold.
 */
export function toTsType(dataType: string): string | undefined {
  switch (dataType) {
    case 'int2':
    case 'int4':
    case 'float4':
    case 'float8':
    case 'oid':
      return 'number'
    case 'int8':
    case 'numeric':
    case 'money':
    case 'text':
    case 'varchar':
    case 'bpchar':
    case 'char':
    case 'name':
    case 'citext':
    case 'uuid':
    case 'time':
    case 'timetz':
    case 'interval':
    case 'inet':
    case 'cidr':
    case 'macaddr':
    case 'xml':
    case 'tsvector':
    case 'tsquery':
    case 'point':
    case 'line':
    case 'lseg':
    case 'box':
    case 'path':
    case 'polygon':
    case 'circle':
    case 'bit':
    case 'varbit':
      return 'string'
    case 'bool':
      return 'boolean'
    case 'date':
    case 'timestamp':
    case 'timestamptz':
      return 'Date'
    case 'bytea':
      return 'Buffer'
    case 'json':
    case 'jsonb':
      return 'unknown'
    case 'void':
      return 'void'
    default:
      return undefined
  }
}

type PgType = {
  readonly oid: number
  readonly typname: string
  readonly typtype: string
  readonly typelem: number
}

type Catalog = {
  readonly types: ReadonlyMap<number, PgType>
  readonly enums: ReadonlyMap<number, readonly string[]>
  readonly notNull: Map<string, boolean>
}

function property(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function isPgType(row: unknown): row is PgType {
  return (
    typeof row === 'object' &&
    row !== null &&
    typeof Reflect.get(row, 'oid') === 'number' &&
    typeof Reflect.get(row, 'typname') === 'string' &&
    typeof Reflect.get(row, 'typtype') === 'string' &&
    typeof Reflect.get(row, 'typelem') === 'number'
  )
}

type EnumRow = { readonly enumtypid: number; readonly enumlabel: string }

function isEnumRow(row: unknown): row is EnumRow {
  return (
    typeof row === 'object' &&
    row !== null &&
    typeof Reflect.get(row, 'enumtypid') === 'number' &&
    typeof Reflect.get(row, 'enumlabel') === 'string'
  )
}

async function loadCatalog(sql: postgres.Sql): Promise<Catalog> {
  const typeRows = await sql.unsafe(
    'SELECT oid::int4 AS oid, typname, typtype::text AS typtype, typelem::int4 AS typelem FROM pg_type',
  )
  const enumRows = await sql.unsafe(
    'SELECT enumtypid::int4 AS enumtypid, enumlabel FROM pg_enum ORDER BY enumtypid, enumsortorder',
  )
  const types = new Map<number, PgType>()
  for (const row of typeRows) {
    if (isPgType(row)) types.set(row.oid, row)
  }
  const enums = new Map<number, string[]>()
  for (const row of enumRows) {
    if (!isEnumRow(row)) continue
    const labels = enums.get(row.enumtypid) ?? []
    labels.push(row.enumlabel)
    enums.set(row.enumtypid, labels)
  }
  return { types, enums, notNull: new Map() }
}

/**
 * The TypeScript type for a catalog entry, learning enums (a union of their labels) and
 * arrays (`T[]` of the element type) from the catalog itself.
 */
export function learnType(
  oid: number,
  types: ReadonlyMap<number, PgType>,
  enums: ReadonlyMap<number, readonly string[]>,
  depth = 0,
): string | undefined {
  const entry = types.get(oid)
  if (entry === undefined || depth > 4) return undefined
  if (entry.typtype === 'e') {
    const labels = enums.get(oid) ?? []
    return labels.length === 0 ? 'string' : labels.map((label) => `'${label}'`).join(' | ')
  }
  if (entry.typelem !== 0 && entry.typname.startsWith('_')) {
    const element =
      learnType(entry.typelem, types, enums, depth + 1) ??
      toTsType(types.get(entry.typelem)?.typname ?? '')
    if (element === undefined) return undefined
    return element.includes('|') ? `(${element})[]` : `${element}[]`
  }
  return undefined
}

async function isNotNull(
  sql: postgres.Sql,
  catalog: Catalog,
  table: number,
  column: number,
): Promise<boolean> {
  const key = `${table}.${column}`
  const cached = catalog.notNull.get(key)
  if (cached !== undefined) return cached
  const rows = await sql.unsafe(
    'SELECT attnotnull FROM pg_attribute WHERE attrelid = $1 AND attnum = $2',
    [table, column],
  )
  const [row] = rows
  const value = row !== undefined && Reflect.get(row, 'attnotnull') === true
  catalog.notNull.set(key, value)
  return value
}

type DescribedStatementColumn = {
  readonly name: string
  readonly type: number
  readonly table: number
  readonly number: number
}

function isStatementColumn(value: unknown): value is DescribedStatementColumn {
  return (
    typeof property(value, 'name') === 'string' &&
    typeof property(value, 'type') === 'number' &&
    typeof property(value, 'table') === 'number' &&
    typeof property(value, 'number') === 'number'
  )
}

async function describeColumn(
  sql: postgres.Sql,
  catalog: Catalog,
  column: DescribedStatementColumn,
  learned: Record<string, string>,
): Promise<DescribedColumn> {
  const entry = catalog.types.get(column.type)
  const dataType = entry?.typname ?? `oid_${column.type}`
  const tsType = learnType(column.type, catalog.types, catalog.enums)
  if (tsType !== undefined) Reflect.set(learned, dataType, tsType)
  const hasSource = column.table !== 0 && column.number !== 0
  const notNull = hasSource ? await isNotNull(sql, catalog, column.table, column.number) : undefined
  const nullability: ColumnNullability =
    notNull === undefined ? 'unknown' : notNull ? 'not-null' : 'nullable'
  return { name: column.name, dataType, nullability }
}

async function describeWith(
  sql: postgres.Sql,
  catalog: Catalog,
  queryText: string,
): Promise<DescribeResult> {
  try {
    const described = await sql.unsafe(queryText).describe()
    const learned: Record<string, string> = {}
    const statementColumns: unknown[] = described.columns
    const columns = await Promise.all(
      statementColumns
        .filter(isStatementColumn)
        .map((column) => describeColumn(sql, catalog, column, learned)),
    )
    const parameters = described.types.map((oid) => ({
      dataType: catalog.types.get(oid)?.typname ?? null,
    }))
    return { ok: true, columns, parameters, types: learned }
  } catch (error) {
    const position = property(error, 'position')
    const offset = typeof position === 'string' ? Number.parseInt(position, 10) - 1 : undefined
    return describeFailure(
      error,
      offset !== undefined && Number.isFinite(offset) ? offset : undefined,
    )
  }
}

type AttributeRow = {
  readonly table: string
  readonly column: string
  readonly typeoid: number
  readonly notnull: boolean
}

function isAttributeRow(row: unknown): row is AttributeRow {
  return (
    typeof property(row, 'table') === 'string' &&
    typeof property(row, 'column') === 'string' &&
    typeof property(row, 'typeoid') === 'number' &&
    typeof property(row, 'notnull') === 'boolean'
  )
}

async function introspect(sql: postgres.Sql, catalog: Catalog): Promise<IntrospectResult> {
  const rows = await sql.unsafe(`
    SELECT c.relname AS table, a.attname AS column, a.atttypid::int4 AS typeoid, a.attnotnull AS notnull
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'v', 'm', 'p') AND a.attnum > 0 AND NOT a.attisdropped
      AND n.nspname = ANY (current_schemas(false))
    ORDER BY c.relname, a.attnum
  `)
  const tables = new Map<string, IntrospectedTable>()
  const types: Record<string, string> = {}
  const list: unknown[] = rows
  for (const row of list.filter(isAttributeRow)) {
    const dataType = catalog.types.get(row.typeoid)?.typname ?? `oid_${row.typeoid}`
    const learned = learnType(row.typeoid, catalog.types, catalog.enums)
    if (learned !== undefined) Reflect.set(types, dataType, learned)
    const existing = tables.get(row.table) ?? { name: row.table, columns: [] }
    tables.set(row.table, {
      name: existing.name,
      columns: [
        ...existing.columns,
        { name: row.column, dataType, nullability: row.notnull ? 'not-null' : 'nullable' },
      ],
    })
  }
  return { tables: [...tables.values()], types }
}

async function open(databaseUrl: string): Promise<Connection> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
  // Reloaded after every `exec`: a migration may add the enum or table a later query uses.
  let catalog = await loadCatalog(sql)
  return {
    describe(queryText) {
      return describeWith(sql, catalog, queryText)
    },
    async exec(sqlText) {
      await sql.unsafe(sqlText)
      catalog = await loadCatalog(sql)
    },
    introspect() {
      return introspect(sql, catalog)
    },
    close() {
      return sql.end()
    },
  }
}

/**
 * The PostgreSQL dialect. Statements are described through `postgres.js` (the extended-query
 * protocol's Describe message), types are named from `pg_type`, enums and arrays are learned
 * from the catalog, and a column that maps onto a table reads its nullability from
 * `pg_attribute`. A column produced by an expression or an outer join is reported as
 * `unknown` nullability, which inferql renders without `| null`.
 */
export const dialect: Dialect = {
  name: 'postgres',
  toTsType,
  connect(databaseUrl) {
    return open(databaseUrl)
  },
}

// The runtime half, for code that runs queries: `sql()` bound to a database (client/postgres.ts).
// It shares the entry so `import { connect } from 'inferql/postgres'` is all an app imports.
export { connect } from '../client/postgres.js'
export type { PostgresSql } from '../client/postgres.js'
