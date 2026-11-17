import { readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * inferql's TypeScript content mapper (TypeScript 7.1+): it shows TypeScript each migration
 * `.sql` file as a module that registers the file's text, as a string literal type, in the
 * `Migrations` interface under its position in name order. inferql's types fold those entries
 * into the `Schema` with `InferSchema`, so a project whose migrations are plain `.sql` files
 * writes no TypeScript for its schema at all — only the `contentMappers` entry in tsconfig.json.
 *
 * TypeScript starts the mapper as a process (`typescript.contentMapper` in package.json) and
 * speaks JSON-RPC with LSP-style framing over its stdin / stdout: `initialize`, then
 * `openProject` per tsconfig.json, `transform` per mapped file, `closeProject`.
 */

/** What the mapper answers each method with; plain data, sent back as the JSON-RPC result. */
export type MapperHandlers = Readonly<Record<string, (params: unknown) => unknown>>

/** The dialect names `InferSchema` understands, the same the lint rule accepts. */
const DIALECTS = new Set(['sqlite', 'mysql', 'mariadb', 'postgres', 'postgresql', 'pg'])

type Project = {
  readonly dialect: string
  /** The absolute migrations directory: only its `.sql` files are migrations. */
  readonly migrationsDir: string
}

function property(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function stringProperty(value: unknown, key: string): string | undefined {
  const found = property(value, key)
  return typeof found === 'string' ? found : undefined
}

/** The migrations of a directory in the order the lint rule applies them: by name. */
export function migrationNames(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((entry) => entry.endsWith('.sql'))
      .toSorted((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/**
 * The module TypeScript sees for one migration: an augmentation of `Migrations` with the
 * file's text under its index. `JSON.stringify` writes a valid TypeScript string literal.
 */
export function migrationModule(index: number, dialect: string, sql: string): string {
  return [
    '// A migration, as inferql’s content mapper shows it to TypeScript. The import brings',
    '// inferql itself into the program: an augmentation of a module that nothing else loads',
    '// (a project that imports only `inferql/sqlite`) is not resolved.',
    "import type {} from 'inferql'",
    "declare module 'inferql' {",
    '  interface Migrations {',
    `    ${index}: { readonly dialect: ${JSON.stringify(dialect)}; readonly sql: ${JSON.stringify(sql)} }`,
    '  }',
    '}',
    '',
  ].join('\n')
}

/** A `.sql` file outside the migrations directory registers nothing. */
const NOT_A_MIGRATION = 'export {}\n'

/** The mapper's methods. State (the open projects) lives in the returned closure. */
export function createMapperHandlers(): MapperHandlers {
  const projects = new Map<string, Project>()
  return {
    initialize(params) {
      const version = property(params, 'protocolVersion')
      return {
        protocolVersion: typeof version === 'number' ? version : 1,
        positionEncoding: 'utf-8',
        diagnosticSource: 'inferql',
      }
    },
    openProject(params) {
      const handle = stringProperty(params, 'projectHandle') ?? ''
      const configFile = stringProperty(params, 'configFileName') ?? ''
      const options = property(params, 'options')
      const dialect = stringProperty(options, 'dialect') ?? 'sqlite'
      const migrationsDir = path.resolve(
        path.dirname(configFile),
        stringProperty(options, 'migrationsDir') ?? 'migrations',
      )
      projects.set(handle, { dialect, migrationsDir })
      const optionDiagnostics = DIALECTS.has(dialect)
        ? []
        : [
            {
              path: ['dialect'],
              messageText: `inferql does not know the dialect \`${dialect}\`; use one of ${[...DIALECTS].join(', ')}.`,
              code: 1,
            },
          ]
      // A migration's index depends on the other files' names: an added, removed or renamed
      // migration changes the identity, and the watched directory makes TypeScript ask again,
      // so every migration is transformed anew with its current index.
      return {
        configIdentity: JSON.stringify([dialect, migrationsDir, migrationNames(migrationsDir)]),
        watchedFiles: [migrationsDir],
        optionDiagnostics,
      }
    },
    transform(params) {
      const fileName = stringProperty(params, 'fileName') ?? ''
      const content = stringProperty(params, 'content') ?? ''
      const project = projects.get(stringProperty(params, 'projectHandle') ?? '')
      const isMigration =
        project !== undefined && path.resolve(path.dirname(fileName)) === project.migrationsDir
      if (!isMigration) return { extension: '.ts', text: NOT_A_MIGRATION, mappings: [] }
      const index = migrationNames(project.migrationsDir).indexOf(path.basename(fileName))
      if (index === -1) return { extension: '.ts', text: NOT_A_MIGRATION, mappings: [] }
      return {
        extension: '.ts',
        text: migrationModule(index, project.dialect, content),
        mappings: [],
      }
    },
    closeProject(params) {
      projects.delete(stringProperty(params, 'projectHandle') ?? '')
      return {}
    },
  }
}

function frame(message: unknown): string {
  const body = JSON.stringify(message)
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
}

/** Answers one JSON-RPC message; a notification (no `id`) gets no answer. */
export function respond(handlers: MapperHandlers, message: unknown): string | undefined {
  const id = property(message, 'id')
  const method = stringProperty(message, 'method') ?? ''
  if (id === undefined) return undefined
  const handler = handlers[method]
  if (handler === undefined) {
    return frame({
      jsonrpc: '2.0',
      id,
      error: { code: -32_601, message: `Unknown method ${method}` },
    })
  }
  try {
    return frame({ jsonrpc: '2.0', id, result: handler(property(message, 'params')) ?? {} })
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    return frame({ jsonrpc: '2.0', id, error: { code: -32_603, message: text } })
  }
}

/** Serves the handlers over this process's stdin / stdout until TypeScript closes the pipe. */
export function serve(handlers: MapperHandlers): void {
  let buffer = Buffer.alloc(0)
  process.stdin.on('end', () => process.exit(0))
  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const length = Number(
        /Content-Length:\s*(\d+)/iu.exec(buffer.subarray(0, headerEnd).toString())?.[1],
      )
      const start = headerEnd + 4
      if (buffer.length < start + length) return
      const message: unknown = JSON.parse(buffer.subarray(start, start + length).toString('utf8'))
      buffer = buffer.subarray(start + length)
      const reply = respond(handlers, message)
      if (reply !== undefined) process.stdout.write(reply)
    }
  })
}
