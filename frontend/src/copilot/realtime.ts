// OpenAI Realtime WebRTC client for the in-tab voice co-pilot.
// Flow: mint ephemeral secret (our backend) → RTCPeerConnection (mic + remote audio)
// → data channel → session.update with our tools → on response.done, run its function
// calls and return their outputs. Turn handling follows OpenAI's Realtime guide:
// https://developers.openai.com/api/docs/guides/realtime-conversations (push-to-talk,
// interruption, function calling).
import type { RunTool } from "./useCopilotTools";

type ToolSchema = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type CopilotState = "idle" | "connecting" | "live" | "error";
export type MicMode = "ptt" | "open";

export type RealtimeOptions = {
  toolSchemas: ToolSchema[];
  runTool: RunTool;
  onState?: (s: CopilotState, detail?: string) => void;
  onEvent?: (label: string) => void;
};

const SESSION_INSTRUCTIONS = [
  "You are a drawing co-pilot embedded in an Excalidraw whiteboard.",
  "For ANY request that involves drawing, editing, navigating, or changing the board, you MUST",
  "call a tool to actually do it. Never only describe or say you'll do it — act first, then give",
  "a one-sentence spoken confirmation. If unsure of element ids, call get_scene first.",
  "Prefer add_diagram (Mermaid) for structured diagrams and add_elements for a few loose shapes.",
  "Only reply in words without a tool call for pure questions that require no canvas change.",
].join(" ");

async function fetchCsrf(): Promise<{ token: string; header: string }> {
  const r = await fetch("/api/csrf-token", { credentials: "include" });
  return r.json();
}

async function mintEphemeralSecret(): Promise<{
  client_secret: string;
  model: string;
}> {
  const { token, header } = await fetchCsrf();
  const r = await fetch("/api/realtime/session", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", [header]: token },
    body: "{}",
  });
  if (!r.ok) throw new Error(`session mint failed: ${r.status}`);
  return r.json();
}

export class RealtimeCopilot {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private micTrack: MediaStreamTrack | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private opts: RealtimeOptions;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  // Cost guardrail: auto-disconnect after this much inactivity (no events/sends).
  private static IDLE_MS = 3 * 60 * 1000;
  // Shorter holds are treated as accidental taps and not sent to the model.
  private static MIN_PTT_MS = 250;
  private mode: MicMode = "ptt";
  private responseActive = false;
  private audioPlaying = false;
  private pttStartedAt = 0;
  state: CopilotState = "idle";

  constructor(opts: RealtimeOptions) {
    this.opts = opts;
  }

