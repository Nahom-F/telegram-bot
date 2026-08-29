// lib/telegram.js
//
// A minimal helper for sending a plain one-off Telegram DM from mini app
// endpoints — e.g. notifying someone their access request was decided from
// the Users screen, mirroring what api/telegram-webhook.js's own
// callback_query handler does for the same actions taken via DM buttons.
// Not a replacement for that file's own send helpers (which handle
// chunking, inline keyboards, etc.) — this is just enough for a short
// notification with no reply needed.

import { fetchWithTimeout } from "./fetchWithTimeout.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export async function sendTelegramNotification(chatId, text) {
  const resp = await fetchWithTimeout(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }, 10000);
  if (!resp.ok) {
    console.error(`sendTelegramNotification failed (${resp.status}):`, await resp.text());
  }
}
