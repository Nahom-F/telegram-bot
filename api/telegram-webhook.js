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
//   send a document  reads PDF, .docx, or plain-text files — uses your
//                     caption as the question if you add one, otherwise
//                     summarizes / answers whatever's in the file
//   anything else    normal text chat (Gemini, falls back to Groq)
//
// Extra npm dependency for document reading:
//   mammoth   pulls plain text out of .docx files (PDFs don't need this —
//              Gemini reads those natively). Add it with:
//                npm install mammoth

import mammoth from "mammoth";
import { fetchWithTimeout } from "../lib/fetchWithTimeout.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTHORIZED_CHAT_IDS = (process.env.AUTHORIZED_CHAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
// e.g. https://your-project.vercel.app/miniapp/index.html — set after the
// mini app is deployed. /start includes an "Open Chat App" button only
// when this is set, so the bot still works fine without it.
const MINI_APP_URL = process.env.MINI_APP_URL;

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
  "You are a helpful, knowledgeable personal assistant chatting over Telegram. " +
  "Give complete, specific answers with real detail — don't artificially " +
  "shorten a good answer just to be brief. Plain text only, no markdown headers " +
  "(Telegram doesn't render them well) — use line breaks and dashes for " +
  "structure instead.";

async function askGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: prompt }] }],
    }),
  }, 20000);
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
  const resp = await fetchWithTimeout(url, {
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
  }, 30000); // images/PDFs legitimately take a bit longer than plain text
  if (!resp.ok) throw new Error(`Gemini vision error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini vision returned no text");
  return text;
}

// Resolves a Telegram file_id to a downloadable URL — photos come in as
// IDs, not URLs, so this is always the first step before fetching one.
async function getTelegramFileUrl(fileId) {
  const resp = await fetchWithTimeout(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`,
    {},
    10000
  );
  const data = await resp.json();
  if (!data.ok) throw new Error(`getFile failed: ${JSON.stringify(data)}`);
  return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
}

async function fetchAsBase64(url) {
  const resp = await fetchWithTimeout(url, {}, 20000);
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
  const resp = await fetchWithTimeout(url, {}, 30000); // image generation takes longer than text
  if (!resp.ok) throw new Error(`Pollinations error ${resp.status}: ${await resp.text()}`);
  const mimeType = resp.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await resp.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}

async function askGroq(prompt) {
  const resp = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
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
  }, 20000);
  if (!resp.ok) throw new Error(`Groq error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq returned no text");
  return text;
}

// Groq goes first here (not Gemini) purely for speed — Groq's custom
// hardware is built for low-latency inference, and it was previously only
// ever used as a fallback, so its speed was going unused for the common
// case. Trade-off: Gemini was originally primary because it's the
// strongest model on Gemini's free tier, so this trades a little of that
// quality margin for consistently faster replies. Vision/documents are
// untouched below — they stay Gemini-only either way.
async function getAiReply(prompt) {
  try {
    return await askGroq(prompt);
  } catch (err) {
    console.warn("Groq failed, falling back to Gemini:", err.message);
    try {
      return await askGemini(prompt);
    } catch (err2) {
      console.error("Gemini also failed:", err2.message);
      return "⚠️ Both Groq and Gemini failed to respond just now — try again in a moment.";
    }
  }
}

// No Groq fallback for vision on purpose: Groq's only current vision model
// (qwen/qwen3.6-27b) is explicitly a preview model in their own docs, and
// their previous stable vision model (Llama 4 Scout) was just deprecated.
// Better to fail clearly than silently hand you a less reliable answer.
// Also used for PDFs sent as documents, since Gemini reads those through
// the exact same inline_data + mimeType mechanism as images.
async function getVisionReply(prompt, base64Image, mimeType) {
  try {
    return await askGeminiVision(prompt, base64Image, mimeType);
  } catch (err) {
    console.error("Gemini vision/document failed:", err.message);
    return `⚠️ Couldn't read that file right now: ${err.message}`;
  }
}

async function sendTypingAction(chatId) {
  try {
    await fetchWithTimeout(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    }, 8000);
  } catch {
    // A missed typing indicator isn't worth failing the request over.
  }
}

// Telegram rejects any single message over 4096 characters — and used to
// fail completely silently here (no error thrown, nothing sent, nothing
// logged). That's exactly what "ask for a website, typing shows, then
// nothing arrives" looks like: Gemini's full HTML/CSS/JS reply blew past
// 4096 chars, Telegram's API rejected it, and the code never checked.
// Splitting long replies into multiple messages (on line breaks where
// possible) and logging any real failure fixes this for every long reply,
// not just code.
const TELEGRAM_MESSAGE_LIMIT = 4096;

function splitForTelegram(text, limit = TELEGRAM_MESSAGE_LIMIT) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut <= 0) cut = limit; // no line break to cut on — hard cut
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendTelegramMessage(chatId, text) {
  for (const chunk of splitForTelegram(text)) {
    const resp = await fetchWithTimeout(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk }),
    }, 10000);
    if (!resp.ok) {
      console.error(`sendMessage failed (${resp.status}):`, await resp.text());
    }
  }
}