  private touchIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.opts.onEvent?.("Voice ended after 3 minutes idle.");
      this.disconnect();
    }, RealtimeCopilot.IDLE_MS);
  }

  private setState(s: CopilotState, detail?: string) {
    this.state = s;
    this.opts.onState?.(s, detail);
  }

  async connect(): Promise<void> {
    if (this.state === "connecting" || this.state === "live") return;
    this.setState("connecting");
    try {
      const { client_secret, model } = await mintEphemeralSecret();

      const pc = new RTCPeerConnection();
      this.pc = pc;

      // Remote model audio → hidden <audio>.
      this.audioEl = document.createElement("audio");
      this.audioEl.autoplay = true;
      pc.ontrack = (e) => {
        if (this.audioEl) this.audioEl.srcObject = e.streams[0];
      };

      // Local mic (push-to-talk starts muted). Non-fatal: if there's no mic, the user
      // denies permission, or the prompt hangs, fall back to text-only mode (recvonly
      // for the model's audio). The timeout guards against getUserMedia never resolving.
      try {
        const mic = await Promise.race<MediaStream>([
          navigator.mediaDevices.getUserMedia({ audio: true }),
          new Promise<MediaStream>((_, rej) =>
            setTimeout(() => rej(new Error("mic timeout")), 6000),
          ),
        ]);
        this.micTrack = mic.getAudioTracks()[0];
        this.micTrack.enabled = false;
        pc.addTrack(this.micTrack, mic);
      } catch (micErr) {
        console.warn("[copilot] no microphone — text-only mode", micErr);
        this.opts.onEvent?.("no mic: text-only mode");
        pc.addTransceiver("audio", { direction: "recvonly" });
      }

      // Events / tool-calls.
      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      dc.onopen = () => this.configureSession();
      // The server can end the session (errors, the 60-minute limit). disconnect()
      // clears this.dc first, so only an unexpected close reaches the log.
      dc.onclose = () => {
        if (this.dc !== dc) return;
        this.opts.onEvent?.("Voice disconnected.");
        this.disconnect();
      };
      dc.onmessage = (e) => this.onServerEvent(JSON.parse(e.data));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`,
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${client_secret}`,
            "Content-Type": "application/sdp",
          },
        },
      );
      if (!sdpRes.ok) throw new Error(`SDP exchange failed: ${sdpRes.status}`);
      const answer = { type: "answer" as const, sdp: await sdpRes.text() };
      await pc.setRemoteDescription(answer);

      this.setState("live");
      this.touchIdle();
    } catch (err: any) {
      console.error("[copilot] connect failed", err);
      this.setState("error", err?.message || String(err));
      this.disconnect();
    }
  }

  private send(obj: unknown) {
    if (this.dc && this.dc.readyState === "open")
      this.dc.send(JSON.stringify(obj));
    this.touchIdle();
  }

  private turnDetection() {
    // Push-to-talk turns server VAD off; the client commits each turn itself.
    return this.mode === "open" ? { type: "semantic_vad" } : null;
  }

  private configureSession() {
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: SESSION_INSTRUCTIONS,
        tools: this.opts.toolSchemas,
        tool_choice: "auto",
        audio: { input: { turn_detection: this.turnDetection() } },
      },
    });
  }

  // Stop the model mid-answer: cancel generation, then drop unplayed audio.
  private interrupt() {
    if (this.responseActive) this.send({ type: "response.cancel" });
    if (this.audioPlaying) this.send({ type: "output_audio_buffer.clear" });
  }

  setMode(mode: MicMode) {
    this.mode = mode;
    this.setMicEnabled(mode === "open");
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        audio: { input: { turn_detection: this.turnDetection() } },
      },
    });
  }

  pttStart() {
    this.interrupt();
    this.send({ type: "input_audio_buffer.clear" });
    this.pttStartedAt = Date.now();
    this.setMicEnabled(true);
  }

  pttEnd() {
    if (!this.pttStartedAt) return;
    this.setMicEnabled(false);
    const held = Date.now() - this.pttStartedAt;
    this.pttStartedAt = 0;
    if (held < RealtimeCopilot.MIN_PTT_MS) {
      this.send({ type: "input_audio_buffer.clear" });
      return;
    }
    this.send({ type: "input_audio_buffer.commit" });
    this.send({ type: "response.create" });
  }

  // Type a command (also the headless test path). Triggers a model response.
  sendText(text: string) {
    this.interrupt();
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.send({ type: "response.create" });
  }

  private setMicEnabled(on: boolean) {
    if (this.micTrack) this.micTrack.enabled = on;
  }

  // Run every function call in a finished response, return all outputs, then
  // ask for one follow-up response.
  private async runFunctionCalls(output: any[]) {
    const calls = output.filter((item) => item?.type === "function_call");
    if (calls.length === 0) return;
    for (const { name, call_id, arguments: argStr } of calls) {
      let args: unknown = {};
      try {
        args = argStr ? JSON.parse(argStr) : {};
      } catch {
        /* leave as {} */
      }
      const result = await this.opts.runTool(name, args);
      this.send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id, output: result },
      });
    }
    this.send({ type: "response.create" });
  }

  private async onServerEvent(evt: any) {
    this.touchIdle();
    switch (evt.type) {
      case "response.created":
        this.responseActive = true;
        break;
      case "response.done":
        this.responseActive = false;
        if (evt.response?.status === "completed")
          await this.runFunctionCalls(evt.response.output ?? []);
        break;
      case "output_audio_buffer.started":
        this.audioPlaying = true;
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        this.audioPlaying = false;
        break;
      case "error":
        console.error("[copilot] realtime error", evt.error);
        this.opts.onEvent?.(`error: ${evt.error?.message || "unknown"}`);
        break;
      default:
        break;
    }
  }

  disconnect() {
    const dc = this.dc;
    this.dc = null;
    this.responseActive = false;
    this.audioPlaying = false;
    this.pttStartedAt = 0;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    try {
      this.micTrack?.stop();
      dc?.close();
      this.pc?.close();
    } catch {
      /* noop */
    }
    this.micTrack = null;
    this.pc = null;
    if (this.audioEl) {
      this.audioEl.srcObject = null;
      this.audioEl = null;
    }
    if (this.state !== "error") this.setState("idle");
  }
}
