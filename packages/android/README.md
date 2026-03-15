# Nimbalyst for Android

Native Android companion app for Nimbalyst, mirroring the native iOS package architecture while explicitly excluding voice-agent features in the first implementation track.

## Current Status

This package currently contains:

- a Kotlin + Jetpack Compose Android app scaffold
- an Android `WebView` host for the shared transcript renderer
- a Room-backed local store for projects, sessions, messages, and sync watermarks
- a Kotlin AES-GCM / PBKDF2 crypto layer compatible with the iOS and desktop wire format
- an OkHttp WebSocket sync manager for index-room and session-room hydration
- QR payload import, editable pairing/auth credentials, and `nimbalyst://` deep-link handling for pairing and auth callbacks
- a browser-login entry point that launches the existing server OAuth flow
- a CameraX + ML Kit QR scanner for pairing import in onboarding and settings
- a desktop session-creation request flow from the Projects screen
- queued prompt sync and prompt submission from Android through the index-room update path
- native image attachments for prompts via photo picker and quick camera capture
- interactive widget responses bridged from the transcript `WebView` back to desktop session control
- unread-state tracking for the active session and unread indicators in the session list
- desktop settings/model metadata sync surfaced in Android settings
- notification permission and FCM token registration plumbing wired on the Android client
- server-side FCM send path added in `packages/collabv3` for Android mobile push delivery
- a dedicated Vite transcript bundle setup under `src/transcript/`
- package-local docs and scripts so Android work can evolve without touching the monorepo root

What is not implemented yet:

- push notifications
- production-ready UX polish and release hardening

## Structure

```text
packages/android/
  app/                         # Android application module
  src/transcript/              # React transcript bundle for Android WebView
  scripts/                     # Package-local helper scripts
  package.json                 # Transcript build/test scripts
  build.gradle.kts             # Root Android Gradle config
  settings.gradle.kts          # Android Gradle settings
```

## Development

### Transcript bundle

```bash
cd packages/android
npm install
npm run build:transcript
npm run sync:transcript-assets
```

### Android app

```bash
cd packages/android
./gradlew :app:assembleDebug
./gradlew :app:testDebugUnitTest
```

If `JAVA_HOME` points at GraalVM on this machine, Android builds can fail during the AGP `jlink` step. Using the installed OpenJDK at `/Users/ghinkle/Library/Java/JavaVirtualMachines/openjdk-20.0.2/Contents/Home` worked for `assembleDebug` and `testDebugUnitTest`.

The app currently boots into a native Compose shell with placeholder project, session, and settings screens plus a `TranscriptWebView` container that will load the generated transcript asset bundle once `dist-transcript/` has been synced into the Android build assets.

Android can now:

- store and edit pairing, auth, and routing credentials locally
- import the same pairing payload shape used by iOS QR flows
- scan the desktop pairing QR directly from onboarding and settings
- receive `nimbalyst://pair?...` and `nimbalyst://auth/callback?...` links
- open the existing browser login flow from Settings
- connect to CollabV3 index and session rooms and hydrate the local Room database
- request new desktop sessions and wait for the returning index broadcast
- queue prompts from Android and render queued prompts in the session detail view
- attach photos from the library or quick camera capture when queueing prompts
- send AskUserQuestion, ToolPermission, ExitPlanMode, and GitCommit widget responses from the transcript bridge
- clear unread indicators as sessions are viewed on Android
- show desktop-synced available models and the current default model in settings
- request notification permission and attempt FCM token registration when Firebase config is present

Current push blocker:

- There is no `google-services.json` in this workspace, so Android cannot complete real FCM registration yet.
- Firebase/FCM secrets still need to be provided to the worker environment before Android push can deliver in production.
