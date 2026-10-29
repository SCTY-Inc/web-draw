// Copilot: one Excalidraw sidebar for every way of asking the AI to draw.
// The composer drafts with Compose (paste markdown/code or describe a diagram).
// The mic starts a voice session; while it is live, typed messages go to that
// session instead, because it can read and edit the scene. Everything flows
// through the same runTool dispatcher as WebMCP.
import { useEffect, useRef, useState } from "react";
import { Sidebar } from "@excalidraw/excalidraw";
import {
  AlertTriangle,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import type { RunTool } from "./useCopilotTools";
import { RealtimeCopilot, type CopilotState, type MicMode } from "./realtime";
import { TOOLS_BY_NAME, realtimeToolSchemas } from "./tools";
import { requestCompose } from "./compose";
import { BTN_PRIMARY, BTN_SECONDARY } from "./styles";

export const COPILOT_SIDEBAR = "copilot";

const STATE_META: Record<CopilotState, { label: string; dot: string }> = {
  idle: { label: "Voice off", dot: "bg-neutral-400" },
  connecting: { label: "Connecting…", dot: "bg-amber-500" },
  live: { label: "Voice live", dot: "bg-emerald-500" },
  error: { label: "Voice error", dot: "bg-rose-500" },
};

// Map a raw connection failure to a plain-language, actionable message.
// A denied/absent mic is NOT an error (realtime.ts falls back to text-only),
// so the error state is always a session-mint or voice-service negotiation failure.
function friendlyError(detail?: string): string {
  const d = detail || "";
  if (/session mint failed|csrf|\b401\b|\b403\b/i.test(d))
    return "Couldn't start voice. You may need to sign in again, then retry.";
  if (/SDP|realtime|openai/i.test(d))
    return "Couldn't reach the voice service. Check your connection and try again.";
  if (/network|failed to fetch|load failed/i.test(d))
    return "Network problem reaching the copilot. Check your connection and try again.";
  return "Voice couldn't connect. Try again in a moment.";
}

const isTyping = () => {
  const el = document.activeElement as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable)
  );
};

export function CopilotSidebar({
  runTool,
  docked,
  onDock,
  onStateChange,
}: {
  runTool: RunTool;
  docked: boolean;
  onDock: (docked: boolean) => void;
  onStateChange: (open: boolean) => void;
}) {
  return (
    <Sidebar
      name={COPILOT_SIDEBAR}
      docked={docked}
      onDock={onDock}
      onStateChange={(state) => onStateChange(state?.name === COPILOT_SIDEBAR)}
    >
      <Sidebar.Header>
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-neutral-900 dark:text-neutral-100">
          <Sparkles
            size={16}
            className="text-indigo-600 dark:text-indigo-400"
          />
          Copilot
        </span>
      </Sidebar.Header>
      <CopilotBody runTool={runTool} />
    </Sidebar>
  );
}

