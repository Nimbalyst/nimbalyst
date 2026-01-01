# Capacitor Package (Mobile App)

This package contains the iOS/iPadOS companion app for Nimbalyst. It provides a mobile interface for viewing and interacting with AI sessions synced from the desktop app.

## Features

- View AI sessions synced from desktop
- End-to-end encrypted session sync
- QR code pairing with desktop app
- iPad split-view layout
- Dark mode support

## Prerequisites

- Node.js 18+
- Xcode 15+ (for iOS development)
- iOS Simulator or physical device
- CocoaPods (`sudo gem install cocoapods`)

## Development Setup

1. Install dependencies from the monorepo root:
   ```bash
   npm install
   ```

2. Build the runtime package (required dependency):
   ```bash
   cd packages/runtime
   npm run build
   ```

3. Build and sync the Capacitor app:
   ```bash
   cd packages/capacitor
   npm run ios:dev
   ```

This will:
- Build the web assets
- Sync them to the iOS project
- Open Xcode

4. In Xcode, select a simulator or device and click Run.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (web preview) |
| `npm run build` | Build web assets |
| `npm run cap:sync` | Build and sync to native projects |
| `npm run cap:open:ios` | Open iOS project in Xcode |
| `npm run ios:dev` | Build, sync, and open Xcode |
| `npm run ios:build` | Build and sync for iOS (no Xcode open) |

## Architecture

```
src/
  App.tsx                 # Main router with split-view support
  screens/
    SessionListScreen.tsx # Session list (or sidebar on iPad)
    SessionDetailScreen.tsx # Session conversation view
    SettingsScreen.tsx    # QR pairing and settings
  components/
    SplitView.tsx         # iPad split-view layout
    SessionCard.tsx       # Session list item
    ProjectPicker.tsx     # Project filter modal
    SyncStatusBadge.tsx   # Connection status indicator
  contexts/
    CollabV3SyncContext.tsx # WebSocket sync state
  services/
    CredentialService.ts  # Secure credential storage
```

## Pairing with Desktop

1. On the desktop app, go to **Settings > Session Sync**
2. Enable sync and configure the server URL
3. Click **Pair Mobile Device**
4. On the mobile app, go to **Settings**
5. Tap **Scan QR Code**
6. Point your camera at the QR code

The QR code contains:
- Server URL
- User credentials
- E2E encryption key (never sent to server)

## Building for TestFlight

### Export Compliance

The app has `ITSAppUsesNonExemptEncryption` set to `false` in `Info.plist`. This bypasses the export compliance questionnaire in App Store Connect.

While the app does use AES-256-GCM encryption for E2E session sync, it uses the Web Crypto API (`crypto.subtle`) which is provided by the operating system, not bundled encryption code. Apple's export compliance rules primarily concern encryption algorithms shipped with the app, not system-provided APIs.

If you add custom encryption libraries (e.g., bundled native crypto code), you may need to change this to `true` and answer the export compliance questions.

### Build Steps

1. Configure signing in Xcode:
   - Open `ios/App/App.xcworkspace`
   - Select the "App" target
   - Set your Team and Bundle Identifier

2. Build and archive:
   - Product > Archive
   - Distribute App > App Store Connect

3. Submit to TestFlight in App Store Connect.

## Troubleshooting

### "Module not found" errors
Run `npm install` at the monorepo root and rebuild:
```bash
npm install
npm run build --workspace @nimbalyst/runtime
npm run cap:sync --workspace @nimbalyst/capacitor
```

### Pod install issues
```bash
cd ios/App
pod install --repo-update
```

### Camera permission denied
Add to `ios/App/App/Info.plist`:
```xml
<key>NSCameraUsageDescription</key>
<string>Camera is used to scan QR codes for device pairing</string>
```

### WebSocket connection fails
- Check the server URL (ws:// for local, wss:// for production)
- Ensure the sync server is running
- Check network connectivity

## Component Guidelines

Since this package may share components with the Electron version, put React components that might be used by both platforms in the `runtime` package instead of here.
