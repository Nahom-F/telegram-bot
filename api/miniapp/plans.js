// api/miniapp/plans.js
//
// GET -> tier limits + live Stars prices, for the "Details" comparison
// table in Settings. Pulls straight from TIER_LIMITS/getTierPrices so it
// can never show numbers that don't match what's actually enforced.

import { requireTelegramUser } from "../../lib/telegramAuth.js";
import { TIER_LIMITS } from "../../lib/limits.js";
import { getTierPrices } from "../../lib/subscriptions.js";

export default async function handler(req, res) {
  const user = await requireTelegramUser(req, res);
  if (!user) return;

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const prices = await getTierPrices();
  res.status(200).json({
    limits: TIER_LIMITS,
    prices,
    videoGeneration: "coming_soon",
  });
}
