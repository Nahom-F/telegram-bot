// api/telegram-webhook.js
//
// Telegram webhook handler — Gemini for text + vision (Groq fallback for
// text only), Pollinations.ai for image generation. Stateless: Vercel spins
// this up per incoming message, so there's no "12 hour" session limit and
// no process to keep running. Always on.
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
// Commands:
//   /start           intro message
//   /image <prompt>  generates an image via Pollinations.ai (also /img)
//   send a photo     analyzes it — uses your caption as the question if you
//                     add one, otherwise reads/answers anything written in
//                     the image or describes it
//   anything else    normal text chat (Gemini, falls back to Groq)

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTHORIZED_CHAT_IDS = (process.env.AUTHORIZED_CHAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// Model IDs current as of Aug 2026 — swap if your account has different access.
const GEMINI_MODEL = "gemini-3.6-flash";
const GROQ_MODEL = "openai/gpt-oss-120b"; // Groq's current flagship open model (text only)

const DEVELOPER_CREDIT = "Made by Nahom (NF).";
const UNAUTHORIZED_NOTICE =
  "🤖 This bot was made by Nahom (NF). It's private, so I can't chat with you here — but thanks for stopping by!";

// Free, no-cost way to noticeably improve answer quality without changing
// models (the underlying model is already the strongest one available on
// the free tier — see the README for why "more powerful" mostly means
// better prompting, not a bigger model).
const SYSTEM_PROMPT =
  "You are a helpful, friendly personal assistant chatting over Telegram. " +
  "Answer clearly, specifically, and concisely — plain text only, no markdown " +
  "headers (Telegram doesn't render them well). Prefer a direct, concrete answer " +
  "over a generic one.";

async function askGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
  if (!resp.ok) throw new Error(`Gemini error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

// Same Gemini endpoint, just with an extra inline_data part — Gemini
// natively handles text+image together in one request, no separate
// "vision model" needed.
async function askGeminiVision(prompt, base64Image, mimeType) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64Image } },
          ],
        },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`Gemini vision error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini vision returned no text");
  return text;
}

// Resolves a Telegram file_id to a downloadable URL — photos come in as
// IDs, not URLs, so this is always the first step before fetching one.
async function getTelegramFileUrl(fileId) {
  const resp = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await resp.json();
  if (!data.ok) throw new Error(`getFile failed: ${JSON.stringify(data)}`);
  return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
}

async function fetchAsBase64(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download file: ${resp.status}`);
  const mimeType = resp.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await resp.arrayBuffer();
  return { base64: Buffer.from(arrayBuffer).toString("base64"), mimeType };
}

// Returns a Buffer of image bytes for /image generation. Uses
// Pollinations.ai's older image.pollinations.ai endpoint, which — unlike
// the newer gen.pollinations.ai unified API — still works without any API
// key or billing. Rate-limited to roughly 1 request per 15 seconds for
// anonymous use, which is plenty for a single-person bot.
async function askPollinationsImage(prompt) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`;
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
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
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

// No Groq fallback for vision on purpose: Groq's only current vision model
// (qwen/qwen3.6-27b) is explicitly a preview model in their own docs, and
// their previous stable vision model (Llama 4 Scout) was just deprecated.
// Better to fail clearly than silently hand you a less reliable answer.
async function getVisionReply(prompt, base64Image, mimeType) {
  try {
    return await askGeminiVision(prompt, base64Image, mimeType);
  } catch (err) {
    console.error("Gemini vision failed:", err.message);
    return `⚠️ Couldn't analyze that image right now: ${err.message}`;
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

  if (!chatId) {
    res.status(200).send("OK");
    return;
  }

  // Strangers now get a short reply instead of silence — tells them who
  // made it and that it's private, then stops there (no AI call, so it
  // costs nothing even if someone messages repeatedly).
  if (!AUTHORIZED_CHAT_IDS.includes(String(chatId))) {
    console.log(`Unauthorized chat_id=${chatId} — sent developer notice only`);
    await sendTelegramMessage(chatId, UNAUTHORIZED_NOTICE);
    res.status(200).send("OK");
    return;
  }

  const text = message.text;

  if (text === "/start") {
    await sendTelegramMessage(
      chatId,
      `I'm online — Gemini for chat (Groq backup), /image <description> for pictures, and send me a photo any time and I'll analyze it.\n\n${DEVELOPER_CREDIT}`
    );
    res.status(200).send("OK");
    return;
  }

  // Photo message (with or without a caption).
  if (message.photo && message.photo.length) {
    const largest = message.photo[message.photo.length - 1]; // last = highest res
    const question =
      (message.caption || "").trim() ||
      "Look at this image. If it contains a question, problem, or text to solve " +
        "(like a screenshot of homework, a quiz, or a math problem), read it and " +
        "answer it directly. Otherwise, describe what's in the image.";

    try {
      const fileUrl = await getTelegramFileUrl(largest.file_id);
      const { base64, mimeType } = await fetchAsBase64(fileUrl);
      const answer = await getVisionReply(question, base64, mimeType);
      await sendTelegramMessage(chatId, answer);
    } catch (err) {
      console.error("Vision pipeline failed:", err.message);
      await sendTelegramMessage(chatId, `⚠️ Couldn't process that image: ${err.message}`);
    }
    res.status(200).send("OK");
    return;
  }

  if (!text) {
    // Sticker, voice note, etc. — nothing to reply to.
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
