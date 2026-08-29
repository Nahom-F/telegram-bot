// api/miniapp/users.js
//
// Owner-only. GET returns { pending, approved }; POST approves/denies a
// pending request; DELETE removes an approved user's access.
//
// The real security boundary is here, not in the frontend: every request
// independently re-checks isOwner() against the same check the DM bot
// uses. Hiding the button from non-owners in the UI is just cleanliness —
// this check is what actually stops a non-owner from managing users, even
// if they somehow called this endpoint directly.

import { requireTelegramUser } from "../../lib/telegramAuth.js";
import { isOwner, listPendingRequests, listApprovedUsers, decideAccessRequest, removeUser } from "../../lib/access.js";
import { sendTelegramNotification } from "../../lib/telegram.js";

export default async function handler(req, res) {
  const user = await requireTelegramUser(req, res);
  if (!user) return;

  if (!isOwner(user.id)) {
    res.status(403).json({ error: "owner_only", message: "Only the bot owner can manage users." });
    return;
  }

  if (req.method === "GET") {
    const [pending, approved] = await Promise.all([listPendingRequests(), listApprovedUsers()]);
    res.status(200).json({ pending, approved });
    return;
  }

  if (req.method === "POST") {
    const { telegramUserId, action } = req.body || {};
    if (!telegramUserId || !["approve", "deny"].includes(action)) {
      res.status(400).json({ error: "telegramUserId and a valid action are required" });
      return;
    }
    const approved = action === "approve";
    const updated = await decideAccessRequest(Number(telegramUserId), approved);
    if (!updated) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    await sendTelegramNotification(
      Number(telegramUserId),
      approved ? "🎉 You've been approved! Send /start to begin." : "Your access request was declined."
    );
    res.status(200).json(updated);
    return;
  }

  if (req.method === "DELETE") {
    const { telegramUserId } = req.body || {};
    if (!telegramUserId) {
      res.status(400).json({ error: "telegramUserId is required" });
      return;
    }
    const removed = await removeUser(Number(telegramUserId));
    if (!removed) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    await sendTelegramNotification(Number(telegramUserId), "Your access to this bot has been removed.");
    res.status(204).end();
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
