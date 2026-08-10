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
4. Add the one extra dependency this version needs, for reading `.docx`
   files:
   ```
   npm install mammoth
   ```
   (PDFs don't need this — Gemini reads those natively, same as images.)
5. Deploy. You'll get a URL like `https://your-project.vercel.app`.

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
instead of text. Send it any photo — with or without a caption — and it'll
analyze it (see below).

## Photo / vision

- Send a photo with a caption and the caption is used as your question
  ("what's the joke in this?", "translate the sign", etc).
- Send a photo with no caption and it defaults to: if there's a question,
  problem, or text in the image (a homework screenshot, a quiz, a math
  problem), read it and answer it directly — otherwise, describe the image.
- Uses the same `GEMINI_API_KEY` you already set — Gemini's `generateContent`
  endpoint takes text and image together in one request, so no extra key or
  setup is needed.
- No Groq fallback for vision specifically — Groq's only current vision
  model is a preview model in their own docs (their previous stable one was
  just deprecated), so failures here return a plain error message rather
  than silently falling back to something less reliable. Text chat and
  image *generation* both still have their normal fallbacks.

## Document reading

- Send a PDF, `.docx`, or plain-text (`.txt`) file — with or without a
  caption — and the bot reads it.
- With a caption, the caption is used as your question ("what's the total
  on page 2?", "translate this to English", etc). Without one, it defaults
  to: answer any question/problem in the document if there is one,
  otherwise summarize it.
- **PDFs** go straight to Gemini the same way photos do (no extraction
  step) — this also means it can handle scanned/image-only PDFs, since
  Gemini is reading the actual pages, not parsed text.
- **`.docx`** files have their text pulled out first with the `mammoth`
  package (Gemini's document understanding doesn't accept `.docx` directly
  the way it does PDFs and images), then sent as a normal text prompt.
- **`.txt`** files are read directly as plain text.
- Old-format `.doc`, `.pptx`, `.xlsx`, and other file types aren't wired up
  yet — the bot will tell you it can't read them rather than failing
  silently.
- Telegram bots can only download files up to 20MB — anything bigger gets
  a clear "too big" message instead of a failed/hanging request.
- Uses `getAiReply` (Gemini → Groq fallback) for `.docx`/`.txt`, and the
  vision path (Gemini only, no fallback — see above) for PDFs, since PDFs
  go through the same multimodal call as images.

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

## How powerful is this, and can it be stronger for free?

`gemini-3.6-flash` is Google's current fast-tier model — it's already the
strongest model available on Gemini's free tier. As of April 2026, Google
moved the Pro-tier models (the actually-stronger reasoning models) to
paid-only, so there's no free model swap that makes this meaningfully
smarter. What this bot does instead, for free: a `SYSTEM_PROMPT` constant
near the top tells the model how to behave (concise, specific, plain text)
— this doesn't make the model itself smarter, but it noticeably improves
answer quality and consistency, at zero cost. If you want a bigger upgrade
later, the next real lever is conversation memory (the bot currently
treats every message independently) — that needs somewhere to store chat
history between requests, since Vercel functions don't keep state between
invocations. A free external store like Upstash Redis, or your existing
EcoFurnish database if you ever merge this bot into that project, would
both work.

## Notes

- **Only you can use it.** The `AUTHORIZED_CHAT_IDS` check in the code
  replies to anyone else with a short "made by Nahom (NF), this bot is
  private" message and stops there — no AI call, so it costs nothing even
  if a stranger messages repeatedly.
- **Developer credit.** Shows in the `/start` reply, and in the notice
  unauthorized users get — so anyone who finds and starts the bot sees who
  made it either way.
- **Model IDs** (`gemini-3.6-flash`, `openai/gpt-oss-120b`) are current as of Aug 2026.
  If either provider retires a model later, just change the constant near
  the top of `api/telegram-webhook.js`.
- **No domain needed.** The free `your-project.vercel.app` address is a full
  HTTPS endpoint — that's all a webhook needs. A separate domain (like an
  `ecofurnish.de5.net`-style free forwarding address) wouldn't run any code
  or make this faster; it would just be a different name pointing at
  something.
