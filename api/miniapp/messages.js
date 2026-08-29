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
import { isMemoryEnabled, listMemories, saveMemory, extractMemoryMarker, MEMORY_LIMIT } from "../../lib/memory.js";
import { checkMessageLimit, recordMessageUsage } from "../../lib/limits.js";

async function loadOwnedChat(chatId, telegramUserId) {
  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.telegramUserId, telegramUserId)));
  return chat || null;
}

export default async function handler(req, res) {
  const user = await requireTelegramUser(req, res);
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

    // Checked before spending an AI call, not after — no point burning a
    // request just to refuse to show its result.
    const limitCheck = await checkMessageLimit(user.id);
    if (!limitCheck.allowed) {
      res.status(429).json({ error: "rate_limited", message: limitCheck.reason });
      return;
    }

    await db.insert(messages).values({ chatId: chat.id, role: "user", content: content.trim() });

    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chat.id))
      .orderBy(asc(messages.createdAt));

    const memoryOn = await isMemoryEnabled(user.id);
    const savedMemories = memoryOn ? (await listMemories(user.id)).map((m) => m.content) : [];

    const { text: rawReply, tokensUsed } = await getConversationReply(
      history.map((m) => ({ role: m.role, content: m.content })),
      { savedMemories, allowMemorySave: memoryOn }
    );
    await recordMessageUsage(user.id, tokensUsed);

    // If the model flagged that the user asked it to remember something,
    // save it and strip the marker out before anyone sees it. If memory's
    // already full, don't save — just say so, rather than silently
    // dropping what they asked to keep.
    let { visibleReply, savedFact } = extractMemoryMarker(rawReply);
    if (savedFact) {
      const result = await saveMemory(user.id, savedFact);
      if (!result.saved && result.reason === "limit") {
        visibleReply += `\n\n(Your memory is full — ${MEMORY_LIMIT}/${MEMORY_LIMIT} saved. Remove one in Settings to save this.)`;
      }
    }

    const [assistantMessage] = await db
      .insert(messages)
      .values({ chatId: chat.id, role: "assistant", content: visibleReply })
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
