import TurndownService from 'turndown';

/**
 * Content script that runs on all web pages
 * Handles extracting page content and converting to markdown
 */

// Initialize Turndown service for HTML to markdown conversion
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Custom rule for images - convert to absolute URLs
turndown.addRule('images', {
  filter: 'img',
  replacement: (content, node) => {
    const src = node.getAttribute('src');
    const alt = node.getAttribute('alt') || '';

    if (!src) return '';

    try {
      // Convert relative URLs to absolute
      const absoluteSrc = new URL(src, window.location.href).href;
      return `![${alt}](${absoluteSrc})`;
    } catch (e) {
      console.error('Error converting image URL:', e);
      return '';
    }
  }
});

// Custom rule for links - preserve absolute URLs
turndown.addRule('links', {
  filter: 'a',
  replacement: (content, node) => {
    const href = node.getAttribute('href');
    const title = node.getAttribute('title');

    if (!href) return content;

    try {
      const absoluteHref = new URL(href, window.location.href).href;
      return title
        ? `[${content}](${absoluteHref} "${title}")`
        : `[${content}](${absoluteHref})`;
    } catch (e) {
      console.error('Error converting link URL:', e);
      return content;
    }
  }
});

/**
 * Extract the main content from the page
 * Tries to find the main article content, falls back to body
 */
function extractMainContent() {
  // Try to find the main content area
  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '.article-content',
    '.post-content',
    '.entry-content',
    '#content',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }

  // Fall back to body
  return document.body;
}

/**
 * Convert the current page to markdown
 */
function convertPageToMarkdown() {
  const content = extractMainContent();
  return turndown.turndown(content);
}

/**
 * Get page metadata
 */
function getPageMetadata() {
  // Try to extract author
  let author = '';
  const authorMeta = document.querySelector('meta[name="author"]');
  const authorEl = document.querySelector('.author, .byline, [rel="author"]');

  if (authorMeta) {
    author = authorMeta.getAttribute('content') || '';
  } else if (authorEl) {
    author = authorEl.textContent?.trim() || '';
  }

  // Try to extract publication date
  let publishedDate = '';
  const dateMeta = document.querySelector('meta[property="article:published_time"]');
  const dateEl = document.querySelector('time[datetime]');

  if (dateMeta) {
    publishedDate = dateMeta.getAttribute('content') || '';
  } else if (dateEl) {
    publishedDate = dateEl.getAttribute('datetime') || '';
  }

  return {
    title: document.title,
    url: window.location.href,
    author,
    publishedDate,
    clippedAt: new Date().toISOString(),
  };
}

/**
 * Get selected text as markdown (if any)
 */
function getSelectedMarkdown() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const container = document.createElement('div');
  container.appendChild(range.cloneContents());

  return turndown.turndown(container);
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getMarkdown') {
    try {
      const markdown = convertPageToMarkdown();
      const metadata = getPageMetadata();
      const selection = getSelectedMarkdown();

      sendResponse({
        success: true,
        markdown,
        metadata,
        selection,
      });
    } catch (error) {
      console.error('Error converting page to markdown:', error);
      sendResponse({
        success: false,
        error: error.message,
      });
    }
    return true; // Keep channel open for async response
  }

  if (request.action === 'getSelection') {
    try {
      const selection = getSelectedMarkdown();
      const metadata = getPageMetadata();

      sendResponse({
        success: true,
        selection,
        metadata,
      });
    } catch (error) {
      console.error('Error getting selection:', error);
      sendResponse({
        success: false,
        error: error.message,
      });
    }
    return true;
  }
});

console.log('Nimbalyst Web Clipper content script loaded');
