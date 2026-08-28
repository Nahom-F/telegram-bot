-- Run this once in your Neon project's SQL editor to set up the schema
-- from scratch. If you already have tables from an earlier version, use
-- the incremental db/migrate_*.sql files instead.

CREATE TABLE IF NOT EXISTS chats (
  id SERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chats_telegram_user_id_idx ON chats(telegram_user_id);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_chat_id_idx ON messages(chat_id);

CREATE TABLE IF NOT EXISTS user_settings (
  telegram_user_id BIGINT PRIMARY KEY,
  memory_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memories (
  id SERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memories_telegram_user_id_idx ON memories(telegram_user_id);

CREATE TABLE IF NOT EXISTS access_requests (
  telegram_user_id BIGINT PRIMARY KEY,
  status TEXT NOT NULL,
  display_name TEXT,
  reason TEXT,
  requested_at TIMESTAMP NOT NULL DEFAULT now(),
  decided_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
