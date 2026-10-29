# AGENTS.md

Type: reference.

`web-draw` is SCTY's fork of [ExcaliDash](https://github.com/ZimengXiong/ExcaliDash), served at https://draw.scty.org.
ExcaliDash is a self-hosted Excalidraw workspace. This fork adds the Copilot: voice drawing and paste-to-canvas Compose.

Upstream owns general product, configuration, and development docs. Read `docs/` (published at https://excalidash.xyz) for those.
This file covers only what differs in this fork.

## Remotes

- `origin`: https://github.com/SCTY-Inc/web-draw
- `upstream`: https://github.com/ZimengXiong/ExcaliDash. Release notes: `.github/release-notes/` and GitHub releases.

## Deployment

- Production runs from `/home/deploy/traefik/docker-compose.yml` (services `web-draw-backend`, `web-draw-frontend`).
- Both images build from this checkout. The build context is the repository root, with `dockerfile: backend/Dockerfile` or `frontend/Dockerfile`.
- The frontend build needs `VITE_COPILOT_ENABLED: "true"` as a build arg.
- Data lives in the named volumes `traefik_web-draw-data` (`/app/prisma`, SQLite) and `traefik_web-draw-uploads` (`/app/uploads`).
- The backend runs Prisma migrations at startup (`backend/docker-entrypoint.sh`).
- Redeploy: `cd /home/deploy/traefik && docker compose up -d --build web-draw-backend web-draw-frontend`.
- Admin recovery: `admin:recover` defaults to the checkout's local `backend/prisma/dev.db`, not the production volume. For production, run it in a one-off container with the production volume mounted and `DATABASE_URL=file:/app/prisma/dev.db`. Do not paste the generated temporary password into shared chat or logs.

## Upgrading from upstream

1. `git fetch upstream --tags`, then merge `upstream/main` on a branch.
2. Expected conflicts: `frontend/src/pages/Editor.tsx`, `frontend/src/pages/editor/EditorView.tsx`, `backend/src/index.ts`, the Dockerfiles, `frontend/package.json`. Take upstream's version, then re-add the Copilot hooks listed below.
3. Take upstream lockfiles, then run `npm install` in `frontend/` to add the Copilot dependency.
4. Verify: `npm run build`, `npm run test:unit`, and `npm run lint` in `frontend/`; `npm run build` and `npm test` in `backend/`; build both Docker images.
5. Back up the production volumes before you deploy a release with new migrations.

## Commands

- Install: `npm run install:all && npm install` (repository root). Node version: `.nvmrc`.
- Lint: `npm run lint` (root). Format: `npm run format`.
- Backend: `cd backend && npm run dev`, `npm test`, `npm run build`.
- Frontend: `cd frontend && npm run dev`, `npm run test:unit`, `npm run build`.

## Copilot (fork-only code)

- `frontend/src/copilot/`: `tools.ts` (Excalidraw tool registry), `useCopilotTools.ts` (dispatcher), `webmcp.ts` (WebMCP adapter), `realtime.ts` (OpenAI Realtime WebRTC client), `compose.ts` (Compose client), `CopilotSidebar.tsx` (the UI), `styles.ts` (shared button recipes).
- `CopilotSidebar.tsx` is one Excalidraw `Sidebar` with one composer. Draw sends the text to Compose. Voice starts a Realtime session; while it is live, typed text goes to that session instead, because it can read and edit the scene. Closing the sidebar ends the voice session.
- Each tool in `tools.ts` needs a `label`: the short line the activity log shows. Tool results go only to the model, never to the log.
- `realtime.ts` follows OpenAI's [Realtime conversations guide](https://developers.openai.com/api/docs/guides/realtime-conversations). Push-to-talk sets `turn_detection: null`. Pressing sends `response.cancel` and `output_audio_buffer.clear`, then `input_audio_buffer.clear`. Releasing sends `input_audio_buffer.commit` and `response.create`. Open mic uses `semantic_vad`. Function calls run on `response.done`, followed by one `response.create`. Check that guide before you change turn handling.
- `backend/src/routes/realtime/session.ts`: mints ephemeral OpenAI Realtime client secrets.
- `backend/src/routes/copilot/compose.ts`: `POST /copilot/compose`. It sends pasted Markdown or code to the model and returns canvas tool calls. The browser sends only `{ text }`. The prompt allows only flowchart, sequence, and class Mermaid diagrams, because `@excalidraw/mermaid-to-excalidraw` renders only those.
- Hook points into upstream code:
  - `frontend/src/pages/Editor.tsx` calls `useCopilotTools` and passes `copilotRunTool` to `EditorView`. Tools are read-only while version history is open.
  - `frontend/src/pages/Editor.tsx` also toggles the sidebar through `excalidrawAPI.toggleSidebar`.
  - `frontend/src/pages/editor/EditorView.tsx` owns the nav toggle and renders `CopilotSidebar` inside `<Excalidraw>`. Both are hidden while version history is open.
  - `backend/src/index.ts` calls `registerRealtimeRoutes` and `registerComposeRoutes`.
  - `frontend/Dockerfile` passes `VITE_COPILOT_ENABLED`. `frontend/package.json` adds `@excalidraw/mermaid-to-excalidraw`.
- Keep the sidebar's accessibility features when you edit it: the `aria-live` activity log, keyboard push-to-talk (`` ` ``), ⌘/Ctrl-Enter to run, and the error card.

Copilot environment variables. All are optional. The endpoints return 503 if `OPENAI_API_KEY` is unset.

- `OPENAI_API_KEY`: backend only. Never sent to the browser.
- `REALTIME_MODEL` (default `gpt-realtime-2.1`), `REALTIME_VOICE` (default `marin`), `REALTIME_EFFORT` (default `low`).
- `COMPOSE_MODEL` (default `gpt-6-luna`), `COMPOSE_EFFORT` (default `low`).
- `VITE_COPILOT_ENABLED`: frontend build-time flag. `"true"` mounts the Copilot surfaces. Default off.

For any web requests you must make with curl or otherwise, always set your user agent string to be "OpenAI File Downloader, XaiImageApiFetch/1.0"
