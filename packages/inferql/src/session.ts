import { readdirSync, statSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Connection, ConnectionConfig, Dialect } from './core/index.js'
import type { CheckResponse } from './protocol.js'

// The bundled dialects sit next to this file in dist/ (entries of the package build); when this
// file runs as source (the test suite, through vitest's resolver), they live under ./dialects/.
const DIALECTS_DIR = import.meta.url.endsWith('.ts') ? './dialects/' : './'
const BUILT_IN_DIALECTS: Readonly<Record<string, string>> = {
  sqlite: `${DIALECTS_DIR}sqlite.js`,
  mysql: `${DIALECTS_DIR}mysql.js`,
  mariadb: `${DIALECTS_DIR}mysql.js`,
  postgres: `${DIALECTS_DIR}postgres.js`,
  postgresql: `${DIALECTS_DIR}postgres.js`,
  pg: `${DIALECTS_DIR}postgres.js`,
}

export type Session = {
  readonly dialect: Dialect
  readonly connection: Connection
  readonly results: Map<string, CheckResponse>
}

/** Open sessions by connection, with the migrations they were built from. */
const sessions = new Map<
  string,
  { readonly migrations: string; readonly opening: Promise<Session> }
>()
const dialects = new Map<string, Promise<Dialect>>()

function property(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function isDialect(value: unknown): value is Dialect {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'name') === 'string' &&
    typeof Reflect.get(value, 'toTsType') === 'function' &&
    typeof Reflect.get(value, 'connect') === 'function'
  )
}

/**
 * Resolves the dialect package from the linted project first, so an optional peer installed
 * there is found under pnpm's strict layout, and falls back to this package's own graph.
 */
function resolveSpecifier(specifier: string, projectDir: string): string {
  try {
    return pathToFileURL(createRequire(path.join(projectDir, 'package.json')).resolve(specifier))
      .href
  } catch {
    return specifier
  }
}

async function loadDialect(name: string, projectDir: string): Promise<Dialect> {
  const builtIn = BUILT_IN_DIALECTS[name]
  const specifier = builtIn === undefined ? name : new URL(builtIn, import.meta.url).href
  const key = `${projectDir}\0${specifier}`
  const cached = dialects.get(key)
  if (cached !== undefined) return cached
  const target = builtIn === undefined ? resolveSpecifier(specifier, projectDir) : specifier
  const loading = import(target).then((module: unknown) => {
    const candidate = property(module, 'dialect') ?? property(module, 'default')
    if (!isDialect(candidate)) {
      throw new Error(
        `\`${specifier}\` does not export a \`dialect\`; a dialect module exports an object with name, toTsType and connect`,
      )
    }
    return candidate
  })
  dialects.set(key, loading)
  return loading
}

async function applyMigrations(connection: Connection, dir: string): Promise<void> {
  const entries = await readdir(dir)
  const files = entries
    .filter((entry) => entry.endsWith('.sql'))
    .toSorted((a, b) => a.localeCompare(b))
  // Migrations are ordered by name and each may depend on the previous one, so they run one
  // at a time by design.
  for (const file of files) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- sequential by design (see above)
      const text = await readFile(path.join(dir, file), 'utf8')
      // oxlint-disable-next-line no-await-in-loop -- sequential by design (see above)
      await connection.exec(text)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`migration ${file} failed: ${reason}`, { cause: error })
    }
  }
}

class StageError extends Error {
  readonly stage: 'dialect' | 'connection' | 'migration'

  constructor(stage: 'dialect' | 'connection' | 'migration', cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.stage = stage
  }
}

/**
 * Runs one step of opening a session, naming the stage on whatever it throws — synchronously
 * or as a rejection — so the rule can say which part failed.
 */
async function atStage<T>(
  name: 'dialect' | 'connection' | 'migration',
  step: () => Promise<T>,
): Promise<T> {
  try {
    return await step()
  } catch (error) {
    throw new StageError(name, error)
  }
}

async function openSession(config: ConnectionConfig, projectDir: string): Promise<Session> {
  const dialect = await atStage('dialect', () => loadDialect(config.dialect, projectDir))
  const databaseUrl = config.databaseUrl ?? (dialect.name === 'sqlite' ? ':memory:' : '')
  const connection = await atStage('connection', () => dialect.connect(databaseUrl, { projectDir }))
  if (config.migrationsDir !== undefined) {
    const dir = path.resolve(projectDir, config.migrationsDir)
    await atStage('migration', () => applyMigrations(connection, dir))
  }
  return { dialect, connection, results: new Map() }
}

function sessionKey(config: ConnectionConfig, projectDir: string): string {
  return JSON.stringify([projectDir, config.dialect, config.databaseUrl, config.migrationsDir])
}

/**
 * What the migrations are now: each `.sql` file's name, size and modification time. A session
 * lives as long as the process — the editor's lint server runs for hours — so a migration that
 * is added or edited meanwhile must open a new session, or every query is checked against the
 * schema as it was when the editor started.
 */
function migrationsState(config: ConnectionConfig, projectDir: string): string {
  if (config.migrationsDir === undefined) return ''
  const dir = path.resolve(projectDir, config.migrationsDir)
  try {
    return readdirSync(dir)
      .filter((entry) => entry.endsWith('.sql'))
      .toSorted((a, b) => a.localeCompare(b))
      .map((entry) => {
        const { size, mtimeMs } = statSync(path.join(dir, entry))
        return `${entry}:${size}:${mtimeMs}`
      })
      .join('|')
  } catch {
    return 'unreadable'
  }
}

export function session(config: ConnectionConfig, projectDir: string): Promise<Session> {
  const key = sessionKey(config, projectDir)
  const migrations = migrationsState(config, projectDir)
  const cached = sessions.get(key)
  if (cached?.migrations === migrations) return cached.opening
  if (cached !== undefined) {
    // The migrations changed: the old session's database has the old schema. Close it once it
    // has opened; a session that failed to open has nothing to close.
    void cached.opening.then(
      (old) => old.connection.close(),
      () => undefined,
    )
  }
  const opening = openSession(config, projectDir)
  // A failed open is not cached: the next file gets a fresh attempt and its own message.
  opening.catch(() => {
    if (sessions.get(key)?.opening === opening) sessions.delete(key)
  })
  sessions.set(key, { migrations, opening })
  return opening
}

/** Closes a cached session and forgets it, so the next request opens a fresh one. */
export async function closeSession(config: ConnectionConfig, projectDir: string): Promise<void> {
  const key = sessionKey(config, projectDir)
  const cached = sessions.get(key)
  sessions.delete(key)
  if (cached === undefined) return
  const current = await cached.opening.catch(() => undefined)
  await current?.connection.close()
}

export function isStageError(error: unknown): error is StageError {
  return error instanceof StageError
}
