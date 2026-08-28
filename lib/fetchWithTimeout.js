// lib/fetchWithTimeout.js
//
// Plain fetch() can hang indefinitely if an upstream API stalls instead of
// erroring quickly — that starves any Gemini -> Groq fallback of a chance
// to even run, since the whole invocation can burn its entire time budget
// waiting on one stuck call before Vercel kills it. This wraps fetch with
// a hard timeout so a slow provider gets aborted and handed off to the
// fallback (or a clear error) quickly, instead of silently hanging for a
// minute or more.

export async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