function CopilotBody({ runTool }: { runTool: RunTool }) {
  const [state, setState] = useState<CopilotState>("idle");
  const [errorDetail, setErrorDetail] = useState<string | undefined>();
  const [micAvailable, setMicAvailable] = useState(true);
  const [micMode, setMicMode] = useState<MicMode>("ptt");
  const [talking, setTalking] = useState(false);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const rtRef = useRef<RealtimeCopilot | null>(null);

  const pushLog = (line: string) => setLog((l) => [line, ...l].slice(0, 8));
  // Tool results are for the model; the user sees one plain line per action.
  const runAndLog = async (name: string, args: unknown) => {
    const r = await runTool(name, args);
    pushLog(TOOLS_BY_NAME[name]?.label ?? name);
    return r;
  };
  const micOn = () => {
    rtRef.current?.pttStart();
    setTalking(true);
  };
  const micOff = () => {
    rtRef.current?.pttEnd();
    setTalking(false);
  };

  // Closing the sidebar unmounts this body and ends any voice session.
  useEffect(() => () => rtRef.current?.disconnect(), []);

  const live = state === "live";
  const voiceOn = state === "connecting" || live;

  // Open mic lets the server detect turns; push-to-talk sends a turn only
  // while the button or the ` key is held.
  useEffect(() => {
    if (!live || !micAvailable) return;
    rtRef.current?.setMode(micMode);
    setTalking(false);
  }, [micMode, live, micAvailable]);

  // Hold ` to talk. Captured before Excalidraw's key handlers, and ignored while
  // typing so the composer and canvas shortcuts keep working.
  useEffect(() => {
    if (!live || micMode !== "ptt" || !micAvailable) return;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Backquote" || e.repeat || isTyping()) return;
      e.preventDefault();
      e.stopPropagation();
      micOn();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Backquote") return;
      e.preventDefault();
      e.stopPropagation();
      micOff();
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      micOff();
    };
  }, [live, micMode, micAvailable]);

  const startVoice = async () => {
    // Dispose any stale instance (e.g. one left over from a prior error) so retry works.
    rtRef.current?.disconnect();
    setErrorDetail(undefined);
    setMicAvailable(true);
    const rt = new RealtimeCopilot({
      toolSchemas: realtimeToolSchemas(),
      runTool: runAndLog,
      onState: (s, detail) => {
        setState(s);
        setErrorDetail(s === "error" ? detail : undefined);
      },
      onEvent: (label) => {
        // The status row already shows a missing mic.
        if (label.startsWith("no mic")) setMicAvailable(false);
        else pushLog(label);
      },
    });
    rtRef.current = rt;
    await rt.connect();
  };

  const stopVoice = () => {
    rtRef.current?.disconnect();
    rtRef.current = null;
    setState("idle");
    setErrorDetail(undefined);
  };

  const compose = async (input: string) => {
    setComposing(true);
    try {
      const calls = await requestCompose(input);
      if (calls.length === 0) pushLog("Nothing to draw from that input.");
      for (const c of calls) await runAndLog(c.name, c.args);
      setText("");
    } catch (e: any) {
      pushLog(`Couldn't draw: ${e?.message || "unknown error"}`);
    } finally {
      setComposing(false);
    }
  };

  const submit = () => {
    const t = text.trim();
    if (!t || composing) return;
    if (live && rtRef.current) {
      pushLog(`you: ${t}`);
      rtRef.current.sendText(t);
      setText("");
      return;
    }
    void compose(t);
  };

  const meta = STATE_META[state];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 pt-0">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        rows={5}
        spellCheck={false}
        placeholder={
          live
            ? "Type to the voice session…"
            : "Describe a diagram or paste text…"
        }
        aria-label={live ? "Message the voice session" : "Text to draw"}
        className="w-full resize-y rounded-xl border-2 border-black bg-slate-50 px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-indigo-500"
      />

      <div className="flex items-center gap-2">
        {voiceOn ? (
          <button
            type="button"
            onClick={stopVoice}
            title="End the voice session"
            className={BTN_SECONDARY}
          >
            <PhoneOff size={15} />
            {state === "connecting" ? "Cancel" : "End voice"}
          </button>
        ) : (
          <button
            type="button"
            onClick={startVoice}
            title="Start a voice session"
            className={BTN_SECONDARY}
          >
            <Mic size={15} /> Voice
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          title="Run (⌘/Ctrl + Enter)"
          disabled={composing || !text.trim()}
          className={`ml-auto ${BTN_PRIMARY} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0`}
        >
          {composing ? (
            <Loader2 size={15} className="animate-spin" />
          ) : live ? (
            <Send size={15} />
          ) : (
            <Sparkles size={15} />
          )}
          {composing ? "Drawing…" : live ? "Send" : "Draw"}
        </button>
      </div>

      {state === "error" ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border-2 border-rose-600 bg-rose-50 p-2.5 text-xs font-bold text-rose-600 dark:border-rose-500 dark:bg-rose-900/20 dark:text-rose-400"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="leading-relaxed">{friendlyError(errorDetail)}</p>
            <button
              type="button"
              onClick={startVoice}
              className="mt-2 inline-flex items-center gap-1 rounded-lg border-2 border-rose-600 px-2 py-1 text-rose-700 transition-all hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:border-rose-500 dark:text-rose-300 dark:hover:bg-rose-900/40"
            >
              <RotateCcw size={13} /> Try again
            </button>
          </div>
        </div>
      ) : null}

      {voiceOn ? (
        <div className="flex flex-wrap items-center gap-2">
          <span
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1 text-xs font-bold text-neutral-500 dark:text-neutral-400"
          >
            <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
          {live && !micAvailable ? (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-neutral-500 dark:text-neutral-400">
              <MicOff size={13} /> No microphone. Type instead.
            </span>
          ) : null}
          {live && micAvailable && micMode === "ptt" ? (
            <button
              type="button"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture?.(e.pointerId);
                micOn();
              }}
              onPointerUp={micOff}
              onPointerLeave={micOff}
              onPointerCancel={micOff}
              onKeyDown={(e) => {
                if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                  e.preventDefault();
                  micOn();
                }
              }}
              onKeyUp={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  micOff();
                }
              }}
              aria-pressed={talking}
              title="Hold to talk (or hold the ` key)"
              className={`inline-flex select-none items-center gap-1.5 rounded-xl border-2 border-black px-3 py-1 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                talking ? "bg-emerald-700" : "bg-emerald-600"
              }`}
            >
              {talking ? (
                <span className="h-2 w-2 rounded-full bg-white motion-safe:animate-pulse" />
              ) : (
                <Mic size={13} />
              )}
              {talking ? "Talking…" : "Hold to talk"}
            </button>
          ) : null}
          {live && micAvailable ? (
            <button
              type="button"
              onClick={() => setMicMode((m) => (m === "ptt" ? "open" : "ptt"))}
              title="Switch between hold-to-talk and always listening"
              className="ml-auto inline-flex items-center gap-1 rounded-lg border-2 border-neutral-300 px-2 py-1 text-xs font-bold text-neutral-600 transition-all hover:border-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-500"
            >
              {micMode === "ptt" ? <Mic size={13} /> : <Radio size={13} />}
              {micMode === "ptt" ? "Push-to-talk" : "Open mic"}
            </button>
          ) : null}
        </div>
      ) : null}

      {log.length > 0 ? (
        <div
          role="log"
          aria-live="polite"
          aria-atomic="false"
          aria-label="Copilot activity"
          className="max-h-40 space-y-0.5 overflow-auto rounded-xl border-2 border-neutral-200 bg-neutral-50 p-2 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
        >
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
