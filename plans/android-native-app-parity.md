---
planStatus:
  planId: plan-android-native-app-parity-20260307
  title: Android Native App Parity with iOS Native App
  status: in-development
  planType: initiative
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - android
    - mobile
    - native
    - ios-parity
    - collabv3
  created: "2026-03-07"
  updated: "2026-03-14T06:20:00.000Z"
  progress: 93
---
# Android Native App Parity with iOS Native App

## Objective

Implement and maintain a pure native Android companion app that matches the current native iOS app in product capability and architectural posture, excluding voice-agent features for now, while keeping the initial release target to internal or beta distribution rather than full public Play Store launch.

## Implementation Status

- `packages/android` now exists with:
  - a Gradle-based Android app scaffold
  - a working Gradle wrapper
  - a package-local transcript bundle build
  - a minimal Compose shell with a `WebView` transcript host
  - a seeded Room database backing the project and session UI
  - unit-tested transcript payload serialization
  - persisted pairing state with manual onboarding, QR payload import, and in-place credential editing
  - a Kotlin crypto layer compatible with the iOS and desktop wire format
  - an OkHttp-based sync manager for index-room and session-room hydration
  - Room persistence for synced projects, sessions, messages, and sync watermarks
  - `nimbalyst://pair` and `nimbalyst://auth/callback` deep-link handling
  - a browser-login entry point into the existing auth flow
  - a camera-based QR scanner for pairing import from onboarding and settings
  - outbound create-session requests from Android to desktop
  - outbound prompt submission from Android through `indexUpdate`
  - image attachment capture and photo-picker support for queued prompts
  - queued prompt persistence and queued prompt rendering in session detail
  - transcript-bridge support for interactive prompt responses back to desktop session control
  - unread-state tracking and unread indicator clearing while viewing sessions
  - desktop settings/model sync surfaced in Android settings
  - client-side notification permission and FCM token registration plumbing
  - server-side FCM push send path in `packages/collabv3`
- The transcript bundle builds successfully.
- `./gradlew :app:testDebugUnitTest` and `./gradlew :app:assembleDebug` complete successfully on this machine with OpenJDK 20.
- full Android push delivery is still blocked on missing Firebase config in the Android app and missing deployed FCM secrets in the worker environment.
- several product workflows are still pending.

## Product Decisions Captured During Planning

- Target full feature parity with the current iOS native app, not a trimmed mobile viewer.
- Use a pure native Android architecture. The transcript renderer remains web-based inside a `WebView`, matching the iOS `WKWebView` pattern.
- Include implementation plus maintenance and beta-distribution work. Do not expand this initiative to full production Play Store readiness yet.
- Hold off on Android voice-agent features entirely. Treat voice as a separate future initiative rather than part of Android parity v1.

## Current State

### Repo Findings

- The repo has a mature native iOS package at `packages/ios` with SwiftUI, GRDB, CryptoKit/CommonCrypto, Stytch auth, CollabV3 sync, and an embedded React transcript bundle rendered in `WKWebView`.
- `packages/ios/NimbalystNative/Sources` already covers the major product surfaces Android needs to match:
  - app state and navigation
  - QR pairing and auth
  - local database and reactive views
  - CollabV3 sync and wire protocol handling
  - push notifications
  - transcript rendering bridge
  - attachments and camera capture
  - voice mode
  - analytics and settings
- The Android side is effectively absent today. There is no `packages/android` or equivalent native Android package in the workspace.
- The monorepo root still describes Android as historical Capacitor/mobile support.
- Shared behavior already exists in the desktop/runtime stack:
  - encrypted sync protocol and device presence
  - interactive prompts and mobile-driven responses
  - transcript React components in `@nimbalyst/runtime`
  - synced settings and model metadata
- Server work is not zero. `packages/collabv3/src/IndexRoom.ts` explicitly has an Android push gap: `TODO: Add FCM support for Android`.

### iOS Architecture Worth Mirroring

- Native shell with one dedicated native package for app logic and UI.
- Local SQLite persistence with reactive observation and incremental sync.
- Secrets in secure OS storage, not in the database.
- Shared transcript bundle built separately and embedded into the native app.
- Package-local CI covering transcript build plus native tests.
- Release and operational assets stored close to the mobile package:
  - screenshots
  - store copy
  - release script
  - package-specific testing docs

## Recommendation

Build Android as a first-class sibling to `packages/ios`, not as a resurrection of the old Capacitor app and not as a new cross-platform rewrite. The goal is architectural parity, not source-level parity.

The cleanest long-term shape is:

1. A new `packages/android` package that mirrors the `packages/ios` boundary.
2. Native Android code in Kotlin with Jetpack Compose.
3. A dedicated Android `WebView` transcript renderer using the same runtime transcript components already embedded on iOS.
4. Shared contracts at the protocol and transcript layer, but separate native implementations for storage, auth, sync, notifications, and media.

