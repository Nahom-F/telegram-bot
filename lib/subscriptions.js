// lib/subscriptions.js
//
// Tracks Pro/Premium subscriptions paid via Telegram Stars. A user with no
// row here (or a row whose expiresAt has passed) is on the free tier —
// there's no explicit cancellation flow to handle. Telegram's own UI lets
// a user cancel their subscription any time; when they do (or a renewal
// charge fails), no new successful_payment arrives, expiresAt eventually
// passes, and getUserTier() naturally falls back to "free" on its own.

import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { subscriptions } from "../db/schema.js";
import { isOwner } from "./access.js";

// Telegram Stars subscriptions are locked to exactly 30 days per renewal —
// not our choice, that's a hard constraint of createInvoiceLink/sendInvoice.
export const SUBSCRIPTION_PERIOD_SECONDS = 2592000;

// Stars prices — 1 Star is roughly $0.01. Kept here (not scattered across
// the webhook) so adjusting a price is a one-line change.
export const TIER_PRICES_STARS = {
  pro: 250, // ~$2.50/month
  premium: 500, // ~$5/month
};

export async function getUserTier(telegramUserId) {
  if (isOwner(telegramUserId)) return "owner";
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.telegramUserId, telegramUserId));
  if (sub && sub.status === "active" && sub.expiresAt && sub.expiresAt > new Date()) {
    return sub.tier; // "pro" | "premium"
  }
  return "free";
}

// Called from the successful_payment handler — for both a brand-new
// subscription and every 30-day renewal (Telegram sends a fresh
// successful_payment for each, which is why this just upserts rather than
// requiring a "first payment" special case).
export async function activateSubscription(telegramUserId, tier, chargeId, expiresAt) {
  await db
    .insert(subscriptions)
    .values({ telegramUserId, tier, status: "active", telegramChargeId: chargeId, expiresAt })
    .onConflictDoUpdate({
      target: subscriptions.telegramUserId,
      set: { tier, status: "active", telegramChargeId: chargeId, expiresAt, updatedAt: new Date() },
    });
}
