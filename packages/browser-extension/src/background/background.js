/**
 * Background service worker for Nimbalyst Web Clipper
 * Handles context menus, message routing, and protocol URL generation
 */

const NIMBALYST_PROTOCOL = 'nimbalyst://';
const MAX_URL_LENGTH = 1500000; // 1.5MB threshold for base64 content

/**
 * Initialize context menus on installation
 */
chrome.runtime.onInstalled.addListener(() => {
  // Create context menu for clipping
  chrome.contextMenus.create({
    id: 'clip-page',
    title: 'Clip page to Nimbalyst',
    contexts: ['page', 'selection'],
  });

  chrome.contextMenus.create({
    id: 'clip-selection',
    title: 'Clip selection to Nimbalyst',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: 'clip-with-ai',
    title: 'Extract with AI...',
    contexts: ['page', 'selection'],
  });

  console.log('Nimbalyst Web Clipper installed');
});

/**
 * Base64 encode a string (handles UTF-8 correctly)
 */
function base64Encode(str) {
  // Use TextEncoder for proper UTF-8 handling
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join('');
  return btoa(binString);
}

/**
 * Generate nimbalyst:// protocol URL for clipping
 */
function generateClipURL({ title, url, content, selection, aiPrompt }) {
  const params = new URLSearchParams();

  params.set('url', url);
  params.set('title', title);

  // Encode content if provided
  if (content) {
    const contentB64 = base64Encode(content);

    // Check size - if too large, fall back to URL-only mode
    if (contentB64.length > MAX_URL_LENGTH) {
      params.set('downloadFull', 'true');
      console.log('Content too large, falling back to server-side download');
    } else {
      params.set('content', contentB64);
    }
  }

  // Encode selection if provided
  if (selection) {
    const selectionB64 = base64Encode(selection);
    params.set('selection', selectionB64);
  }

  // Add AI prompt if provided
  if (aiPrompt) {
    const promptB64 = base64Encode(aiPrompt);
    params.set('aiPrompt', promptB64);
  }

  return `${NIMBALYST_PROTOCOL}clip?${params.toString()}`;
}

/**
 * Send clip to Nimbalyst by opening protocol URL
 */
async function sendClipToNimbalyst(clipData) {
  const url = generateClipURL(clipData);

  try {
    // Open the protocol URL (this will launch/activate Nimbalyst)
    await chrome.tabs.create({ url, active: false });

    // Close the tab immediately (it just triggers the protocol handler)
    const tabs = await chrome.tabs.query({ url });
    if (tabs.length > 0) {
      await chrome.tabs.remove(tabs[0].id);
    }

    console.log('Clip sent to Nimbalyst');
    return { success: true };
  } catch (error) {
    console.error('Error sending clip:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle context menu clicks
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    // Get page content from content script
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: info.selectionText ? 'getSelection' : 'getMarkdown',
    });

    if (!response.success) {
      console.error('Failed to get page content:', response.error);
      return;
    }

    const { markdown, metadata, selection } = response;

    if (info.menuItemId === 'clip-page') {
      // Clip full page
      await sendClipToNimbalyst({
        title: metadata.title,
        url: metadata.url,
        content: markdown,
        selection: null,
        aiPrompt: null,
      });
    } else if (info.menuItemId === 'clip-selection') {
      // Clip selection only
      await sendClipToNimbalyst({
        title: metadata.title,
        url: metadata.url,
        content: markdown,
        selection: selection || info.selectionText,
        aiPrompt: null,
      });
    } else if (info.menuItemId === 'clip-with-ai') {
      // Show popup to get AI prompt
      // For now, use a simple prompt
      const aiPrompt = prompt(
        'What would you like to extract from this page?\n\nExample: "Extract all product names and prices into a table"'
      );

      if (aiPrompt) {
        await sendClipToNimbalyst({
          title: metadata.title,
          url: metadata.url,
          content: markdown,
          selection: selection || info.selectionText,
          aiPrompt,
        });
      }
    }
  } catch (error) {
    console.error('Error handling context menu click:', error);
  }
});

/**
 * Handle messages from popup or content scripts
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'clipPage') {
    handleClipPage(request.data)
      .then(sendResponse)
      .catch((error) => {
        console.error('Error clipping page:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }

  if (request.action === 'clipWithAI') {
    handleClipWithAI(request.data)
      .then(sendResponse)
      .catch((error) => {
        console.error('Error clipping with AI:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

/**
 * Handle clip page request from popup
 */
async function handleClipPage(data) {
  return await sendClipToNimbalyst({
    title: data.title,
    url: data.url,
    content: data.content,
    selection: data.selection,
    aiPrompt: null,
  });
}

/**
 * Handle clip with AI request from popup
 */
async function handleClipWithAI(data) {
  return await sendClipToNimbalyst({
    title: data.title,
    url: data.url,
    content: data.content,
    selection: data.selection,
    aiPrompt: data.aiPrompt,
  });
}

console.log('Nimbalyst Web Clipper background service worker loaded');
