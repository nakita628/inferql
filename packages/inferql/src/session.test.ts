import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

import { closeSession, isStageError, session } from './session.js'

const fixtures = fileURLToPath(new URL('./rules/fixtures/', import.meta.url))

describe('session', () => {
  it('loads a dialect from a module path relative to the project and caches the session', async () => {
    const config = { dialect: './dialects/custom.mjs' }
    const first = await session(config, fixtures)
    expect(first.dialect.name).toBe('custom')
    expect(await session(config, fixtures)).toBe(first)
    const described = await first.connection.describe('SELECT 1')
    expect(described.ok && described.columns.map((column) => column.name)).toEqual([
      'id',
      'note',
      'executed',
    ])
    await closeSession(config, fixtures)
    expect(await session(config, fixtures)).not.toBe(first)
    await closeSession(config, fixtures)
  })

  it('applies migrations in name order and stops at the first failure', async () => {
    const config = { dialect: './dialects/custom.mjs', migrationsDir: 'migrations' }
    const current = await session(config, fixtures)
    const described = await current.connection.describe('SELECT 1')
    // The custom dialect reports `executed` as typed only once a migration ran.
    expect(described.ok && described.columns[2]?.dataType).toBe('STR')
    await closeSession(config, fixtures)

    const broken = { dialect: './dialects/custom.mjs', migrationsDir: 'migrations-broken' }
    await expect(session(broken, fixtures)).rejects.toThrow(
      'migration 002_bad.sql failed: cannot run this',
    )
    await session(broken, fixtures).catch((error: unknown) => {
      expect(isStageError(error) && error.stage).toBe('migration')
    })
  })

  it('opens a new session when a migration is added or edited, as a long-lived editor needs', async () => {
    const project = mkdtempSync(path.join(tmpdir(), 'inferql-session-'))
    mkdirSync(path.join(project, 'migrations'))
    const migration = path.join(project, 'migrations', '001_users.sql')
    writeFileSync(migration, 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);')
    const config = { dialect: 'sqlite', migrationsDir: 'migrations' }

    const before = await session(config, project)
    expect(await before.connection.describe('SELECT email FROM users')).toMatchObject({ ok: false })
    expect(await session(config, project)).toBe(before)

    writeFileSync(
      migration,
      'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT);',
    )
    const after = await session(config, project)
    expect(after).not.toBe(before)
    expect(await after.connection.describe('SELECT email FROM users')).toMatchObject({ ok: true })

    writeFileSync(
      path.join(project, 'migrations', '002_posts.sql'),
      'CREATE TABLE posts (id INTEGER);',
    )
    const added = await session(config, project)
    expect(added).not.toBe(after)
    expect(await added.connection.describe('SELECT id FROM posts')).toMatchObject({ ok: true })
    await closeSession(config, project)
  })

  it('rejects a module without a dialect export, and an unknown module', async () => {
    await expect(session({ dialect: './dialects/no-dialect.mjs' }, fixtures)).rejects.toThrow(
      'does not export a `dialect`',
    )
    await session({ dialect: './dialects/no-dialect.mjs' }, fixtures).catch((error: unknown) => {
      expect(isStageError(error) && error.stage).toBe('dialect')
    })
    await expect(session({ dialect: './dialects/missing.mjs' }, fixtures)).rejects.toThrow()
  })

  it('reports a failed connection as such', async () => {
    const config = { dialect: 'sqlite', databaseUrl: path.join(fixtures, 'no', 'such', 'dir.db') }
    await session(config, fixtures).catch((error: unknown) => {
      expect(isStageError(error) && error.stage).toBe('connection')
    })
  })
})
