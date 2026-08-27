-- Run this once in your Neon project's SQL editor to set up the schema.

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
