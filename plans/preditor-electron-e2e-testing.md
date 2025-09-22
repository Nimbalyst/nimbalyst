---
planStatus:
  planId: plan-preditor-electron-e2e
  title: Preditor Electron E2E Testing
  status: in-development
  planType: testing
  priority: high
  owner: ghinkle
  stakeholders:
    - platform
    - qa
    - preditor-team
  tags:
    - electron
    - e2e
    - testing
    - automation
  created: "2025-09-21"
  updated: "2025-09-22T16:45:00Z"
  progress: 40
  dueDate: ""
  startDate: ""
---
# Preditor Electron E2E Testing
<!-- plan-status -->

## Context & Objectives
- Establish reliable end-to-end coverage for the Preditor Electron app, beginning with a single smoke test that exercises the core Markdown editing flow.
- Validate that the chosen tooling scales to cover multi-window editor workflows, plugin interactions, and cross-platform packaging builds.
- Integrate the suite into CI for regression detection without slowing daily development.

## Tooling Decision
- **__Recommendation__**: Adopt Playwright's Electron automation (`@playwright/test` + `electron.launch`) as the primary UI test framework.
- **__Why Playwright__**:
    - Native Electron support with automatic waiting, trace capture, and parallelism out of the box.
    - First-class TypeScript API and existing workspace dependency (`npm run test:e2e` already sets up Playwright for web), reducing onboarding friction.
    - Built-in screenshot/video artifacts ease debugging flaky editor scenarios.
- **__Alternatives Considered__**:
    - Spectron: deprecated and pinned to old Electron versions; lacks maintainers.
    - WebdriverIO + wdio-electron: heavier configuration; weaker tracing/story for interactive debugging.
    - TestCafe: browser-focused with limited Electron-specific hooks.
- **__Action__**: Extend the current Playwright configuration with an Electron-specific project that targets the Preditor binary.

## Milestones
1. **__Foundation__**
    - Add Electron project entry in `playwright.config.ts` with launch script pointing to `packages/electron/dist/main`.
    - Stand up shared test utilities for app bootstrapping and state reset.
2. **__First Smoke Test__**
    - Author `packages/electron/__tests__/e2e/preditor-smoke.spec.ts`.
    - Assert the editor loads, accepts markdown input, and renders preview output.
3. **__Stabilization__**
    - Enable Playwright trace/screenshot retention on failure.
    - Introduce retry policy for known flaky startup paths.
4. **__CI Integration__**
    - Update GitHub Actions workflow to build Electron in CI cache and run the Electron Playwright project on macOS + Windows runners.
    - Publish artifacts (traces, videos) for failed runs.
5. **__Coverage Expansion__**
    - Capture critical regression paths: file open/save, diff plugin flows, AI assistant interactions, export pipelines.
    - Target 10 high-value scenarios by end of first quarter.

## Initial Test Scenario
- **__Test Name__**: `preditor-smoke.spec.ts`
- **__Setup__**:
- Build Electron bundle once per test run (`npm run build --workspace packages/electron`).
- Launch via Playwright's Electron `electronApp = await electron.launch({ args: ['.'] })` using the packaged main process entry.
- **__Steps__**:
1. Wait for the main window and ensure the default workspace loads without fatal toast errors.
2. Focus the primary editor surface, type markdown (`## Heading` + bullet list) using Playwright keyboard actions.
3. Trigger preview toggle (toolbar button or shortcut) and verify rendered HTML contains `h2` and `li` elements.
4. Ensure undo/redo via keyboard shortcuts functions without errors in the console.
5. Capture screenshot and attach Playwright trace.
- **__Assertions__**:
- Toolbar commands present (`Bold`, `Italic`, `AI` buttons) to ensure plugin rendering.
- Preview pane shows converted markdown matching typed content.
- No console errors (`consoleMessage.type() === 'error'`).
- **__Artifacts__**: Configure `test.use({ trace: 'on-first-retry', screenshot: 'only-on-failure', video: 'retain-on-failure' })` for the Electron project.

## Test Harness Work
- Add `tests/e2e/electron/appLauncher.ts` helper to:
- Resolve Electron binary path (dev vs CI) and orchestrate temporary workspaces.
- Provide APIs for clearing local storage/session files between runs.
- Extend shared Playwright fixtures with:
- `electronApp` (lifecycle-managed) and `mainWindow` references.
- Utility to wait for Lexical editor readiness (`waitForEditorReady` by inspecting root node state or DOM attribute `data-editor-ready`).
- Wire mock/stub layer for network requests (AI endpoints) using Playwright's route interception to avoid external dependencies.

## CI & Tooling
- Modify `.github/workflows/test.yml` (or create `test-e2e-electron.yml`) to:
- Install system dependencies (Xvfb on Linux runners if needed; code signing bypass for CI builds).
- Cache Electron build artifacts and Playwright browsers (`npx playwright install --with-deps`).
- Run the Electron Playwright project in parallel with existing web e2e.
- Emit JUnit XML for integration with dashboards (Playwright `reporter: [['junit', { outputFile: 'reports/electron-e2e.xml' }]]`).
- Store failure artifacts via workflow `actions/upload-artifact`.

## Coverage Roadmap
- **__Core Flows__**: document open/save, diff visualization, collaborative session join, export to markdown/pdf.
- **__Plugins__**: AI assistant prompts, table diff plugin interactions, metadata frontmatter editing.
- **__Regression Suites__**: window resizing, recovery after crash, offline mode behavior, multi-tab editing.
- **__Performance Watchpoints__**: measure time-to-editor-ready and typing latency using Playwright's tracing metrics; set budget alerts.

## Risks & Mitigations
- Electron startup duration variability → Warm cache builds locally and prebuild in CI; increase Playwright `timeout` for first window attach.
- Flaky animations and async plugin loads → Use Playwright locators with expect polling and disable non-essential animations in `app.whenReady` for test env.
- AI/network dependencies → Stub HTTP endpoints; provide deterministic responses in tests.
- Platform differences (macOS vs Windows) → Cover shortcuts per platform; run periodic smoke tests on all target OSes.

## Next Actions
1. Add Electron project configuration to Playwright and commit scaffolding.
2. Implement `appLauncher` helper and smoke spec; verify locally via `npm run test:e2e -- --project=electron`.
3. Set up CI workflow with artifact retention; mark milestone complete after green run.

## Status Updates

- **2025-09-22**: Added `playwright.config.ts`, documented the workflow in `docs/PLAYWRIGHT.md`, referenced commands in `README.md`, and built the `packages/electron/tests/e2e/autosave-navigation.spec.cjs` regression that exercises autosave before tab navigation.
