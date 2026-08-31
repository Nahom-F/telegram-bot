-- Run this once in Neon's SQL editor. Adds admin-editable Stars prices
-- (so /setprice works without a redeploy), seeded with the new bumped
-- defaults — 300 for Pro, 600 for Premium.

CREATE TABLE IF NOT EXISTS plan_prices (
  tier TEXT PRIMARY KEY,
  price_stars INTEGER NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO plan_prices (tier, price_stars) VALUES ('pro', 300), ('premium', 600)
ON CONFLICT (tier) DO NOTHING;
