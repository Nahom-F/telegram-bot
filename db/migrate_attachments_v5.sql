-- Run this once in Neon's SQL editor. This is what Stage 4 (file/photo
-- uploads in the mini app) needs on top of what you already have.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_type TEXT;