// Separate from sendTelegramMessage because this one needs a reply_markup
// (the inline button) — not something the normal chat replies ever use.
async function sendStartMessage(chatId) {
  const body = {
    chat_id: chatId,
    text:
      "I'm online — Gemini for chat (Groq backup), /image <description> for pictures, " +
      "send me a photo any time and I'll analyze it, and send me a PDF, .docx, or text " +
      "file and I'll read it too." +
      (MINI_APP_URL ? " There's also a proper chat app now, with saved history." : "") +
      `\n\n${DEVELOPER_CREDIT}`,
  };
  if (MINI_APP_URL) {
    body.reply_markup = {
      inline_keyboard: [[{ text: "💬 Open Chat App", web_app: { url: MINI_APP_URL } }]],
    };
  }
  const resp = await fetchWithTimeout(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 10000);
  if (!resp.ok) {
    console.error(`sendStartMessage failed (${resp.status}):`, await resp.text());
  }
}

async function sendTelegramPhoto(chatId, imageBuffer, mimeType, caption) {
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption.slice(0, 1024));
  form.append("photo", new Blob([imageBuffer], { type: mimeType }), `image.${ext}`);
  await fetchWithTimeout(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    body: form,
  }, 20000);
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
    await sendStartMessage(chatId);
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
      sendTypingAction(chatId); // fire-and-forget — already swallows its own errors
      const fileUrl = await getTelegramFileUrl(largest.file_id);
      const { base64 } = await fetchAsBase64(fileUrl);
      // Telegram re-compresses every "photo" upload to JPEG server-side,
      // regardless of the original format — but its file-download server
      // doesn't reliably report that back in Content-Type. Trusting that
      // header was the actual bug: a wrong/generic mime type meant Gemini
      // couldn't decode the bytes as an image, and described the raw data
      // instead ("pasted as raw code"). Hardcoding it is more reliable.
      const answer = await getVisionReply(question, base64, "image/jpeg");
      await sendTelegramMessage(chatId, answer);
    } catch (err) {
      console.error("Vision pipeline failed:", err.message);
      await sendTelegramMessage(chatId, `⚠️ Couldn't process that image: ${err.message}`);
    }
    res.status(200).send("OK");
    return;
  }

  // Document message (PDF, .docx, or plain text — sent as a "file" rather
  // than a "photo" on Telegram, so it arrives as message.document).
  if (message.document) {
    const doc = message.document;
    const fileName = doc.file_name || "file";
    const mimeType = doc.mime_type || "";
    const lowerName = fileName.toLowerCase();
    const question =
      (message.caption || "").trim() ||
      "Read this document. If it contains a question or something to solve, " +
        "answer it directly. Otherwise, summarize what's in it.";

    // Telegram bots can only download files up to 20MB regardless of chat type.
    if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
      await sendTelegramMessage(
        chatId,
        "⚠️ That file's too big for me to download — Telegram bots max out at 20MB."
      );
      res.status(200).send("OK");
      return;
    }

    try {
      sendTypingAction(chatId); // fire-and-forget — already swallows its own errors
      const fileUrl = await getTelegramFileUrl(doc.file_id);

      if (mimeType === "application/pdf" || lowerName.endsWith(".pdf")) {
        // Gemini reads PDFs natively through the same inline_data mechanism
        // used for images — no text extraction needed, and it handles
        // scanned/image-only PDFs too since it's reading the actual pages.
        const { base64 } = await fetchAsBase64(fileUrl);
        const answer = await getVisionReply(question, base64, "application/pdf");
        await sendTelegramMessage(chatId, answer);
      } else if (
        mimeType ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        lowerName.endsWith(".docx")
      ) {
        // Gemini's inline_data doesn't accept .docx directly, so pull the
        // text out first with mammoth and send it as a normal text prompt.
        const resp = await fetchWithTimeout(fileUrl, {}, 20000);
        const arrayBuffer = await resp.arrayBuffer();
        const { value: docText } = await mammoth.extractRawText({
          buffer: Buffer.from(arrayBuffer),
        });
        if (!docText.trim()) {
          await sendTelegramMessage(chatId, "⚠️ Couldn't find any text in that .docx file.");
        } else {
          const prompt = `${question}\n\n--- Document text ---\n${docText.slice(0, 30000)}`;
          const answer = await getAiReply(prompt);
          await sendTelegramMessage(chatId, answer);
        }
      } else if (mimeType.startsWith("text/") || lowerName.endsWith(".txt")) {
        const resp = await fetchWithTimeout(fileUrl, {}, 20000);
        const docText = await resp.text();
        const prompt = `${question}\n\n--- Document text ---\n${docText.slice(0, 30000)}`;
        const answer = await getAiReply(prompt);
        await sendTelegramMessage(chatId, answer);
      } else {
        // Old .doc, .pptx, .xlsx, etc. — not wired up yet.
        await sendTelegramMessage(
          chatId,
          `⚠️ I can only read PDF, .docx, and plain text files right now — "${fileName}" isn't one of those.`
        );
      }
    } catch (err) {
      console.error("Document pipeline failed:", err.message);
      await sendTelegramMessage(chatId, `⚠️ Couldn't process that file: ${err.message}`);
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

  sendTypingAction(chatId); // fire-and-forget — already swallows its own errors
  const reply = await getAiReply(text);
  await sendTelegramMessage(chatId, reply);
  res.status(200).send("OK");
}
