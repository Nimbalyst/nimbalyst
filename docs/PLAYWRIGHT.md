# Playwright End-to-End Testing

This repository uses [Playwright](https://playwright.dev) for automated end-to-end coverage across the web playground and the Electron desktop shell.

## Installation

```bash
npm install -D @playwright/test
npx playwright install --with-deps
```

> **Tip:** run these commands at the repository root so all workspace projects share the same Playwright binaries.

## Running Tests

- `npm run test:e2e` runs every Playwright project defined in `playwright.config.ts`.
- `npm run test:e2e -- --project=electron` executes only the Electron scenario.

> **Build first:** make sure `npm run build --workspace @preditor/electron` has been executed so `packages/electron/out/main/index.js` exists before launching the Electron project.

Artifacts (traces, screenshots, videos) are captured on the first retry or failure and saved under `playwright-report/`.

## Electron Project Details

Path: `packages/electron/tests/e2e/autosave-navigation.spec.cjs`

Scenario highlights:

1. Launches the built Electron bundle with a temporary workspace folder.
2. Edits `source.md`, inserts a document reference to `target.md`, and confirms the tab becomes dirty.
3. Clicks the reference, triggering the navigation logic to another file.
4. Verifies the original tab is no longer marked dirty and the file on disk contains the autosaved marker before navigation.

The test dismisses the first-launch API key dialog automatically, making it safe to run in CI.

## Conventions

- Electron specs live under `packages/electron/tests/e2e/` and use the CommonJS (`.cjs`) extension for compatibility with the Electron Playwright runner.
- Keep specs self-cleaning: temporary files and launched apps must be disposed in `finally` blocks.
- Prefer Playwright locators over raw selectors to benefit from auto-waiting and improved error messages.

## Future Work

- Add a smoke test for the web playground once the existing Playwright setup is extended with a web project.
- Capture additional regression scenarios such as tab reopening, AI interactions, and history restore flows.
