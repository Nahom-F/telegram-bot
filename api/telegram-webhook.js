// api/telegram-webhook.js
//
// Telegram webhook handler — Gemini for text (Groq fallback), Pollinations.ai
// for images (free, no billing, no API key required). Stateless: Vercel
// spins this up per incoming message, so there's no "12 hour" session limit
// and no process to keep running. Always on.
//
// Required environment variables (set in Vercel → Project Settings →
// Environment Variables):
//   TELEGRAM_BOT_TOKEN       your bot token from BotFather
//   AUTHORIZED_CHAT_IDS      comma-separated chat IDs allowed to use the bot
//                             (e.g. "123456789" or "123456789,987654321")
//   GEMINI_API_KEY
//   GROQ_API_KEY             from console.groq.com (free API tier, no card)
//   TELEGRAM_WEBHOOK_SECRET  any random string you make up — verifies
//                             incoming requests really came from Telegram
//
// Optional:
//   POLLINATIONS_API_KEY     free key from enter.pollinations.ai — not
//                             required, but avoids shared per-IP rate limits
//                             if /image gets used a lot
//
// Commands:
//   /start           intro message
//   /image <prompt>  generates an image via Pollinations.ai (also /img)
//   anything else    normal text chat (Gemini, falls back to Groq)

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTHORIZED_CHAT_IDS = (process.env.AUTHORIZED_CHAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const POLLINATIONS_API_KEY = process.env.POLLINATIONS_API_KEY || "";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// Model IDs current as of Aug 2026 — swap if your account has different access.
const GEMINI_MODEL = "gemini-3.6-flash";
const GROQ_MODEL = "openai/gpt-oss-120b"; // Groq's current flagship open model (text only)

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

// Returns a Buffer of image bytes. Pollinations.ai — free, no billing, no
// API key required for normal use (gen.pollinations.ai, backed by Flux).
async function askPollinationsImage(prompt) {
  const keyParam = POLLINATIONS_API_KEY ? `?key=${POLLINATIONS_API_KEY}` : "";
  const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}${keyParam}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Pollinations error ${resp.status}: ${await resp.text()}`);
  const mimeType = resp.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await resp.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}

async function askGroq(prompt) {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`Groq error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq returned no text");
  return text;
}

async function getAiReply(prompt) {
  try {
    return await askGemini(prompt);
  } catch (err) {
    console.warn("Gemini failed, falling back to Groq:", err.message);
    try {
      return await askGroq(prompt);
    } catch (err2) {
      console.error("Groq also failed:", err2.message);
      return "⚠️ Both Gemini and Groq failed to respond just now — try again in a moment.";
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

async function sendTelegramPhoto(chatId, imageBuffer, mimeType, caption) {
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption.slice(0, 1024));
  form.append("photo", new Blob([imageBuffer], { type: mimeType }), `image.${ext}`);
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    body: form,
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

  // The actual "can strangers use my bot" gate.
  if (!AUTHORIZED_CHAT_IDS.includes(String(chatId))) {
    console.log(`Ignored message from unauthorized chat_id=${chatId}`);
    res.status(200).send("OK");
    return;
  }

  if (text === "/start") {
    await sendTelegramMessage(
      chatId,
      "I'm online — Gemini for chat (Groq backup), and /image <description> for pictures."
    );
    res.status(200).send("OK");
    return;
  }

  const imageMatch = text.match(/^\/(image|img)\s+([\s\S]+)/i);
  if (imageMatch) {
    const imagePrompt = imageMatch[2].trim();
    try {
      const { buffer, mimeType } = await askPollinationsImage(imagePrompt);
      await sendTelegramPhoto(chatId, buffer, mimeType, imagePrompt);
    } catch (err) {
      console.error("Image generation failed:", err.message);
      await sendTelegramMessage(chatId, `⚠️ Couldn't generate that image: ${err.message}`);
    }
    res.status(200).send("OK");
    return;
  }

  if (/^\/(image|img)$/i.test(text)) {
    await sendTelegramMessage(chatId, "Send it like: /image a red fox in a snowy forest");
    res.status(200).send("OK");
    return;
  }

  const reply = await getAiReply(text);
  await sendTelegramMessage(chatId, reply);
  res.status(200).send("OK");
}
