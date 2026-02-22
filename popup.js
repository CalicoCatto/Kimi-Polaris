// Kimi Polaris — popup script

const toggleNav = document.getElementById('toggle-nav');

// ─── Load saved state ───────────────────────────────────────────────────────

chrome.storage.local.get({ kimiPolarisEnabled: true }, ({ kimiPolarisEnabled }) => {
  toggleNav.checked = kimiPolarisEnabled;
});

// ─── Persist and propagate changes ─────────────────────────────────────────

toggleNav.addEventListener('change', () => {
  const enabled = toggleNav.checked;
  chrome.storage.local.set({ kimiPolarisEnabled: enabled });

  // Forward to the active Kimi tab's content script (best-effort)
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: 'kp-toggle', enabled }).catch(() => {});
  });
});
