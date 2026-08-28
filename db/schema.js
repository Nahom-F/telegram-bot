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
    // Short AI-generated summary of this chat, generated lazily the first
    // time another chat needs it for the "remember across chats" bridge —
    // not populated eagerly, so it stays null until it's actually used.
    summary: text("summary"),
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
