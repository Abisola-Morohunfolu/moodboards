# Web app

The TanStack Start application for the public landing, signed-in planners and
households, anonymous client links, and board interaction.

- `src/routes` owns file-based routes and the root layout.
- `src/features` owns product behavior grouped by domain.
- `src/components` contains app-specific compositions.
- `src/lib` contains TanStack Start and browser infrastructure.
- `src/styles` contains global styles and semantic light/dark tokens. The root
  [DESIGN.md](../../DESIGN.md) captures the implemented quiet canvas system;
  [design notes](../../docs/08-design.md) summarize it.

Keep transport shapes in `packages/contracts` and reusable presentational
components in `packages/ui`.

Run `pnpm dev:web` from the repository root after starting the API. The local
address is `http://127.0.0.1:3000`. Set `VITE_API_URL` only when the API does
not use `http://127.0.0.1:3001`. The app uses React Query for server state and
Tailwind CSS for its quiet neutral surfaces and blue accent. Instrument Sans is
self-hosted in `public/fonts`. Theme follows the system by default, with a
persisted system/light/dark override.

`/` server-renders the complete public landing and sends signed-in users to
`/boards` after the account query resolves. Its Create a board CTA opens
`/login?mode=signup`; `/login?mode=login` opens sign-in. Authenticated and client
routes retain `ssr: false`. The root creates one QueryClient per App instance,
avoiding a server-shared account cache.

Planner pages fetch account data. The gallery uses query-backed previews from
actual board items, enabled as they approach the viewport, without interval
polling. Desktop editing uses a freeform canvas, contextual tools, and an
inspector; phones use a grid and native protected-focus sheets.
`/share/:token` exchanges a board-specific link and the client viewer
reads only `/client` endpoints. See
[web work unit 6](../../docs/17-web-planner-client-ui.md) for setup and diagrams.
