# Nimbalyst Browser Extension

A Chrome browser extension for clipping web pages and extracting content with AI directly into your Nimbalyst projects.

## Features

- **Simple Clipping**: Convert web pages to markdown with a single click
- **Selection Clipping**: Clip only the selected text from a page
- **AI-Powered Extraction**: Use AI to extract specific information or transform content
- **Context Menu Integration**: Right-click anywhere to clip content
- **Smart Content Detection**: Automatically finds the main article content
- **Image Handling**: Preserves images as URLs for Nimbalyst to download locally
- **Metadata Extraction**: Captures page title, URL, author, and publication date

## Installation

### Development Installation

1. Build the extension:
   ```bash
   cd packages/browser-extension
   npm install
   npm run build
   ```

2. Load the extension in Chrome:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right corner)
   - Click "Load unpacked"
   - Select the `packages/browser-extension/dist` directory

3. The Nimbalyst icon should appear in your browser toolbar

### Production Installation

*(Coming soon - will be available in the Chrome Web Store)*

## Usage

### Quick Clip via Popup

1. Navigate to any web page you want to clip
2. Click the Nimbalyst extension icon in your toolbar
3. Choose an action:
   - **Clip Page**: Clips the entire page content
   - **Clip Selection**: Clips only selected text (if any text is selected)
   - **Extract with AI**: Enter a prompt to extract specific information

### Quick Clip via Context Menu

1. Right-click anywhere on a web page
2. Select one of the Nimbalyst options:
   - **Clip page to Nimbalyst**: Clips the entire page
   - **Clip selection to Nimbalyst**: Clips selected text
   - **Extract with AI...**: Opens a prompt for AI-powered extraction

### How Clipping Works

When you clip a page:

1. The extension converts the HTML to clean markdown
2. Images are kept as absolute URLs
3. Content is base64-encoded and sent via `nimbalyst://clip` protocol URL
4. Nimbalyst receives the clip, creates a markdown file, and downloads images
5. The clip appears in your project with full metadata

### AI-Powered Extraction

The AI extraction feature allows you to:

- Extract specific data (e.g., "Extract all product names and prices into a table")
- Summarize content (e.g., "Summarize the main points of this article")
- Transform format (e.g., "Convert this tutorial into a step-by-step checklist")
- Filter information (e.g., "Extract only the JavaScript code examples")

Example prompts:
- "Extract all product names and prices into a table"
- "Summarize the key takeaways in bullet points"
- "Extract the recipe ingredients and instructions"
- "List all the mentioned books with their authors"

## Technical Details

### Architecture

- **Content Script** (`content.js`): Runs on all web pages, handles HTML to markdown conversion using Turndown
- **Background Service Worker** (`background.js`): Manages context menus and protocol URL generation
- **Popup UI** (`popup.html/js/css`): Provides quick access interface

### Communication Protocol

The extension uses the `nimbalyst://clip` custom protocol to send clips to Nimbalyst:

```
nimbalyst://clip?url=...&title=...&content=...&selection=...&aiPrompt=...
```

Parameters are base64-encoded to handle special characters and preserve formatting.

### Size Limits

- Content under 1.5MB: Sent directly via protocol URL
- Content over 1.5MB: Falls back to URL-only mode (Nimbalyst downloads server-side)

## Development

### Building

```bash
npm run build        # Build once
npm run watch        # Build and watch for changes
npm run clean        # Clean dist directory
```

### File Structure

```
packages/browser-extension/
├── src/
│   ├── background/
│   │   └── background.js      # Service worker
│   ├── content/
│   │   └── content.js         # Content script
│   └── popup/
│       ├── popup.html         # Popup UI
│       ├── popup.css          # Popup styles
│       └── popup.js           # Popup logic
├── icons/                     # Extension icons
├── manifest.json              # Chrome extension manifest
├── build.js                   # Build script
└── package.json
```

### Testing

To test the extension:

1. Load it in Chrome as described in Installation
2. Open the Chrome DevTools console for debugging
3. Check the extension's service worker console: `chrome://extensions/` > Details > Service worker
4. Test on various websites to ensure compatibility

## Browser Support

Currently supports:
- Chrome (Manifest V3)
- Edge (Chromium-based)

Future support planned:
- Firefox
- Safari

## Integration with Nimbalyst

This extension requires Nimbalyst desktop app v0.45.0 or later with:
- `nimbalyst://` protocol handler registered
- Web clipping tracker type configured
- Image download infrastructure

See the Nimbalyst documentation for setup instructions.

## Permissions

The extension requires the following permissions:

- `activeTab`: Access the current tab's content for clipping
- `contextMenus`: Add right-click menu options
- `storage`: Save user preferences (future use)
- `<all_urls>`: Access content from any website for clipping

All permissions are used exclusively for clipping functionality. No data is sent anywhere except to your local Nimbalyst installation via the protocol handler.

## Privacy

- No data is collected or sent to external servers
- All processing happens locally in your browser
- Clips are sent only to your local Nimbalyst app via custom protocol
- No analytics or tracking

## Troubleshooting

### Extension doesn't appear
- Make sure you've enabled Developer mode in `chrome://extensions/`
- Verify the extension is loaded and enabled
- Try reloading the extension

### Clipping doesn't work
- Ensure Nimbalyst desktop app is installed and running
- Verify the `nimbalyst://` protocol is registered (try opening `nimbalyst://clip` in browser)
- Check the browser console for errors

### AI extraction not working
- Ensure you have AI configured in Nimbalyst
- Check that the AI provider has available quota
- Try a simpler prompt first

### Images not downloading
- Check that Nimbalyst has write access to the project directory
- Verify the `.nimbalyst/assets/` folder exists
- Check Nimbalyst console for image download errors

## Future Enhancements

- Batch clipping of multiple tabs
- Tag suggestions based on page content
- Screenshot capture alongside markdown
- Browser bookmark sync
- Reading list integration
- Annotation support before clipping
- Bookmarklet version using same protocol

## License

Part of the Nimbalyst project. See repository root for license information.
