// lib/telegramAuth.js
//
// Verifies Telegram Mini App initData server-side, per Telegram's documented
// algorithm (core.telegram.org/bots/webapps#validating-data-received-via-the-web-app).
// This is the only trustworthy way to know who's calling the mini app API —
// the frontend can't just be taken at its word about which user it is.

import crypto from "crypto";

const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60; // reject sessions older than 24h

export function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // Constant-time comparison — avoids leaking timing info that could help
  // an attacker guess their way to a valid hash.
  const hashBuffer = Buffer.from(hash, "hex");
  const computedBuffer = Buffer.from(computedHash, "hex");
  if (
    hashBuffer.length !== computedBuffer.length ||
    !crypto.timingSafeEqual(hashBuffer, computedBuffer)
  ) {
    return null;
  }

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > MAX_INIT_DATA_AGE_SECONDS) return null;

  const userJson = params.get("user");
  if (!userJson) return null;

  try {
    return JSON.parse(userJson); // { id, first_name, last_name, username, ... }
  } catch {
    return null;
  }
}

// Pulls initData out of the request, verifies it, and returns the Telegram
// user — or sends a 401 and returns null so the endpoint can just `return`.
export function requireTelegramUser(req, res) {
  const initData = req.headers["x-telegram-init-data"];
  const user = verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
  if (!user) {
    res.status(401).json({ error: "Invalid or missing Telegram auth" });
    return null;
  }
  return user;
}
