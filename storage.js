// Storage utilities for content scripts (loaded as regular script, no ES modules)
// The logic here mirrors storage-module.js - keep them in sync
// This file exposes functions as globals for content.js to use

(function() {
  const SYNC_KEYS = ['groups', 'token', 'darkMode'];
  const LOCAL_KEYS = ['prs'];

  const DEFAULTS = {
    groups: ['P0', 'P1', 'Backlog'],
    token: '',
    darkMode: false,
    prs: {}
  };

  async function storageGet(keys) {
    const syncKeys = keys.filter(k => SYNC_KEYS.includes(k));
    const localKeys = keys.filter(k => LOCAL_KEYS.includes(k));

    const [syncData, localData] = await Promise.all([
      syncKeys.length > 0 ? chrome.storage.sync.get(syncKeys) : {},
      localKeys.length > 0 ? chrome.storage.local.get(localKeys) : {}
    ]);

    return { ...syncData, ...localData };
  }

  async function storageSet(data) {
    const syncData = {};
    const localData = {};

    for (const [key, value] of Object.entries(data)) {
      if (SYNC_KEYS.includes(key)) {
        syncData[key] = value;
      } else {
        localData[key] = value;
      }
    }

    const promises = [];
    if (Object.keys(syncData).length > 0) {
      promises.push(chrome.storage.sync.set(syncData));
    }
    if (Object.keys(localData).length > 0) {
      promises.push(chrome.storage.local.set(localData));
    }

    return Promise.all(promises);
  }

  // Expose as globals for content.js
  window.storageGet = storageGet;
  window.storageSet = storageSet;
  window.STORAGE_DEFAULTS = DEFAULTS;
  window.SYNC_KEYS = SYNC_KEYS;
  window.LOCAL_KEYS = LOCAL_KEYS;
})();
