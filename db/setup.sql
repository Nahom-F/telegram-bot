-- Run this once in your Neon project's SQL editor to set up the schema
-- from scratch. If you already ran the original version of this file,
-- use db/migrate_memory.sql instead — it only adds what's new.

CREATE TABLE IF NOT EXISTS chats (
  id SERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New chat',
  summary TEXT,
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
