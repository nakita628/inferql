import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

import { findProjectDir, parseJsonc, readConnection } from './project.js'

const example = fileURLToPath(new URL('../../../example/sqlite/', import.meta.url))

describe('project', () => {
  it('finds the nearest package.json above a file', () => {
    expect(findProjectDir(path.join(example, 'src', 'queries.ts'))).toBe(path.resolve(example))
  })

  it('reads the connection from tsconfig.json’s inferql content mapper entry', () => {
    expect(readConnection(example)).toEqual({
      dialect: 'sqlite',
      migrationsDir: 'migrations',
      databaseUrl: undefined,
    })
  })

  it('falls back to the editor settings, and to nothing without a dialect', () => {
    const elsewhere = fileURLToPath(new URL('../', import.meta.url))
    expect(readConnection(elsewhere, { dialect: 'postgres', databaseUrl: 'postgres://x' })).toEqual(
      {
        dialect: 'postgres',
        migrationsDir: undefined,
        databaseUrl: 'postgres://x',
      },
    )
    expect(readConnection(elsewhere)).toBeUndefined()
  })

  it('parses JSON with comments and trailing commas, leaving strings alone', () => {
    expect(parseJsonc('{ // a\n "a": "x // y", /* b */ "b": [1, 2,], }')).toEqual({
      a: 'x // y',
      b: [1, 2],
    })
  })
})
