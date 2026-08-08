// api/telegram-webhook.js
//
// Telegram webhook handler — Gemini primary, Grok (xAI) fallback.
// Stateless: Vercel spins this up per incoming message, so there's no
// "12 hour" session limit and no process to keep running. Always on.
//
// Required environment variables (set in Vercel → Project Settings →
// Environment Variables):
//   TELEGRAM_BOT_TOKEN       your bot token from BotFather
//   AUTHORIZED_CHAT_IDS      comma-separated chat IDs allowed to use the bot
//                             (e.g. "123456789" or "123456789,987654321")
//   GEMINI_API_KEY
//   GROK_API_KEY
//   TELEGRAM_WEBHOOK_SECRET  any random string you make up — verifies
//                             incoming requests really came from Telegram

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTHORIZED_CHAT_IDS = (process.env.AUTHORIZED_CHAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROK_API_KEY = process.env.GROK_API_KEY;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// Model IDs current as of Aug 2026 — swap if your account has different access.
const GEMINI_MODEL = "gemini-3.6-flash";
const GROK_MODEL = "grok-4.5";

async function askGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!resp.ok) throw new Error(`Gemini error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

async function askGrok(prompt) {
  const resp = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROK_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`Grok error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Grok returned no text");
  return text;
}

async function getAiReply(prompt) {
  try {
    return await askGemini(prompt);
  } catch (err) {
    console.warn("Gemini failed, falling back to Grok:", err.message);
    try {
      return await askGrok(prompt);
    } catch (err2) {
      console.error("Grok also failed:", err2.message);
      return "⚠️ Both Gemini and Grok failed to respond just now — try again in a moment.";
    }
  }
}

async function sendTelegramMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export default async function handler(req, res) {
  // Anything that isn't Telegram POSTing an update (e.g. you opening the
  // URL in a browser) just gets a plain 200 so it doesn't look broken.
  if (req.method !== "POST") {
    res.status(200).send("Telegram AI bot webhook is up.");
    return;
  }

  // Confirms the request actually came from Telegram and not a stranger
  // who found this URL and started POSTing fake updates to it.
  if (WEBHOOK_SECRET && req.headers["x-telegram-bot-api-secret-token"] !== WEBHOOK_SECRET) {
    res.status(401).send("Unauthorized");
    return;
  }

  const update = req.body;
  const message = update?.message;
  const chatId = message?.chat?.id;
  const text = message?.text;

  if (!chatId || !text) {
    res.status(200).send("OK");
    return;
  }

  // The actual "can strangers use my bot" gate — same idea as the Colab
  // version's whitelist.
  if (!AUTHORIZED_CHAT_IDS.includes(String(chatId))) {
    console.log(`Ignored message from unauthorized chat_id=${chatId}`);
    res.status(200).send("OK");
    return;
  }

  if (text === "/start") {
    await sendTelegramMessage(
      chatId,
      "I'm online — powered by Gemini, with Grok as a fallback. Ask me anything."
    );
    res.status(200).send("OK");
    return;
  }

  const reply = await getAiReply(text);
  await sendTelegramMessage(chatId, reply);
  res.status(200).send("OK");
}
