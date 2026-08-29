-- Run this once in Neon's SQL editor. This is what Stage 3 (per-user
-- limits) needs on top of what you already have.

CREATE TABLE IF NOT EXISTS usage_events (
  id SERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  kind TEXT NOT NULL,
  tokens INTEGER,
  bytes INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_events_user_time_idx ON usage_events(telegram_user_id, created_at);
