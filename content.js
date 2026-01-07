// Content script to inject "Add to Shepherd" button on PR pages
// Note: storage.js is loaded before this file via manifest, providing storageGet/storageSet as globals

// Check if extension context is still valid
function isExtensionValid() {
  try {
    return chrome.runtime && !!chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

// Safe wrapper for storage calls
async function safeStorageGet(keys) {
  if (!isExtensionValid()) throw new Error('Extension context invalidated');
  return storageGet(keys);
}

async function safeStorageSet(data) {
  if (!isExtensionValid()) throw new Error('Extension context invalidated');
  return storageSet(data);
}

// Wait for the page to load and find the right spot
function injectButton() {
  if (!isExtensionValid()) return;

  // Look for the header actions area (where Edit and Code buttons are)
  const headerActions = document.querySelector('.gh-header-actions');
  if (!headerActions) {
    // Try alternate selector for newer GitHub UI
    const altHeader = document.querySelector('[class*="header"] .d-flex.flex-wrap');
    if (altHeader && !document.getElementById('shepherd-btn-container')) {
      createButtonContainer(altHeader);
    }
    return;
  }

  // Don't add if already exists
  if (document.getElementById('shepherd-btn-container')) return;

  createButtonContainer(headerActions);
}

function createButtonContainer(parent) {
  const container = document.createElement('div');
  container.id = 'shepherd-btn-container';
  container.className = 'shepherd-btn-container';

  // Create dropdown button
  container.innerHTML = `
    <div class="shepherd-dropdown">
      <button class="shepherd-btn" id="shepherdBtn">
        <span class="shepherd-icon">🐑</span>
        <span class="shepherd-text">Shepherd</span>
        <span class="shepherd-arrow">▾</span>
      </button>
      <div class="shepherd-menu" id="shepherdMenu">
        <div class="shepherd-menu-header">Add to priority group:</div>
        <div class="shepherd-menu-items" id="shepherdMenuItems">
          <!-- Filled dynamically -->
        </div>
        <div class="shepherd-menu-status" id="shepherdStatus"></div>
      </div>
    </div>
  `;

  // Insert at the beginning of header actions
  // Use :scope to only find direct children, avoiding nested elements
  try {
    const firstDirectChild = parent.querySelector(':scope > a, :scope > button, :scope > div');
    if (firstDirectChild && firstDirectChild.parentNode === parent) {
      parent.insertBefore(container, firstDirectChild);
    } else if (parent.firstChild) {
      parent.insertBefore(container, parent.firstChild);
    } else {
      parent.appendChild(container);
    }
  } catch (e) {
    // Fallback: just prepend if selectors fail
    parent.prepend(container);
  }

  // Setup event listeners
  const btn = document.getElementById('shepherdBtn');
  const menu = document.getElementById('shepherdMenu');

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.contains('open');
    menu.classList.toggle('open');

    if (!isOpen) {
      try {
        await loadGroups();
      } catch (err) {
        console.warn('Shepherd: Extension context invalidated, please refresh the page');
        menu.classList.remove('open');
      }
    }
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      menu.classList.remove('open');
    }
  });
}

async function loadGroups() {
  const menuItems = document.getElementById('shepherdMenuItems');
  const status = document.getElementById('shepherdStatus');

  if (!menuItems || !status) return;

  // Get current PR URL
  const prUrl = window.location.href.split('?')[0].split('#')[0];

  // Load state from storage
  const stored = await safeStorageGet(['groups', 'prs']);
  const groups = stored.groups || STORAGE_DEFAULTS.groups;
  const prs = stored.prs || STORAGE_DEFAULTS.prs;

  // Check if PR is already tracked
  const currentGroup = prs[prUrl]?.group;

  menuItems.innerHTML = groups.map(group => `
    <button class="shepherd-menu-item ${currentGroup === group ? 'active' : ''}" data-group="${group}">
      ${currentGroup === group ? '✓ ' : ''}${group}
    </button>
  `).join('') + `
    <button class="shepherd-menu-item remove ${currentGroup ? '' : 'hidden'}" data-action="remove">
      Remove from Shepherd
    </button>
  `;

  if (currentGroup) {
    status.textContent = `Currently in: ${currentGroup}`;
    status.className = 'shepherd-menu-status active';
  } else {
    status.textContent = 'Not tracked';
    status.className = 'shepherd-menu-status';
  }

  // Add click handlers
  menuItems.querySelectorAll('.shepherd-menu-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      try {
        const group = e.target.dataset.group;
        const action = e.target.dataset.action;

        if (action === 'remove') {
          delete prs[prUrl];
          status.textContent = 'Removed!';
          status.className = 'shepherd-menu-status';
        } else if (group) {
          prs[prUrl] = {
            group,
            data: null, // Will be fetched when sidebar opens
            addedAt: Date.now()
          };
          status.textContent = `Added to ${group}!`;
          status.className = 'shepherd-menu-status active';
        }

        await safeStorageSet({ prs });

        // Update button states
        await loadGroups();

        // Close menu after a brief delay
        setTimeout(() => {
          const menu = document.getElementById('shepherdMenu');
          if (menu) menu.classList.remove('open');
        }, 500);
      } catch (err) {
        console.warn('Shepherd: Extension context invalidated, please refresh the page');
        status.textContent = 'Error - refresh page';
        status.className = 'shepherd-menu-status';
      }
    });
  });
}

// Run on page load
function init() {
  if (!isExtensionValid()) return;

  // Try immediately
  injectButton();

  // Also observe for dynamic page updates (GitHub uses pjax)
  const observer = new MutationObserver(() => {
    if (!isExtensionValid()) {
      observer.disconnect();
      return;
    }
    if (window.location.pathname.includes('/pull/')) {
      injectButton();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Also handle GitHub's turbo navigation
  document.addEventListener('turbo:load', injectButton);
  document.addEventListener('pjax:end', injectButton);
}

// Wait for DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
