# Agent Mistakes Log

## 2026-03-25: Pushed release without full local build verification

**What happened**: Pushed v0.56.14 and v0.56.15 to GitHub without running the full `build:mac:local` or `build:extensions` locally. Only ran `npm run typecheck` and the runtime vite build, which missed:
1. v0.56.14: runtime vite build fails on clean `dist/` due to extension-sdk circular resolution
2. v0.56.15: fixed runtime build but extension-sdk `tsc` fails when `dist/` already exists (TS5055)

**Lesson**: Before pushing a release, ALWAYS run `npm run build:extensions` (or the full `build:mac:local`) locally to verify the complete build pipeline works. Typecheck alone is not sufficient.

**User feedback**: "Given that we can't even build locally, maybe you should stop pushing to github without asking me"
