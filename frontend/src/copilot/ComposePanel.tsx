// Compose panel: paste markdown or code, and a size-routed GPT-5.5 model maps it
// onto the canvas (Mermaid diagram or loose shapes — the model decides). The bottom-
// right launcher that used to open the voice co-pilot now opens this; voice moved to
// the top nav. Output flows through the same runTool dispatcher as voice/WebMCP.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FileCode2, Loader2, Sparkles, X } from "lucide-react";
import type { RunTool } from "./useCopilotTools";
import { requestCompose } from "./compose";
import { BTN_PRIMARY } from "./styles";

type Status = "idle" | "working" | "error";

export function ComposePanel({
  runTool,
  open,
  onOpenChange,
}: {
  runTool: RunTool;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [text, setText] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const fabRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const wasOpen = useRef(false);

  const pushLog = (line: string) => setLog((l) => [line, ...l].slice(0, 14));

  // Focus into the panel on open, back to the launcher on close.
  useEffect(() => {
    if (open) panelRef.current?.focus();
    else if (wasOpen.current) fabRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const compose = async () => {
    const t = text.trim();
    if (!t || status === "working") return;
    setStatus("working");
    pushLog(`composing ${t.length} chars…`);
    try {
      const calls = await requestCompose(t);
      if (calls.length === 0) {
        pushLog("Nothing to draw from that input.");
        setStatus("idle");
        return;
      }
      for (const c of calls) {
        const r = await runTool(c.name, c.args);
        pushLog(`${c.name}: ${r}`);
      }
      setText("");
      setStatus("idle");
    } catch (e: any) {
      pushLog(`error: ${e?.message || "compose failed"}`);
      setStatus("error");
    }
  };

  if (!open) {
    return (
      <button
        ref={fabRef}
        type="button"
        onClick={() => onOpenChange(true)}
        title="Compose — paste markdown or code to map it onto the canvas"
        aria-label="Open Compose"
        className={`fixed bottom-4 right-4 z-50 ${BTN_PRIMARY} px-4 py-2 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] active:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]`}
        data-testid="compose-open"
      >
        <FileCode2 size={16} /> Compose
      </button>
    );
  }

  const working = status === "working";

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Compose"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onOpenChange(false);
        }
      }}
      className="fixed bottom-4 right-4 z-50 w-[min(26rem,calc(100vw-2rem))] rounded-2xl border-2 border-black bg-white p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] animate-in fade-in zoom-in-95 duration-200 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.06)]"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-neutral-900 dark:text-neutral-100">
          <FileCode2
            size={16}
            className="text-indigo-600 dark:text-indigo-400"
          />{" "}
          Compose
        </span>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="rounded-lg border-2 border-transparent p-1 text-neutral-400 transition-all hover:border-black hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:border-neutral-600 dark:hover:text-white"
          aria-label="Close Compose"
        >
          <X size={18} />
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            compose();
          }
        }}
        rows={6}
        placeholder="Paste markdown or code… Compose will map it onto the canvas."
        aria-label="Text to compose"
        data-testid="compose-text"
        spellCheck={false}
        className="w-full resize-y rounded-xl border-2 border-black bg-slate-50 px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-900 placeholder:font-sans placeholder:text-slate-400 transition-all focus:border-indigo-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-indigo-500"
      />

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={compose}
          disabled={working || !text.trim()}
          data-testid="compose-run"
          className={`${BTN_PRIMARY} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]`}
        >
          {working ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Sparkles size={15} />
          )}
          {working ? "Composing…" : "Compose"}
        </button>
        <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <kbd className="rounded border-2 border-neutral-300 px-1 font-bold dark:border-neutral-600">
            ⌘/Ctrl
          </kbd>
          +
          <kbd className="rounded border-2 border-neutral-300 px-1 font-bold dark:border-neutral-600">
            ↵
          </kbd>
        </span>
      </div>

      {status === "error" && (
        <div
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-xl border-2 border-rose-600 bg-rose-50 p-2.5 text-xs font-bold text-rose-600 dark:border-rose-500 dark:bg-rose-900/20 dark:text-rose-400"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <p className="leading-relaxed">
            Compose couldn’t finish — see the log below, then try again.
          </p>
        </div>
      )}

      <div
        role="log"
        aria-live="polite"
        aria-label="Compose activity"
        className="mt-2 max-h-40 overflow-auto rounded-xl border-2 border-neutral-200 bg-neutral-50 p-2 font-mono text-[11px] text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
        data-testid="compose-log"
      >
        {log.length === 0 ? (
          <div className="font-sans font-medium text-neutral-500 dark:text-neutral-400">
            Paste something, then Compose…
          </div>
        ) : (
          log.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </div>
  );
}
