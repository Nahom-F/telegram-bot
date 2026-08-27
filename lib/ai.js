// lib/ai.js
//
// Multi-turn Gemini (primary) / Groq (fallback) calling for the mini app's
// chat threads. This is a sibling to the single-prompt logic already in
// api/telegram-webhook.js, not a replacement for it — the webhook's
// existing DM chat, /image, and document reading are untouched and keep
// working exactly as they do now. This file exists because a "chat" with
// history is the whole point of the mini app, so it's built around a full
// message array instead of one prompt.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const GEMINI_MODEL = "gemini-3.6-flash";
const GROQ_MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT =
  "You are a helpful, knowledgeable personal assistant chatting inside a Telegram " +
  "mini app. Give complete, specific answers with real detail — don't artificially " +
  "shorten a good answer just to be brief. Plain text only, no markdown headers.";

// history: [{ role: "user" | "assistant", content: "..." }, ...] in order,
// oldest first. Gemini calls the assistant's turns "model", not "assistant".
async function askGeminiConversation(history) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const contents = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
    }),
  });
  if (!resp.ok) throw new Error(`Gemini error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

async function askGroqConversation(history) {
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
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });
  if (!resp.ok) throw new Error(`Groq error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq returned no text");
  return text;
}

export async function getConversationReply(history) {
  try {
    return await askGeminiConversation(history);
  } catch (err) {
    console.warn("Gemini failed, falling back to Groq:", err.message);
    try {
      return await askGroqConversation(history);
    } catch (err2) {
      console.error("Groq also failed:", err2.message);
      return "⚠️ Both Gemini and Groq failed to respond just now — try again in a moment.";
    }
  }
}
