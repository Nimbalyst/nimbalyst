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
| `npm run fastlane:setup` | Install fastlane and dependencies |
| `npm run fastlane:device` | Build and install on connected device |
| `npm run fastlane:build` | Build for App Store/TestFlight |
| `npm run fastlane:beta` | Build and upload to TestFlight |
| `npm run fastlane:deploy` | Alias for beta (build + upload) |
| `npm run fastlane:setup-signing` | Initialize code signing with match |
| `npm run fastlane:sync-signing` | Refresh certificates/profiles |

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

## Fastlane for iOS Deployment

Fastlane automates iOS builds and TestFlight deployments. All fastlane commands should be run from `packages/capacitor`.

### Quick Reference

| Command | Description |
|---------|-------------|
| `npm run fastlane:setup` | Install fastlane and dependencies |
| `npm run fastlane:device` | Build and install on connected device |
| `npm run fastlane:build` | Build for App Store/TestFlight |
| `npm run fastlane:beta` | Build and upload to TestFlight |
| `npm run fastlane:deploy` | Alias for beta (build + upload) |
| `npm run fastlane:setup-signing` | Initialize code signing with match |
| `npm run fastlane:sync-signing` | Refresh certificates/profiles |

### First-Time Setup

1. **Install fastlane dependencies**:
   ```bash
   cd packages/capacitor
   npm run fastlane:setup
   ```

2. **Configure environment variables** - create `ios/fastlane/.env`:
   ```bash
   cd ios/fastlane
   cp .env.example .env
   # Edit .env with your credentials
   ```

   Required variables:
   - `APPLE_ID` - Your Apple Developer email
   - `TEAM_ID` - Apple Developer Team ID (found in App Store Connect > Membership)
   - `MATCH_GIT_URL` - Private git repo for certificates (e.g., `git@github.com:org/certificates.git`)
   - `MATCH_PASSWORD` - Encryption password for match

   Optional (for automated uploads):
   - `APP_STORE_CONNECT_API_KEY_KEY_ID`
   - `APP_STORE_CONNECT_API_KEY_ISSUER_ID`
   - `APP_STORE_CONNECT_API_KEY_KEY` (base64-encoded .p8 file)

3. **Set up code signing** (first time only):
   ```bash
   npm run fastlane:setup-signing
   ```

### Development: Install on Device

To build and install on a connected iOS device (via USB or WiFi):

```bash
npm run fastlane:device
```

This uses automatic signing and `xcrun devicectl` to install the app. Make sure your device is:
- Connected via USB, or
- On the same WiFi network with "Connect via network" enabled in Xcode > Window > Devices

### TestFlight Deployment

```bash
# Build only (creates .ipa)
npm run fastlane:build

# Build and upload to TestFlight
npm run fastlane:beta
```

The build process:
1. Builds web assets with Vite
2. Syncs to iOS via Capacitor
3. Increments build number automatically
4. Builds signed .ipa for App Store

### Registering Test Devices

1. Edit `ios/fastlane/devices.txt`:
   ```
   Device ID	Device Name	Device Platform
   00008030-001234567890ABCD	John's iPhone	ios
   ```

2. Register devices:
   ```bash
   cd ios && bundle exec fastlane register_devices
   ```

3. Regenerate profiles:
   ```bash
   npm run fastlane:sync-signing
   ```

### Common Issues

**Code signing errors**: Make sure `.env` credentials are correct, then try:
```bash
cd ios && bundle exec fastlane match nuke distribution
npm run fastlane:setup-signing
```

**No connected device found**: Ensure device is connected via USB or WiFi pairing is enabled.

**Build number conflict**: Manually increment if needed:
```bash
cd ios && bundle exec fastlane run increment_build_number xcodeproj:"App/App.xcodeproj"
```

See `FASTLANE_SETUP.md` for detailed setup instructions.

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
