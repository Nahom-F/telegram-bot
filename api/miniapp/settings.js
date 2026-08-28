// api/miniapp/settings.js
//
// GET  -> the calling user's settings (currently just memoryEnabled)
// POST { memoryEnabled } -> update it
//
// This is separate from the theme toggle on purpose — theme is purely
// cosmetic and lives in the browser's localStorage, but memoryEnabled
// changes how messages.js actually answers, so it has to be readable from
// the backend regardless of which device or session is asking.

import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { userSettings } from "../../db/schema.js";
import { requireTelegramUser } from "../../lib/telegramAuth.js";

export default async function handler(req, res) {
  const user = requireTelegramUser(req, res);
  if (!user) return;

  if (req.method === "GET") {
    const [row] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.telegramUserId, user.id));
    res.status(200).json({ memoryEnabled: row?.memoryEnabled ?? false });
    return;
  }

  if (req.method === "POST") {
    const { memoryEnabled } = req.body || {};
    if (typeof memoryEnabled !== "boolean") {
      res.status(400).json({ error: "memoryEnabled must be a boolean" });
      return;
    }
    await db
      .insert(userSettings)
      .values({ telegramUserId: user.id, memoryEnabled })
      .onConflictDoUpdate({
        target: userSettings.telegramUserId,
        set: { memoryEnabled, updatedAt: new Date() },
      });
    res.status(200).json({ memoryEnabled });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
