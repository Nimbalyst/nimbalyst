# Android Testing

## Current Coverage

The initial Android package scaffold supports these checks:

```bash
cd packages/android
npm run build:transcript
npm run sync:transcript-assets
./gradlew :app:assembleDebug
./gradlew :app:testDebugUnitTest
```

On this machine, those Gradle tasks passed when `JAVA_HOME` was set to `/Users/ghinkle/Library/Java/JavaVirtualMachines/openjdk-20.0.2/Contents/Home` instead of the default GraalVM install.

## Expected Next Additions

- Room migration tests
- WebSocket sync integration tests
- emulator smoke tests for the native shell and transcript host
- emulator verification for `nimbalyst://pair` and `nimbalyst://auth/callback` deep links
- emulator verification for queued prompt submission and queue clearing
- emulator verification for interactive widget responses in the transcript view
- emulator verification for camera QR scanning across permission states
- emulator verification for image attachment send flow from photo picker and camera preview
- emulator verification for unread badges clearing when a session is opened
- emulator verification for desktop settings/model sync display
- device verification for notification permission flow and FCM token registration once Firebase config is installed
- worker-env verification for FCM service-account secrets before Android push delivery

## Manual Smoke Check

1. Build the transcript bundle.
2. Sync transcript assets into the generated Android asset directory.
3. Launch the app from Android Studio or `./gradlew :app:installDebug`.
4. Confirm the native shell opens.
5. Open Settings and verify:
   - QR payload import populates the pairing fields
   - browser login launches the server auth route
6. Open the Session screen and verify the transcript host either:
   - loads the bundled transcript page, or
   - shows the explicit missing-assets message instead of failing silently.
7. With a paired desktop session selected, send a prompt from Android and verify:
   - the queued prompt card updates immediately
   - the desktop receives the queued prompt
   - the queued prompt clears once desktop starts processing it
8. Open a session with an interactive prompt widget and verify the response is sent back to desktop and reflected in the transcript.
9. Open onboarding or settings, scan a valid desktop pairing QR, and verify the pairing fields are populated without manual paste.
10. Add an image attachment from the session composer and verify desktop receives the queued prompt with the attachment payload.
11. Let a session receive a new message while not selected, verify it shows unread state, then open it and verify the unread indicator clears.
12. Trigger a desktop settings sync and verify Android settings shows the synced model list and default model.
13. Install Firebase config, enable notifications from Android settings, and verify the sync server receives `registerPushToken`.
14. Provision FCM worker secrets, trigger a mobile push from desktop, and verify Android receives the notification with the session deep link.
