// lib/imagegen.js
//
// Pollinations.ai image generation for the mini app. A separate,
// deliberately not-shared implementation from api/telegram-webhook.js's
// own askPollinationsImage — that one is already working and untouched;
// duplicating ~8 lines here is cheaper than risking it over reuse.
// Anonymous, free, no API key — rate-limited to roughly 1 request per 15
// seconds, a non-issue for how either surface calls it.

import { fetchWithTimeout } from "./fetchWithTimeout.js";

export async function generateImage(prompt) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`;
  const resp = await fetchWithTimeout(url, {}, 30000);
  if (!resp.ok) throw new Error(`Pollinations error ${resp.status}: ${await resp.text()}`);
  const mimeType = resp.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await resp.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}
