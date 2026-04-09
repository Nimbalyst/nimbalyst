---
planStatus:
  planId: plan-windows-shell-compatibility
  title: Windows Shell Compatibility
  status: in-progress
  planType: bugfix
  owner: ghinkle
  priority: high
  stakeholders:
    - agents
  tags:
    - windows
    - terminal
    - shell
    - electron
  created: "2026-04-07"
  updated: "2026-04-09"
  progress: 85
  dueDate: ""
  startDate: "2026-04-07"
---
# Windows Shell Compatibility

## Overview

The current Windows shell flow is too narrow for real developer setups. We currently detect only `pwsh.exe`, `powershell.exe`, and `cmd.exe`, and shell detection relies on raw `process.env.PATH`. That misses common cases where Git Bash or WSL are installed but not visible through the inherited GUI environment. Our enhanced PATH logic also omits standard Git for Windows directories and is not shared with terminal shell detection.

This plan standardizes Windows shell support so the app works reliably for the typical developer environments:

- PowerShell Core (`pwsh`)
- Windows PowerShell
- Git Bash
- WSL
- `cmd.exe` as fallback

The design goal is to fix this as a platform layer instead of accreting more one-off fallbacks.

## Goals

- Detect common Windows developer shells even when the app launches from a GUI with incomplete environment state.
- Separate interactive shell choice from CLI/tool PATH discovery.
- Launch each shell with the startup behavior users expect from that ecosystem.
- Preserve a user-selected shell instead of re-deciding on every launch.
- Support WSL without corrupting native Windows file-path assumptions for background tools.
- Provide diagnostics so users can understand why a shell was or was not detected.

## Non-Goals

- Full Linux container or remote shell orchestration.
- Supporting every niche Windows shell distribution on the first pass.
- Automatically forcing background tool execution into WSL just because the terminal shell is WSL.

## Problem Statement

The current design has three coupled concerns that should be separate:

1. Shell detection
2. PATH and executable discovery
3. Per-shell launch/bootstrap behavior

