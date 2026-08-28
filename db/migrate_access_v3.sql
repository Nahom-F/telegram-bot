-- Run this once in Neon's SQL editor. This is what Stage 2 (the
-- request/approve/deny access flow) needs on top of what you already have.

CREATE TABLE IF NOT EXISTS access_requests (
  telegram_user_id BIGINT PRIMARY KEY,
  status TEXT NOT NULL,
  display_name TEXT,
  reason TEXT,
  requested_at TIMESTAMP NOT NULL DEFAULT now(),
  decided_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
