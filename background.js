// Background service worker for PR Shepherd
import { storageGet, storageSet, storageInitDefaults } from './storage-module.js';

// Initialize default state on install (not on update)
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await storageInitDefaults();
  }
});

// Allow clicking the extension icon to open/close the side panel
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getState') {
    storageGet(['groups', 'prs', 'token', 'darkMode']).then(sendResponse);
    return true;
  }

  if (request.action === 'setState') {
    storageSet(request.data).then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === 'openSidePanel') {
    chrome.sidePanel.open({ windowId: sender.tab.windowId });
    sendResponse({ success: true });
    return true;
  }
});
