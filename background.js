// Background service worker for PR Shepherd

// Initialize default state on install (not on update)
chrome.runtime.onInstalled.addListener(async (details) => {
  // Only initialize defaults on fresh install, not on update
  if (details.reason !== 'install') {
    return;
  }

  const stored = await chrome.storage.local.get(['groups', 'prs']);

  // Set defaults if not already set
  if (!stored.groups) {
    await chrome.storage.local.set({
      groups: ['P0', 'P1', 'Backlog']
    });
  }

  if (!stored.prs) {
    await chrome.storage.local.set({
      prs: {}
    });
  }
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getState') {
    chrome.storage.local.get(['groups', 'prs', 'token']).then(sendResponse);
    return true;
  }

  if (request.action === 'setState') {
    chrome.storage.local.set(request.data).then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === 'openSidePanel') {
    chrome.sidePanel.open({ windowId: sender.tab.windowId });
    sendResponse({ success: true });
    return true;
  }
});
