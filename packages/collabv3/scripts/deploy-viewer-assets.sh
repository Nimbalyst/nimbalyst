#!/usr/bin/env bash
#
# Deploy viewer assets to R2 for the web extension viewer.
#
# Uploads React dependency bundles, the extension-sdk shim, and
# extension viewer bundles to the SESSION_SHARES R2 bucket under /viewer/.
#
# Usage:
#   ./scripts/deploy-viewer-assets.sh [--env staging|production]
#
# Prerequisites:
#   - wrangler CLI authenticated
#   - Extension bundles built (dist/index.js in each extension dir)
#   - Extension SDK built
#
# What gets uploaded:
#   viewer/deps/react.js           - React UMD → ESM wrapper
#   viewer/deps/react-dom.js       - ReactDOM UMD → ESM wrapper
#   viewer/deps/react-dom-client.js
#   viewer/deps/react-jsx-runtime.js
#   viewer/deps/extension-sdk.js   - createReadOnlyHost + useEditorLifecycle
#   viewer/ext/{name}-viewer.js    - Extension bundles
#   viewer/ext/{name}-viewer.css   - Extension styles

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COLLABV3_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$(dirname "$COLLABV3_DIR")")"
STAGING_DIR="$COLLABV3_DIR/.viewer-staging"

# Parse args
WRANGLER_EXTRA=""
REMOTE_FLAG=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --env) WRANGLER_EXTRA="--env $2"; REMOTE_FLAG="--remote"; shift 2 ;;
    --remote) REMOTE_FLAG="--remote"; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

R2_BUCKET="nimbalyst-session-shares"

echo "=== Deploy Viewer Assets ==="
echo "Repo root: $REPO_ROOT"
echo "Staging dir: $STAGING_DIR"
echo ""

# Clean staging
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR/viewer/deps" "$STAGING_DIR/viewer/ext"

# --- React dependency wrappers ---
# These are ES module wrappers that re-export from UMD globals.
# The extension viewer shell page loads React via <script> tags,
# and these modules let extensions use `import React from 'react'`.

echo "Creating React dependency wrappers..."

cat > "$STAGING_DIR/viewer/deps/react.js" << 'REACTEOF'
export * from 'https://esm.sh/react@18.3.1';
export { default } from 'https://esm.sh/react@18.3.1';
REACTEOF

cat > "$STAGING_DIR/viewer/deps/react-dom.js" << 'REACTDOMEOF'
export * from 'https://esm.sh/react-dom@18.3.1?external=react';
export { default } from 'https://esm.sh/react-dom@18.3.1?external=react';
REACTDOMEOF

cat > "$STAGING_DIR/viewer/deps/react-dom-client.js" << 'REACTDOMCLIENTEOF'
export * from 'https://esm.sh/react-dom@18.3.1/client?external=react';
REACTDOMCLIENTEOF

cat > "$STAGING_DIR/viewer/deps/react-jsx-runtime.js" << 'JSXEOF'
export * from 'https://esm.sh/react@18.3.1/jsx-runtime';
JSXEOF

cat > "$STAGING_DIR/viewer/deps/react-jsx-dev-runtime.js" << 'JSXDEVEOF'
export * from 'https://esm.sh/react@18.3.1/jsx-dev-runtime';
JSXDEVEOF

# @nimbalyst/runtime shim -- stub exports used by built-in extensions
cat > "$STAGING_DIR/viewer/deps/nimbalyst-runtime.js" << 'RUNTIMEEOF'
// Minimal @nimbalyst/runtime shim for web viewer.
// Stubs exports that built-in extensions import as externals.
import React from 'react';

// MaterialSymbol -- renders a Material Symbols icon via Google Fonts CSS
export function MaterialSymbol({ icon, size = 24, className = '', style = {} }) {
  return React.createElement('span', {
    className: `material-symbols-outlined ${className}`,
    style: { fontSize: size, ...style },
  }, icon);
}

// useDocumentPath -- returns the file path from EditorHost (no-op in viewer)
export function useDocumentPath() {
  return '';
}
RUNTIMEEOF

# @nimbalyst/editor-context shim
cat > "$STAGING_DIR/viewer/deps/nimbalyst-editor-context.js" << 'EDITORCTXEOF'
// Minimal @nimbalyst/editor-context shim for web viewer.
export {};
EDITORCTXEOF

# --- Extension SDK shim ---
# Build the extension-sdk and copy the relevant exports
echo "Building extension-sdk..."
EXTENSION_SDK_DIST="$REPO_ROOT/packages/extension-sdk/dist"
if [ ! -f "$EXTENSION_SDK_DIST/index.js" ]; then
  echo "Extension SDK not built. Building..."
  (cd "$REPO_ROOT/packages/extension-sdk" && npm run build 2>/dev/null || true)
fi

# For the web viewer, we need a minimal shim that provides createReadOnlyHost
# and useEditorLifecycle. Since the SDK is small, we can serve it directly.
if [ -f "$EXTENSION_SDK_DIST/createReadOnlyHost.js" ]; then
  cp "$EXTENSION_SDK_DIST/createReadOnlyHost.js" "$STAGING_DIR/viewer/deps/extension-sdk.js"
  echo "  Copied extension-sdk createReadOnlyHost"
else
  echo "  WARNING: extension-sdk not built or createReadOnlyHost.js not found"
  echo "  The viewer shell imports createReadOnlyHost from this file"
fi

# --- Extension bundles ---
echo ""
echo "Copying extension bundles..."

