import { describe, expectTypeOf, it } from 'vite-plus/test'

import type { InferSchema } from './ddl.js'
import type { InferParams, InferRow, MigrationsSchema } from './index.js'
import { bindSql } from './index.js'
import type { Column } from './schema.js'

type Posts = {
  posts: {
    id: Column<number>
    user_id: Column<number>
    title: Column<string>
    body: Column<string, true>
  }
}

type Opaque = { readonly [column: string]: Column<unknown, true> }

describe('InferSchema — the example migrations, as `inferql schema` renders them', () => {
  it('reads SQLite', () => {
    const users = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email VARCHAR(255),
        age INTEGER,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `
    const posts = `
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        body TEXT
      );
    `
    expectTypeOf<InferSchema<'sqlite', [typeof users, typeof posts]>>().toEqualTypeOf<
      Posts & {
        users: {
          id: Column<number>
          name: Column<string>
          email: Column<string, true>
          age: Column<number, true>
          created_at: Column<string>
        }
      } extends infer S
        ? { [K in keyof S]: S[K] }
        : never
    >()
  })

  it('reads PostgreSQL, with an enum, an array and idempotent drops', () => {
    const schema = `
      DROP TABLE IF EXISTS posts;
      DROP TABLE IF EXISTS users;
      DROP TYPE IF EXISTS role;
      CREATE TYPE role AS ENUM ('admin', 'member');
      CREATE TABLE users (
        id serial PRIMARY KEY,
        name text NOT NULL,
        email varchar(255),
        role role NOT NULL DEFAULT 'member',
        tags text[] NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE posts (
        id serial PRIMARY KEY,
        user_id int NOT NULL REFERENCES users(id),
        title text NOT NULL,
        body text
      );
    `
    expectTypeOf<InferSchema<'postgres', typeof schema>>().toEqualTypeOf<{
      posts: Posts['posts']
      users: {
        id: Column<number>
        name: Column<string>
        email: Column<string, true>
        role: Column<'admin' | 'member'>
        tags: Column<string[]>
        created_at: Column<Date>
      }
    }>()
  })

  it('reads MySQL, with an inline ENUM', () => {
    const schema = `
      DROP TABLE IF EXISTS posts;
      DROP TABLE IF EXISTS users;
      CREATE TABLE users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NULL,
        role ENUM('admin', 'member') NOT NULL DEFAULT 'member',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE posts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        title VARCHAR(200) NOT NULL,
        body TEXT
      );
    `
    expectTypeOf<InferSchema<'mysql', typeof schema>>().toEqualTypeOf<{
      posts: Posts['posts']
      users: {
        id: Column<number>
        name: Column<string>
        email: Column<string, true>
        role: Column<'admin' | 'member'>
        created_at: Column<Date>
      }
    }>()
  })
})

describe('InferSchema — CREATE TABLE', () => {
  it('skips comments, keeps `;` and `--` inside literals, and ignores other statements', () => {
    const schema = `
      -- the users; all of them
      /* a block comment; with a semicolon */
      CREATE TABLE IF NOT EXISTS t (
        a TEXT NOT NULL DEFAULT 'x; y', -- trailing comment
        b INTEGER
      );
      CREATE INDEX t_b ON t (b);
      INSERT INTO t (a) VALUES ('seed');
      BEGIN; COMMIT;
    `
    expectTypeOf<InferSchema<'sqlite', typeof schema>>().toEqualTypeOf<{
      t: { a: Column<string>; b: Column<number, true> }
    }>()
  })

  it('makes table-level PRIMARY KEY columns NOT NULL and skips other constraints', () => {
    const schema = `
      CREATE TABLE m (
        a int,
        b text,
        c text CHECK (c IS NOT NULL),
        CONSTRAINT m_pk PRIMARY KEY (a, "b"),
        UNIQUE (c),
        FOREIGN KEY (a) REFERENCES other (id)
      )
    `
    expectTypeOf<InferSchema<'postgres', typeof schema>>().toEqualTypeOf<{
      m: { a: Column<number>; b: Column<string>; c: Column<string, true> }
    }>()
  })

  it('leaves an existing table alone under IF NOT EXISTS', () => {
    const first = 'CREATE TABLE t (a INTEGER NOT NULL)'
    const second = 'CREATE TABLE IF NOT EXISTS t (b TEXT)'
    expectTypeOf<InferSchema<'sqlite', [typeof first, typeof second]>>().toEqualTypeOf<{
      t: { a: Column<number> }
    }>()
  })

  it('folds unquoted PostgreSQL names to lower case and strips schemas and quotes', () => {
    const schema = 'CREATE TABLE public.Users (Id int NOT NULL, "displayName" text)'
    expectTypeOf<InferSchema<'pg', typeof schema>>().toEqualTypeOf<{
      users: { id: Column<number>; displayName: Column<string, true> }
    }>()
    const mysql = 'CREATE TABLE `app`.`Users` (`Id` int NOT NULL)'
    expectTypeOf<InferSchema<'mysql', typeof mysql>>().toEqualTypeOf<{
      Users: { Id: Column<number> }
    }>()
  })

  it('maps type spellings to what the driver returns', () => {
    const pg = `
      CREATE TABLE t (
        a bigint, b double precision, c timestamp(3) with time zone, d character varying(10),
        e boolean, f numeric(10, 2), g jsonb, h bytea, i uuid, j integer ARRAY, k varchar(5)[],
        l bigserial, m int GENERATED ALWAYS AS IDENTITY, n geography
      )
    `
    expectTypeOf<InferSchema<'postgres', typeof pg>>().toEqualTypeOf<{
      t: {
        a: Column<string, true>
        b: Column<number, true>
        c: Column<Date, true>
        d: Column<string, true>
        e: Column<boolean, true>
        f: Column<string, true>
        g: Column<unknown, true>
        h: Column<Buffer, true>
        i: Column<string, true>
        j: Column<number[], true>
        k: Column<string[], true>
        l: Column<string>
        m: Column<number>
        n: Column<unknown, true>
      }
    }>()
    const mysql = `
      CREATE TABLE t (
        a TINYINT(1), b BIGINT UNSIGNED NOT NULL, c DECIMAL(10,2), d MEDIUMTEXT,
        e VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, f JSON, g BLOB,
        h TIMESTAMP, i BOOLEAN, j SERIAL, k SET('x', 'y')
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `
    expectTypeOf<InferSchema<'mysql', typeof mysql>>().toEqualTypeOf<{
      t: {
        a: Column<number, true>
        b: Column<number>
        c: Column<string, true>
        d: Column<string, true>
        e: Column<string>
        f: Column<unknown, true>
        g: Column<Buffer, true>
        h: Column<Date, true>
        i: Column<number, true>
        j: Column<number>
        k: Column<string, true>
      }
    }>()
    const sqlite = 'CREATE TABLE t (a, b BLOB, c REAL, d BOOLEAN, e JSON, f NVARCHAR(10)) STRICT'
    expectTypeOf<InferSchema<'sqlite', typeof sqlite>>().toEqualTypeOf<{
      t: {
        a: Column<Uint8Array, true>
        b: Column<Uint8Array, true>
        c: Column<number, true>
        d: Column<number, true>
        e: Column<string, true>
        f: Column<string, true>
      }
    }>()
  })

  it('applies overrides by type name, ignoring case', () => {
    const schema = 'CREATE TABLE t (a timestamptz NOT NULL, b int8, c timestamptz[])'
    expectTypeOf<
      InferSchema<'postgres', typeof schema, { TimestampTZ: string; int8: bigint }>
    >().toEqualTypeOf<{
      t: { a: Column<string>; b: Column<bigint, true>; c: Column<string[], true> }
    }>()
  })

  it('copies a table with MySQL `CREATE TABLE ... LIKE`', () => {
    const schema = 'CREATE TABLE a (x INT NOT NULL); CREATE TABLE b LIKE a'
    expectTypeOf<InferSchema<'mysql', typeof schema>['b']>().toEqualTypeOf<{
      x: Column<number>
    }>()
  })

  it('makes what it cannot read opaque instead of guessing', () => {
    const schema = `
      CREATE TABLE src (a int NOT NULL);
      CREATE TABLE copy AS SELECT * FROM src;
      CREATE TABLE child (b int) INHERITS (src);
      CREATE TABLE part PARTITION OF src FOR VALUES IN (1);
    `
    type S = InferSchema<'postgres', typeof schema>
    expectTypeOf<S['copy']>().toEqualTypeOf<Opaque>()
    expectTypeOf<S['child']>().toEqualTypeOf<Opaque>()
    expectTypeOf<S['part']>().toEqualTypeOf<Opaque>()
    expectTypeOf<S['src']>().toEqualTypeOf<{ a: Column<number> }>()
  })

  it('does not read statements inside a `$$` function body', () => {
    const schema = `
      CREATE TABLE t (a int NOT NULL);
      CREATE FUNCTION f() RETURNS trigger AS $$
      BEGIN
        DROP TABLE t;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `
    expectTypeOf<InferSchema<'postgres', typeof schema>>().toEqualTypeOf<{
      t: { a: Column<number> }
    }>()
  })

  it('gives no tables for a non-literal string', () => {
    expectTypeOf<keyof InferSchema<'sqlite', string>>().toEqualTypeOf<never>()
  })
})

describe('InferSchema — ALTER, DROP and RENAME', () => {
  it('follows ADD / DROP / RENAME COLUMN and RENAME TO across migrations', () => {
    const create = 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, legacy TEXT)'
    const add = 'ALTER TABLE users ADD COLUMN email TEXT'
    const drop = 'ALTER TABLE users DROP COLUMN legacy'
    const rename = 'ALTER TABLE users RENAME COLUMN name TO full_name'
    const move = 'ALTER TABLE users RENAME TO members'
    expectTypeOf<
      InferSchema<'sqlite', [typeof create, typeof add, typeof drop, typeof rename, typeof move]>
    >().toEqualTypeOf<{
      members: { id: Column<number>; full_name: Column<string>; email: Column<string, true> }
    }>()
  })

  it('follows PostgreSQL column changes, several per statement', () => {
    const schema = `
      CREATE TABLE t (a int, b text NOT NULL, c int);
      ALTER TABLE ONLY t
        ALTER COLUMN a SET NOT NULL,
        ALTER b DROP NOT NULL,
        ALTER COLUMN c TYPE bigint USING c::bigint,
        ALTER COLUMN a SET DEFAULT 0,
        ADD COLUMN IF NOT EXISTS d boolean NOT NULL DEFAULT false,
        ADD CONSTRAINT t_c_key UNIQUE (c);
      ALTER TABLE IF EXISTS missing ADD COLUMN x int;
      ALTER TABLE t OWNER TO app;
    `
    expectTypeOf<InferSchema<'postgres', typeof schema>>().toEqualTypeOf<{
      t: {
        a: Column<number>
        b: Column<string, true>
        c: Column<string, true>
        d: Column<boolean>
      }
    }>()
  })

  it('follows MySQL MODIFY, CHANGE, ADD PRIMARY KEY and RENAME TABLE', () => {
    const schema = `
      CREATE TABLE t (a INT, b VARCHAR(10), c INT);
      ALTER TABLE t MODIFY COLUMN b TEXT NOT NULL, CHANGE c d DATETIME AFTER a;
      ALTER TABLE t ADD PRIMARY KEY (a), ADD COLUMN e INT FIRST, ENGINE = InnoDB;
      RENAME TABLE t TO u;
    `
    expectTypeOf<InferSchema<'mysql', typeof schema>>().toEqualTypeOf<{
      u: {
        a: Column<number>
        b: Column<string>
        d: Column<Date, true>
        e: Column<number, true>
      }
    }>()
  })

  it('makes a table opaque after a change it does not follow', () => {
    const schema =
      'CREATE TABLE t (a int); ALTER TABLE t ALTER COLUMN a ADD GENERATED ALWAYS AS IDENTITY'
    expectTypeOf<InferSchema<'postgres', typeof schema>['t']>().toEqualTypeOf<Opaque>()
  })

  it('drops tables and types', () => {
    const schema = `
      CREATE TABLE a (x int); CREATE TABLE b (x int); CREATE TABLE c (x int);
      DROP TABLE IF EXISTS a, b CASCADE;
    `
    expectTypeOf<keyof InferSchema<'postgres', typeof schema>>().toEqualTypeOf<'c'>()
  })

  it('extends an enum with ALTER TYPE ... ADD VALUE, reaching tables created before', () => {
    const schema = `
      CREATE TYPE mood AS ENUM ('sad', 'ok');
      CREATE TABLE t (m mood NOT NULL, ms mood[]);
      ALTER TYPE mood ADD VALUE IF NOT EXISTS 'happy' AFTER 'ok';
    `
    expectTypeOf<InferSchema<'postgres', typeof schema>>().toEqualTypeOf<{
      t: {
        m: Column<'sad' | 'ok' | 'happy'>
        ms: Column<('sad' | 'ok' | 'happy')[], true>
      }
    }>()
  })

  it('resolves a domain to its base type', () => {
    const schema = `
      CREATE DOMAIN email AS text CHECK (VALUE LIKE '%@%');
      CREATE TABLE t (e email NOT NULL);
    `
    expectTypeOf<InferSchema<'postgres', typeof schema>>().toEqualTypeOf<{
      t: { e: Column<string> }
    }>()
  })
})

describe('InferSchema — views', () => {
  it('types a view from its SELECT against the tables before it', () => {
    const schema = `
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT);
      CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL);
      CREATE VIEW IF NOT EXISTS user_posts AS
        SELECT u.name, u.email, p.title FROM users u LEFT JOIN posts p ON p.user_id = u.id;
      CREATE VIEW counts AS WITH c AS (SELECT 1) SELECT * FROM c;
    `
    type S = InferSchema<'sqlite', typeof schema>
    expectTypeOf<S['user_posts']>().toEqualTypeOf<{
      name: Column<string>
      email: Column<string, true>
      title: Column<string, true>
    }>()
    expectTypeOf<S['counts']>().toEqualTypeOf<Opaque>()
  })
})

describe('InferSchema — with sql()', () => {
  const schema = `
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT);
    ALTER TABLE users ADD COLUMN age INTEGER;
    CREATE TABLE legacy AS SELECT * FROM users;
  `
  type S = InferSchema<'sqlite', typeof schema>
  const sql = bindSql<S>(() => [])

  it('types rows and parameters with no generated file', () => {
    const rows = sql('SELECT id, name, age FROM users WHERE email = ?', 'a@example.com')
    expectTypeOf(rows).toEqualTypeOf<
      readonly { readonly id: number; readonly name: string; readonly age: number | null }[]
    >()
    // @ts-expect-error -- age is a number
    sql('SELECT id FROM users WHERE age = ?', 'old')
  })

  it('types the columns of an opaque table as unknown', () => {
    expectTypeOf<InferRow<'SELECT name FROM legacy', S>>().toEqualTypeOf<
      Readonly<{ name: unknown }>
    >()
    expectTypeOf<InferParams<'SELECT name FROM legacy WHERE id = ?', S>>().toEqualTypeOf<
      [unknown]
    >()
  })
})

describe('MigrationsSchema — what the content mapper registers', () => {
  it('applies the entries in index order, whatever order they were declared in', () => {
    type Registered = {
      1: { readonly dialect: 'sqlite'; readonly sql: 'ALTER TABLE t ADD COLUMN b TEXT' }
      0: { readonly dialect: 'sqlite'; readonly sql: 'CREATE TABLE t (a INTEGER NOT NULL)' }
    }
    expectTypeOf<MigrationsSchema<Registered>>().toEqualTypeOf<{
      t: { a: Column<number>; b: Column<string, true> }
    }>()
  })

  it('reads the dialect from the entries and gives no tables without any', () => {
    type Registered = {
      0: { readonly dialect: 'postgres'; readonly sql: 'CREATE TABLE T (n int8 NOT NULL)' }
    }
    expectTypeOf<MigrationsSchema<Registered>>().toEqualTypeOf<{ t: { n: Column<string> } }>()
    expectTypeOf<keyof MigrationsSchema<Record<never, never>>>().toEqualTypeOf<never>()
  })
})
