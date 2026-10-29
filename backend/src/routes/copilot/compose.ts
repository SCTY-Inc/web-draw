// Compose: turn pasted markdown/code into canvas tool calls. The browser posts raw
// text; we reason over it server-side via the OpenAI Responses API, and return the model's tool
// calls for the client to run through its existing runTool dispatcher.
//
// The tool *contract* is owned here (not supplied by the client) so the server decides
// what the model may emit. We expose only the two canvas tools Compose needs and let
// the model choose between them. Frontend calls POST /api/copilot/compose
// (the /api prefix is stripped → /copilot/compose). The OPENAI_API_KEY stays server-side.
import type { Express, Request, Response } from "express";

type Deps = {
  app: Express;
  requireAuth: (
    req: Request,
    res: Response,
    next: (err?: unknown) => void,
  ) => void;
  asyncHandler: (fn: (req: Request, res: Response) => Promise<unknown>) => any;
};

// Mirrors the inputSchema of frontend/src/copilot/tools.ts (add_diagram / add_elements).
// Kept lean and server-owned; the frontend handlers remain the source of truth for
// execution and are defensive about arg shape.
const COMPOSE_TOOLS = [
  {
    type: "function" as const,
    name: "add_diagram",
    description:
      "Render a Mermaid diagram (flowchart, sequence, class, ER, etc.) onto the board. " +
      "Provide valid Mermaid source. Best for structured diagrams; for a few loose shapes use add_elements.",
    parameters: {
      type: "object",
      properties: {
        mermaid: { type: "string", description: "Mermaid diagram source." },
        x: {
          type: "number",
          description: "Optional top-left x offset (default 0).",
        },
        y: {
          type: "number",
          description: "Optional top-left y offset (default 0).",
        },
      },
      required: ["mermaid"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "add_elements",
    description:
      "Add shapes/text/arrows from compact skeletons. Each skeleton: " +
      "{type:'rectangle'|'ellipse'|'diamond'|'text'|'arrow'|'line', x, y, width?, height?, " +
      "label?:{text}, text?, strokeColor?, backgroundColor?}. For connectors use type:'arrow' " +
      "with start:{id} and end:{id}. Coordinates are canvas pixels.",
    parameters: {
      type: "object",
      properties: {
        skeletons: {
          type: "array",
          description: "Array of Excalidraw element skeletons to create.",
          items: { type: "object" },
        },
      },
      required: ["skeletons"],
      additionalProperties: false,
    },
  },
];

const INSTRUCTIONS = [
  "You convert pasted text, markdown, or code into a visual map on an Excalidraw whiteboard.",
  "You MUST call a tool to produce the visual — never reply in prose.",
  "Prefer add_diagram (Mermaid) for anything with structure, hierarchy, or flow; use add_elements",
  "only for a few loose, unstructured shapes.",
  "IMPORTANT: the Mermaid renderer supports ONLY flowchart (graph TD / graph LR), sequenceDiagram,",
  "and classDiagram. Use one of these and nothing else — never mindmap, gantt, pie, journey, or",
  "other types, which fail to render. For hierarchies, taxonomies, or outlines, use a top-down",
  "flowchart (graph TD) with nested nodes.",
  "LAYOUT — build depth, not breadth, so the diagram doesn't sprawl wide and shallow. In a flowchart",
  "each level becomes one row, so a parent with many direct children renders as one very wide row.",
  "Put at most ~5 sibling nodes under any single parent; when there are more, add intermediate",
  "grouping nodes so the tree gains levels instead of one long row. Aim for 3–5 levels of depth, and",
  "cluster related nodes into `subgraph` blocks (they lay out compactly in 2D rather than a single",
  "row). Choose direction by content: `graph LR` for sequential processes/pipelines, `graph TD` for",
  "hierarchies and taxonomies.",
  "Prefer one clear diagram over many scattered shapes. Lay elements out so they don't overlap.",
].join(" ");

// Cap input so a paste can't blow up a model call; generous enough for whole files.
const MAX_INPUT_CHARS = 50_000;

export function registerComposeRoutes({
  app,
  requireAuth,
  asyncHandler,
}: Deps): void {
  app.post(
    "/copilot/compose",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "Compose disabled",
          message: "OPENAI_API_KEY is not configured on the server.",
        });
      }

      const text =
        typeof req.body?.text === "string" ? req.body.text.trim() : "";
      if (!text) {
        return res
          .status(400)
          .json({ error: "Bad request", message: "Provide non-empty `text`." });
      }
      if (text.length > MAX_INPUT_CHARS) {
        return res.status(413).json({
          error: "Too large",
          message: `Input exceeds ${MAX_INPUT_CHARS} characters.`,
        });
      }

      const model = process.env.COMPOSE_MODEL || "gpt-6-luna";
      const effort = process.env.COMPOSE_EFFORT || "low";
      console.log(
        `[compose] ${text.length} chars → ${model} (effort=${effort})`,
      );

      let resp: globalThis.Response;
      try {
        resp = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            instructions: INSTRUCTIONS,
            input: text,
            tools: COMPOSE_TOOLS,
            tool_choice: "auto",
            reasoning: { effort },
            store: false,
          }),
        });
      } catch (err: any) {
        console.error("[compose] network error:", err?.message || err);
        return res.status(502).json({ error: "Compose upstream unreachable" });
      }

      const raw = await resp.text();
      if (!resp.ok) {
        console.error(
          "[compose] responses failed",
          resp.status,
          raw.slice(0, 400),
        );
        return res
          .status(502)
          .json({ error: "Compose request failed", status: resp.status });
      }

      let data: any;
      try {
        data = JSON.parse(raw);
      } catch {
        return res.status(502).json({ error: "Compose returned non-JSON" });
      }

      // Responses API: function calls surface as output items of type "function_call"
      // with `name` and `arguments` (a JSON string). Map them to {name, args}.
      const allowed = new Set(COMPOSE_TOOLS.map((t) => t.name));
      const calls = (Array.isArray(data?.output) ? data.output : [])
        .filter(
          (item: any) =>
            item?.type === "function_call" && allowed.has(item?.name),
        )
        .map((item: any) => {
          let args: unknown = {};
          try {
            args = item.arguments ? JSON.parse(item.arguments) : {};
          } catch {
            /* leave as {} — the client handler is defensive */
          }
          return { name: item.name, args };
        });

      return res.json({ calls });
    }),
  );
}
