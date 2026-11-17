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
