---
planStatus:
  planId: plan-alpha-release-channel
  title: Internal Alpha Release Channel
  status: in-development
  planType: feature
  priority: high
  owner: ghinkle
  stakeholders:
    - ghinkle
    - internal-team
  tags:
    - releases
    - distribution
    - auto-update
    - infrastructure
  created: "2025-11-02"
  updated: "2025-01-16T09:45:00.000Z"
  progress: 83
  startDate: "2025-01-16"
---

## Implementation Progress

- [x] Add releaseChannel setting to app settings schema
- [x] Implement command-click functionality in Global Settings UI to reveal channel selector
- [x] Add Release Channel dropdown (Stable/Alpha) to Global Settings
- [x] Update UpdateService to route to R2 or GitHub based on channel setting
- [x] Complete Cloudflare R2 setup (follow setup instructions in plan)
- [x] Update R2 bucket URL in autoUpdater.ts (replace TODO placeholder)
- [x] Update release workflow to upload to Cloudflare R2
- [x] Make GitHub Release creation optional/manual in workflow
- [x] Configure GitHub secrets (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID)
- [ ] Add current channel indicator to About dialog
- [ ] Test alpha channel opt-in flow with actual R2 bucket
- [ ] Test auto-updater with R2 feed URL
- [ ] Test switching between channels
- [ ] Document final setup steps in RELEASING.md

# Internal Alpha Release Channel

## Goals

- Provide a separate release channel for internal alpha users to receive early builds
- Keep alpha releases separate from stable public releases on GitHub
- Enable internal testing and feedback before wider distribution
- Maintain existing stable release process for public users
- Support automatic updates for both channels independently

## Problem Statement

Currently, all releases go to `github.com/nimbalyst/nimbalyst/releases` where they're visible to the public. We need a way to distribute internal alpha builds to a select group of users for testing before making releases publicly available.

Internal users need:
- Early access to new features for testing
- Automatic update notifications for alpha builds
- Ability to provide feedback before public release

The system must:
- Not interfere with the stable public release channel
- Not expose alpha builds to public users
- Support Electron's auto-update mechanism for both channels

## Approach

### Two-Channel System

**Stable Channel (existing):**
- Public releases on GitHub Releases
- Update feed: `github.com/nimbalyst/nimbalyst/releases`
- Target: General users
- Quality bar: Production-ready

**Alpha Channel (new):**
- All releases automatically published to Cloudflare R2
- Update feed: R2 bucket with non-obvious URL
- Target: Internal team members
- Quality bar: Feature-complete but potentially unstable
- Promotion: Good releases are manually promoted to GitHub public releases

### Distribution Approach: Security Through Obscurity with Cloudflare R2

**Selected approach: Cloudflare R2 bucket with non-obvious URL**

