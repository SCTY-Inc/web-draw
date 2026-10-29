// Compose: turn pasted markdown/code into canvas actions. Posts the text to our
// backend (POST /api/copilot/compose), which reasons over it server-side with a
// size-routed GPT-5.5 model and returns the tool calls to run. We then dispatch
// each call through the existing runTool layer — the same hands the voice co-pilot
// uses. The tool *contract* lives server-side, so the browser only sends raw text.
export type ComposeCall = { name: string; args: unknown };

async function fetchCsrf(): Promise<{ token: string; header: string }> {
  const r = await fetch("/api/csrf-token", { credentials: "include" });
  return r.json();
}

export async function requestCompose(text: string): Promise<ComposeCall[]> {
  const { token, header } = await fetchCsrf();
  const r = await fetch("/api/copilot/compose", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", [header]: token },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(
      detail?.message || detail?.error || `compose failed: ${r.status}`,
    );
  }
  const data = await r.json();
  return Array.isArray(data?.calls) ? data.calls : [];
}
