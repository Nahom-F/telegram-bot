// api/miniapp/messages.js
//
// GET  ?chatId=123 -> full message history for that chat
// POST { chatId, content, attachmentUrl?, attachmentName?, attachmentType?,
//        attachmentBytes? } -> saves the user's message (with an
//        attachment if one was uploaded first — see blob-upload.js),
//        gets an AI reply, saves and returns it
//
// content starting with "/image <description>" (no attachment) generates
// an image via Pollinations instead of an AI text reply — same command as
// the DM bot's /image, kept consistent across both surfaces.
//
// An attachment is analyzed on its own (image/PDF via vision, .docx/.txt
// via text extraction) plus whatever caption came with it — not folded
// into the running conversation history/memory machinery, same choice the
// DM bot already makes for photos and documents.
//
// Every chat is checked against the calling Telegram user's id before any
// read or write — there's no way to touch a chat that isn't yours, even if
// you guess its id.

import { eq, and, asc } from "drizzle-orm";
import { put } from "@vercel/blob";
import { db } from "../../db/client.js";
import { chats, messages } from "../../db/schema.js";
import { requireTelegramUser } from "../../lib/telegramAuth.js";
import { getConversationReply } from "../../lib/ai.js";
import { analyzeAttachment } from "../../lib/attachments.js";
import { generateImage } from "../../lib/imagegen.js";
import { isMemoryEnabled, listMemories, saveMemory, extractMemoryMarker, MEMORY_LIMIT } from "../../lib/memory.js";
import { checkMessageLimit, recordMessageUsage, recordFileUsage, checkImageGenLimit, recordImageUsage } from "../../lib/limits.js";

async function loadOwnedChat(chatId, telegramUserId) {
  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.telegramUserId, telegramUserId)));
  return chat || null;
}

