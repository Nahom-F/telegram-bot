// api/miniapp/chats.js
//
// GET  -> list the calling user's chats, most recently active first
// POST -> create a new chat for the calling user
//
// Every request must carry a valid X-Telegram-Init-Data header (see
// lib/telegramAuth.js) — chats are always scoped to whoever that header
// proves you are.

import { eq, desc } from "drizzle-orm";
import { db } from "../../db/client.js";
import { chats } from "../../db/schema.js";
import { requireTelegramUser } from "../../lib/telegramAuth.js";

export default async function handler(req, res) {
  const user = requireTelegramUser(req, res);
  if (!user) return;

  if (req.method === "GET") {
    const rows = await db
      .select()
      .from(chats)
      .where(eq(chats.telegramUserId, user.id))
      .orderBy(desc(chats.updatedAt));
    res.status(200).json(rows);
    return;
  }

  if (req.method === "POST") {
    const [chat] = await db
      .insert(chats)
      .values({ telegramUserId: user.id, title: "New chat" })
      .returning();
    res.status(201).json(chat);
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