Today those concerns are mixed across [ShellDetector.ts](.//Users/ghinkle/sources/stravu-editor/packages/electron/src/main/services/ShellDetector.ts), [CLIManager.ts](.//Users/ghinkle/sources/stravu-editor/packages/electron/src/main/services/CLIManager.ts), and [TerminalSessionManager.ts](.//Users/ghinkle/sources/stravu-editor/packages/electron/src/main/services/TerminalSessionManager.ts).

That creates several concrete gaps:

- Git Bash is never selected because the detector does not look for it.
- Terminal shell detection uses raw `process.env.PATH` instead of the enhanced Windows PATH.
- Enhanced Windows PATH only queries the user PATH and some common package manager locations; it does not add standard Git for Windows locations.
- WSL is not modeled as a distinct provider, even though it requires cwd and path translation.

## Proposed Architecture

### 1. Introduce a Windows shell discovery layer

Replace the current hardcoded fallback chain with provider-based discovery.

Proposed model:

```ts
interface ShellProviderDefinition {
  id: 'pwsh' | 'powershell' | 'git-bash' | 'wsl' | 'cmd';
  label: string;
  priority: number;
  detect(context: DetectionContext): Promise<DetectedShell[]>;
}

interface DetectedShell {
  providerId: string;
  executablePath: string;
  displayName: string;
  args: string[];
  source: 'path' | 'registry' | 'well-known-path' | 'system';
  diagnostics: string[];
  capabilities: {
    interactive: boolean;
    loginShell: boolean;
    posixLike: boolean;
    supportsBootstrap: boolean;
    requiresPathTranslation: boolean;
  };
}
```

This discovery layer should return all detected shells plus a default selection derived from priority and user preference.

### 2. Centralize Windows PATH construction

Extract Windows PATH logic into a reusable service or helper that both terminal shell detection and background CLI/tool execution can consume.

Inputs should include:

- `process.env.PATH`
- `HKCU\Environment\Path`
- `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\Path`
- custom user-configured path directories
- well-known install locations

Well-known Windows locations should include:

- `C:\Program Files\Git\bin`
- `C:\Program Files\Git\usr\bin`
- `C:\Program Files (x86)\Git\bin`
- `C:\Program Files (x86)\Git\usr\bin`
- existing Node/npm/Scoop/Chocolatey/Volta/Yarn/uv/Bun/Deno locations already partially handled

Requirements:

- expand `%VAR%` style entries
- normalize and dedupe case-insensitively
- preserve source ordering deterministically

### 3. Add per-shell launch adapters

Launch semantics differ enough that each shell should have a dedicated adapter instead of generic name-based branching.

Each adapter is responsible for:

- executable path
- base args
- bootstrap injection
- cwd handling
- environment adjustments
- history/CWD tracking compatibility

Expected launch rules:

- `pwsh`
  - use `-NoLogo -NoExit`
  - allow normal profile loading
  - inject bootstrap via `-Command`
- `powershell`
  - same as above with lower default priority
- `git-bash`
  - use `--login -i`
  - treat as POSIX-like for bootstrap/history logic
- `wsl`
  - launch via `wsl.exe`
  - translate cwd into Linux form before spawn
  - treat as an explicit provider, not generic bash
- `cmd`
  - keep as minimal fallback

### 4. Persist shell preference explicitly

Detection should determine what is available, not silently switch the user every time. Once the user chooses a shell, that preference should be stored and reused until it becomes unavailable.

Suggested default priority:

1. Saved user preference if valid
2. `pwsh`
3. `git-bash`
4. `wsl`
5. `powershell`
6. `cmd`

WSL should not be auto-preferred globally because it changes path semantics for the terminal session in ways that differ from the rest of the app.

### 5. Keep WSL terminal choice separate from native tool execution

Interactive terminal shell and background tool execution should remain separate concerns.

If a user opens a WSL terminal, that does not mean all app subprocesses should automatically run under WSL. Background tools still work on Windows file paths unless the entire workspace or session explicitly opts into a WSL execution model. Without that separation, file IO and tool invocation will drift between Windows and Linux path formats.

## Implementation Plan

### Phase 1: Detection and PATH foundation

- Refactor [ShellDetector.ts](.//Users/ghinkle/sources/stravu-editor/packages/electron/src/main/services/ShellDetector.ts) into provider-based discovery.
- Extract shared Windows PATH logic from [CLIManager.ts](.//Users/ghinkle/sources/stravu-editor/packages/electron/src/main/services/CLIManager.ts) into a reusable helper or service.
- Update shell discovery to use the enhanced Windows PATH instead of raw `process.env.PATH`.
- Add detection for Git Bash and WSL.
- Add support for reading both user and system PATH from the registry.

### Phase 2: Terminal launch refactor

- Refactor [TerminalSessionManager.ts](.//Users/ghinkle/sources/stravu-editor/packages/electron/src/main/services/TerminalSessionManager.ts) to use provider-specific launch adapters.
- Preserve existing zsh/bash/pwsh history bootstrap behavior where still valid.
- Add Git Bash launch behavior with login-shell semantics.
- Add WSL cwd translation and WSL-specific launch path handling.

### Phase 3: Settings and diagnostics

- Add or extend app settings to persist the preferred terminal shell.
- Surface detected shells with resolved paths and diagnostics in settings or logs.
- Make fallback behavior visible so users can understand why a shell was not chosen.

### Phase 4: Validation and hardening

- Add unit coverage for PATH merging and shell detection.
- Add targeted tests around default selection and saved preference behavior.
- Manually validate on representative Windows environments.

## Candidate Files

### Main process

- `packages/electron/src/main/services/ShellDetector.ts`
- `packages/electron/src/main/services/CLIManager.ts`
- `packages/electron/src/main/services/TerminalSessionManager.ts`
- `packages/electron/src/main/ipc/SettingsHandlers.ts`

### Renderer/settings UI

- Existing settings UI for advanced terminal or shell preferences if present
- Possibly new shell diagnostics display in settings

## Testing Matrix

Minimum validation set:

- `pwsh` installed, Git absent
- Git Bash installed in default `Program Files` path but not on inherited PATH
- Git Bash present through system PATH only
- WSL installed with a default distro
- app launched before and after PATH changes
- saved shell preference still valid
- saved shell preference becomes unavailable
- workspace on native Windows path
- WSL terminal opened while background tools remain native Windows

## Risks

- WSL cwd translation is the most likely source of subtle bugs.
- Git Bash users may rely on login-shell startup semantics that differ from plain interactive bash.
- PATH normalization on Windows must be case-insensitive and env-expanding or detection will remain flaky.
- A partial refactor that improves detection without improving launch semantics will still leave user-visible gaps.

## Recommendation

Implement Phase 1 and Phase 2 together in one branch. The platform layer only becomes trustworthy once discovery and launch behavior are aligned. Settings and diagnostics can follow immediately after, but detection-only changes will not fully solve the user-facing problem.

## Implementation Status

Implemented:

- shared Windows PATH resolution covering inherited PATH, user PATH, system PATH, and common Git/PowerShell/Node install directories
- Windows shell detection for `pwsh`, Windows PowerShell, Git Bash, WSL, and `cmd`
- provider-aware terminal launch for Git Bash and WSL
- persisted Windows shell preference in app settings
- Windows-only shell selector in Advanced Settings
- shell discovery diagnostics surfaced in settings
- restoration of the previously persisted shell when reopening an existing terminal

Remaining hardening:

- deeper WSL shell bootstrap/history hooks comparable to the native bash/zsh/pwsh flows
- richer diagnostics for why a specific shell was not detected
