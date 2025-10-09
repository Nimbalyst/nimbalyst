// Update window renderer script
declare global {
  interface Window {
    electronAPI: {
      send: (channel: string, data?: any) => void;
      on: (channel: string, callback: (...args: any[]) => void) => void;
      off: (channel: string, callback: (...args: any[]) => void) => void;
    };
  }
}

// Import marked for markdown rendering (will be bundled)
import { marked } from 'marked';

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

interface UpdateAvailableData {
  currentVersion: string;
  newVersion: string;
  releaseNotes: string;
  releaseDate?: string;
}

interface DownloadProgressData {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

interface UpdateReadyData {
  version: string;
}

interface UpdateErrorData {
  message: string;
}

// State management
let currentState: 'available' | 'downloading' | 'ready' | 'error' = 'available';

// DOM elements
const stateAvailable = document.getElementById('state-available')!;
const stateDownloading = document.getElementById('state-downloading')!;
const stateReady = document.getElementById('state-ready')!;
const stateError = document.getElementById('state-error')!;

const currentVersionEl = document.getElementById('current-version')!;
const newVersionEl = document.getElementById('new-version')!;
const releaseNotesEl = document.getElementById('release-notes')!;

const progressFillEl = document.getElementById('progress-fill')!;
const progressTextEl = document.getElementById('progress-text')!;
const downloadSpeedEl = document.getElementById('download-speed')!;
const downloadSizeEl = document.getElementById('download-size')!;

const readyVersionEl = document.getElementById('ready-version')!;
const errorMessageEl = document.getElementById('error-message')!;

const btnLater = document.getElementById('btn-later')!;
const btnDownload = document.getElementById('btn-download')!;
const btnInstallLater = document.getElementById('btn-install-later')!;
const btnRestart = document.getElementById('btn-restart')!;
const btnErrorClose = document.getElementById('btn-error-close')!;
const btnErrorRetry = document.getElementById('btn-error-retry')!;

// Helper functions
function showState(state: 'available' | 'downloading' | 'ready' | 'error') {
  currentState = state;

  stateAvailable.classList.add('hidden');
  stateDownloading.classList.add('hidden');
  stateReady.classList.add('hidden');
  stateError.classList.add('hidden');

  switch (state) {
    case 'available':
      stateAvailable.classList.remove('hidden');
      break;
    case 'downloading':
      stateDownloading.classList.remove('hidden');
      break;
    case 'ready':
      stateReady.classList.remove('hidden');
      break;
    case 'error':
      stateError.classList.remove('hidden');
      break;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + '/s';
}

// Event handlers
btnLater.addEventListener('click', () => {
  window.electronAPI.send('update-window:dismiss');
});

btnDownload.addEventListener('click', () => {
  console.log('[UPDATE] Download button clicked, transitioning to downloading state');
  window.electronAPI.send('update-window:download');
  showState('downloading');
});

btnInstallLater.addEventListener('click', () => {
  window.electronAPI.send('update-window:dismiss');
});

btnRestart.addEventListener('click', () => {
  window.electronAPI.send('update-window:install');
});

btnErrorClose.addEventListener('click', () => {
  window.electronAPI.send('update-window:dismiss');
});

btnErrorRetry.addEventListener('click', () => {
  window.electronAPI.send('update-window:download');
  showState('downloading');
});

// IPC event listeners
window.electronAPI.on('update-window:show-available', (data: UpdateAvailableData) => {
  currentVersionEl.textContent = data.currentVersion;
  newVersionEl.textContent = data.newVersion;

  // Parse and render markdown release notes
  if (data.releaseNotes) {
    try {
      // Parse markdown to HTML
      const html = marked.parse(data.releaseNotes);
      releaseNotesEl.innerHTML = html as string;
    } catch (err) {
      console.error('Failed to parse release notes:', err);
      releaseNotesEl.textContent = data.releaseNotes;
    }
  } else {
    releaseNotesEl.innerHTML = '<p>No release notes available.</p>';
  }

  showState('available');
});

window.electronAPI.on('update-window:progress', (data: DownloadProgressData) => {
  // Update progress bar
  const percent = Math.round(data.percent);
  progressFillEl.style.width = `${percent}%`;
  progressTextEl.textContent = `${percent}%`;

  // Update download stats
  downloadSpeedEl.textContent = formatSpeed(data.bytesPerSecond);
  downloadSizeEl.textContent = `${formatBytes(data.transferred)} / ${formatBytes(data.total)}`;

  // Ensure we're showing the downloading state
  if (currentState !== 'downloading') {
    showState('downloading');
  }
});

window.electronAPI.on('update-window:show-ready', (data: UpdateReadyData) => {
  readyVersionEl.textContent = data.version;
  showState('ready');
});

window.electronAPI.on('update-window:error', (data: UpdateErrorData) => {
  errorMessageEl.textContent = data.message;
  showState('error');
});

window.electronAPI.on('theme-change', (theme: string) => {
  document.body.setAttribute('data-theme', theme);
  if (process.platform === 'darwin') {
    document.body.classList.add('darwin');
  }
});

// Get initial theme
(async () => {
  try {
    const theme = await window.electronAPI.getTheme();
    if (theme) {
      document.body.setAttribute('data-theme', theme);
    }
  } catch (err) {
    console.error('Failed to get initial theme:', err);
  }
})();

// Set darwin class if on macOS
if (process.platform === 'darwin') {
  document.body.classList.add('darwin');
}

// Initialize
console.log('Update window initialized');
