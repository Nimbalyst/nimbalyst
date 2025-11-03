/**
 * Popup UI script for Nimbalyst Web Clipper
 */

// DOM elements
const clipPageBtn = document.getElementById('clipPageBtn');
const clipSelectionBtn = document.getElementById('clipSelectionBtn');
const clipWithAIBtn = document.getElementById('clipWithAIBtn');
const aiPromptContainer = document.getElementById('aiPromptContainer');
const aiPromptInput = document.getElementById('aiPromptInput');
const cancelAIBtn = document.getElementById('cancelAIBtn');
const submitAIBtn = document.getElementById('submitAIBtn');
const statusMessage = document.getElementById('statusMessage');
const pageTitle = document.getElementById('pageTitle');

// State
let currentTab = null;
let pageData = null;

/**
 * Initialize popup
 */
async function init() {
  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    // Update page title
    pageTitle.textContent = tab.title;

    // Get page data from content script
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getMarkdown' });

    if (response.success) {
      pageData = response;

      // Enable clip selection button if there's a selection
      if (response.selection) {
        clipSelectionBtn.disabled = false;
      }
    } else {
      showStatus('error', 'Failed to load page content');
    }
  } catch (error) {
    console.error('Error initializing popup:', error);
    showStatus('error', 'Error loading page. Try refreshing.');
  }
}

/**
 * Show status message
 */
function showStatus(type, message) {
  statusMessage.className = `status-message ${type}`;
  statusMessage.textContent = message;

  if (type === 'success') {
    setTimeout(() => {
      statusMessage.className = 'status-message';
    }, 3000);
  }
}

/**
 * Clip full page
 */
async function clipPage() {
  if (!pageData) return;

  try {
    clipPageBtn.disabled = true;
    showStatus('info', 'Clipping page...');

    const response = await chrome.runtime.sendMessage({
      action: 'clipPage',
      data: {
        title: pageData.metadata.title,
        url: pageData.metadata.url,
        content: pageData.markdown,
        selection: null,
      },
    });

    if (response.success) {
      showStatus('success', 'Page clipped to Nimbalyst!');
      setTimeout(() => window.close(), 1500);
    } else {
      showStatus('error', 'Failed to clip page');
      clipPageBtn.disabled = false;
    }
  } catch (error) {
    console.error('Error clipping page:', error);
    showStatus('error', 'Error clipping page');
    clipPageBtn.disabled = false;
  }
}

/**
 * Clip selection
 */
async function clipSelection() {
  if (!pageData || !pageData.selection) return;

  try {
    clipSelectionBtn.disabled = true;
    showStatus('info', 'Clipping selection...');

    const response = await chrome.runtime.sendMessage({
      action: 'clipPage',
      data: {
        title: pageData.metadata.title,
        url: pageData.metadata.url,
        content: pageData.markdown,
        selection: pageData.selection,
      },
    });

    if (response.success) {
      showStatus('success', 'Selection clipped to Nimbalyst!');
      setTimeout(() => window.close(), 1500);
    } else {
      showStatus('error', 'Failed to clip selection');
      clipSelectionBtn.disabled = false;
    }
  } catch (error) {
    console.error('Error clipping selection:', error);
    showStatus('error', 'Error clipping selection');
    clipSelectionBtn.disabled = false;
  }
}

/**
 * Show AI prompt input
 */
function showAIPrompt() {
  aiPromptContainer.classList.remove('hidden');
  aiPromptInput.focus();
}

/**
 * Hide AI prompt input
 */
function hideAIPrompt() {
  aiPromptContainer.classList.add('hidden');
  aiPromptInput.value = '';
}

/**
 * Submit AI extraction
 */
async function submitAIExtraction() {
  if (!pageData) return;

  const prompt = aiPromptInput.value.trim();
  if (!prompt) {
    showStatus('error', 'Please enter a prompt');
    return;
  }

  try {
    submitAIBtn.disabled = true;
    showStatus('info', 'Extracting with AI...');

    const response = await chrome.runtime.sendMessage({
      action: 'clipWithAI',
      data: {
        title: pageData.metadata.title,
        url: pageData.metadata.url,
        content: pageData.markdown,
        selection: pageData.selection,
        aiPrompt: prompt,
      },
    });

    if (response.success) {
      showStatus('success', 'Content sent to Nimbalyst for AI extraction!');
      setTimeout(() => window.close(), 1500);
    } else {
      showStatus('error', 'Failed to send for AI extraction');
      submitAIBtn.disabled = false;
    }
  } catch (error) {
    console.error('Error submitting AI extraction:', error);
    showStatus('error', 'Error processing request');
    submitAIBtn.disabled = false;
  }
}

// Event listeners
clipPageBtn.addEventListener('click', clipPage);
clipSelectionBtn.addEventListener('click', clipSelection);
clipWithAIBtn.addEventListener('click', showAIPrompt);
cancelAIBtn.addEventListener('click', hideAIPrompt);
submitAIBtn.addEventListener('click', submitAIExtraction);

// Handle Enter key in AI prompt
aiPromptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    submitAIExtraction();
  }
});

// Initialize on load
init();
