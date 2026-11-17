import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

import { describeSchema } from './introspect.js'

const fixtures = fileURLToPath(new URL('./rules/fixtures/', import.meta.url))

describe('describeSchema', () => {
  it('applies the migrations and describes every table with its TypeScript types', async () => {
    const schema = await describeSchema(
      { dialect: 'sqlite', migrationsDir: 'migrations' },
      fixtures,
    )
    expect(schema.dialect).toBe('sqlite')
    expect(schema.tables.map((table) => table.name)).toEqual(['posts', 'users'])
    expect(schema.tables.find((table) => table.name === 'users')?.columns).toEqual([
      { name: 'id', dataType: 'INTEGER', nullable: false, tsType: 'number' },
      { name: 'name', dataType: 'TEXT', nullable: false, tsType: 'string' },
      { name: 'email', dataType: 'VARCHAR(255)', nullable: true, tsType: 'string' },
      { name: 'age', dataType: 'INTEGER', nullable: true, tsType: 'number' },
      { name: 'created_at', dataType: 'DATETIME', nullable: false, tsType: 'string' },
    ])
  })

  it('applies overrides by type name, like `inferql schema --override`', async () => {
    const schema = await describeSchema(
      { dialect: 'sqlite', migrationsDir: 'migrations' },
      fixtures,
      {
        integer: 'bigint',
      },
    )
    expect(schema.tables[0]?.columns[0]).toMatchObject({ name: 'id', tsType: 'bigint' })
  })
})
