# Telegram AI Bot — Gemini primary, Groq fallback

Runs the same way your EcoFurnish Telegram bot does: as a Vercel serverless
function, not a program that has to stay running. Telegram sends each
message straight to a URL on your Vercel project, the function wakes up,
answers, and goes back to sleep. There is no "12 hour session," nothing to
restart, and no PC or laptop needs to be on.

## 1. Deploy

1. Push this folder to a new GitHub repo (or `vercel deploy` from inside it
   with the Vercel CLI — either works, same as EcoFurnish).
2. Import it in Vercel → New Project.
3. In Project Settings → Environment Variables, add these 5:

   | Key | Value |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | your bot token from BotFather |
   | `AUTHORIZED_CHAT_IDS` | your numeric chat ID (comma-separate more if needed) |
   | `GEMINI_API_KEY` | your Gemini key |
   | `GROQ_API_KEY` | your Groq key from console.groq.com (free, no card) |
   | `TELEGRAM_WEBHOOK_SECRET` | any random string you make up yourself |

   This is the "dedicated place for API keys" you're thinking of — Vercel
   encrypts these and only your functions can read them at runtime; they're
   never in your code or repo.
4. Deploy. You'll get a URL like `https://your-project.vercel.app`.

## 2. Point Telegram at it (one-time, do this once after every deploy of a new URL)

Run this once in a browser or terminal, filling in your own values:

```
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://your-project.vercel.app/api/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

You should get back `{"ok":true,"result":true,...}`. That's it — Telegram
now pushes messages to your function instead of you having to poll for them.

## 3. Test

Message your bot `/start`, then ask it anything. Send `/image a red fox
in a snowy forest` (or `/img ...`) and it'll reply with a generated picture
instead of text.

## Image generation

- Uses Pollinations.ai's `image.pollinations.ai` endpoint — genuinely free,
  no signup, no API key. (Pollinations also has a newer `gen.pollinations.ai`
  unified endpoint, but that one now requires a paid API key — this bot
  deliberately avoids it.)
- Anonymous use is rate-limited to roughly 1 request per 15 seconds, which
  is a non-issue for a bot only you use.
- No fallback provider for images (Groq doesn't do image generation) — if
  the Pollinations call fails, you'll get a text error back instead of a
  picture.

## Notes

- **Only you can use it.** The `AUTHORIZED_CHAT_IDS` check in the code
  ignores any message from a chat ID that isn't in that list — this is what
  actually keeps strangers out, not whether the bot is "discoverable."
- **Model IDs** (`gemini-3.6-flash`, `openai/gpt-oss-120b`) are current as of Aug 2026.
  If either provider retires a model later, just change the constant near
  the top of `api/telegram-webhook.js`.
- **No domain needed.** The free `your-project.vercel.app` address is a full
  HTTPS endpoint — that's all a webhook needs. A separate domain (like an
  `ecofurnish.de5.net`-style free forwarding address) wouldn't run any code
  or make this faster; it would just be a different name pointing at
  something.
