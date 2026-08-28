-- Run this once in Neon's SQL editor. This supersedes the "remember across
-- chats" bridge from the previous version — memories are now explicit,
-- user-controlled facts instead of an auto-generated chat summary.

CREATE TABLE IF NOT EXISTS memories (
  id SERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memories_telegram_user_id_idx ON memories(telegram_user_id);

-- Optional cleanup — the old per-chat summary column is no longer read by
-- any code after this update. Safe to leave in place if you'd rather not
-- bother, or uncomment this to remove it:
-- ALTER TABLE chats DROP COLUMN IF EXISTS summary;
