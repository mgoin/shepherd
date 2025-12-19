// ES Module wrapper for storage.js
// This file re-exports the storage functions for use in ES module contexts
// (background service worker, sidepanel)

// Shared storage module - single source of truth for sync vs local storage
// Sync storage: syncs across Chrome browsers (100KB limit)
// Local storage: device-specific (10MB limit)

export const SYNC_KEYS = ['groups', 'token', 'darkMode'];
export const LOCAL_KEYS = ['prs'];

export const DEFAULTS = {
  groups: ['P0', 'P1', 'Backlog'],
  token: '',
  darkMode: false,
  prs: {}
};

// Get values from storage (handles sync/local split automatically)
export async function storageGet(keys) {
  const syncKeys = keys.filter(k => SYNC_KEYS.includes(k));
  const localKeys = keys.filter(k => LOCAL_KEYS.includes(k));

  const [syncData, localData] = await Promise.all([
    syncKeys.length > 0 ? chrome.storage.sync.get(syncKeys) : {},
    localKeys.length > 0 ? chrome.storage.local.get(localKeys) : {}
  ]);

  return { ...syncData, ...localData };
}

// Set values to storage (handles sync/local split automatically)
export async function storageSet(data) {
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

// Initialize defaults on fresh install
export async function storageInitDefaults() {
  const [syncStored, localStored] = await Promise.all([
    chrome.storage.sync.get(SYNC_KEYS),
    chrome.storage.local.get(LOCAL_KEYS)
  ]);

  const syncDefaults = {};
  const localDefaults = {};

  for (const key of SYNC_KEYS) {
    if (syncStored[key] === undefined && DEFAULTS[key] !== undefined) {
      syncDefaults[key] = DEFAULTS[key];
    }
  }

  for (const key of LOCAL_KEYS) {
    if (localStored[key] === undefined && DEFAULTS[key] !== undefined) {
      localDefaults[key] = DEFAULTS[key];
    }
  }

  const promises = [];
  if (Object.keys(syncDefaults).length > 0) {
    promises.push(chrome.storage.sync.set(syncDefaults));
  }
  if (Object.keys(localDefaults).length > 0) {
    promises.push(chrome.storage.local.set(localDefaults));
  }

  return Promise.all(promises);
}
