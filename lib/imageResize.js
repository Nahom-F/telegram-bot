// lib/imageResize.js
//
// Downscales an oversized image before it's sent to Gemini for vision
// analysis. Phone camera photos are routinely 3000-4000px on a side — far
// more resolution than a vision model needs to read text or describe a
// scene — so sending it at full size just means more data to transmit and
// more for Gemini to actually process, directly adding to the analysis
// time that was the whole reason for this file. Never touches PDFs (a
// completely different format, unrelated to this). Falls back to the
// original buffer untouched on any resize failure — this can only make
// things faster, never turn a request that would have worked into one
// that doesn't.
//
// jimp is deliberately pinned to 0.22.12, not the current 1.x line. 1.x is
// a genuine rewrite (different import style, possibly renamed methods)
// that isn't yet consistently documented enough to be confident about
// getting exactly right on the first try, whereas 0.22.12's classic API
// (Jimp.read/.resize/.getBufferAsync) is extremely well-established.
// Being pure JS with zero native dependencies, there's none of the
// deployment risk an old *native* package would carry by comparison —
// this was chosen over sharp specifically to sidestep sharp's currently
// open, unresolved Vercel packaging bug on its latest version.

import Jimp from "jimp";

// Matches common vision-model guidance — no real analysis quality is lost
// sending anything bigger than this.
const MAX_DIMENSION = 1568;

export async function resizeImageIfNeeded(buffer, mimeType) {
  if (!mimeType || !mimeType.startsWith("image/")) return { buffer, mimeType };

  try {
    const image = await Jimp.read(buffer);
    const { width, height } = image.bitmap;
    if (Math.max(width, height) <= MAX_DIMENSION) return { buffer, mimeType };

    if (width > height) {
      image.resize(MAX_DIMENSION, Jimp.AUTO);
    } else {
      image.resize(Jimp.AUTO, MAX_DIMENSION);
    }
    image.quality(85);
    const outBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
    return { buffer: outBuffer, mimeType: "image/jpeg" };
  } catch (err) {
    console.warn("Image resize failed, sending original size instead:", err.message);
    return { buffer, mimeType };
  }
}
