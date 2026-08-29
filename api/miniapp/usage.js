// api/miniapp/usage.js
//
// GET -> the calling user's current usage against their limits, or
// { isOwner: true } if they're not limited at all. Powers the small usage
// line in the mini app's menu drawer.

import { requireTelegramUser } from "../../lib/telegramAuth.js";
import { isOwner } from "../../lib/access.js";
import { getUsageSummary, DEFAULT_LIMITS } from "../../lib/limits.js";

export default async function handler(req, res) {
  const user = await requireTelegramUser(req, res);
  if (!user) return;

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (isOwner(user.id)) {
    res.status(200).json({ isOwner: true });
    return;
  }

  const { messagesLastHour, totalTokens } = await getUsageSummary(user.id);
  res.status(200).json({
    isOwner: false,
    messagesLastHour,
    messagesPerHourLimit: DEFAULT_LIMITS.messagesPerHour,
    totalTokens,
    maxTokens: DEFAULT_LIMITS.maxTokens,
  });
}