# Mindmap (external extension)
MINDMAP_DIR="$REPO_ROOT/../nimbalyst-mindmap"
if [ -f "$MINDMAP_DIR/dist/index.js" ]; then
  cp "$MINDMAP_DIR/dist/index.js" "$STAGING_DIR/viewer/ext/mindmap-viewer.js"
  echo "  mindmap-viewer.js ($(wc -c < "$MINDMAP_DIR/dist/index.js" | tr -d ' ') bytes)"
  if [ -f "$MINDMAP_DIR/dist/index.css" ]; then
    cp "$MINDMAP_DIR/dist/index.css" "$STAGING_DIR/viewer/ext/mindmap-viewer.css"
    echo "  mindmap-viewer.css ($(wc -c < "$MINDMAP_DIR/dist/index.css" | tr -d ' ') bytes)"
  fi
else
  echo "  WARNING: Mindmap extension not built at $MINDMAP_DIR/dist/index.js"
fi

# DataModelLM (built-in extension)
DATAMODELLM_DIR="$REPO_ROOT/packages/extensions/datamodellm"
if [ -f "$DATAMODELLM_DIR/dist/index.js" ]; then
  cp "$DATAMODELLM_DIR/dist/index.js" "$STAGING_DIR/viewer/ext/datamodellm-viewer.js"
  echo "  datamodellm-viewer.js ($(wc -c < "$DATAMODELLM_DIR/dist/index.js" | tr -d ' ') bytes)"
  if [ -f "$DATAMODELLM_DIR/dist/index.css" ]; then
    cp "$DATAMODELLM_DIR/dist/index.css" "$STAGING_DIR/viewer/ext/datamodellm-viewer.css"
    echo "  datamodellm-viewer.css ($(wc -c < "$DATAMODELLM_DIR/dist/index.css" | tr -d ' ') bytes)"
  fi
else
  echo "  WARNING: DataModelLM extension not built at $DATAMODELLM_DIR/dist/index.js"
fi

# Excalidraw (built-in extension)
EXCALIDRAW_DIR="$REPO_ROOT/packages/extensions/excalidraw"
if [ -f "$EXCALIDRAW_DIR/dist/index.js" ]; then
  cp "$EXCALIDRAW_DIR/dist/index.js" "$STAGING_DIR/viewer/ext/excalidraw-viewer.js"
  echo "  excalidraw-viewer.js ($(wc -c < "$EXCALIDRAW_DIR/dist/index.js" | tr -d ' ') bytes)"
  if [ -f "$EXCALIDRAW_DIR/dist/index.css" ]; then
    cp "$EXCALIDRAW_DIR/dist/index.css" "$STAGING_DIR/viewer/ext/excalidraw-viewer.css"
    echo "  excalidraw-viewer.css ($(wc -c < "$EXCALIDRAW_DIR/dist/index.css" | tr -d ' ') bytes)"
  fi
else
  echo "  WARNING: Excalidraw extension not built at $EXCALIDRAW_DIR/dist/index.js"
fi

# CSV Spreadsheet (built-in extension)
CSV_DIR="$REPO_ROOT/packages/extensions/csv-spreadsheet"
if [ -f "$CSV_DIR/dist/index.js" ]; then
  cp "$CSV_DIR/dist/index.js" "$STAGING_DIR/viewer/ext/csv-viewer.js"
  echo "  csv-viewer.js ($(wc -c < "$CSV_DIR/dist/index.js" | tr -d ' ') bytes)"
  if [ -f "$CSV_DIR/dist/index.css" ]; then
    cp "$CSV_DIR/dist/index.css" "$STAGING_DIR/viewer/ext/csv-viewer.css"
    echo "  csv-viewer.css ($(wc -c < "$CSV_DIR/dist/index.css" | tr -d ' ') bytes)"
  fi
else
  echo "  WARNING: CSV Spreadsheet extension not built at $CSV_DIR/dist/index.js"
fi

# MockupLM (built-in extension)
MOCKUP_DIR="$REPO_ROOT/packages/extensions/mockuplm"
if [ -f "$MOCKUP_DIR/dist/index.js" ]; then
  cp "$MOCKUP_DIR/dist/index.js" "$STAGING_DIR/viewer/ext/mockup-viewer.js"
  echo "  mockup-viewer.js ($(wc -c < "$MOCKUP_DIR/dist/index.js" | tr -d ' ') bytes)"
  if [ -f "$MOCKUP_DIR/dist/index.css" ]; then
    cp "$MOCKUP_DIR/dist/index.css" "$STAGING_DIR/viewer/ext/mockup-viewer.css"
    echo "  mockup-viewer.css ($(wc -c < "$MOCKUP_DIR/dist/index.css" | tr -d ' ') bytes)"
  fi
else
  echo "  WARNING: MockupLM extension not built at $MOCKUP_DIR/dist/index.js"
fi

# --- Upload to R2 ---
echo ""
echo "Uploading to R2 bucket: $R2_BUCKET"

# Upload each file
for file in $(find "$STAGING_DIR" -type f); do
  relative="${file#$STAGING_DIR/}"
  echo "  $relative"
  npx wrangler r2 object put "$R2_BUCKET/$relative" --file="$file" $REMOTE_FLAG $WRANGLER_EXTRA --content-type="$(
    case "${file##*.}" in
      js) echo "application/javascript" ;;
      css) echo "text/css" ;;
      json) echo "application/json" ;;
      *) echo "application/octet-stream" ;;
    esac
  )" 2>/dev/null
done

# Cleanup
rm -rf "$STAGING_DIR"

echo ""
echo "Done. Viewer assets deployed to R2."
echo "Extension viewers available: mindmap"
