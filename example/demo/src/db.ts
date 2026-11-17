import { readdirSync, readFileSync } from 'node:fs'

import { connect } from 'inferql/sqlite'

export const sql = connect(':memory:')

// The demo's database lives in memory: build it from the migrations, then add a few users.
const migrations = new URL('../migrations/', import.meta.url)
for (const file of readdirSync(migrations).toSorted()) {
  sql.database.exec(readFileSync(new URL(file, migrations), 'utf8'))
}
sql.database.exec(`
  INSERT INTO users (name, email) VALUES ('Ada Lovelace', 'ada@example.com');
  INSERT INTO users (name, email) VALUES ('Alan Turing', NULL);
`)