export default async function handler(req, res) {
  const user = await requireTelegramUser(req, res);
  if (!user) return;

  if (req.method === "GET") {
    const chatId = Number(req.query.chatId);
    if (!chatId) {
      res.status(400).json({ error: "chatId is required" });
      return;
    }
    const chat = await loadOwnedChat(chatId, user.id);
    if (!chat) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.createdAt));
    res.status(200).json(rows);
    return;
  }

  if (req.method === "POST") {
    const { chatId, content, attachmentUrl, attachmentName, attachmentType, attachmentBytes } = req.body || {};
    const hasAttachment = !!attachmentUrl;
    const trimmedContent = (content || "").trim();

    if (!chatId || (!trimmedContent && !hasAttachment)) {
      res.status(400).json({ error: "chatId and content (or an attachment) are required" });
      return;
    }
    const chat = await loadOwnedChat(Number(chatId), user.id);
    if (!chat) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }

    // Checked before spending an AI call, not after — no point burning a
    // request just to refuse to show its result.
    const limitCheck = await checkMessageLimit(user.id);
    if (!limitCheck.allowed) {
      res.status(429).json({ error: "rate_limited", message: limitCheck.reason });
      return;
    }

    const imageMatch = !hasAttachment && trimmedContent.match(/^\/(image|img)\s+([\s\S]+)/i);
    const isBareImageCommand = !hasAttachment && /^\/(image|img)$/i.test(trimmedContent);

    if (isBareImageCommand) {
      res.status(400).json({ error: "bad_command", message: "Send it like: /image a red fox in a snowy forest" });
      return;
    }

    if (imageMatch) {
      const imageLimitCheck = await checkImageGenLimit(user.id);
      if (!imageLimitCheck.allowed) {
        res.status(429).json({ error: "rate_limited", message: imageLimitCheck.reason });
        return;
      }
    }

    const displayContent = trimmedContent || (hasAttachment ? `📎 ${attachmentName}` : "");

    await db.insert(messages).values({
      chatId: chat.id,
      role: "user",
      content: displayContent,
      attachmentUrl: hasAttachment ? attachmentUrl : null,
      attachmentName: hasAttachment ? attachmentName : null,
      attachmentType: hasAttachment ? attachmentType : null,
    });

    // --- Image generation ("/image <description>") ---
    // A completely separate path from the AI text/vision reply below —
    // Pollinations returns image bytes directly, not something that goes
    // through Gemini/Groq at all. The result gets uploaded to our own
    // Blob store (not left pointing at Pollinations' URL) so it stays
    // reliably viewable as part of this chat's history later.
    if (imageMatch) {
      const prompt = imageMatch[2].trim();
      let assistantContent, attachment = null;
      try {
        const { buffer, mimeType } = await generateImage(prompt);
        const blob = await put(`generated-images/${chat.id}-${Date.now()}.jpg`, buffer, {
          access: "public",
          contentType: mimeType,
        });
        assistantContent = `Generated: ${prompt}`;
        attachment = { url: blob.url, name: `${prompt.slice(0, 40)}.jpg`, type: mimeType };
      } catch (err) {
        assistantContent = `⚠️ Couldn't generate that image: ${err.message}`;
      }
      await recordMessageUsage(user.id, null); // still counts toward messages/hour, no tokens involved
      await recordImageUsage(user.id);

      const [assistantMessage] = await db
        .insert(messages)
        .values({
          chatId: chat.id,
          role: "assistant",
          content: assistantContent,
          attachmentUrl: attachment?.url || null,
          attachmentName: attachment?.name || null,
          attachmentType: attachment?.type || null,
        })
        .returning();

      await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chat.id));
      if (chat.title === "New chat") {
        const autoTitle = prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt;
        await db.update(chats).set({ title: autoTitle }).where(eq(chats.id, chat.id));
      }

      res.status(201).json(assistantMessage);
      return;
    }

    let rawReply, tokensUsed;

    if (hasAttachment) {
      const result = await analyzeAttachment(attachmentUrl, attachmentName, attachmentType, trimmedContent);
      rawReply = result.text;
      tokensUsed = result.tokensUsed;
      await recordFileUsage(user.id, attachmentBytes || null);
    } else {
      const history = await db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chat.id))
        .orderBy(asc(messages.createdAt));

      const memoryOn = await isMemoryEnabled(user.id);
      const savedMemories = memoryOn ? (await listMemories(user.id)).map((m) => m.content) : [];

      const result = await getConversationReply(
        history.map((m) => ({ role: m.role, content: m.content })),
        { savedMemories, allowMemorySave: memoryOn }
      );
      rawReply = result.text;
      tokensUsed = result.tokensUsed;
    }
    await recordMessageUsage(user.id, tokensUsed);

    // If the model flagged that the user asked it to remember something,
    // save it and strip the marker out before anyone sees it. If memory's
    // already full, don't save — just say so, rather than silently
    // dropping what they asked to keep. (Attachments never trigger this —
    // analyzeAttachment doesn't pass allowMemorySave — so savedFact is
    // always null on that path.)
    let { visibleReply, savedFact } = extractMemoryMarker(rawReply);
    if (savedFact) {
      const result = await saveMemory(user.id, savedFact);
      if (!result.saved && result.reason === "limit") {
        visibleReply += `\n\n(Your memory is full — ${MEMORY_LIMIT}/${MEMORY_LIMIT} saved. Remove one in Settings to save this.)`;
      }
    }

    const [assistantMessage] = await db
      .insert(messages)
      .values({ chatId: chat.id, role: "assistant", content: visibleReply })
      .returning();

    // Bumping updatedAt keeps the chat list sorted by most-recently-active.
    await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chat.id));

    // Auto-title a brand-new chat from its first message, so the chat list
    // doesn't just show a wall of identical "New chat" entries.
    if (chat.title === "New chat") {
      const titleSource = trimmedContent || attachmentName || "New chat";
      const autoTitle = titleSource.length > 40 ? `${titleSource.slice(0, 40)}…` : titleSource;
      await db.update(chats).set({ title: autoTitle }).where(eq(chats.id, chat.id));
    }

    res.status(201).json(assistantMessage);
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
