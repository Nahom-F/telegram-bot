// api/miniapp/messages.js
//
// GET  ?chatId=123          -> full message history for that chat
// POST { chatId, content }  -> saves the user's message, asks the AI with
//                              the whole thread as context, saves and
//                              returns its reply
//
// Every chat is checked against the calling Telegram user's id before any
// read or write — there's no way to touch a chat that isn't yours, even if
// you guess its id.

import { eq, and, asc } from "drizzle-orm";
import { db } from "../../db/client.js";
import { chats, messages } from "../../db/schema.js";
import { requireTelegramUser } from "../../lib/telegramAuth.js";
import { getConversationReply } from "../../lib/ai.js";

async function loadOwnedChat(chatId, telegramUserId) {
  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.telegramUserId, telegramUserId)));
  return chat || null;
}

export default async function handler(req, res) {
  const user = requireTelegramUser(req, res);
  if (!user) return;

  if (req.method === "GET") {
    const chatId = Number(req.query.chatId);
    if (!chatId) {
      res.status(400).json({ error: "chatId is required" });
      return;
    }
    const chat = await loadOwnedChat(chatId, user.id);
    if (!chat) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.createdAt));
    res.status(200).json(rows);
    return;
  }

  if (req.method === "POST") {
    const { chatId, content } = req.body || {};
    if (!chatId || !content || !content.trim()) {
      res.status(400).json({ error: "chatId and content are required" });
      return;
    }
    const chat = await loadOwnedChat(Number(chatId), user.id);
    if (!chat) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }

    await db.insert(messages).values({ chatId: chat.id, role: "user", content: content.trim() });

    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chat.id))
      .orderBy(asc(messages.createdAt));

    const reply = await getConversationReply(
      history.map((m) => ({ role: m.role, content: m.content }))
    );

    const [assistantMessage] = await db
      .insert(messages)
      .values({ chatId: chat.id, role: "assistant", content: reply })
      .returning();

    // Bumping updatedAt keeps the chat list sorted by most-recently-active.
    await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chat.id));

    // Auto-title a brand-new chat from its first message, so the chat list
    // doesn't just show a wall of identical "New chat" entries.
    if (chat.title === "New chat") {
      const trimmed = content.trim();
      const autoTitle = trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
      await db.update(chats).set({ title: autoTitle }).where(eq(chats.id, chat.id));
    }

    res.status(201).json(assistantMessage);
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
