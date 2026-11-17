import mysql from 'mysql2/promise'

import { describeFailure } from '../core/index.js'
import type {
  Connection,
  DescribeResult,
  DescribedColumn,
  Dialect,
  IntrospectedTable,
  IntrospectResult,
} from '../core/index.js'

/** Column type codes of the MySQL binary protocol (`mysql2`'s `Types`). */
const TYPE_NAMES: Readonly<Record<number, string>> = {
  0: 'decimal',
  1: 'tinyint',
  2: 'smallint',
  3: 'int',
  4: 'float',
  5: 'double',
  6: 'null',
  7: 'timestamp',
  8: 'bigint',
  9: 'mediumint',
  10: 'date',
  11: 'time',
  12: 'datetime',
  13: 'year',
  14: 'date',
  15: 'varchar',
  16: 'bit',
  245: 'json',
  246: 'decimal',
  247: 'enum',
  248: 'set',
  249: 'tinyblob',
  250: 'mediumblob',
  251: 'longblob',
  252: 'blob',
  253: 'varchar',
  254: 'char',
  255: 'geometry',
}

const NOT_NULL_FLAG = 1
const ENUM_FLAG = 256
const SET_FLAG = 2048
/** The `binary` character set: what tells a BLOB from a TEXT (both arrive as BLOB types). */
const BINARY_CHARSET = 63

function hasFlag(flags: number, flag: number): boolean {
  // oxlint-disable-next-line no-bitwise -- MySQL column flags are a bit set by protocol definition
  return (flags & flag) !== 0
}

