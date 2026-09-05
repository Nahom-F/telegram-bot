// lib/attachments.js
//
// Turns an uploaded file (already sitting in Vercel Blob by the time this
// runs — see api/miniapp/blob-upload.js) into an AI reply. Mirrors the
// same file-type handling api/telegram-webhook.js already does for DM
// photos/documents, just fed from a Blob URL instead of a Telegram file
// download.

import mammoth from "mammoth";
import { fetchWithTimeout } from "./fetchWithTimeout.js";
import { getVisionReply, getConversationReply } from "./ai.js";
import { resizeImageIfNeeded } from "./imageResize.js";

const DEFAULT_QUESTION =
  "Look at this file. If it contains a question, problem, or text to solve, " +
  "answer it directly. Otherwise, describe or summarize what's in it.";

// Returns { text, tokensUsed }.
export async function analyzeAttachment(attachmentUrl, attachmentName, attachmentType, caption) {
  const question = (caption || "").trim() || DEFAULT_QUESTION;
  const lowerName = (attachmentName || "").toLowerCase();
  const mimeType = attachmentType || "";

  if (mimeType.startsWith("image/") || mimeType === "application/pdf" || lowerName.endsWith(".pdf")) {
    const resp = await fetchWithTimeout(attachmentUrl, {}, 15000);
    const arrayBuffer = await resp.arrayBuffer();
    const initialMimeType = lowerName.endsWith(".pdf") ? "application/pdf" : mimeType || "image/jpeg";
    // A no-op for PDFs — resizeImageIfNeeded only acts on image/* MIME types.
    const { buffer, mimeType: effectiveMimeType } = await resizeImageIfNeeded(
      Buffer.from(arrayBuffer),
      initialMimeType
    );
    const base64 = buffer.toString("base64");
    return await getVisionReply(question, base64, effectiveMimeType);
  }

  if (mimeType.includes("wordprocessingml") || lowerName.endsWith(".docx")) {
    const resp = await fetchWithTimeout(attachmentUrl, {}, 15000);
    const arrayBuffer = await resp.arrayBuffer();
    const { value: docText } = await mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) });
    if (!docText.trim()) {
      return { text: "⚠️ Couldn't find any text in that .docx file.", tokensUsed: null };
    }
    const prompt = `${question}\n\n--- Document text ---\n${docText.slice(0, 30000)}`;
    return await getConversationReply([{ role: "user", content: prompt }]);
  }

  if (mimeType.startsWith("text/") || lowerName.endsWith(".txt")) {
    const resp = await fetchWithTimeout(attachmentUrl, {}, 15000);
    const docText = await resp.text();
    const prompt = `${question}\n\n--- Document text ---\n${docText.slice(0, 30000)}`;
    return await getConversationReply([{ role: "user", content: prompt }]);
  }

  return {
    text: `I can only read images, PDFs, .docx, and plain text files right now — "${attachmentName}" isn't one of those.`,
    tokensUsed: null,
  };
}
