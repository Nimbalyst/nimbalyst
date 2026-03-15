# Android Package (Native Android App)

This package contains the native Android app for Nimbalyst. It mirrors the iOS native app architecture where practical: a pure native mobile shell with a single embedded web transcript view that renders the shared React transcript bundle.

## Overview

The Android app is:

- **Pure native Android** using Kotlin and Jetpack Compose
- **Room-backed** for local persistence
- **WebSocket-synced** with CollabV3 Durable Objects
- **End-to-end encrypted** using the same seed + user-derived key model as iOS
- **Transcript-rendered** through a single `WebView` that loads the bundled React transcript UI

Voice agent features are intentionally out of scope for Android.

## Package Structure

```text
packages/android/
  app/
    src/main/java/com/nimbalyst/app/
      attachments/    # Image attachment preparation/compression
      auth/           # Auth callback parsing
      crypto/         # AES-GCM + PBKDF2 key derivation
      data/           # Room entities, DAOs, repository
      notifications/  # Android notification + FCM token plumbing
      pairing/        # QR payload parsing and persistent pairing state
      sync/           # WebSocket sync manager and wire protocol
      transcript/     # WebView host and JS bridge
      ui/             # Compose screens and app shell
    src/test/         # Unit tests
  src/transcript/     # Shared React transcript bundle entrypoint/assets
  scripts/            # Transcript asset sync helpers
```

## Key Architecture Rules

### Transcript

- The transcript UI lives in `src/transcript/main.tsx` and is bundled into Android assets.
- `TranscriptWebView.kt` is the Android host. `TranscriptBridge.kt` is the only place JS bridge actions should be decoded and routed.
- Keep transcript behavior aligned with iOS unless Android-specific UX requires a different path.

### Sync and Encryption

- `SyncManager.kt` owns the device sync lifecycle, room joins, index updates, queued prompt handling, and session control messages.
- `CryptoManager.kt` must remain wire-compatible with iOS and desktop. Be cautious with any PBKDF2, AES-GCM, or payload format changes.
- User routing identity and crypto identity are distinct. Do not collapse them back into a single field.

### Persistence

- Room is the source of truth for local Android UI state.
- Prefer repository/DAO changes over screen-local state duplication.
- If you add persisted fields, update schema, migrations, and any seed/demo paths together.

### Firebase / Notifications

- `app/google-services.json` is local environment config. Do **not** commit it.
- Client push registration lives in `notifications/NotificationManager.kt`.
- Server push delivery is implemented in `packages/collabv3`. Android push changes usually require coordinated client + server work.

## Development

### Prerequisites

- Android Studio Ladybug / AGP-compatible version for this project
- JDK 20 for Gradle builds on this machine
- Android SDK + emulator tooling
- Node.js 20+ for transcript bundle builds

### Commands

```bash
# Build transcript bundle
npm run build:transcript --prefix packages/android

# Assemble debug APK
cd packages/android
JAVA_HOME=/Users/ghinkle/Library/Java/JavaVirtualMachines/openjdk-20.0.2/Contents/Home ./gradlew :app:assembleDebug

# Run unit tests
cd packages/android
JAVA_HOME=/Users/ghinkle/Library/Java/JavaVirtualMachines/openjdk-20.0.2/Contents/Home ./gradlew :app:testDebugUnitTest
```

Open `packages/android/` in Android Studio, not the repo root.

## Agent Guidance

- Read the root `CLAUDE.md` before changing this package.
- Prefer following iOS behavior and naming when implementing cross-platform mobile features.
- Do not commit secrets or local machine config such as:
  - `app/google-services.json`
  - `local.properties`
  - build outputs
- If Android Studio reports AGP incompatibility, the correct fix is usually to update Android Studio rather than downgrade AGP/Kotlin.
- When changing sync protocol behavior, inspect the matching iOS and CollabV3 code paths before editing.
- When changing transcript bridge behavior, update or add Android tests in `app/src/test/` where possible.

## Important Files

| File | Purpose |
| --- | --- |
| `app/src/main/java/com/nimbalyst/app/NimbalystApplication.kt` | App-level dependency setup and startup wiring |
| `app/src/main/java/com/nimbalyst/app/MainActivity.kt` | Activity entry point and deep-link handling |
| `app/src/main/java/com/nimbalyst/app/ui/NimbalystAndroidApp.kt` | Root Compose app shell and navigation |
| `app/src/main/java/com/nimbalyst/app/sync/SyncManager.kt` | Core mobile sync lifecycle and message handling |
| `app/src/main/java/com/nimbalyst/app/sync/SyncProtocol.kt` | Android wire protocol types |
| `app/src/main/java/com/nimbalyst/app/crypto/CryptoManager.kt` | Encryption and key derivation |
| `app/src/main/java/com/nimbalyst/app/data/NimbalystDatabase.kt` | Room database definition |
| `app/src/main/java/com/nimbalyst/app/transcript/TranscriptWebView.kt` | WebView transcript host |
| `app/src/main/java/com/nimbalyst/app/transcript/TranscriptBridge.kt` | JS/native bridge handler |
| `src/transcript/main.tsx` | Shared transcript app entry point for Android |
