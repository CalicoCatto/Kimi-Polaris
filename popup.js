// Kimi Polaris — popup script

const toggleNav     = document.getElementById('toggle-nav');
const toggleFolders = document.getElementById('toggle-folders');

// ─── Load saved state ───────────────────────────────────────────────────────

chrome.storage.local.get(
  { kpNavEnabled: true, kpFoldersEnabled: true },
  ({ kpNavEnabled, kpFoldersEnabled }) => {
    toggleNav.checked     = kpNavEnabled;
    toggleFolders.checked = kpFoldersEnabled;
  }
);

// ─── Send message to active Kimi tab ────────────────────────────────────────

function sendToggle(type, enabled) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type, enabled }).catch(() => {});
  });
}

// ─── Persist and propagate changes ──────────────────────────────────────────

toggleNav.addEventListener('change', () => {
  const enabled = toggleNav.checked;
  chrome.storage.local.set({ kpNavEnabled: enabled });
  sendToggle('kp-toggle-nav', enabled);
});

toggleFolders.addEventListener('change', () => {
  const enabled = toggleFolders.checked;
  chrome.storage.local.set({ kpFoldersEnabled: enabled });
  sendToggle('kp-toggle-folders', enabled);
});
