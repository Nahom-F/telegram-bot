// lib/limits.js
//
// Per-user usage limits for approved (non-owner) users. The owner is never
// limited. Two kinds of cap:
//   - messagesPerHour: a real rolling window (checked against a log of
//     events, not a fixed clock-hour bucket) — it eases naturally as old
//     messages age out, no reset job needed.
//   - maxTokens: a lifetime allowance, not a per-hour one. This is
//     deliberately a "credits" model — it's what Stage 5 (payments) will
//     top up, rather than something that quietly refills on its own.
// Token counts come directly from the AI providers' own usage figures in
// their API responses, not an estimate.

import { sql, eq, and, gte } from "drizzle-orm";
import { db } from "../db/client.js";
import { usageEvents } from "../db/schema.js";
import { isOwner } from "./access.js";

export const DEFAULT_LIMITS = {
  messagesPerHour: 20,
  maxTokens: 100000,
  maxFileBytes: 50 * 1024 * 1024, // 50MB — enforced where a file is actually
  // accepted. Not applied to the DM bot's document reading, since
  // Telegram's own 20MB bot download limit already binds tighter than
  // 50MB ever would there; this is for Stage 4's mini app uploads.
};

export async function recordMessageUsage(telegramUserId, tokens) {
  await db.insert(usageEvents).values({ telegramUserId, kind: "message", tokens: tokens ?? null });
}

export async function recordFileUsage(telegramUserId, bytes) {
  await db.insert(usageEvents).values({ telegramUserId, kind: "file", bytes: bytes ?? null });
}

export async function getUsageSummary(telegramUserId) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const [{ count: messagesLastHour }] = await db
    .select({ count: sql`count(*)`.mapWith(Number) })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.telegramUserId, telegramUserId),
        eq(usageEvents.kind, "message"),
        gte(usageEvents.createdAt, oneHourAgo)
      )
    );

  const [{ total: totalTokens }] = await db
    .select({ total: sql`coalesce(sum(${usageEvents.tokens}), 0)`.mapWith(Number) })
    .from(usageEvents)
    .where(eq(usageEvents.telegramUserId, telegramUserId));

  return { messagesLastHour, totalTokens };
}

// Call before making the AI call — returns { allowed: false, reason } if
// over either cap, so the caller can show that instead of spending an AI
// call it's just going to refuse to use anyway.
export async function checkMessageLimit(telegramUserId) {
  if (isOwner(telegramUserId)) return { allowed: true };

  const { messagesLastHour, totalTokens } = await getUsageSummary(telegramUserId);

  if (messagesLastHour >= DEFAULT_LIMITS.messagesPerHour) {
    return {
      allowed: false,
      reason: `You've hit your limit of ${DEFAULT_LIMITS.messagesPerHour} messages per hour. Try again in a bit.`,
    };
  }
  if (totalTokens >= DEFAULT_LIMITS.maxTokens) {
    return {
      allowed: false,
      reason: `You've used all ${DEFAULT_LIMITS.maxTokens.toLocaleString()} tokens of your allowance.`,
    };
  }
  return { allowed: true };
}

export function checkFileSize(telegramUserId, bytes) {
  if (isOwner(telegramUserId)) return { allowed: true };
  if (bytes > DEFAULT_LIMITS.maxFileBytes) {
    return { allowed: false, reason: "That file's too big — the limit is 50MB." };
  }
  return { allowed: true };
}
