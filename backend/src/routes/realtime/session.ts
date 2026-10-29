// Mints a short-lived ephemeral client secret for an OpenAI Realtime voice session.
// The standing OPENAI_API_KEY stays server-side; the browser only ever receives a
// scoped, expiring secret it uses to open the WebRTC session directly with OpenAI.
//
// Frontend calls POST /api/realtime/session (nginx strips /api → /realtime/session).
import type { Express, Request, Response } from "express";

type Deps = {
  app: Express;
  requireAuth: (req: Request, res: Response, next: (err?: unknown) => void) => void;
  asyncHandler: (fn: (req: Request, res: Response) => Promise<unknown>) => any;
};

export function registerRealtimeRoutes({ app, requireAuth, asyncHandler }: Deps): void {
  app.post(
    "/realtime/session",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "Realtime disabled",
          message: "OPENAI_API_KEY is not configured on the server.",
        });
      }

      const model = process.env.REALTIME_MODEL || "gpt-realtime-2.1";
      const voice = process.env.REALTIME_VOICE || "marin";
      // Low reasoning effort = snappy "draw a box" latency; bump via env for heavier
      // "design this whole architecture" sessions. (Verified field: session.reasoning.effort.)
      const effort = process.env.REALTIME_EFFORT || "low";

      let resp: globalThis.Response;
      try {
        resp = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            session: {
              type: "realtime",
              model,
              reasoning: { effort },
              audio: { output: { voice } },
            },
          }),
        });
      } catch (err: any) {
        console.error("[realtime] network error minting client secret:", err?.message || err);
        return res.status(502).json({ error: "Realtime upstream unreachable" });
      }

      const raw = await resp.text();
      if (!resp.ok) {
        console.error("[realtime] client_secrets failed", resp.status, raw.slice(0, 400));
        return res.status(502).json({ error: "Realtime session failed", status: resp.status });
      }

      let data: any;
      try {
        data = JSON.parse(raw);
      } catch {
        return res.status(502).json({ error: "Realtime returned non-JSON" });
      }

      // Normalize across API shapes:
      //  - /client_secrets → { value, expires_at, session }
      //  - legacy /sessions → { client_secret: { value, expires_at } }
      const value = data?.value ?? data?.client_secret?.value ?? null;
      const expiresAt = data?.expires_at ?? data?.client_secret?.expires_at ?? null;
      if (!value) {
        console.error("[realtime] no client secret in response:", raw.slice(0, 300));
        return res.status(502).json({ error: "Realtime returned no client secret" });
      }

      return res.json({ client_secret: value, expires_at: expiresAt, model });
    })
  );
}
