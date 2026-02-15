# iOS Package (Native iOS App)

This package contains the native SwiftUI iOS/iPadOS app for Nimbalyst. It provides a mobile interface for viewing and interacting with AI sessions synced from the desktop Electron app via end-to-end encrypted WebSocket sync.

The app is **pure Swift/SwiftUI** with no Capacitor or web framework dependency. The only web view is `TranscriptWebView` (WKWebView) which renders the rich chat transcript using the same React components as the desktop app.

## Package Structure

```
packages/ios/
  NimbalystNative/          # Swift Package - all business logic and UI
    Sources/
      App/                  # AppState (root observable), ContentView, navigation
      Auth/                 # AuthManager (Stytch OAuth via ASWebAuthenticationSession)
      Crypto/               # CryptoManager (AES-256-GCM, PBKDF2), KeychainManager
      Database/             # DatabaseManager (GRDB migrations, queries)
      Models/               # GRDB record types: Project, Session, Message, QueuedPrompt, SyncState
      Notifications/        # NotificationManager (push notification registration)
      Sync/                 # SyncManager, WebSocketClient, SyncProtocol types
      Utils/                # RelativeTimestamp, NimbalystColors
      Views/                # All SwiftUI views
    Tests/                  # Unit and integration tests (68 tests)
    Package.swift           # Swift Package Manager manifest (GRDB dependency)

  NimbalystApp/             # Xcode app target
    Sources/                # App entry point (@main), DebugMenu
    Resources/              # Assets.xcassets (AppIcon, Splash), transcript-dist bundle
    project.yml             # XcodeGen project definition

  CryptoCompatibility/      # CommonCrypto bridging header for PBKDF2 key derivation

  src/transcript/           # React transcript web bundle (loaded in WKWebView)
    main.tsx                # Entry point with Swift <-> JS bridge
    styles.css              # Styles with bundled Material Symbols font
    fonts/                  # Locally bundled Material Symbols TTF

  vite.config.transcript.ts # Vite config for transcript bundle (IIFE format for file://)
  transcript.html           # HTML entry point for Vite build
  dist-transcript/          # Build output (not committed)
```

## Key Architecture Decisions

### Authentication Flow
1. QR pairing stores encryption seed + server URL in Keychain
2. Stytch OAuth stores JWT + user ID in Keychain
3. When both paired AND authenticated, managers initialize
4. Encryption key derived from seed + user ID via PBKDF2

### Data Flow
- **Sync**: WebSocket connection to CollabV3 Durable Object (same server as desktop)
- **Encryption**: All session data encrypted with AES-256-GCM before transmission
- **Storage**: GRDB (SQLite) with reactive `ValueObservation` for live UI updates
- **Transcript**: WKWebView loads bundled React app, communicates via `webkit.messageHandlers.bridge`

### iPad Support
- `NavigationSplitView` for regular size class (sidebar + detail)
- `NavigationStack` for compact size class (iPhone)

## Development

### Prerequisites
- Xcode 16+
- Node.js 20+ (for transcript bundle)
- XcodeGen (`brew install xcodegen`)

### Commands
```bash
# From monorepo root:
npm run ios:test:swift          # Run all 68 Swift tests
npm run ios:build:transcript    # Build transcript web bundle

# From packages/ios/:
cd NimbalystNative && swift test                    # Run tests directly
cd NimbalystApp && xcodegen generate                # Regenerate .xcodeproj
open NimbalystApp/NimbalystApp.xcodeproj            # Open in Xcode
```

### Transcript Bundle
The Xcode pre-build script in `project.yml` automatically builds the transcript with Vite and copies it to `Resources/transcript-dist/`. You can also build manually:

```bash
npx vite build --config vite.config.transcript.ts
```

Output: `dist-transcript/transcript.html` + `dist-transcript/assets/` (JS bundle + Material Symbols font).

## Key Files

| File | Purpose |
|------|---------|
| `Sources/App/AppState.swift` | Root observable object; owns database, crypto, and sync managers |
| `Sources/Sync/SyncManager.swift` | WebSocket sync with CollabV3; processes index responses and broadcasts |
| `Sources/Sync/SyncProtocol.swift` | All wire protocol types (Codable structs with CodingKeys) |
| `Sources/Database/DatabaseManager.swift` | GRDB schema migrations, queries, and project stats refresh |
| `Sources/Crypto/CryptoManager.swift` | AES-256-GCM encrypt/decrypt, deterministic project ID encryption |
| `Sources/Views/TranscriptWebView.swift` | WKWebView + Coordinator with JS bridge, TranscriptController |
| `Sources/Views/SessionDetailView.swift` | Session detail with transcript, scroll-to-top, jump-to-prompt |
| `Sources/Views/SessionListView.swift` | Time-grouped session list with search and swipe-to-delete |
| `Sources/Views/ProjectListView.swift` | Project list sorted by last activity with desktop connection indicator |
| `src/transcript/main.tsx` | React transcript app with `scrollToTop`, `scrollToMessage`, `getPromptList` JS bridge |

## Testing
- 68 Swift tests covering database, crypto, sync integration, and web view
- See [TESTING.md](./TESTING.md) for CI/CD pipeline details
- Tests run on both macOS (via Swift Package Manager) and iOS simulator (via Xcode)
