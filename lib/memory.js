// lib/memory.js
//
// The "remember across chats" bridge: when enabled, a brand-new chat's
// first message gets a short summary of the user's most recently active
// OTHER chat folded in as background context — not the raw transcript,
// and the two chats are never merged.

import { eq, and, ne, desc, asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { chats, messages, userSettings } from "../db/schema.js";
import { summarizeConversation } from "./ai.js";

export async function isMemoryEnabled(telegramUserId) {
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.telegramUserId, telegramUserId));
  return row?.memoryEnabled ?? false;
}

// Returns a short summary of the user's most recently active other chat,
// or null if there isn't one yet. Generates and caches the summary on the
// source chat the first time it's needed — later calls reuse it instead
// of re-summarizing. (Trade-off: if you keep adding to that source chat
// afterward, the cached summary won't pick up the new messages. Fine for
// v1 — worth revisiting if it turns out to matter in practice.)
export async function getMemoryContext(telegramUserId, excludeChatId) {
  const [sourceChat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.telegramUserId, telegramUserId), ne(chats.id, excludeChatId)))
    .orderBy(desc(chats.updatedAt))
    .limit(1);

  if (!sourceChat) return null;
  if (sourceChat.summary) return sourceChat.summary;

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, sourceChat.id))
    .orderBy(asc(messages.createdAt));

  if (history.length === 0) return null;

  const summary = await summarizeConversation(
    history.map((m) => ({ role: m.role, content: m.content }))
  );

  await db.update(chats).set({ summary }).where(eq(chats.id, sourceChat.id));

  return summary;
}