## Scope

### In Scope

- Pairing, auth, encrypted sync, and local persistence
- Phone and tablet Android UX matching iPhone and iPad parity as closely as Android conventions allow
- Project list, session list, session detail, prompt submission, interactive prompt handling, commit proposal review, and model selection
- Attachments, camera capture, queued prompts, unread state, and synced settings
- Push notifications and deep-linking to sessions
- Analytics, beta distribution, CI, screenshots, release docs, and ongoing maintenance hooks

### Out of Scope

- Public Play Store launch and production store-operations hardening
- Reintroducing Capacitor as a permanent Android solution
- Converging iOS and Android native code into a shared mobile runtime in this initiative
- Backend redesign outside the Android-related gaps needed for parity
- Android voice-agent and realtime voice features

## Feature Parity Target

Android should reach parity with the current iOS feature set represented by `packages/ios`, excluding voice-agent features:

- Pairing and onboarding
  - QR scan
  - manual setup fallback
  - account matching after pairing
- Auth
  - Google OAuth via server redirect
  - magic link if still desired
- Core navigation
  - projects
  - sessions
  - session detail
  - settings
  - phone and tablet layouts
- Transcript interactions
  - rich message rendering
  - code blocks and custom widgets
  - prompt send
  - interactive question and permission responses
  - scroll-to-top and jump-to-prompt support
- Session workflow
  - create session from mobile
  - queued prompt display
  - unread state
  - context usage and synced metadata
  - model picker
- Device integration
  - push notifications
  - camera and image attachment flow
  - deep links
- Operational parity
  - analytics
  - testing
  - screenshot automation
  - release notes and beta distribution process

## Proposed Package Layout

```text
packages/android/
  package.json                   # transcript build/test scripts
  README.md
  TESTING.md
  PLAY_INTERNAL_COPY.md          # beta distribution metadata
  app/
    build.gradle.kts
    src/main/
      AndroidManifest.xml
      java/com/nimbalyst/app/...
      res/...
  android-native/
    build.gradle.kts             # optional shared Android library module
    src/main/java/com/nimbalyst/native/...
    src/test/...
  src/transcript/
    main.tsx
    styles.css
    fonts/
  dist-transcript/               # build output, not committed
  screenshots/
  scripts/
    take-screenshots.sh
```

### Notes

- This mirrors the iOS package shape closely enough that mobile planning, docs, and release operations stay legible across platforms.
- If Android needs more than one Gradle module, keep the public package boundary at `packages/android` and hide the extra complexity inside the Gradle project.
- If the transcript bundle starts to diverge, stop and extract a shared `packages/mobile-transcript` package for both iOS and Android rather than letting the two copies drift.

## Architecture

### UI Layer

- Kotlin
- Jetpack Compose
- Navigation Compose for phone flows
- Adaptive navigation for tablets and foldables
  - use a master-detail layout for larger widths, analogous to iOS `NavigationSplitView`
- Material 3 only where it helps platform fit; do not allow Android design defaults to distort product behavior relative to iOS

### Local Data Layer

- Room over SQLite for Android-native persistence and migrations
- Store encrypted sync seed, JWT, and auth identifiers in Android Keystore-backed secure storage
- Store cached decrypted transcript content only in app-private storage, matching the iOS model of secure local cache for fast offline reading
- Mirror the iOS schema conceptually:
  - projects
  - sessions
  - messages
  - sync_state
  - queued_prompts
  - later parity columns for context usage, read state, hierarchy, commands, draft input, session metadata

### Networking and Sync

- OkHttp WebSocket client for CollabV3 connections
- Native Android sync manager that mirrors the responsibilities of iOS `SyncManager.swift`
- WebSocket reconnect logic lives in a **bound foreground Service** (not a ViewModel), so it survives app backgrounding and matches iOS `SyncManager` lifecycle behavior
  - Android 12+ requires foreground services with a persistent notification for long-running network operations; design the notification accordingly
- Preserve iOS behavior around:
  - index room sync
  - active session room sync
  - incremental catch-up
  - device presence
  - synced settings
  - queued mobile prompts
  - cross-device interactive responses

### Auth and Pairing