Why this approach:
Implementation details:
- No authentication tokens or credentials to distribute
- Simple infrastructure setup
- **Zero egress fees** (unlike S3, R2 doesn't charge for downloads)
- Built-in global CDN (Cloudflare's edge network)
- Faster downloads worldwide
- S3-compatible API (same tools work)
- Adequate security for internal alpha testing
- Standard Electron auto-updater support

- Create R2 bucket with non-obvious name (e.g., `nimbalyst-alpha-updates`)
- Use hard-to-guess path structure (e.g., `/builds/v2/alpha/`)
- Make bucket publicly readable but don't advertise the URL
- Use R2 public URL (e.g., `https://pub-a8f92b3c.r2.dev/`) or custom domain
- Update feed URL is hardcoded in app, only accessible via command-click option
- Upload standard auto-update files (`latest-mac.yml`, `.dmg`, `.zip`)

Security characteristics:
- URL only exists in compiled app code
- Bucket name is non-obvious and not linked anywhere public
- Command-click UI requirement provides additional barrier
- No credentials needed for updates
- If reverse-engineered, user is motivated enough to be an alpha tester anyway

Cost advantages over S3:
- Storage: ~$0.015/GB/month (similar to S3)
- Bandwidth: **$0** (S3 charges ~$0.09/GB for egress)
- For alpha distribution with ~10 users downloading ~500MB builds: essentially free

### Channel Selection

**Approach: Hidden UI option revealed by command-click**

Users opt into alpha channel via:
- Command-click (Mac) / Ctrl-click (Windows) on "Advanced Settings" button in Global Settings
- Reveals "Release Channel" dropdown with Stable/Alpha options
- Selection is stored in app settings
- Default is always Stable channel

This approach:
- Prevents casual users from accidentally discovering alpha channel
- No separate builds needed
- No credentials or special access required
- Easy for internal team to enable

## Key Components

### Release Process Changes

**Affected files:**
- `.github/workflows/release.yml` - Add R2 upload step to existing workflow
- `package.json` - No changes needed (use existing `/release` command)
- `electron-builder.yml` - No changes needed

**New unified release workflow:**
1. Use existing `/release [patch|minor|major]` command
2. GitHub Actions builds the release
3. **Automatically uploads to Cloudflare R2** (all releases)
4. **Manual promotion to GitHub Releases** (only stable releases)

**Promotion workflow:**
- Internal team tests the R2 release
- If stable enough, manually create GitHub Release
- Copy build artifacts from R2 or re-upload to GitHub
- Public users receive update from GitHub feed

### Auto-Update Configuration

**Affected files:**
- `packages/electron/src/main/index.ts` - Update checker configuration
- `packages/electron/src/main/services/UpdateService.ts` - Channel selection logic
- App settings storage - Store channel preference

**Update feed routing:**
- Detect user's selected channel from settings
- Point auto-updater to appropriate feed URL
- Handle authentication if using private distribution

### Channel Settings UI

**Affected files:**
- Settings panel component
- Settings schema and storage

**UI elements:**
- Channel selection dropdown (Stable/Alpha)
- Warning message about alpha instability
- Current channel indicator in About dialog

### Version Management

**Affected files:**
- Version scripts in package.json
- Release command implementation

**Versioning:**
- All releases use standard semver: `X.Y.Z`
- No special alpha suffix needed
- R2 always has latest build
- GitHub Releases only has manually promoted stable builds

## Distribution Implementation Details

### Cloudflare R2 Setup Instructions

**Step 1: Create R2 bucket**

1. Log in to Cloudflare Dashboard
2. Navigate to **R2 Object Storage** in the left sidebar
3. Click **Create bucket**
4. Enter bucket name: Use a non-obvious identifier (e.g., `nimbalyst-alpha-updates-a8f92b3c`)
5. Choose location: Automatic (recommended) or specific region
6. Click **Create bucket**

**Step 2: Enable public access**

1. Open your newly created bucket
2. Go to **Settings** tab
3. Scroll to **Public access** section
4. Click **Allow Access** under "Public URL Access"
5. Copy the public R2.dev URL that appears (e.g., `https://pub-a8f92b3c.r2.dev/`)
6. Save this URL - you'll need it for the app configuration

**Step 3: Create API token for GitHub Actions**

1. In Cloudflare Dashboard, go to **R2** → **Overview**
2. Click **Manage R2 API Tokens** button
3. Click **Create API Token**
4. Configure the token:
  - **Token name**: `nimbalyst-github-actions`
  - **Permissions**: Select "Object Read & Write"
  - **Apply to specific buckets only**: Select your bucket (`nimbalyst-alpha-updates-a8f92b3c`)
  - **TTL**: Leave as "Forever" (or set expiration if preferred)
5. Click **Create API Token**
6. **IMPORTANT**: Copy both values immediately (you won't see them again):
  - **Access Key ID** (e.g., `a1b2c3d4e5f6g7h8i9j0`)
  - **Secret Access Key** (e.g., `1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0`)
7. Also note your **Account ID** from the R2 Overview page (e.g., `1234567890abcdef1234567890abcdef`)

**Step 4: Configure GitHub Secrets**

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** and add each of these:

   **Secret 1:**
  - Name: `R2_ACCESS_KEY_ID`
  - Value: [Paste the Access Key ID from Step 3]

   **Secret 2:**
  - Name: `R2_SECRET_ACCESS_KEY`
  - Value: [Paste the Secret Access Key from Step 3]

   **Secret 3:**
  - Name: `CLOUDFLARE_ACCOUNT_ID`
  - Value: [Paste your Account ID from Step 3]

4. Verify all three secrets are created

**Step 5: Optional - Set up custom domain**

If you want to use a custom domain instead of the R2.dev URL:

1. In your R2 bucket settings, go to **Settings** tab
2. Scroll to **Custom Domains** section
3. Click **Connect Domain**
4. Enter your domain (e.g., `alpha-updates.nimbalyst.com`)
5. If your domain is managed by Cloudflare, DNS records are created automatically
6. If not, follow the instructions to add the required DNS records
7. Wait for DNS propagation (usually a few minutes)
8. Use this custom domain in your app configuration instead of the R2.dev URL

**File structure:**
```
/ (bucket root)
  ├── latest-mac.yml          # Update manifest (overwritten each release)
  ├── Nimbalyst-1.2.3-mac.zip
  ├── Nimbalyst-1.2.3.dmg
  └── Nimbalyst-1.2.3.dmg.blockmap
```

Note: Each release overwrites the previous one in R2. Only the latest build is kept.

### Auto-Updater Configuration

**In UpdateService.ts:**

Update the feed URL configuration to use the R2 public URL from Step 2 above:

```typescript
const channel = await this.settingsService.get('releaseChannel') || 'stable';

if (channel === 'alpha') {
  // Use the R2 public URL from Step 2 of setup (replace with your actual URL)
  const alphaFeedURL = 'https://pub-a8f92b3c.r2.dev/';
  // Or with custom domain from Step 5:
  // const alphaFeedURL = 'https://alpha-updates.nimbalyst.com/';
  autoUpdater.setFeedURL(alphaFeedURL);
} else {
  // Default GitHub releases feed (manually promoted stable releases only)
  autoUpdater.setFeedURL('https://github.com/nimbalyst/nimbalyst/releases');
}
```

**Important:** Replace `https://pub-a8f92b3c.r2.dev/` with your actual R2 public URL from the setup steps.

### GitHub Actions Workflow Changes

Modify existing `.github/workflows/release.yml` to add R2 upload step:

```yaml
# Add after the existing build steps, before GitHub Release creation

- name: Upload to Cloudflare R2 (all releases)
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
  run: |
    # Install AWS CLI if not already available
    pip install awscli

    # Upload to R2 (always happens)
    # Replace 'nimbalyst-alpha-updates-a8f92b3c' with your actual bucket name
    aws s3 sync dist/ s3://nimbalyst-alpha-updates-a8f92b3c/ \
      --endpoint-url https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com \
      --exclude "*" \
      --include "*.dmg" \
      --include "*.zip" \
      --include "*.yml" \
      --include "*.blockmap"

# GitHub Release creation becomes manual or conditional
# Remove automatic GitHub Release creation from workflow
# Team manually creates GitHub Release for stable versions
```

**Important:** Update the bucket name in the workflow to match your actual bucket name from Step 1.

**Required GitHub Secrets** (configured in Step 4):
- `R2_ACCESS_KEY_ID` - From Cloudflare R2 API token
- `R2_SECRET_ACCESS_KEY` - From Cloudflare R2 API token
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID

**Manual promotion to GitHub:**
1. Test the release on alpha channel
2. If stable, go to GitHub → Releases → Draft new release
3. Upload build artifacts from local build or download from R2
4. Publish release (makes it available to public/stable users)

**Verification:**

Test the R2 upload by running the workflow:
1. Trigger a release using the `/release` command
2. Check GitHub Actions logs to verify R2 upload succeeded
3. Visit your R2 bucket in Cloudflare Dashboard to confirm files are present
4. Test the public URL: `https://pub-[your-id].r2.dev/latest-mac.yml` should download the manifest

## User Experience

### Opting Into Alpha

1. User opens Global Settings window
2. Command-clicks (Mac) or Ctrl-clicks (Windows) the "Advanced Settings" button
3. Release Channel dropdown appears
4. Selects "Alpha" from dropdown
5. Sees warning message: "Alpha releases may be unstable and are intended for internal testing"
6. Closes settings
7. App automatically checks for alpha updates on next update check

### Receiving Alpha Updates

1. New build is released (via `/release` command)
2. Automatically uploaded to R2
3. Alpha channel users receive update notification
4. Download and install follows existing auto-update flow
5. Version shows current version number in About dialog

### Opting Out of Alpha

1. User changes channel back to "Stable"
2. App checks for latest stable release
3. If current alpha version > latest stable, no downgrade
4. Future updates come from stable channel only

## Security and Access Control

- Alpha builds contain identical code to stable builds (same API keys, same secrets)
- Access control via security through obscurity:
-   - Non-obvious R2 bucket name
  - Hard-to-guess path structure
  - No public documentation of alpha channel or R2 URL
  - Command-click UI requirement provides discovery barrier
- Internal team shares instructions privately (documentation, Slack, etc.)
- R2 bucket URL is only in compiled app code
- If someone reverse-engineers the app, they can access alpha builds (acceptable risk)
- Cloudflare's global CDN provides fast downloads without additional cost

## Acceptance Criteria

- [ ] Internal users can opt into alpha channel via command-click in settings
- [ ] All releases automatically upload to R2
- [ ] Auto-updater correctly checks R2 when alpha channel selected
- [ ] Auto-updater checks GitHub when stable channel selected
- [ ] Public users cannot accidentally discover alpha channel (command-click required)
- [ ] Existing `/release` command uploads to both R2 (automatic) and supports manual GitHub promotion
- [ ] Documentation explains how to promote releases from R2 to GitHub
- [ ] Settings UI clearly indicates current channel
- [ ] Switching channels does not require manual reinstallation
- [ ] GitHub Release creation is removed from automatic workflow (manual only)

## Open Questions

1. How should we handle downgrades when users switch from alpha to stable? (Current plan: no automatic downgrade, they stay on current version until next stable release)
2. Should there be automated notifications to internal team when builds are uploaded to R2? (Slack/Discord webhook?)
3. Do we need analytics/telemetry to differentiate alpha vs stable channel users?
4. Should we use a custom domain (e.g., `alpha-updates.nimbalyst.com`) or just use the R2.dev URL?
5. Should we keep old builds in R2 with version-specific paths, or always overwrite with latest? (Current plan: overwrite, only keep latest)

## Migration Path

Since this is a new feature, no migration is needed. Existing users remain on stable channel by default. The implementation should be additive and not disrupt current release process.
