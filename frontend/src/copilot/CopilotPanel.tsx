// Voice/text co-pilot plus a raw tool runner, toggled from the editor nav.
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Mic,
  MicOff,
  Radio,
  RotateCcw,
  Send,
  Wrench,
  X,
} from "lucide-react";
import type { RunTool } from "./useCopilotTools";
import { RealtimeCopilot, type CopilotState } from "./realtime";
import { realtimeToolSchemas } from "./tools";
import { BTN_PRIMARY, BTN_SECONDARY } from "./styles";

const TOOL_EXAMPLES = [
  '{"tool":"add_elements","args":{"skeletons":[{"type":"rectangle","x":100,"y":100,"width":160,"height":80,"label":{"text":"API"}}]}}',
  '{"tool":"get_scene","args":{}}',
  '{"tool":"set_viewport","args":{"fit":"all"}}',
];

const STATE_META: Record<CopilotState, { label: string; dot: string }> = {
  idle: { label: "Idle", dot: "bg-neutral-400" },
  connecting: { label: "Connecting…", dot: "bg-amber-500" },
  live: { label: "Live", dot: "bg-emerald-500" },
  error: { label: "Error", dot: "bg-rose-500" },
};

// Map a raw connection failure to a plain-language, actionable message.
// A denied/absent mic is NOT an error (realtime.ts falls back to text-only),
// so the error state is always a session-mint or voice-service negotiation failure.
function friendlyError(detail?: string): string {
  const d = detail || "";
  if (/session mint failed|csrf|\b401\b|\b403\b/i.test(d))
    return "Couldn't start a session — you may need to sign in again, then retry.";
  if (/SDP|realtime|openai/i.test(d))
    return "Couldn't reach the voice service. Check your connection and try again.";
  if (/network|failed to fetch|load failed/i.test(d))
    return "Network problem reaching the co-pilot. Check your connection and try again.";
  return "The co-pilot couldn't connect. Try again in a moment.";
}

