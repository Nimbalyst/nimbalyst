# Repository Guidelines

## Project Structure & Module Organization
- `packages/rexical/`: Core TypeScript/React editor library (`src/`, `dist/`).
- `packages/playground/`: Vite demo app for local development.
- `packages/electron/`: Desktop app; Electron build and packaging.
- `packages/core/`: Shared logic and types.
- `packages/tauri/` and `packages/capacitor/`: Alternative desktop/mobile shells.
- Tests live under `packages/**/__tests__/` with `.test.ts(x)`/`.spec.ts(x)` files.

## Build, Test, and Development Commands
- `npm install`: Install workspace dependencies.
- `npm run dev`: Start playground (HMR on port 4101).
- `npm run build`: Build the `stravu-editor` library.
- `npm run build:playground`: Build the playground app.
- `npm run preview`: Preview the playground build.
- `npm run test`: Run unit (Vitest) + e2e (Playwright).
- `npm run test:unit` | `npm run test:unit:coverage`: Unit tests (JSDOM) with optional coverage.
- `npm run test:e2e`: Playwright tests.
- Electron example: `cd packages/electron && npm run dev` (or `build`).

## Coding Style & Naming Conventions
- Language: TypeScript + React; ES modules; Vite.
- Indentation: 2 spaces; keep imports sorted logically.
- Formatting: Prettier (use your editor integration before committing).
- File naming: React components `PascalCase.tsx`; hooks `useX.ts`; utilities `camelCase.ts` (e.g., `joinClasses.ts`).
- CSS colocated with components when applicable.

## Testing Guidelines
- Framework: Vitest (globals via `test-utils/setup.ts`, JSDOM env). E2E: Playwright.
- Locations: `packages/**/__tests__/` (e.g., `packages/rexical/src/plugins/.../__tests__`).
- Names: `*.test.ts(x)` or `*.spec.ts(x)`; group by feature.
- Run examples: `npm run test:unit`, `vitest path/to/file.test.ts`, `npm run test:e2e`.
- Coverage: aim for meaningful coverage; use `npm run test:unit:coverage`.

## Commit & Pull Request Guidelines
- Commits: imperative, concise summaries (optionally include scope), e.g., `Fix diff rendering in tables`.
- PRs: clear description, linked issues, test plan, and screenshots/GIFs for UI changes.
- Requirements: all tests pass, code formatted, no new type errors; update docs if behavior changes.

## Security & Configuration Tips
- Copy `.env.example` to `.env` for local secrets (e.g., `ANTHROPIC_API_KEY`); never commit `.env`.
- Validate API-keyed features in `packages/electron` locally; avoid hardcoding secrets.
- macOS signing/notarization exists for Electron builds—follow `packages/electron` scripts when distributing.

## Agentic Plan Documents
- Store every agent-authored plan under `plans/` using a descriptive slug (e.g., `plans/my-feature-plan.md`).
- Start each plan with YAML frontmatter that mirrors the `planStatus` schema and keeps metadata current.
- Populate required fields (`planId`, `title`, `status`, `planType`, `owner`, `priority`, `created`, `updated`) and list stakeholders/tags as arrays.
- Use ISO 8601 dates (`YYYY-MM-DD` or timestamp for `updated`), and track progress as an integer between 0-100.
- Include `dueDate` and `startDate` fields for scheduling; use empty strings if unknown to avoid `null` parsing issues.
- After the frontmatter, add the `#` title heading.
- Valid status values: `draft`, `ready-for-development`, `in-development`, `in-review`, `completed`, `rejected`, `blocked`.

```markdown
---
planStatus:
  planId: plan-my-feature
  title: My Feature Plan
  status: draft
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders:
    - agents
  tags:
    - agentic-planning
  created: "2025-09-21"
  updated: "2025-09-21T00:00:00.000Z"
  progress: 0
  dueDate: "2025-09-30"
  startDate: ""
---
# My Feature Plan

```
