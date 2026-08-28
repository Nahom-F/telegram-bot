// lib/memory.js
//
// Explicit, user-controlled memory. Nothing is saved automatically — the
// model itself decides when the user's latest message actually asked it
// to remember/save something (not just used the word in passing), and
// reports that back with a marker line at the end of its reply. That line
// is stripped out here before the reply is ever shown or stored, and only
// the extracted fact is kept. Capped at MEMORY_LIMIT per user; viewable,
// editable, and deletable any time from Settings.

import { eq, and, asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { memories, userSettings } from "../db/schema.js";

export const MEMORY_LIMIT = 5;
const MEMORY_MAX_LENGTH = 300;

export async function isMemoryEnabled(telegramUserId) {
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.telegramUserId, telegramUserId));
  return row?.memoryEnabled ?? false;
}

export async function listMemories(telegramUserId) {
  return db
    .select()
    .from(memories)
    .where(eq(memories.telegramUserId, telegramUserId))
    .orderBy(asc(memories.createdAt));
}

export async function saveMemory(telegramUserId, content) {
  const trimmed = content.trim().slice(0, MEMORY_MAX_LENGTH);
  if (!trimmed) return { saved: false, reason: "empty" };

  const existing = await listMemories(telegramUserId);
  if (existing.length >= MEMORY_LIMIT) return { saved: false, reason: "limit" };

  const [memory] = await db
    .insert(memories)
    .values({ telegramUserId, content: trimmed })
    .returning();
  return { saved: true, memory };
}

export async function updateMemory(telegramUserId, id, content) {
  const trimmed = content.trim().slice(0, MEMORY_MAX_LENGTH);
  if (!trimmed) return null;
  const [memory] = await db
    .update(memories)
    .set({ content: trimmed, updatedAt: new Date() })
    .where(and(eq(memories.id, id), eq(memories.telegramUserId, telegramUserId)))
    .returning();
  return memory || null;
}

export async function deleteMemory(telegramUserId, id) {
  const [deleted] = await db
    .delete(memories)
    .where(and(eq(memories.id, id), eq(memories.telegramUserId, telegramUserId)))
    .returning();
  return !!deleted;
}

// Pulls a trailing "[SAVE_MEMORY: ...]" marker off an AI reply, if the
// model included one (see buildSystemInstruction in lib/ai.js for the
// instruction that produces it). Returns the reply with the marker
// removed, plus the extracted fact (or null if there wasn't one).
export function extractMemoryMarker(text) {
  const match = text.match(/\n*\[SAVE_MEMORY:\s*([^\]]+)\]\s*$/);
  if (!match) return { visibleReply: text, savedFact: null };
  return {
    visibleReply: text.slice(0, match.index).trimEnd(),
    savedFact: match[1].trim(),
  };
}