export function CopilotPanel({
  runTool,
  open,
  onClose,
}: {
  runTool: RunTool;
  open: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<CopilotState>("idle");
  const [errorDetail, setErrorDetail] = useState<string | undefined>();
  const [micAvailable, setMicAvailable] = useState(true);
  const [log, setLog] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [dev, setDev] = useState(false);
  const [toolInput, setToolInput] = useState(TOOL_EXAMPLES[0]);
  const [talking, setTalking] = useState(false);
  const [micMode, setMicMode] = useState<"ptt" | "open">("ptt");
  const rtRef = useRef<RealtimeCopilot | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const pushLog = (line: string) => setLog((l) => [line, ...l].slice(0, 14));
  const micOn = () => {
    rtRef.current?.setMicEnabled(true);
    setTalking(true);
  };
  const micOff = () => {
    rtRef.current?.setMicEnabled(false);
    setTalking(false);
  };

  useEffect(() => () => rtRef.current?.disconnect(), []);

  // Move focus into the panel when it opens so keyboard/screen-reader users land here.
  // Focus return on close is handled by the Editor (it owns the nav toggle that opened us).
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // Keyboard push-to-talk: hold ` (Backquote) to talk. Captured before Excalidraw's
  // own key handlers, and ignored while typing in an input/textarea so the text box
  // and canvas shortcuts keep working.
  // Open-mic mode: keep the mic continuously on (Realtime server-VAD detects turns).
  // PTT mode: mic stays muted until a key/button is held.
  useEffect(() => {
    if (state !== "live" || !micAvailable) return;
    if (micMode === "open") micOn();
    else micOff();
  }, [micMode, state, micAvailable]);

  useEffect(() => {
    if (state !== "live" || micMode !== "ptt" || !micAvailable) return;
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      );
    };
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
  }, [state, micMode, micAvailable]);

  const start = async () => {
    if (state === "connecting" || state === "live") return;
    // Dispose any stale instance (e.g. one left over from a prior error) so retry works.
    rtRef.current?.disconnect();
    rtRef.current = null;
    setErrorDetail(undefined);
    setMicAvailable(true);
    const rt = new RealtimeCopilot({
      toolSchemas: realtimeToolSchemas(),
      runTool: async (name, args) => {
        const r = await runTool(name, args);
        pushLog(`tool · ${name}: ${r}`);
        return r;
      },
      onState: (s, detail) => {
        setState(s);
        setErrorDetail(s === "error" ? detail : undefined);
        if (detail) pushLog(`${s}: ${detail}`);
      },
      onEvent: (label) => {
        if (label.startsWith("no mic")) setMicAvailable(false);
        pushLog(label);
      },
    });
    rtRef.current = rt;
    await rt.connect();
  };

  const stop = () => {
    rtRef.current?.disconnect();
    rtRef.current = null;
    setState("idle");
    setErrorDetail(undefined);
  };

  const retry = async () => {
    stop();
    await start();
  };

  const sendText = () => {
    const t = text.trim();
    if (!t || !rtRef.current || state !== "live") return;
    pushLog(`you: ${t}`);
    rtRef.current.sendText(t);
    setText("");
  };

  const runToolJson = async () => {
    try {
      const parsed = JSON.parse(toolInput);
      const r = await runTool(parsed.tool, parsed.args ?? {});
      pushLog(`tool · ${parsed.tool}: ${r}`);
    } catch (e: any) {
      pushLog(`error: ${e?.message || "invalid JSON"}`);
    }
  };

  if (!open) return null;

  const live = state === "live";
  const meta = STATE_META[state];

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Co-pilot"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border-2 border-black bg-white p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] animate-in fade-in zoom-in-95 duration-200 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.06)]"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-neutral-900 dark:text-neutral-100">
          <Bot size={16} className="text-indigo-600 dark:text-indigo-400" />{" "}
          Co-pilot
          <span
            role="status"
            aria-live="polite"
            className="ml-1 inline-flex items-center gap-1 text-xs font-bold text-neutral-500 dark:text-neutral-400"
          >
            <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border-2 border-transparent p-1 text-neutral-400 transition-all hover:border-black hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:border-neutral-600 dark:hover:text-white"
          aria-label="Close co-pilot"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {state === "idle" || state === "error" ? (
          <button
            type="button"
            onClick={start}
            data-testid="copilot-start"
            className={BTN_PRIMARY}
          >
            Start co-pilot
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            data-testid="copilot-stop"
            className={BTN_SECONDARY}
          >
            {state === "connecting" ? "Cancel" : "Stop"}
          </button>
        )}
        {live && micAvailable && micMode === "ptt" && (
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
            aria-label="Hold to talk"
            data-testid="copilot-ptt"
            title="Hold to talk (or hold the ` key)"
            className={`inline-flex select-none items-center gap-1.5 rounded-xl border-2 border-black px-3 py-1.5 text-sm font-bold text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900 ${
              talking
                ? "bg-emerald-700"
                : "bg-emerald-600 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-y-0"
            }`}
          >
            {talking ? (
              <>
                <span className="h-2 w-2 rounded-full bg-white motion-safe:animate-pulse" />{" "}
                Talking…
              </>
            ) : (
              <>
                <Mic size={15} /> Hold to talk
              </>
            )}
          </button>
        )}
        {live && micAvailable && micMode === "open" && (
          <span
            className="inline-flex select-none items-center gap-1.5 rounded-xl border-2 border-emerald-600 bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-300"
            data-testid="copilot-listening"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />{" "}
            Listening
          </span>
        )}
        {live && micAvailable && (
          <button
            type="button"
            onClick={() => setMicMode((m) => (m === "ptt" ? "open" : "ptt"))}
            data-testid="copilot-micmode"
            className="ml-auto inline-flex items-center gap-1 rounded-lg border-2 border-neutral-300 px-2 py-1.5 text-xs font-bold text-neutral-600 transition-all hover:border-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-500"
            title="Switch between hold-to-talk and always-listening"
          >
            {micMode === "ptt" ? (
              <>
                <Mic size={13} /> Push-to-talk
              </>
            ) : (
              <>
                <Radio size={13} /> Open mic
              </>
            )}
          </button>
        )}
      </div>
      {live && micAvailable && micMode === "ptt" && (
        <p className="mt-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          Hold{" "}
          <kbd className="rounded border-2 border-neutral-300 px-1 font-bold dark:border-neutral-600">
            `
          </kbd>{" "}
          or the button to talk.
        </p>
      )}

      {live && !micAvailable && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border-2 border-neutral-200 bg-neutral-50 p-2 text-xs font-bold text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
          <MicOff size={14} className="shrink-0" /> No microphone — type your
          request below.
        </div>
      )}

      {state === "error" && (
        <div
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-xl border-2 border-rose-600 bg-rose-50 p-3 text-xs font-bold text-rose-600 dark:border-rose-500 dark:bg-rose-900/20 dark:text-rose-400"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="leading-relaxed">{friendlyError(errorDetail)}</p>
            <button
              type="button"
              onClick={retry}
              data-testid="copilot-retry"
              className="mt-2 inline-flex items-center gap-1 rounded-lg border-2 border-rose-600 px-2 py-1 text-rose-700 transition-all hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:border-rose-500 dark:text-rose-300 dark:hover:bg-rose-900/40"
            >
              <RotateCcw size={13} /> Try again
            </button>
          </div>
        </div>
      )}

      {live && (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendText()}
            placeholder="Tell the co-pilot… (e.g. draw the auth flow)"
            aria-label="Message the co-pilot"
            data-testid="copilot-text"
            className="flex-1 rounded-xl border-2 border-black bg-slate-50 px-3 py-1.5 text-sm font-bold text-slate-900 placeholder:font-medium placeholder:text-slate-400 transition-all focus:border-indigo-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={sendText}
            data-testid="copilot-send"
            aria-label="Send message"
            className={BTN_PRIMARY}
          >
            <Send size={15} /> Send
          </button>
        </div>
      )}

      <div
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-label="Co-pilot activity"
        className="mt-2 max-h-40 overflow-auto rounded-xl border-2 border-neutral-200 bg-neutral-50 p-2 font-mono text-[11px] text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
        data-testid="copilot-log"
      >
        {log.length === 0 ? (
          <div className="font-sans font-medium text-neutral-500 dark:text-neutral-400">
            Start the co-pilot, then talk or type…
          </div>
        ) : (
          log.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>

      <button
        type="button"
        onClick={() => setDev((d) => !d)}
        className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-neutral-500 transition-colors hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        {dev ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Wrench size={12} /> {dev ? "Hide dev tools" : "Dev tools"}
      </button>
      {dev && (
        <div className="mt-1.5 flex items-center gap-2">
          <input
            value={toolInput}
            onChange={(e) => setToolInput(e.target.value)}
            spellCheck={false}
            aria-label="Raw tool JSON"
            data-testid="copilot-input"
            className="flex-1 rounded-xl border-2 border-neutral-300 bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-900 focus:border-indigo-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={runToolJson}
            data-testid="copilot-run"
            className="inline-flex items-center rounded-lg border-2 border-black bg-neutral-800 px-2.5 py-1.5 text-xs font-bold text-white transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-neutral-700"
          >
            Run
          </button>
        </div>
      )}
    </div>
  );
}
