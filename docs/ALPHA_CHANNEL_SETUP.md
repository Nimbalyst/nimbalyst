# Alpha Release Channel Setup Guide

This document explains how to complete the setup of the alpha release channel for Nimbalyst.

## Overview

The alpha release channel allows internal team members to receive early builds for testing before they're promoted to the public stable channel.

**How it works:**
- All releases automatically upload to Cloudflare R2
- Internal users opt into alpha channel via hidden UI option (command-click)
- Tested builds are manually promoted to GitHub Releases for public users

## Current Status

✅ **Completed:**
- R2 bucket created and configured
- Auto-updater routing implemented (R2 for alpha, GitHub for stable)
- UI implemented (command-click to reveal channel selector)
- Workflow updated to upload to R2

🚧 **Remaining:**
- Add GitHub secrets for R2 access
- Test the complete flow

## Step 1: Add GitHub Secrets

You need to add three secrets to your GitHub repository for the workflow to upload to R2.

### Navigate to Secrets Settings

1. Go to: https://github.com/nimbalyst/nimbalyst-code/settings/secrets/actions
2. Click **"New repository secret"** for each of the following:

### Secret 1: R2_ACCESS_KEY_ID

- **Name:** `R2_ACCESS_KEY_ID`
- **Value:** Your Cloudflare R2 Access Key ID (from the API token you created)
- Click **"Add secret"**

### Secret 2: R2_SECRET_ACCESS_KEY

- **Name:** `R2_SECRET_ACCESS_KEY`
- **Value:** Your Cloudflare R2 Secret Access Key (from the API token you created)
- Click **"Add secret"**

### Secret 3: CLOUDFLARE_ACCOUNT_ID

- **Name:** `CLOUDFLARE_ACCOUNT_ID`
- **Value:** Your Cloudflare Account ID

To find your Account ID:
1. Go to: https://dash.cloudflare.com/
2. Click on "R2" in the sidebar
3. Your Account ID is shown on the R2 Overview page
4. Or run: `wrangler whoami` if you have Wrangler CLI installed

## Step 2: Verify Secrets

After adding all three secrets, verify they appear in the repository secrets list:
- R2_ACCESS_KEY_ID
- R2_SECRET_ACCESS_KEY
- CLOUDFLARE_ACCOUNT_ID

## Step 3: Test the Workflow

### Trigger a Test Build

1. Go to: https://github.com/nimbalyst/nimbalyst-code/actions
2. Select "Build and Release Electron App" workflow
3. Click "Run workflow"
4. Set:
  - **branch:** `main` (or your current branch)
  - **Create a release:** `true`
  - **Create GitHub Release:** `false` (for testing)
5. Click "Run workflow"

### Verify Upload to R2

1. Wait for workflow to complete
2. Check workflow logs for "Upload to Cloudflare R2" step
3. Should see: "✅ Uploaded to R2 alpha channel"
4. Verify files in R2 bucket:
  - Go to: https://dash.cloudflare.com/
  - Navigate to R2 → Your bucket
  - Should see `.dmg`, `.zip`, `.yml` files

## Step 4: Test Alpha Channel in App

### Enable Alpha Channel

1. Open Nimbalyst
2. Go to Global Settings
3. Navigate to "Advanced Settings"
4. **Command-click** (Mac) or **Ctrl-click** (Windows) on the "Advanced Settings" title
5. Release Channel dropdown should appear
6. Select "Alpha (Internal Testing)"
7. Click "Save Changes"
8. Restart the app

### Verify Auto-Updater Configuration

Check the logs to confirm alpha channel is configured:
1. Open Console.app (Mac) or check app logs
2. Search for "Configuring alpha channel updates from"
3. Should see: `https://pub-4357a3345db7463580090984c0e4e2ba.r2.dev/`

### Test Update Check

1. In Nimbalyst, go to menu: Help → Check for Updates
2. If a build exists in R2:
  - Should show update available
  - Can download and install
3. If no build yet:
  - Should show "You are running the latest version"

## Step 5: Release Workflow

### For Alpha Releases (Internal Testing)

```bash
# Use the /release command or trigger workflow
# Set create_github_release = false
```

Result:
- ✅ Builds uploaded to R2
- ✅ Alpha users get update notification
- ❌ No GitHub Release created
- ❌ Public users don't see it

### For Stable Releases (Public)

After testing alpha build:

```bash
# Re-run the workflow
# Set create_github_release = true
```

Result:
- ✅ GitHub Release created
- ✅ Public/stable users get update notification
- ✅ Still in R2 (alpha users get it too)

## Troubleshooting

### Workflow fails at R2 upload

**Error:** "AWS credentials not found"
- **Solution:** Verify all three secrets are added correctly
- Check secret names match exactly (case-sensitive)

**Error:** "Access Denied"
- **Solution:** Verify R2 API token has "Object Read & Write" permissions
- Check token is for the correct bucket

### Auto-updater not finding updates

**Check 1:** Verify channel setting
```bash
# In app logs, should see:
"Configuring alpha channel updates from: https://pub-..."
```

**Check 2:** Verify R2 files
- Go to R2 bucket in Cloudflare dashboard
- Verify `latest-mac.yml` exists
- Verify file is not empty

**Check 3:** Verify R2 public access
- Public URL should be accessible
- Try opening in browser: `https://pub-4357a3345db7463580090984c0e4e2ba.r2.dev/latest-mac.yml`
- Should download the file

### Files not appearing in R2

**Issue:** Workflow completes but bucket is empty
- Check workflow logs for actual error messages
- Verify bucket name in workflow matches actual bucket name
- Verify CLOUDFLARE_ACCOUNT_ID is correct

## Distribution Info

**R2 Bucket:** `nimbalyst-alpha-updates-4357a3345db7463580090984c0e4e2ba`
**Public URL:** `https://pub-4357a3345db7463580090984c0e4e2ba.r2.dev/`
**Workflow:** `.github/workflows/electron-build.yml`

## Security Notes

- R2 URL is "secret" through obscurity (not advertised)
- Command-click requirement provides discovery barrier
- No authentication needed for updates (public read access)
- Acceptable for internal alpha testing
- If reverse-engineered, user is motivated enough to be alpha tester

## Next Steps

1. ✅ Add GitHub secrets (follow Step 1)
2. ✅ Test workflow upload (follow Step 3)
3. ✅ Test alpha channel in app (follow Step 4)
4. Document in RELEASING.md (final step)
