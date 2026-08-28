-- Run this once in Neon's SQL editor. Your chats/messages tables already
-- exist from setup.sql — this just adds what the memory-bridge feature
-- needs on top of them.

ALTER TABLE chats ADD COLUMN IF NOT EXISTS summary TEXT;

CREATE TABLE IF NOT EXISTS user_settings (
  telegram_user_id BIGINT PRIMARY KEY,
  memory_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
