// WebMCP adapter (webmcp.dev). The webmcp.js script exposes a global `mcp` with
// `registerTool(name, config, handler)`, letting external MCP clients (e.g. Claude
// Desktop) drive this page. We register the SAME tool registry used by the voice
// layer, so both surfaces share one definition.
//
// Guarded by design: if the webmcp.js script isn't loaded, this is a no-op — the
// voice co-pilot does not depend on WebMCP being present. To enable the external
// MCP surface, include the webmcp.js script (the widget self-initialises).
import { COPILOT_TOOLS } from "./tools";

type WebMcpGlobal = {
  registerTool: (
    name: string,
    config: { description?: string; inputSchema?: Record<string, unknown> },
    handler: (args: unknown) => Promise<unknown> | unknown,
  ) => void | (() => void);
};

function getWebMcp(): WebMcpGlobal | null {
  const g = (globalThis as any).mcp;
  return g && typeof g.registerTool === "function" ? (g as WebMcpGlobal) : null;
}

/**
 * Register all co-pilot tools with WebMCP if available.
 * @param dispatch shared dispatcher (same handlers the voice layer uses)
 * @returns cleanup that unregisters where the API supports it
 */
export function registerToolsWithWebMCP(
  dispatch: (name: string, args: unknown) => Promise<string>,
): () => void {
  const mcp = getWebMcp();
  if (!mcp) return () => {};

  const disposers: Array<() => void> = [];
  for (const tool of COPILOT_TOOLS) {
    try {
      const maybeDispose = mcp.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        async (args: unknown) => {
          const result = await dispatch(tool.name, args);
          // WebMCP expects MCP-style content.
          return { content: [{ type: "text", text: result }] };
        },
      );
      if (typeof maybeDispose === "function") disposers.push(maybeDispose);
    } catch (err) {
      console.warn(`[copilot] WebMCP registerTool(${tool.name}) failed`, err);
    }
  }
  return () => disposers.forEach((d) => d());
}
