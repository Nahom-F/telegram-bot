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
// memoryContext, when present, is folded into the system instruction for
// this call only — it's how the "remember across chats" bridge feeds in a
// summary of the user's last chat without merging the two conversations.
async function askGeminiConversation(history, memoryContext) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const contents = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const systemText = memoryContext
    ? `${SYSTEM_PROMPT}\n\nBackground context from the user's most recent other chat (for your awareness only — don't mention this note explicitly unless it's relevant): ${memoryContext}`
    : SYSTEM_PROMPT;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemText }] },
      contents,
    }),
  });
  if (!resp.ok) throw new Error(`Gemini error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

async function askGroqConversation(history, memoryContext) {
  const systemText = memoryContext
    ? `${SYSTEM_PROMPT}\n\nBackground context from the user's most recent other chat (for your awareness only — don't mention this note explicitly unless it's relevant): ${memoryContext}`
    : SYSTEM_PROMPT;
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemText },
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

export async function getConversationReply(history, memoryContext) {
  try {
    return await askGeminiConversation(history, memoryContext);
  } catch (err) {
    console.warn("Gemini failed, falling back to Groq:", err.message);
    try {
      return await askGroqConversation(history, memoryContext);
    } catch (err2) {
      console.error("Groq also failed:", err2.message);
      return "⚠️ Both Gemini and Groq failed to respond just now — try again in a moment.";
    }
  }
}

// A short, cheap summarization call — used to build the "remember across
// chats" bridge. Capped hard at 600 characters as a safety net on top of
// the prompt's own brevity instruction, so a runaway response can never
// balloon the context of every future chat that reads it.
export async function summarizeConversation(history) {
  const transcript = history.map((m) => `${m.role}: ${m.content}`).join("\n");
  const prompt =
    "Summarize the key facts and topics from this conversation in 2-3 short sentences, " +
    "focused on whatever would help someone continue a related conversation later. " +
    "Be concise — this is background context, not a recap.\n\n" +
    transcript;
  const reply = await getConversationReply([{ role: "user", content: prompt }]);
  return reply.length > 600 ? `${reply.slice(0, 600)}…` : reply;
}