function property(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

export function isColumnDefinition(value: unknown): value is ColumnDefinition {
  return (
    typeof property(value, 'name') === 'string' &&
    typeof property(value, 'columnType') === 'number' &&
    typeof property(value, 'flags') === 'number'
  )
}

/**
 * What `mysql2` hands back at runtime for each column type with its default options: integers
 * as numbers, `DECIMAL` and `BIGINT` as strings, temporal types as `Date`, binary as `Buffer`.
 */
export function toTsType(dataType: string): string | undefined {
  switch (dataType.toLowerCase()) {
    case 'tinyint':
    case 'smallint':
    case 'mediumint':
    case 'int':
    case 'year':
    case 'float':
    case 'double':
      return 'number'
    case 'bigint':
      // mysql2 returns BIGINT as a JS number unless `supportBigNumbers` is on.
      return 'number'
    case 'decimal':
    case 'varchar':
    case 'char':
    case 'text':
    case 'enum':
    case 'set':
    case 'time':
      return 'string'
    case 'date':
    case 'datetime':
    case 'timestamp':
      return 'Date'
    case 'bit':
    case 'blob':
    case 'tinyblob':
    case 'mediumblob':
    case 'longblob':
    case 'geometry':
      return 'Buffer'
    case 'json':
      return 'unknown'
    case 'null':
      return 'null'
    default:
      return undefined
  }
}

export type ColumnDefinition = {
  readonly name: string
  readonly columnType: number
  readonly flags: number
  readonly characterSet?: number | undefined
  readonly table?: string | undefined
  readonly orgTable?: string | undefined
  readonly orgName?: string | undefined
}

/**
 * Names the column's type the way a user would write it in DDL. The wire protocol reports
 * `TEXT` as `BLOB`; the binary flag / charset is what tells the two apart.
 */
export function dataTypeOf(column: ColumnDefinition): string {
  const name = TYPE_NAMES[column.columnType] ?? `type_${column.columnType}`
  if (hasFlag(column.flags, ENUM_FLAG)) return 'enum'
  if (hasFlag(column.flags, SET_FLAG)) return 'set'
  const isBinary = column.characterSet === BINARY_CHARSET
  if (name.endsWith('blob') && !isBinary) return 'text'
  return name
}

/**
 * Describes one column. An ENUM / SET column is named by its definition
 * (`enum('a','b')`, looked up in `information_schema` through `definitionOf`) so its labels can
 * be learned as a union; every other column is named by its wire type.
 */
export function describeColumn(
  column: ColumnDefinition,
  definitionOf: (table: string, column: string) => string | undefined = () => undefined,
): DescribedColumn {
  const table = column.orgTable === '' ? undefined : column.orgTable
  const source = column.orgName === '' ? undefined : column.orgName
  const wireType = dataTypeOf(column)
  const definition =
    (wireType === 'enum' || wireType === 'set') && table !== undefined && source !== undefined
      ? definitionOf(table, source)
      : undefined
  return {
    name: column.name,
    dataType: definition ?? wireType,
    nullability: hasFlag(column.flags, NOT_NULL_FLAG) ? 'not-null' : 'nullable',
    table,
    column: source,
  }
}

type Definitions = Map<string, string>

async function loadDefinitions(connection: mysql.Connection): Promise<Definitions> {
  const [rows] = await connection.query(
    "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE IN ('enum', 'set')",
  )
  const definitions: Definitions = new Map()
  const list: unknown[] = Array.isArray(rows) ? rows : []
  for (const row of list) {
    const table = property(row, 'TABLE_NAME')
    const column = property(row, 'COLUMN_NAME')
    const columnType = property(row, 'COLUMN_TYPE')
    if (typeof table === 'string' && typeof column === 'string' && typeof columnType === 'string') {
      definitions.set(`${table}.${column}`, columnType)
    }
  }
  return definitions
}

async function describeWith(
  connection: mysql.Connection,
  definitions: Definitions,
  queryText: string,
): Promise<DescribeResult> {
  try {
    const statement = await connection.prepare(queryText)
    // The promise wrapper hides the callback statement, which is what carries `columns` and
    // `parameters`; the typings declare neither.
    const inner = property(statement, 'statement') ?? statement
    const rawColumns = property(inner, 'columns')
    const rawParameters = property(inner, 'parameters')
    const types: Record<string, string> = {}
    const columns = Array.isArray(rawColumns)
      ? rawColumns.filter(isColumnDefinition).map((column) => {
          const described = describeColumn(column, (table, name) =>
            definitions.get(`${table}.${name}`),
          )
          const learned =
            described.dataType === null ? undefined : learnColumnType(described.dataType)
          if (learned !== undefined && described.dataType !== null) {
            Reflect.set(types, described.dataType, learned)
          }
          return described
        })
      : []
    const parameters = Array.isArray(rawParameters)
      ? rawParameters.map(() => ({ dataType: null }))
      : []
    await statement.close()
    return { ok: true, columns, parameters, types }
  } catch (error) {
    return describeFailure(error)
  }
}

type InformationSchemaRow = {
  readonly TABLE_NAME: string
  readonly COLUMN_NAME: string
  readonly DATA_TYPE: string
  readonly IS_NULLABLE: string
  readonly COLUMN_TYPE: string
}

function isInformationSchemaRow(row: unknown): row is InformationSchemaRow {
  return (
    typeof property(row, 'TABLE_NAME') === 'string' &&
    typeof property(row, 'COLUMN_NAME') === 'string' &&
    typeof property(row, 'DATA_TYPE') === 'string' &&
    typeof property(row, 'IS_NULLABLE') === 'string' &&
    typeof property(row, 'COLUMN_TYPE') === 'string'
  )
}

/**
 * `enum('a','b')` / `set('a','b')` column types become unions of their members.
 */
export function learnColumnType(columnType: string): string | undefined {
  const match = /^(enum|set)\((.*)\)$/iu.exec(columnType)
  if (match === null) return undefined
  const members = match[2] ?? ''
  const labels = [...members.matchAll(/'((?:[^']|'')*)'/gu)].map((entry) =>
    (entry[1] ?? '').replaceAll("''", "'"),
  )
  return labels.map((label) => `'${label.replaceAll("'", String.raw`\'`)}'`).join(' | ')
}

async function introspect(connection: mysql.Connection): Promise<IntrospectResult> {
  const [rows] = await connection.query(
    'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_TYPE FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION',
  )
  const tables = new Map<string, IntrospectedTable>()
  const types: Record<string, string> = {}
  const list: unknown[] = Array.isArray(rows) ? rows : []
  for (const row of list.filter(isInformationSchemaRow)) {
    const learned = learnColumnType(row.COLUMN_TYPE)
    const dataType = learned === undefined ? row.DATA_TYPE : row.COLUMN_TYPE
    if (learned !== undefined) Reflect.set(types, dataType, learned)
    const existing = tables.get(row.TABLE_NAME) ?? { name: row.TABLE_NAME, columns: [] }
    tables.set(row.TABLE_NAME, {
      name: existing.name,
      columns: [
        ...existing.columns,
        {
          name: row.COLUMN_NAME,
          dataType,
          nullability: row.IS_NULLABLE === 'NO' ? 'not-null' : 'nullable',
        },
      ],
    })
  }
  return { tables: [...tables.values()], types }
}

async function open(databaseUrl: string): Promise<Connection> {
  const connection = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true })
  let definitions = await loadDefinitions(connection)
  return {
    describe(queryText) {
      return describeWith(connection, definitions, queryText)
    },
    async exec(sqlText) {
      await connection.query(sqlText)
      definitions = await loadDefinitions(connection)
    },
    introspect() {
      return introspect(connection)
    },
    close() {
      return connection.end()
    },
  }
}

/**
 * The MySQL / MariaDB dialect. Statements are prepared through `mysql2`, whose column
 * definitions carry the type, source table and the `NOT NULL` flag the server computed for
 * the result — including for expressions such as `COUNT(*)`.
 */
export const dialect: Dialect = {
  name: 'mysql',
  toTsType,
  connect(databaseUrl) {
    return open(databaseUrl)
  },
}

// The runtime half, for code that runs queries: `sql()` bound to a database (client/mysql.ts).
// It shares the entry so `import { connect } from 'inferql/mysql'` is all an app imports.
export { connect } from '../client/mysql.js'
export type { MysqlSql } from '../client/mysql.js'
