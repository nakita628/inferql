import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** What the extension needs to read a project's schema: inferql's connection settings. */
export type ProjectConnection = {
  readonly dialect: string
  readonly migrationsDir?: string | undefined
  readonly databaseUrl?: string | undefined
}

/** Settings the editor holds, used where tsconfig.json says nothing. */
export type ConnectionSettings = {
  readonly dialect?: string | undefined
  readonly migrationsDir?: string | undefined
  readonly databaseUrl?: string | undefined
}

/** The directory of the nearest package.json above `file`: inferql's project directory. */
export function findProjectDir(file: string): string | undefined {
  let current = path.dirname(file)
  for (;;) {
    if (existsSync(path.join(current, 'package.json'))) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * JSON with comments and trailing commas, as tsconfig.json is written: comments are blanked
 * outside strings, then a comma before `}` or `]` is dropped.
 */
export function parseJsonc(text: string): unknown {
  let out = ''
  let index = 0
  while (index < text.length) {
    const char = text.charAt(index)
    const next = text.charAt(index + 1)
    if (char === '"') {
      let end = index + 1
      while (end < text.length && text.charAt(end) !== '"') end += text.charAt(end) === '\\' ? 2 : 1
      out += text.slice(index, end + 1)
      index = end + 1
    } else if (char === '/' && next === '/') {
      while (index < text.length && text.charAt(index) !== '\n') index += 1
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
    } else {
      out += char
      index += 1
    }
  }
  return JSON.parse(out.replaceAll(/,(\s*[}\]])/gu, '$1'))
}

function property(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function stringProperty(value: unknown, key: string): string | undefined {
  const found = property(value, key)
  return typeof found === 'string' ? found : undefined
}

/** The `options` of tsconfig.json's `contentMappers` entry for inferql, if it has one. */
function mapperOptions(projectDir: string): unknown {
  const file = path.join(projectDir, 'tsconfig.json')
  if (!existsSync(file)) return undefined
  try {
    const mappers = property(parseJsonc(readFileSync(file, 'utf8')), 'contentMappers')
    if (!Array.isArray(mappers)) return undefined
    const entry: unknown = mappers.find(
      (mapper: unknown) => property(mapper, 'package') === 'inferql',
    )
    return entry === undefined ? undefined : (property(entry, 'options') ?? {})
  } catch {
    return undefined
  }
}

/**
 * The project's connection: tsconfig.json's inferql content mapper options first — the same
 * settings TypeScript reads the migrations with — then the editor's settings. Without a
 * dialect from either, the project is not one this extension completes for.
 */
export function readConnection(
  projectDir: string,
  settings: ConnectionSettings = {},
): ProjectConnection | undefined {
  const options = mapperOptions(projectDir)
  const dialect = stringProperty(options, 'dialect') ?? settings.dialect
  if (dialect === undefined) return undefined
  return {
    dialect,
    migrationsDir:
      stringProperty(options, 'migrationsDir') ??
      settings.migrationsDir ??
      (options === undefined ? undefined : 'migrations'),
    databaseUrl: stringProperty(options, 'databaseUrl') ?? settings.databaseUrl,
  }
}