- QR pairing with CameraX plus ML Kit barcode scanning
- Browser-based auth using Custom Tabs with **Verified App Links** (https:// scheme backed by Digital Asset Links), matching the existing server redirect contract used by iOS
  - **Backend dependency**: `/.well-known/assetlinks.json` must be deployed to the server before OAuth callback testing on Android
- Account-match validation after auth so the Android device derives the same encryption key as desktop

### Transcript Renderer

- Android `WebView` wrapper analogous to iOS `TranscriptWebView.swift`
- Keep the transcript bundle narrow and deep-imported from `@nimbalyst/runtime`, just as the iOS package already does to avoid pulling in heavy editor dependencies
- Reuse the bridge pattern:
  - native -> JS load session, append messages, update metadata, clear session, set theme
  - JS -> native prompt submit, widget response, error reporting, transcript control

### Notifications

- FCM on Android
- Add server-side FCM support in CollabV3 and make the push token registration protocol platform-aware
- Match iOS behavior for deep-linking, suppressing pushes while desktop is active, and routing directly to the affected session

### Analytics and Operational Hooks

- Android analytics service matching the current iOS PostHog privacy posture
- Beta screenshots, app metadata, changelog, and release automation should live in `packages/android`, not in scattered repo scripts

## Shared Code Strategy

Do not introduce Kotlin Multiplatform or React Native as part of this initiative. That would create a second large architectural change while Android does not yet exist.

Instead, share only what is already naturally shared:

- CollabV3 protocol contracts and behavior
- runtime transcript React components
- desktop-driven settings and model metadata
- product-level feature docs and release checklists

Where Android and iOS both need the same mobile-specific renderer behavior, prefer one of these options in order:

1. Extract a shared mobile transcript package used by both platforms.
2. Keep one platform-specific wrapper layer per platform and one shared JS transcript implementation.
3. Duplicate only small native adapter code.

Avoid:

- a shared cross-platform mobile runtime
- duplicated transcript business logic across iOS and Android
- backend conditionals that permanently treat Android as a special case

## Backend and Cross-Repo Dependencies

Android parity requires explicit supporting work outside `packages/android`:

- CollabV3
  - add FCM push delivery and token lifecycle management
  - verify mobile-origin message flows remain platform-neutral
  - validate device presence handling for Android device types
- Desktop pairing UX
  - confirm Android-specific QR/manual setup instructions
  - ensure beta-channel messaging and support copy mention Android
- Runtime transcript
  - harden the mobile transcript bridge as a documented contract instead of an iOS-specific implementation detail
- Analytics
  - add Android events to `docs/POSTHOG_EVENTS.md`
- Release workflows
  - add Android-specific CI and beta artifact publishing

## Delivery Plan

### Phase 0: Lock the Android Reference Shape

- Create a short Android architecture decision record under `packages/android` once implementation begins.
- Freeze the iOS feature inventory to the parity target for Android v1.
- **Decided: extract `packages/mobile-transcript` before Android Phase 1 starts.** Refactor `packages/ios` to consume it, then Android builds on the shared package from day one.
- **Decided: Play Console internal testing track** for beta distribution.
- **Decided: Verified App Links** for OAuth callback. Backend must deploy `/.well-known/assetlinks.json` before Phase 2 auth testing.
- **Decided: bound foreground Service** for WebSocket/sync lifecycle.
- **Decided: FCM backend work starts in parallel with Phase 1**, not deferred to Phase 7. Add to CollabV3 backlog immediately.

### Phase 0.5: Extract Shared Mobile Transcript Package

Before any Android scaffold work:

- Create `packages/mobile-transcript` with the transcript entry point and bridge contract
- Refactor `packages/ios` to build from `packages/mobile-transcript` instead of its own transcript source
- Verify iOS transcript bundle output is identical before and after the refactor
- Document the bridge contract in `packages/mobile-transcript/BRIDGE.md` (native→JS and JS→native message types)

### Phase 1: Scaffold the Package and Build Pipeline

- Create `packages/android`
- Add package-local docs matching iOS:
  - `README.md`
  - `TESTING.md`
  - beta metadata doc
- Create Gradle project and Android app module
- Add transcript build scripts and Android-native test hooks
- Add GitHub Actions jobs for:
  - transcript bundle build
  - Android unit tests
  - Android instrumentation or emulator smoke tests
  - beta artifact upload

### Phase 2: Establish Secure Pairing, Auth, and Storage

- Implement secure storage for:
  - pairing seed
  - server URL
  - auth JWT
  - user and org identifiers
  - analytics identity
- Implement QR scanner and manual setup path
- Implement auth callback flow and account-match validation
- Implement Room schema and migrations equivalent to the iOS database model
- Verify crypto compatibility against existing desktop and iOS test vectors

### Phase 3: Implement Sync and Core App State

- Build Android equivalents of:
  - `AppState.swift`
  - `WebSocketClient.swift`
  - `SyncManager.swift`
  - `SyncProtocol.swift`
- Support:
  - full index sync
  - incremental updates
  - session-room subscription
  - queued prompt syncing
  - device announce and presence
  - synced settings and model metadata
- Add robust reconnect, stale-connection detection, and offline resume behavior

### Phase 4: Deliver Core UI Parity

- Compose onboarding and pairing surfaces
- Project list
- Session list
- Session detail shell
- Settings
- Tablet-adaptive navigation
- Unread indicators and refresh behavior

The exit condition for this phase is a usable Android app that can pair, authenticate, browse projects and sessions, and show local cached state while syncing.

### Phase 5: Embed the Transcript Renderer and Interaction Bridge

- Implement Android `WebView` transcript host
- Port the bridge contract from iOS
- Validate:
  - session load
  - append-only updates
  - metadata updates
  - interactive widget callbacks
  - error forwarding
  - scroll control
- Keep the bundle small and platform-safe
- If Android uncovers transcript drift, extract the shared mobile transcript package here

### Phase 6: Add Session Actions and Advanced Mobile Workflows

- Prompt composition and submission
- Model picker
- queued prompts
- command suggestions if still supported on iOS
- attachment preview
- camera capture and image compression
- create-session flow from mobile
- interactive prompt review:
  - AskUserQuestion
  - tool permission
  - ExitPlanMode
  - GitCommitProposal

### Phase 7: Push Notifications and Deep Linking

- Add FCM client integration
- Add Android token registration flow
- Implement deep links into session detail
- Extend CollabV3 for FCM delivery and token invalidation
- Match desktop-active suppression rules and mobile-active suppression rules already present for iOS

### Phase 8: Beta Readiness and Operational Maintenance

- Establish beta signing and distribution
- Add screenshot automation for phone and tablet form factors
- Create Android beta copy and support notes
- Add crash and ANR monitoring if not already covered
- Add a package-local release script, mirroring the iOS release discipline
- Define on-call ownership for:
  - push delivery failures
  - auth regressions
  - sync breakage
  - transcript renderer regressions

## Maintenance Model

Android should be maintained as a first-class sibling of iOS with explicit operational discipline.

### Ownership

- One mobile owner should remain accountable across both native platforms for feature parity decisions.
- Platform-specific implementation can differ, but product behavior should be reviewed against a single shared parity checklist.

### Ongoing Responsibilities

- Keep Android synced with iOS feature additions and wire protocol changes
- Update Android schema migrations whenever iOS schema meaning changes
- Keep transcript bridge contracts stable across desktop, iOS, and Android
- Maintain beta distribution, screenshots, metadata, and testing docs
- Update analytics docs whenever Android adds or changes mobile events

### Required CI Coverage

- transcript bundle build
- Kotlin unit tests
- crypto compatibility tests
- database migration tests
- WebSocket sync integration tests where feasible
- emulator smoke tests for onboarding, session detail, and deep links

### Release Discipline

- Use package-local docs and scripts, not tribal knowledge
- Maintain an Android-specific changelog or release-notes source
- Version Android independently if distribution needs it, but keep feature parity tracked at the initiative level

## Risks

### High Risk

- WebView transcript performance may regress on low-memory Android devices if the bundle stays too large or runtime imports drift.
- Crypto compatibility mistakes will silently break pairing or decryption across devices.
- FCM support requires backend work that does not exist yet.

### Medium Risk

- Tablet parity is not a direct iPad port. Compose adaptive patterns need careful design to avoid a phone-stretched UI.
- Notification behavior can become inconsistent across desktop, iOS, and Android if suppression logic diverges.
- If transcript logic forks between iOS and Android, maintenance cost will rise quickly.

### Risk Mitigations

- Build shared crypto test vectors and run them in JS, Swift, and Kotlin.
- Treat the transcript bridge as a documented cross-platform contract.
- Add backend FCM support early enough that notification architecture is not bolted on late.

## Success Criteria

- Android can pair with desktop, authenticate, and derive the same encryption keys reliably.
- Android can browse synced projects and sessions with offline cached state.
- Session detail supports full transcript viewing, prompt submission, and interactive prompt responses.
- Push notifications deep-link correctly and follow existing presence suppression rules.
- Beta users can install signed builds through an internal distribution channel without manual engineering intervention.
- Ongoing maintenance burden is documented and owned, not implied.

## Resolved Decisions (2026-03-12)

- **Beta distribution**: Play Console internal testing track.
- **Shared transcript package**: Extract `packages/mobile-transcript` before Phase 1. iOS refactored to consume it first.
- **Auth callback**: Verified App Links (https:// + Digital Asset Links). Backend `/.well-known/assetlinks.json` is a Phase 2 prerequisite.
- **WebSocket lifecycle**: Bound foreground Service. Android 12+ notification required.
- **FCM backend timing**: Start in parallel with Phase 1, not Phase 7.

## Remaining Open Questions

- Whether Android voice should be planned later as a separate follow-on document once the core Android app is stable.
- What the foreground Service notification UX should look like while sync is active (always visible, or only when actively syncing).

## Planning Notes

- A UI mockup would normally be useful for the Android phone and tablet shell, but the `/mockup` skill referenced by planning-mode guidance is not available in this session. This document therefore focuses on execution architecture, parity scope, and maintenance model.
