// api/miniapp/blob-upload.js
//
// The browser never uploads a file through one of our own functions —
// Vercel caps a function's request body at 4.5MB, far below the 50MB
// cap we actually want. Instead, the browser uploads directly to Vercel
// Blob storage, and this route only ever sees a small JSON handshake:
// it hands out a short-lived, size/type-restricted upload token after
// verifying who's asking. The actual file bytes never pass through here.
//
// Auth happens the normal way first (requireTelegramUser, same as every
// other mini app endpoint) — Vercel Blob's own onBeforeGenerateToken hook
// is where the docs warn you MUST authenticate, so skipping it would let
// anyone with the URL upload to your store for free.

import { handleUpload } from "@vercel/blob/client";
import { requireTelegramUser } from "../../lib/telegramAuth.js";
import { isOwner } from "../../lib/access.js";
import { DEFAULT_LIMITS } from "../../lib/limits.js";

const ALLOWED_CONTENT_TYPES = [
  "image/*",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];

// Vercel Blob's handleUpload wants a Web-standard Request, but this
// project uses classic Vercel Functions (req, res) — reconstruct one from
// the Node request so the header/signature-related paths inside
// handleUpload still see something real to work with.
function toWebRequest(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  return new Request(`${protocol}://${host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: JSON.stringify(req.body),
  });
}

export default async function handler(req, res) {
  const user = await requireTelegramUser(req, res);
  if (!user) return;

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: toWebRequest(req),
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        maximumSizeInBytes: isOwner(user.id) ? 500 * 1024 * 1024 : DEFAULT_LIMITS.maxFileBytes,
        tokenPayload: JSON.stringify({ telegramUserId: user.id }),
      }),
    });
    res.status(200).json(jsonResponse);
  } catch (err) {
    console.error("blob-upload handleUpload failed:", err.message);
    res.status(400).json({ error: err.message });
  }
}
