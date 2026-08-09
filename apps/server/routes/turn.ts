import { Router } from "express";
import { turnKeyId, turnKeySecret } from "../env";

export const turnRouter = Router();

const TURN_TTL_SECONDS = 3600;

turnRouter.get("/turn-credentials", async (_req, res) => {
  if (!turnKeyId || !turnKeySecret) {
    res.status(503).json({ error: "TURN service not configured" });
    return;
  }

  try {
    const cfRes = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${turnKeyId}/credentials/generate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${turnKeySecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
      },
    );

    if (!cfRes.ok) {
      console.error("TURN credential generation failed:", cfRes.status, await cfRes.text());
      res.status(502).json({ error: "failed to generate TURN credentials" });
      return;
    }

    const data = (await cfRes.json()) as {
      iceServers: { urls: string[]; username: string; credential: string };
    };

    // Port 53 is blocked by browsers; the STUN-only entry is added separately.
    const urls = data.iceServers.urls.filter((url) => !url.includes(":53"));

    res.json({
      iceServers: [
        { urls: "stun:stun.cloudflare.com:3478" },
        {
          urls,
          username: data.iceServers.username,
          credential: data.iceServers.credential,
        },
      ],
    });
  } catch (err) {
    console.error("GET /turn-credentials failed:", err);
    res.status(502).json({ error: "failed to generate TURN credentials" });
  }
});
