import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { SchemaInfo } from 'inferql/introspect'

import type { ProjectConnection } from './project.js'

type DescribeSchema = (config: ProjectConnection, projectDir: string) => Promise<SchemaInfo>

function isDescribeSchema(value: unknown): value is DescribeSchema {
  return typeof value === 'function'
}

/**
 * The project's own `inferql/introspect`, resolved from its package.json: the same inferql,
 * dialects and drivers its lint rule uses, so the editor's tables are the lint rule's.
 */
export async function loadDescribeSchema(projectDir: string): Promise<DescribeSchema> {
  const resolved = createRequire(path.join(projectDir, 'package.json')).resolve(
    'inferql/introspect',
  )
  const loaded: unknown = await import(pathToFileURL(resolved).href)
  const describe: unknown =
    typeof loaded === 'object' && loaded !== null
      ? Reflect.get(loaded, 'describeSchema')
      : undefined
  if (!isDescribeSchema(describe)) {
    throw new Error(`${resolved} has no describeSchema; update inferql in this project`)
  }
  return describe
}

/** Schemas by project, read once and dropped when a migration or tsconfig.json changes. */
export class SchemaCache {
  readonly #schemas = new Map<string, Promise<SchemaInfo>>()

  get(projectDir: string, connection: ProjectConnection): Promise<SchemaInfo> {
    const key = JSON.stringify([projectDir, connection])
    const cached = this.#schemas.get(key)
    if (cached !== undefined) return cached
    const loading = loadDescribeSchema(projectDir).then((describe) =>
      describe(connection, projectDir),
    )
    // A failed read is not kept: the next completion tries again, after the fix.
    loading.catch(() => this.#schemas.delete(key))
    this.#schemas.set(key, loading)
    return loading
  }

  clear(): void {
    this.#schemas.clear()
  }
}
