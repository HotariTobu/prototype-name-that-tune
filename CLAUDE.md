# CLAUDE.md

See @README.md for project overview and game rules.

## Principles

- **Prototype-first** — Prioritize getting things working quickly over polish or robustness
- **Bun-native** — Use Bun's built-in bundler, dev server, and HMR. Do not add Vite, webpack, or any other bundler
- **Single process** — Everything runs in one Bun.serve() process: Socket.IO, static file serving
- **Stateless server** — All state lives in memory. No database, no persistence
- **Host device as audio source** — Music playback happens only in the host's browser. The server never touches audio
- **Server as source of truth** — Game state (scores, rounds, room management) is managed by the server
- **Function over form** — UI should be minimal and functional. Don't spend time on aesthetics
- **No tests** — This is a prototype. Skip tests entirely

## Conventions

- All code, comments, and commit messages in English
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat: add room creation`, `fix: score calculation`)
- Code layout:
  - `src/index.ts` — Server entry point (Bun.serve)
  - `src/frontend.tsx` — Client entry point (React root)
  - `src/server/` — Server modules: Socket.IO handlers, game logic
  - `src/client/` — Client modules: React components, client-side logic
  - `src/shared/` — Shared types between server and client (e.g. Socket.IO event types)
