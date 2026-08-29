// db/schema.js
//
// Two tables: a "chat" is one conversation thread the user can create and
// switch between in the mini app; a "message" belongs to exactly one chat
// and holds either the user's turn or the assistant's reply, in order.

import { pgTable, serial, integer, bigint, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const chats = pgTable(
  "chats",
  {
    id: serial("id").primaryKey(),
    // Telegram user IDs are up to 64-bit — bigint avoids overflow.
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    title: text("title").notNull().default("New chat"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("chats_telegram_user_id_idx").on(table.telegramUserId),
  })
);

// One row per Telegram user, holding preferences that affect server-side
// behavior (unlike theme, which is purely cosmetic and stays client-side
// in localStorage).
export const userSettings = pgTable("user_settings", {
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).primaryKey(),
  memoryEnabled: boolean("memory_enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Explicit, user-controlled memory — one row per fact the user asked the
// bot to remember (or added manually in Settings). Not tied to any chat;
// capped per user in lib/memory.js, not here.
export const memories = pgTable(
  "memories",
  {
    id: serial("id").primaryKey(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("memories_telegram_user_id_idx").on(table.telegramUserId),
  })
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    chatId: integer("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // "user" | "assistant"
    content: text("content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    chatIdx: index("messages_chat_id_idx").on(table.chatId),
  })
);

// One row per Telegram user who has ever interacted with the access
// system — the whole lifecycle lives in `status`, so this one table is
// the single source of truth for both the DM bot and the mini app:
//   awaiting_reason -> pending -> approved | denied
// The owner (OWNER_CHAT_ID) never gets a row here — they're always
// implicitly approved, checked separately in lib/access.js.
export const accessRequests = pgTable("access_requests", {
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).primaryKey(),
  status: text("status").notNull(), // awaiting_reason | pending | approved | denied
  displayName: text("display_name"),
  reason: text("reason"),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  decidedAt: timestamp("decided_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// One row per usage event (a message answered, or a file processed) — a
// log rather than a running counter, so "messages in the last hour" is a
// real rolling window (ages out naturally) rather than a fixed clock-hour
// bucket. Tokens come straight from the AI providers' own usage figures in
// their responses, not an estimate.
export const usageEvents = pgTable(
  "usage_events",
  {
    id: serial("id").primaryKey(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    kind: text("kind").notNull(), // "message" | "file"
    tokens: integer("tokens"),
    bytes: integer("bytes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userTimeIdx: index("usage_events_user_time_idx").on(table.telegramUserId, table.createdAt),
  })
);
