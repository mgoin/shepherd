// PR Shepherd Sidebar Script

/**
 * @fileoverview PR Shepherd Chrome Extension - GitHub PR Management Sidebar
 * @author Claude Code
 * @version 3.0.0
 * 
 * A Chrome extension for managing GitHub pull requests in the vLLM repository.
 * Features OAuth authentication, smart filtering, custom tags, and performance optimization.
 */

/**
 * Centralized DOM selectors utility
 * Provides easy access to frequently used DOM elements
 * 
 * @namespace DOMSelectors
 * @description Functions that return DOM elements, organized by functional area.
 * Using functions instead of direct element references ensures elements exist when accessed.
 */
const DOMSelectors = {
  // Auth section elements
  authSection: () => document.getElementById('auth-section'),
  mainContent: () => document.getElementById('main-content'),
  authStatus: () => document.getElementById('auth-status'),
  authStatusText: () => document.getElementById('auth-status-text'),
  
  // Header elements
  oauthBtn: () => document.getElementById('oauth-btn'),
  patBtn: () => document.getElementById('pat-btn'),
  settingsBtn: () => document.getElementById('settings-btn'),
  refreshBtn: () => document.getElementById('refresh-btn'),
  
  // Search and filter elements
  searchInput: () => document.getElementById('search-input'),
  reviewerOnlyCheckbox: () => document.getElementById('reviewer-only'),
  includeTeamsCheckbox: () => document.getElementById('include-teams'),
  createTagBtn: () => document.getElementById('create-tag-btn'),
  manageTagsBtn: () => document.getElementById('manage-tags-btn'),
  userTagFilters: () => document.getElementById('user-tag-filters'),
  
  // Main content elements
  prList: () => document.getElementById('pr-list'),
  
  // Footer elements
  rateLimitInfo: () => document.getElementById('rate-limit-info'),
  lastUpdate: () => document.getElementById('last-update'),
  
  // Modal elements
  modalOverlay: () => document.getElementById('modal-overlay'),
  modalTitle: () => document.getElementById('modal-title'),
  modalBody: () => document.getElementById('modal-body'),
  modalFooter: () => document.getElementById('modal-footer'),
  modalClose: () => document.getElementById('modal-close'),
  
  // Dynamic elements (created at runtime)
  promptInput: () => document.getElementById('prompt-input'),
  tokenInput: () => document.getElementById('token-input'),
  
  // Query selectors for multiple elements
  filterBtns: () => document.querySelectorAll('.filter-btn'),
  quickTagBtns: () => document.querySelectorAll('.quick-tag-btn'),
  tagSelectors: () => document.querySelectorAll('.tag-selector'),
  sidebarContainer: () => document.querySelector('.sidebar-container')
};

/**
 * Application constants
 * Centralized configuration values and magic numbers
 * 
 * @namespace Constants
 * @description All configuration constants used throughout the application.
 * Organized by functional area for easy maintenance and updates.
 */
const Constants = {
  // API Configuration
  GITHUB_API_BASE_URL: 'https://api.github.com/graphql',
  GITHUB_REST_API_BASE_URL: 'https://api.github.com',
  
  // Rate limiting
  RATE_LIMIT_THRESHOLD: 50,
  DEFAULT_RATE_LIMIT: 5000,
  RATE_LIMIT_BUFFER_HOURS: 1, // 3600000ms buffer
  
  // Timing (milliseconds)
  AUTO_REFRESH_INTERVAL: 5 * 60 * 1000, // 5 minutes
  CACHE_FRESHNESS_THRESHOLD: 2 * 60 * 1000, // 2 minutes 
  ONE_DAY_MS: 24 * 60 * 60 * 1000,
  ONE_HOUR_MS: 60 * 60 * 1000,
  ONE_MINUTE_MS: 60 * 1000,
  
  // UI Dimensions
  TAG_MENU_WIDTH: 180,
  TAG_MENU_MIN_WIDTH: 120,
  TAG_MENU_MAX_HEIGHT: 200,
  TAG_ITEM_HEIGHT: 36,
  UI_MARGIN: 20,
  
  // GitHub API Limits
  MAX_REVIEW_REQUESTED_PRS: 50,
  MAX_RECENT_PRS: 30,
  
  // HTTP Status Codes
  HTTP_UNAUTHORIZED: 401,
  HTTP_FORBIDDEN: 403,
  HTTP_BAD_GATEWAY: 502,
  HTTP_SERVICE_UNAVAILABLE: 503,
  HTTP_GATEWAY_TIMEOUT: 504,
  
  // Content Types
  GITHUB_V3_ACCEPT: 'application/vnd.github.v3+json',
  JSON_CONTENT_TYPE: 'application/json',
  
  // CI Status Icons
  CI_ICONS: {
    SUCCESS: '✅',
    FAILURE: '❌', 
    ERROR: '🚫',
    PENDING: '🟡',
    IN_PROGRESS: '🔄',
    QUEUED: '⏳',
    COMPLETED: '✅',
    CANCELLED: '⚪',
    SKIPPED: '⏭️',
    NEUTRAL: '⚪',
    TIMED_OUT: '⏰',
    ACTION_REQUIRED: '⚠️',
    UNKNOWN: '❓'
  },
  
  // Tag Colors
  TAG_COLORS: [
    '#0969da', '#2da44e', '#d1242f', '#bf8700', 
    '#8250df', '#cf222e', '#1f883d', '#9a6700',
    '#0550ae', '#6f42c1', '#e36209', '#d73a49'
  ],
  
  // Default Repository
  DEFAULT_REPO: { 
    owner: 'vllm-project', 
    name: 'vllm' 
  },
  
  // Authentication Methods
  AUTH_METHODS: {
    OAUTH: 'oauth',
    PAT: 'pat'
  },
  
  // Time Format Thresholds
  TIME_THRESHOLDS: {
    JUST_NOW: 1, // minute
    MINUTES: 60, // minutes
    HOURS: 24 // hours
  },
  
  // Token Format Prefixes
  TOKEN_PREFIXES: {
    CLASSIC: 'ghp_',
    FINE_GRAINED: 'github_pat_'
  },
  
  // UI Colors
  UI_COLORS: {
    WARNING: '#bf8700',
    HOVER_BACKGROUND: '#f6f8fa',
    TRANSPARENT: 'transparent'
  }
};

/**
 * Modal management system
 * Handles all custom modal dialogs and user interactions
 * 
 * @class ModalManager
 * @description Manages modal dialogs, prompts, confirmations, and specialized auth modals.
 * Provides a consistent interface for all modal interactions in the application.
 */
class ModalManager {
  /**
   * Initialize modal manager and set up event listeners
   * 
   * @param {PRShepherdSidebar} prShepherd - Reference to main application instance
   */
  constructor(prShepherd) {
    this.prShepherd = prShepherd;
    this.setupModal();
  }

  /**
   * Set up modal event listeners
   * Handles overlay clicks, close button, and keyboard navigation
   * 
   * @returns {void}
   */
  setupModal() {
    const overlay = DOMSelectors.modalOverlay();
    const closeBtn = DOMSelectors.modalClose();
    
    // Close modal when clicking overlay
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.hideModal();
      }
    });
    
    // Close modal when clicking X
    closeBtn.addEventListener('click', () => {
      this.hideModal();
    });
    
    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.style.display !== 'none') {
        this.hideModal();
      }
    });
  }

  /**
   * Display a custom modal dialog
   * 
   * @param {string} title - Modal title text
   * @param {string} bodyHTML - HTML content for modal body
   * @param {string} [footerHTML=''] - HTML content for modal footer
   * @returns {void}
   */
  showModal(title, bodyHTML, footerHTML = '') {
    const overlay = DOMSelectors.modalOverlay();
    const titleEl = DOMSelectors.modalTitle();
    const bodyEl = DOMSelectors.modalBody();
    const footerEl = DOMSelectors.modalFooter();
    
    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHTML;
    footerEl.innerHTML = footerHTML;
    
    overlay.style.display = 'flex';
    
    // Focus first input if exists
    const firstInput = bodyEl.querySelector('input, textarea');
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 100);
    }
  }

  /**
   * Hide the currently displayed modal
   * 
   * @returns {void}
   */
  hideModal() {
    const overlay = DOMSelectors.modalOverlay();
    overlay.style.display = 'none';
  }

  /**
   * Show confirmation dialog with custom actions
   * 
   * @param {string} title - Dialog title
   * @param {string} message - Confirmation message
   * @param {string} onConfirm - Function name to call on confirm
   * @param {string|null} [onCancel=null] - Function name to call on cancel
   * @returns {void}
   */
  showConfirm(title, message, onConfirm, onCancel = null) {
    const footerHTML = `
      <button class="modal-btn" onclick="prShepherd.modalManager.hideModal(); ${onCancel ? onCancel + '()' : ''}">Cancel</button>
      <button class="modal-btn danger" onclick="prShepherd.modalManager.hideModal(); ${onConfirm}()">Confirm</button>
    `;
    
    this.showModal(title, `<p>${message}</p>`, footerHTML);
  }

  /**
   * Show input prompt dialog with suggestions
   * 
   * @param {string} title - Dialog title
   * @param {string} message - Prompt message
   * @param {string} [defaultValue=''] - Default input value
   * @param {string} onSubmit - Function name to call on submit
   * @param {Array<string>} [suggestions=[]] - Suggested values
   * @returns {void}
   */
  showPrompt(title, message, defaultValue = '', onSubmit, suggestions = []) {
    let suggestionsHTML = '';
    if (suggestions.length > 0) {
      suggestionsHTML = `
        <div class="suggestions">
          <div class="suggestions-title">Suggestions:</div>
          <div class="suggestion-tags">
            ${suggestions.map(s => `<span class="suggestion-tag" onclick="DOMSelectors.promptInput().value='${s}'">${s}</span>`).join('')}
          </div>
        </div>
      `;
    }
    
    const bodyHTML = `
      <p>${message}</p>
      ${suggestionsHTML}
      <input type="text" class="modal-input" id="prompt-input" value="${defaultValue}" placeholder="Enter value...">
    `;
    
    const footerHTML = `
      <button class="modal-btn" onclick="prShepherd.modalManager.hideModal()">Cancel</button>
      <button class="modal-btn primary" onclick="prShepherd.modalManager.submitPrompt('${onSubmit}')">Create</button>
    `;
    
    this.showModal(title, bodyHTML, footerHTML);
    
    // Handle Enter key
    setTimeout(() => {
      const input = DOMSelectors.promptInput();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.submitPrompt(onSubmit);
        }
      });
    }, 100);
  }

  /**
   * Submit prompt dialog input
   * 
   * @param {string} onSubmit - Function name to call with input value
   * @returns {void}
   */
  submitPrompt(onSubmit) {
    const input = DOMSelectors.promptInput();
    const value = input.value.trim();
    if (value) {
      this.hideModal();
      // Call the callback function with the value
      if (typeof onSubmit === 'string') {
        // Handle function name as string
        if (onSubmit === 'createTag') {
          this.prShepherd.createTagWithValue(value);
        } else if (onSubmit === 'createFirstTag') {
          this.prShepherd.createFirstTagWithValue(value);
        }
      } else if (typeof onSubmit === 'function') {
        onSubmit(value);
      }
    }
  }

  /**
   * Show GitHub token input modal
   * 
   * @returns {void}
   */
  showTokenInputModal() {
    const bodyHTML = `
      <div style="margin-bottom: 16px;">
        <p><strong>🔑 GitHub Personal Access Token Setup</strong></p>
        <ol style="margin: 12px 0; padding-left: 20px; font-size: 13px; line-height: 1.4;">
          <li>Go to: <a href="https://github.com/settings/tokens" target="_blank" style="color: #0969da;">github.com/settings/tokens</a></li>
          <li>Click "Generate new token (classic)"</li>
          <li>Select these scopes:
            <ul style="margin-top: 4px;">
              <li>✅ <code>repo</code> (Full control of private repositories)</li>
              <li>✅ <code>read:org</code> (Read org and team membership)</li>
            </ul>
          </li>
          <li>Copy and paste the token below:</li>
        </ol>
      </div>
      <input type="password" class="modal-input" id="token-input" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" autocomplete="off">
      <div style="font-size: 11px; color: #656d76; margin-top: 8px;">
        💡 Your token is stored locally and never sent to external servers
      </div>
    `;
    
    const footerHTML = `
      <button class="modal-btn" onclick="prShepherd.modalManager.hideModal()">Cancel</button>
      <button class="modal-btn primary" onclick="prShepherd.modalManager.submitTokenInput()">Connect</button>
    `;
    
    this.showModal('GitHub Token Setup', bodyHTML, footerHTML);
    
    // Handle Enter key
    setTimeout(() => {
      const input = DOMSelectors.tokenInput();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.submitTokenInput();
        }
      });
    }, 100);
  }

  /**
   * Submit token input and validate
   * 
   * @async
   * @returns {Promise<void>}
   */
  async submitTokenInput() {
    const input = DOMSelectors.tokenInput();
    const token = input.value.trim();
    
    if (!token) {
      this.showTokenValidationError('Please enter a token.');
      return;
    }
    
    // Validate token format
    if (!token.startsWith(Constants.TOKEN_PREFIXES.CLASSIC) && !token.startsWith(Constants.TOKEN_PREFIXES.FINE_GRAINED)) {
      this.showTokenValidationError(`Invalid token format. GitHub tokens start with "${Constants.TOKEN_PREFIXES.CLASSIC}" or "${Constants.TOKEN_PREFIXES.FINE_GRAINED}"`);
      return;
    }
    
    this.hideModal();
    
    try {
      this.prShepherd.showAuthStatus('Validating token...');
      
      const authResult = await this.prShepherd.oauthClient.authenticateWithPAT(token);
      
      if (authResult && authResult.authenticated) {
        this.prShepherd.hideAuthStatus();
        await this.prShepherd.checkAuth();
        await this.prShepherd.loadPRs();
      } else {
        this.showTokenValidationError('Invalid token. Please check your token and try again.');
      }
    } catch (error) {
      console.error('PAT authentication failed:', error);
      this.showTokenValidationError(`Token validation failed: ${error.message}`);
    }
  }

  /**
   * Show token validation error
   * 
   * @param {string} message - Error message
   * @returns {void}
   */
  showTokenValidationError(message) {
    this.showErrorModal('Token Validation Error', message);
  }

  /**
   * Show generic error modal
   * 
   * @param {string} title - Error title
   * @param {string} message - Error message
   * @returns {void}
   */
  showErrorModal(title, message) {
    const bodyHTML = `
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
        <span style="font-size: 24px;">⚠️</span>
        <p style="margin: 0; line-height: 1.4;">${message}</p>
      </div>
    `;
    
    const footerHTML = `
      <button class="modal-btn primary" onclick="prShepherd.modalManager.hideModal()">OK</button>
    `;
    
    this.showModal(title, bodyHTML, footerHTML);
  }

  /**
   * Show authentication settings modal
   * 
   * @async
   * @returns {Promise<void>}
   */
  async showAuthSettings() {
    const currentAuth = await this.prShepherd.oauthClient.getCurrentAuth();
    
    if (!currentAuth) {
      this.showErrorModal('No Authentication', 'No authentication configured. Please connect to GitHub first.');
      return;
    }

    const method = currentAuth.method === Constants.AUTH_METHODS.OAUTH ? 'OAuth' : 'Personal Access Token';
    
    const bodyHTML = `
      <p>Currently authenticated via <strong>${method}</strong></p>
      <p style="margin-top: 12px; color: #656d76; font-size: 13px;">
        Would you like to logout and connect a different account?
      </p>
    `;
    
    const footerHTML = `
      <button class="modal-btn" onclick="prShepherd.modalManager.hideModal()">Cancel</button>
      <button class="modal-btn danger" onclick="prShepherd.modalManager.confirmLogout()">Logout</button>
    `;
    
    this.showModal('Authentication Settings', bodyHTML, footerHTML);
  }

  /**
   * Confirm logout action
   * 
   * @returns {void}
   */
  confirmLogout() {
    this.hideModal();
    this.prShepherd.logout();
  }

  /**
   * Show tag management modal
   * 
   * @returns {void}
   */
  showTagManagement() {
    if (this.prShepherd.customTags.length === 0) {
      this.showModal(
        'No Tags Created',
        '<p>No custom tags created yet. Click the <strong>+ Add Tag</strong> button to create your first tag.</p>',
        '<button class="modal-btn primary" onclick="prShepherd.modalManager.hideModal()">Got it</button>'
      );
      return;
    }

    const tagList = this.prShepherd.customTags.map((tag, index) => 
      `<div class="tag-item" style="display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid #d1d9e0; border-radius: 6px; margin-bottom: 8px;">
        <span style="width: 12px; height: 12px; border-radius: 50%; background: ${tag.color};"></span>
        <span style="flex: 1;">${tag.name}</span>
        <button class="modal-btn danger" onclick="prShepherd.deleteTag(${index})" style="padding: 4px 8px; font-size: 11px;">Delete</button>
      </div>`
    ).join('');
    
    this.showModal(
      'Manage Tags',
      `<div style="margin-bottom: 16px;"><strong>Your tags:</strong></div>${tagList}`,
      '<button class="modal-btn" onclick="prShepherd.modalManager.hideModal()">Close</button>'
    );
  }
}

/**
 * Main PR Shepherd extension class
 * Manages GitHub pull request viewing, filtering, and organization
 * 
 * @class PRShepherdSidebar
 * @description A Chrome extension sidebar for managing GitHub PRs in the vLLM repository.
 * Provides OAuth authentication, real-time filtering, custom tags, and efficient caching.
 */
class PRShepherdSidebar {
  /**
   * Initialize the PR Shepherd sidebar
   * Sets up API configuration, state management, and OAuth client
   */
  constructor() {
    this.baseUrl = Constants.GITHUB_API_BASE_URL;
    this.repo = Constants.DEFAULT_REPO;
    this.rateLimitInfo = { remaining: Constants.DEFAULT_RATE_LIMIT, reset: 0 };
    this.lastUpdate = null;
    this.allPRs = [];
    this.filteredPRs = [];
    this.currentUser = null;
    this.customTags = [];
    this.prTagAssignments = new Map(); // Map PR numbers to custom tags
    this.searchTerm = '';
    this.reviewerOnlyMode = true;
    this.includeTeamRequests = false;
    this.currentTabPR = null; // Track PR currently open in browser tab
    this.oauthClient = new GitHubOAuth();
    
    // Initialize modal manager
    this.modalManager = new ModalManager(this);
    
    this.init();
  }

  /**
   * Initialize the application
   * Sets up tags, event listeners, loads cached data, and starts authentication
   * 
   * @async
   * @returns {Promise<void>}
   */
  async init() {
    await this.loadCustomTags();
    this.setupEventListeners();
    
    // Detect current PR in browser tab
    await this.updateCurrentTabPR();
    
    // Show cached data immediately (before auth check)
    await this.loadCachedDataInstantly();
    
    await this.checkAuth();
    
    // After auth, refresh data in background if needed
    if (this.token) {
      this.loadPRs(); // Don't await - let it happen in background
    }
    
    this.setupAutoRefresh();
  }

  /**
   * Check and validate user authentication
   * Supports both OAuth and Personal Access Token authentication
   * 
   * @async
   * @returns {Promise<void>}
   */
  async checkAuth() {
    const authSection = DOMSelectors.authSection();
    const mainContent = DOMSelectors.mainContent();
    
    try {
      // Check OAuth authentication first
      const authResult = await this.oauthClient.isAuthenticated();
      if (authResult && authResult.authenticated) {
        this.currentUser = authResult.user;
        this.token = await this.oauthClient.getAccessToken();
        authSection.style.display = 'none';
        mainContent.style.display = 'flex';
        return;
      }

      // Fallback to check legacy PAT
      const currentAuth = await this.oauthClient.getCurrentAuth();
      if (currentAuth && currentAuth.token) {
        this.token = currentAuth.token;
        
        // Validate the token and get user info
        const response = await fetch(`${Constants.GITHUB_REST_API_BASE_URL}/user`, {
          headers: {
            'Authorization': `token ${this.token}`,
            'Accept': Constants.GITHUB_V3_ACCEPT
          }
        });

        if (response.ok) {
          this.currentUser = await response.json();
          authSection.style.display = 'none';
          mainContent.style.display = 'flex';
          return;
        }
      }

      // No valid authentication found
      authSection.style.display = 'flex';
      mainContent.style.display = 'none';
      this.token = null;
      this.currentUser = null;
    } catch (error) {
      console.error('Auth check failed:', error);
      authSection.style.display = 'flex';
      mainContent.style.display = 'none';
      this.token = null;
      this.currentUser = null;
    }
  }

  async getStoredToken() {
    const currentAuth = await this.oauthClient.getCurrentAuth();
    return currentAuth ? currentAuth.token : null;
  }

  /**
   * Set up all event listeners for user interactions
   * Handles buttons, filters, search, and background message communication
   * 
   * @returns {void}
   */
  setupEventListeners() {
    // OAuth button
    DOMSelectors.oauthBtn().addEventListener('click', () => {
      this.handleOAuthFlow();
    });

    // PAT button
    DOMSelectors.patBtn().addEventListener('click', () => {
      this.handlePATFlow();
    });

    // Settings button
    DOMSelectors.settingsBtn().addEventListener('click', () => {
      this.modalManager.showAuthSettings();
    });

    // Refresh button
    DOMSelectors.refreshBtn().addEventListener('click', () => {
      this.loadPRs(true);
    });

    // Search input
    const searchInput = DOMSelectors.searchInput();
    searchInput.addEventListener('input', (e) => {
      this.searchTerm = e.target.value.toLowerCase();
      this.applyFilters();
    });

    // Reviewer only checkbox
    DOMSelectors.reviewerOnlyCheckbox().addEventListener('change', (e) => {
      this.reviewerOnlyMode = e.target.checked;
      console.log(`👤 Reviewer only mode: ${this.reviewerOnlyMode}`);
      this.applyFilters();
    });

    // Include team requests checkbox
    DOMSelectors.includeTeamsCheckbox().addEventListener('change', (e) => {
      this.includeTeamRequests = e.target.checked;
      this.applyFilters();
    });

    // Filter buttons
    DOMSelectors.filterBtns().forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.handleFilterClick(e);
      });
    });

    // Create tag button
    DOMSelectors.createTagBtn().addEventListener('click', () => {
      this.createCustomTag();
    });

    // Manage tags button
    DOMSelectors.manageTagsBtn().addEventListener('click', () => {
      this.manageCustomTags();
    });

    // Listen for background updates
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'pr-updated') {
        this.loadPRsFromCache();
      }
    });

    // Listen for tab changes to update current PR detection
    chrome.tabs.onActivated.addListener(() => {
      this.updateCurrentTabPR();
    });
    
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.url && tab.active) {
        this.updateCurrentTabPR();
      }
    });
  }

  setupAutoRefresh() {
    // Refresh every 5 minutes when sidebar is visible, but respect rate limits
    setInterval(() => {
      if (document.visibilityState === 'visible' && this.token) {
        // Only refresh if we have sufficient rate limit remaining
        if (this.rateLimitInfo.remaining > Constants.RATE_LIMIT_THRESHOLD) {
          this.loadPRs();
        } else {
          console.log('Skipping auto-refresh due to low rate limit:', this.rateLimitInfo.remaining);
        }
      }
    }, Constants.AUTO_REFRESH_INTERVAL);
  }

  async handleOAuthFlow() {
    try {
      this.showAuthStatus('Starting GitHub authentication...');
      
      const authResult = await this.oauthClient.authenticate();
      
      if (authResult && authResult.authenticated) {
        this.hideAuthStatus();
        await this.checkAuth();
        await this.loadPRs();
      } else {
        this.showAuthError('Authentication failed. Please try again.');
      }
    } catch (error) {
      console.error('Device Flow authentication failed:', error);
      this.showAuthError(`Authentication failed: ${error.message}`);
    }
  }

  async handlePATFlow() {
    this.modalManager.showTokenInputModal();
  }


  async logout() {
    try {
      await this.oauthClient.logout();
      this.token = null;
      this.currentUser = null;
      this.allPRs = [];
      this.filteredPRs = [];
      await this.checkAuth();
    } catch (error) {
      console.error('Logout failed:', error);
      this.showErrorModal('Logout Failed', 'Logout failed. Please try again.');
    }
  }

  showAuthStatus(message) {
    const statusElement = DOMSelectors.authStatus();
    const statusText = DOMSelectors.authStatusText();
    
    statusText.textContent = message;
    statusElement.style.display = 'flex';
  }

  hideAuthStatus() {
    const statusElement = DOMSelectors.authStatus();
    statusElement.style.display = 'none';
  }

  showAuthError(message) {
    this.hideAuthStatus();
    this.modalManager.showErrorModal('Authentication Error', message);
  }

  handleFilterClick(e) {
    DOMSelectors.filterBtns().forEach(btn => {
      btn.classList.remove('active');
    });
    e.target.classList.add('active');
    
    this.currentFilter = e.target.dataset.filter;
    this.applyFilters();
  }

  /**
   * Apply current filters to PR list
   * Handles search terms, reviewer mode, and custom tags
   * 
   * @returns {void}
   */
  applyFilters() {
    console.log(`🔍 Filtering ${this.allPRs.length} PRs. ReviewerOnly: ${this.reviewerOnlyMode}, User: ${this.currentUser?.login}`);
    
    let searchFiltered = 0;
    let reviewerFiltered = 0;
    let statusFiltered = 0;
    
    this.filteredPRs = this.allPRs.filter(pr => {
      // Search filter
      if (this.searchTerm) {
        const searchableText = `${pr.title} ${pr.number} ${pr.author.login} ${pr.headRefName}`.toLowerCase();
        if (!this.fuzzyMatch(searchableText, this.searchTerm)) {
          searchFiltered++;
          return false;
        }
      }

      // Reviewer only filter
      if (this.reviewerOnlyMode && this.currentUser) {
        const reviewRequests = pr.reviewRequests?.nodes || [];
        const isDirectReviewer = reviewRequests.some(req => {
          const reviewer = req.requestedReviewer;
          return reviewer?.login === this.currentUser.login;
        });
        
        const hasTeamRequest = this.includeTeamRequests && reviewRequests.some(req => {
          const reviewer = req.requestedReviewer;
          return reviewer?.slug; // This means it's a team
        });
        
        const reviewNodes = pr.reviews?.nodes || [];
        const hasReviewed = reviewNodes.some(review => 
          review.author?.login === this.currentUser.login
        );
        
        if (!isDirectReviewer && !hasTeamRequest && !hasReviewed) {
          reviewerFiltered++;
          return false;
        }
      }

      // Status filter
      if (this.currentFilter && this.currentFilter !== 'all') {
        if (!this.shouldShowPR(pr, this.currentFilter)) {
          statusFiltered++;
          return false;
        }
      }

      return true;
    });

    console.log(`📊 Filter results: ${this.filteredPRs.length} shown, ${searchFiltered} search filtered, ${reviewerFiltered} reviewer filtered, ${statusFiltered} status filtered`);
    
    this.renderFilteredPRs();
  }

  fuzzyMatch(text, search) {
    const searchWords = search.split(' ').filter(word => word.length > 0);
    return searchWords.every(word => text.includes(word));
  }

  shouldShowPR(pr, filter) {
    // Handle system filters
    if (filter === 'all') {
      return true;
    }
    
    if (filter === 'untagged') {
      return !pr.customTag;
    }
    
    // Handle user-created tag filters
    if (this.customTags.some(tag => tag.name === filter)) {
      return pr.customTag?.name === filter;
    }
    
    return true;
  }

  /**
   * Load pull requests from GitHub API
   * Implements smart caching and rate limit management
   * 
   * @async
   * @param {boolean} [forceRefresh=false] - Skip cache and force fresh data
   * @returns {Promise<void>}
   */
  async loadPRs(forceRefresh = false) {
    if (!this.token) return;

    const listElement = DOMSelectors.prList();
    const refreshBtn = DOMSelectors.refreshBtn();
    
    // Check if we should skip refresh (smart caching)
    if (!forceRefresh && this.shouldSkipRefresh()) {
      console.log('⏭️ Skipping refresh - data is fresh enough');
      return;
    }
    
    // Only show loading state if we don't have cached data or forced refresh
    const hasExistingData = this.allPRs && this.allPRs.length > 0;
    refreshBtn.classList.add('updating');
    
    if (!hasExistingData || forceRefresh) {
      listElement.innerHTML = '<div class="loading">Loading your PRs...</div>';
    }

    try {
      console.log('🔄 Fetching fresh PR data...');
      const prs = await this.fetchPRs();
      this.renderPRs(prs);
      await this.savePRCache(prs); // Save to cache
      this.updateFooter();
      this.lastUpdate = new Date();
      console.log('✅ Fresh data loaded');
    } catch (error) {
      console.error('Error loading PRs:', error);
      if (error.message.includes(Constants.HTTP_UNAUTHORIZED.toString()) || error.message.includes('Bad credentials')) {
        listElement.innerHTML = `
          <div class="error">
            Authentication failed. Please check your token.
            <br><br>
            <button class="btn" onclick="DOMSelectors.settingsBtn().click()">
              Update Token
            </button>
          </div>
        `;
      } else if (error.message.includes('required scopes') || error.message.includes('read:org')) {
        listElement.innerHTML = `
          <div class="error">
            Token missing required scopes.
            <br><small>Need: <code>repo</code> and <code>read:org</code></small>
            <br><br>
            <button class="btn" onclick="DOMSelectors.settingsBtn().click()">
              Update Token
            </button>
          </div>
        `;
      } else if (error.message.includes(Constants.HTTP_FORBIDDEN.toString())) {
        listElement.innerHTML = `
          <div class="error">
            Rate limit exceeded. Please wait before refreshing.
            <br><small>Limit resets at ${new Date(this.rateLimitInfo.resetAt || Date.now() + Constants.ONE_HOUR_MS).toLocaleTimeString()}</small>
          </div>
        `;
      } else if (error.message.includes(Constants.HTTP_BAD_GATEWAY.toString()) || 
                 error.message.includes(Constants.HTTP_SERVICE_UNAVAILABLE.toString()) || 
                 error.message.includes(Constants.HTTP_GATEWAY_TIMEOUT.toString())) {
        listElement.innerHTML = `
          <div class="error">
            GitHub API temporarily unavailable (${error.message.includes(Constants.HTTP_GATEWAY_TIMEOUT.toString()) ? 'timeout' : 'server error'}).
            <br><small>GitHub is experiencing issues. This is not a problem with the extension.</small>
            <br><br>
            <button class="btn" onclick="DOMSelectors.refreshBtn().click()">
              Try Again
            </button>
          </div>
        `;
      } else {
        listElement.innerHTML = `<div class="error">Error loading PRs: ${error.message}</div>`;
      }
    } finally {
      refreshBtn.classList.remove('updating');
    }
  }

  async loadCachedDataInstantly() {
    try {
      // Load from local storage cache WITHOUT checking auth first
      const cached = await new Promise((resolve) => {
        chrome.storage.local.get(['pr_cache'], (result) => {
          resolve(result.pr_cache);
        });
      });
      
      if (cached && cached.data && cached.data.length > 0) {
        console.log('📦 Instant cache load:', cached.data.length, 'PRs');
        
        // Show main content immediately with cached data
        const authSection = DOMSelectors.authSection();
        const mainContent = DOMSelectors.mainContent();
        authSection.style.display = 'none';
        mainContent.style.display = 'flex';
        
        this.renderPRs(cached.data);
        this.lastUpdate = new Date(cached.lastUpdate);
        this.updateFooter();
        
        // Add visual indicator that this is cached data
        this.showCacheIndicator();
        return true;
      }
    } catch (error) {
      console.log('No cached data available:', error);
    }
    return false;
  }

  async loadCachedData() {
    if (!this.token) return;
    
    try {
      // Load from local storage cache
      const cached = await new Promise((resolve) => {
        chrome.storage.local.get(['pr_cache'], (result) => {
          resolve(result.pr_cache);
        });
      });
      
      if (cached && cached.data && cached.data.length > 0) {
        console.log('Loading cached PRs:', cached.data.length);
        this.renderPRs(cached.data);
        this.lastUpdate = new Date(cached.lastUpdate);
        this.updateFooter();
        return true;
      }
    } catch (error) {
      console.log('No cached data available:', error);
    }
    return false;
  }

  async savePRCache(prs) {
    try {
      await new Promise((resolve) => {
        chrome.storage.local.set({
          pr_cache: {
            data: prs,
            lastUpdate: Date.now()
          }
        }, resolve);
      });
    } catch (error) {
      console.error('Failed to cache PR data:', error);
    }
  }

  async loadPRsFromCache() {
    // Try to load from background cache first
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getCachedPRs' });
      if (response.success && response.data && response.data.data) {
        this.renderPRs(response.data.data);
        this.updateFooter();
      }
    } catch (error) {
      console.log('No background cache available, using local cache');
      await this.loadCachedData();
    }
  }

  /**
   * Fetch pull requests using GitHub Search API
   * Uses dual queries for review-requested and recent PRs
   * 
   * @async
   * @returns {Promise<Array>} Array of PR objects
   */
  async fetchPRs() {
    // Use GitHub Search API to let GitHub do the filtering!
    const searchQueries = [
      // PRs where I'm requested as reviewer
      `repo:${this.repo.owner}/${this.repo.name} is:pr is:open review-requested:@me`,
      // Recent PRs for context (in case user wants to see all)
      `repo:${this.repo.owner}/${this.repo.name} is:pr is:open sort:updated-desc`
    ];

    const query = `
      query SearchVLLMPRs($reviewQuery: String!, $recentQuery: String!) {
        reviewRequested: search(query: $reviewQuery, type: ISSUE, first: ${Constants.MAX_REVIEW_REQUESTED_PRS}) {
          nodes {
            ... on PullRequest {
              id
              number
              title
              state
              isDraft
              updatedAt
              author {
                login
              }
              reviewRequests(first: 3) {
                nodes {
                  requestedReviewer {
                    ... on User {
                      login
                    }
                    ... on Team {
                      slug
                    }
                  }
                }
              }
              commits(last: 1) {
                nodes {
                  commit {
                    statusCheckRollup {
                      state
                    }
                  }
                }
              }
              reviewDecision
              reviews {
                totalCount
              }
              labels(first: 2) {
                nodes {
                  name
                  color
                }
              }
            }
          }
        }
        recentPRs: search(query: $recentQuery, type: ISSUE, first: ${Constants.MAX_RECENT_PRS}) {
          nodes {
            ... on PullRequest {
              id
              number
              title
              state
              isDraft
              updatedAt
              author {
                login
              }
              reviewRequests(first: 3) {
                nodes {
                  requestedReviewer {
                    ... on User {
                      login
                    }
                    ... on Team {
                      slug
                    }
                  }
                }
              }
              commits(last: 1) {
                nodes {
                  commit {
                    statusCheckRollup {
                      state
                    }
                  }
                }
              }
              reviewDecision
              reviews {
                totalCount
              }
              labels(first: 2) {
                nodes {
                  name
                  color
                }
              }
            }
          }
        }
        viewer {
          login
        }
        rateLimit {
          remaining
          resetAt
        }
      }
    `;

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `bearer ${this.token}`,
        'Content-Type': Constants.JSON_CONTENT_TYPE,
      },
      body: JSON.stringify({
        query,
        variables: {
          reviewQuery: `repo:${this.repo.owner}/${this.repo.name} is:pr is:open review-requested:@me`,
          recentQuery: `repo:${this.repo.owner}/${this.repo.name} is:pr is:open sort:updated-desc`
        }
      })
    });

    // Log rate limit headers for debugging
    const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
    const rateLimitReset = response.headers.get('X-RateLimit-Reset');
    if (rateLimitRemaining) {
      console.log(`Rate limit: ${rateLimitRemaining} remaining, resets at ${new Date(rateLimitReset * 1000).toLocaleTimeString()}`);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.errors) {
      throw new Error(`GraphQL Error: ${data.errors[0].message}`);
    }

    // Store rate limit info and current user
    this.rateLimitInfo = data.data.rateLimit;
    this.currentUser = data.data.viewer;
    
    // Merge results from both search queries
    const reviewRequestedPRs = data.data.reviewRequested?.nodes || [];
    const recentPRs = data.data.recentPRs?.nodes || [];
    
    // Deduplicate by PR number, prioritizing review-requested PRs
    const prMap = new Map();
    
    // Add review-requested PRs first (higher priority)
    reviewRequestedPRs.forEach(pr => {
      if (pr && pr.number) {
        prMap.set(pr.number, pr);
      }
    });
    
    // Add recent PRs if not already present
    recentPRs.forEach(pr => {
      if (pr && pr.number && !prMap.has(pr.number)) {
        prMap.set(pr.number, pr);
      }
    });
    
    return Array.from(prMap.values());
  }

  renderPRs(prs) {
    this.allPRs = prs.map(pr => {
      // Attach custom tag if assigned
      const assignedTag = this.prTagAssignments.get(pr.number);
      if (assignedTag) {
        pr.customTag = this.customTags.find(tag => tag.name === assignedTag);
      }
      return pr;
    });
    this.currentFilter = 'all';
    this.applyFilters();
    this.renderCustomTagFilters();
  }

  renderFilteredPRs() {
    const listElement = DOMSelectors.prList();
    
    if (this.filteredPRs.length === 0) {
      if (this.reviewerOnlyMode && this.allPRs.length > this.filteredPRs.length) {
        listElement.innerHTML = '<div class="empty">No PRs where you are a reviewer.<br><small>Uncheck "My reviews only" to see all PRs.</small></div>';
      } else if (this.searchTerm) {
        listElement.innerHTML = '<div class="empty">No PRs match your search.</div>';
      } else {
        listElement.innerHTML = '<div class="empty">No pull requests found.</div>';
      }
      return;
    }

    const prHTML = this.filteredPRs.map(pr => this.renderPR(pr)).join('');
    listElement.innerHTML = prHTML;
    
    // Add quick tag functionality
    this.setupQuickTagging();
  }

  /**
   * Render HTML for a single PR item
   * 
   * @param {Object} pr - Pull request object from GitHub API
   * @returns {string} HTML string for the PR item
   */
  renderPR(pr) {
    const reviewStatus = this.getReviewStatus(pr);
    const detailedCIStatus = this.getDetailedCIDisplay(pr);
    const labels = this.renderLabels(pr.labels?.nodes);
    const activityInfo = this.getActivityInfo(pr);
    const assignedTag = pr.customTag ? `<span class="custom-tag" style="background-color: ${pr.customTag.color}">📁 ${pr.customTag.name}</span>` : '';
    
    // Check if this PR is currently open in browser tab
    const isCurrentTabPR = this.currentTabPR && 
                          this.currentTabPR.number === pr.number &&
                          this.currentTabPR.owner === this.repo.owner &&
                          this.currentTabPR.repo === this.repo.name;
    const currentTabIndicator = isCurrentTabPR ? `<span class="current-tab-indicator" title="Currently viewing this PR">👁️ Viewing</span>` : '';
    
    return `
      <div class="pr-item" 
           data-pr-number="${pr.number}"
           data-status="${pr.state}" 
           data-draft="${pr.isDraft}"
           data-review-decision="${pr.reviewDecision || ''}"
           data-custom-tag="${pr.customTag?.name || ''}">
        <div class="pr-header">
          <div class="pr-title">
            <a href="https://github.com/${this.repo.owner}/${this.repo.name}/pull/${pr.number}" 
               target="_blank" class="pr-link">
              #${pr.number} ${pr.title}
            </a>
            ${pr.isDraft ? '<span class="draft-badge">DRAFT</span>' : ''}
            ${assignedTag}
            ${currentTabIndicator}
          </div>
          <div class="pr-actions">
            <button class="quick-tag-btn" data-pr-number="${pr.number}" title="Organize with tags">
              📁
            </button>
          </div>
        </div>
        <div class="pr-meta">
          by ${pr.author.login} • ${this.formatDate(pr.updatedAt)}
        </div>
        <div class="pr-status">
          <div class="status-item ci-status-container">
            ${detailedCIStatus}
          </div>
          <div class="status-item">
            ${reviewStatus}
          </div>
        </div>
        ${activityInfo ? `<div class="pr-activity">${activityInfo}</div>` : ''}
        ${labels ? `<div class="pr-labels">${labels}</div>` : ''}
      </div>
    `;
  }

  getStatusIcon(pr) {
    if (pr.isDraft) return '📝';
    
    const ciState = pr.commits.nodes[0]?.commit?.statusCheckRollup?.state;
    switch (ciState) {
      case 'SUCCESS': return Constants.CI_ICONS.SUCCESS;
      case 'FAILURE': case 'ERROR': return Constants.CI_ICONS.FAILURE;
      case 'PENDING': return Constants.CI_ICONS.PENDING;
      default: return Constants.CI_ICONS.NEUTRAL;
    }
  }

  getCIStatus(pr) {
    const rollup = pr.commits.nodes[0]?.commit?.statusCheckRollup;
    if (!rollup) return { state: 'unknown' };
    
    const state = rollup.state ? rollup.state.toLowerCase().replace('_', ' ') : 'unknown';
    return { state };
  }

  getDetailedCIDisplay(pr) {
    const { state } = this.getCIStatus(pr);
    return `<span class="ci-state ci-${state}">${this.getCIIcon(state)} ${state}</span>`;
  }
  
  /**
   * Get emoji icon for CI status state
   * 
   * @param {string} state - CI state (success, failure, pending, etc.)
   * @returns {string} Emoji icon for the state
   */
  getCIIcon(state) {
    const stateUpper = state.toUpperCase();
    return Constants.CI_ICONS[stateUpper] || Constants.CI_ICONS.UNKNOWN;
  }

  getReviewStatus(pr) {
    if (pr.reviewDecision === 'APPROVED') return '👍 Approved';
    if (pr.reviewDecision === 'CHANGES_REQUESTED') return '👎 Changes requested';
    
    // Check if user is directly requested for review
    const reviewRequests = pr.reviewRequests?.nodes || [];
    const isDirectReviewer = reviewRequests.some(req => {
      const reviewer = req.requestedReviewer;
      return reviewer?.login === this.currentUser?.login;
    });
    
    // Check for team requests
    const teamRequests = reviewRequests.filter(req => req.requestedReviewer?.slug);
    
    if (isDirectReviewer) return '👤 You requested';
    if (teamRequests.length > 0) return `👥 Team review (${teamRequests.length})`;
    
    const reviewCount = pr.reviews?.totalCount || 0;
    if (reviewCount === 0) return '⏳ No reviews';
    
    return `💬 ${reviewCount} review${reviewCount > 1 ? 's' : ''}`;
  }

  getActivityInfo(pr) {
    if (!this.currentUser) return '';
    
    const activities = [];
    
    // Check if user is requested for review
    const reviewRequests = pr.reviewRequests?.nodes || [];
    const isDirectReviewer = reviewRequests.some(req => {
      const reviewer = req.requestedReviewer;
      return reviewer?.login === this.currentUser.login;
    });
    
    if (isDirectReviewer) {
      activities.push('🔔 Review requested');
    }
    
    // Check for recent updates (within 1 day)
    const now = Date.now();
    const oneDayAgo = now - Constants.ONE_DAY_MS;
    const updatedAt = new Date(pr.updatedAt).getTime();
    
    if (updatedAt > oneDayAgo) {
      activities.push('🔄 Recently updated');
    }
    
    return activities.length > 0 ? activities.join(' • ') : '';
  }

  renderLabels(labels) {
    if (!labels || !labels.length) return '';
    
    return labels.map(label => 
      `<span class="label" style="background-color: #${label.color}">${label.name}</span>`
    ).join('');
  }

  /**
   * Format a date string into relative time (e.g., "2h ago", "3d ago")
   * 
   * @param {string} dateString - ISO date string
   * @returns {string} Formatted relative time string
   */
  formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMinutes = Math.floor(diffMs / Constants.ONE_MINUTE_MS);
    
    if (diffMinutes < Constants.TIME_THRESHOLDS.JUST_NOW) return 'just now';
    if (diffMinutes < Constants.TIME_THRESHOLDS.MINUTES) return `${diffMinutes}m ago`;
    
    const diffHours = Math.floor(diffMinutes / Constants.TIME_THRESHOLDS.MINUTES);
    if (diffHours < Constants.TIME_THRESHOLDS.HOURS) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / Constants.TIME_THRESHOLDS.HOURS);
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  }

  showCacheIndicator() {
    const lastUpdateElement = DOMSelectors.lastUpdate();
    lastUpdateElement.style.color = Constants.UI_COLORS.WARNING;
    lastUpdateElement.textContent = '📦 Showing cached data, refreshing...';
  }

  hideCacheIndicator() {
    const lastUpdateElement = DOMSelectors.lastUpdate();
    lastUpdateElement.style.color = '';
  }

  updateFooter() {
    const rateLimitElement = DOMSelectors.rateLimitInfo();
    const lastUpdateElement = DOMSelectors.lastUpdate();
    
    if (this.rateLimitInfo) {
      const resetTime = new Date(this.rateLimitInfo.resetAt).toLocaleTimeString();
      rateLimitElement.textContent = `API: ${this.rateLimitInfo.remaining}/${this.rateLimitInfo.limit} (resets ${resetTime})`;
    }
    
    if (this.lastUpdate) {
      const timeAgo = this.getTimeAgo(this.lastUpdate);
      lastUpdateElement.textContent = `Updated: ${timeAgo}`;
      this.hideCacheIndicator();
    }
  }

  shouldSkipRefresh() {
    // Skip refresh if data is less than 2 minutes old
    if (!this.lastUpdate) return false;
    
    const now = Date.now();
    const freshnessThreshold = now - Constants.CACHE_FRESHNESS_THRESHOLD;
    const lastUpdateTime = this.lastUpdate.getTime();
    
    return lastUpdateTime > freshnessThreshold;
  }

  getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMinutes = Math.floor(diffMs / Constants.ONE_MINUTE_MS);
    
    if (diffMinutes < Constants.TIME_THRESHOLDS.JUST_NOW) return 'just now';
    if (diffMinutes === 1) return '1 minute ago';
    if (diffMinutes < Constants.TIME_THRESHOLDS.MINUTES) return `${diffMinutes} minutes ago`;
    
    return date.toLocaleTimeString();
  }

  /**
   * Detect and update the PR currently open in the browser tab
   * 
   * @async
   * @returns {Promise<void>}
   */
  async updateCurrentTabPR() {
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      const previousPR = this.currentTabPR;
      
      if (tab?.url) {
        const match = tab.url.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
        if (match) {
          const [, owner, repo, prNumber] = match;
          this.currentTabPR = { 
            owner, 
            repo, 
            number: parseInt(prNumber),
            url: tab.url 
          };
          console.log(`🎯 Current tab PR detected: ${owner}/${repo}#${prNumber}`);
        } else {
          this.currentTabPR = null;
        }
      } else {
        this.currentTabPR = null;
      }
      
      // Re-render PRs if current tab PR changed and we have PRs loaded
      if (this.allPRs.length > 0 && 
          (previousPR?.number !== this.currentTabPR?.number ||
           previousPR?.owner !== this.currentTabPR?.owner ||
           previousPR?.repo !== this.currentTabPR?.repo)) {
        this.renderFilteredPRs();
      }
    } catch (error) {
      console.log('Could not access tab information:', error.message);
      this.currentTabPR = null;
    }
  }

  // Custom Tags Functionality
  /**
   * Load custom tags and PR assignments from storage
   * 
   * @async
   * @returns {Promise<void>}
   */
  async loadCustomTags() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['custom_tags', 'pr_tag_assignments'], (result) => {
        this.customTags = result.custom_tags || [];
        const assignments = result.pr_tag_assignments || {};
        this.prTagAssignments = new Map(Object.entries(assignments).map(([k, v]) => [parseInt(k), v]));
        resolve();
      });
    });
  }

  async saveCustomTags() {
    return new Promise((resolve) => {
      const assignmentsObj = Object.fromEntries(this.prTagAssignments);
      chrome.storage.local.set({ 
        custom_tags: this.customTags,
        pr_tag_assignments: assignmentsObj
      }, resolve);
    });
  }

  createCustomTag() {
    const suggestions = ['Backlog', 'P0 Priority', 'Customer', 'Review Later', 'Blocked', 'Ready to Merge'];
    
    this.modalManager.showPrompt(
      'Create New Tag',
      'Create a new tag to organize your PRs:',
      '',
      'createTag',
      suggestions
    );
  }

  createTagWithValue(name) {
    if (name && name.trim()) {
      const color = this.getRandomTagColor();
      const tag = {
        id: Date.now().toString(),
        name: name.trim(),
        color: color
      };
      this.customTags.push(tag);
      this.saveCustomTags();
      this.renderCustomTagFilters();
    }
  }

  createFirstTagWithValue(name) {
    if (name && name.trim()) {
      const color = this.getRandomTagColor();
      const tag = {
        id: Date.now().toString(),
        name: name.trim(),
        color: color
      };
      this.customTags.push(tag);
      this.saveCustomTags();
      this.renderCustomTagFilters();
      
      // Assign the new tag to the pending PR
      if (this.pendingTagPRNumber) {
        this.prTagAssignments.set(this.pendingTagPRNumber, tag.name);
        this.saveCustomTags();
        this.renderPRs(this.allPRs);
        this.pendingTagPRNumber = null;
      }
    }
  }

  renderCustomTagFilters() {
    const container = DOMSelectors.userTagFilters();
    
    if (this.customTags.length === 0) {
      container.innerHTML = '';
      return;
    }

    const filtersHTML = this.customTags.map(tag => 
      `<button class="filter-btn" data-filter="${tag.name}" style="border-color: ${tag.color}; color: ${tag.color};">
        📁 ${tag.name}
      </button>`
    ).join('');
    
    container.innerHTML = filtersHTML;
    
    // Add event listeners for custom tag filters
    container.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.handleFilterClick(e);
      });
    });
  }


  setupQuickTagging() {
    DOMSelectors.quickTagBtns().forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const prNumber = parseInt(btn.dataset.prNumber);
        this.showQuickTagMenu(btn, prNumber);
      });
    });
  }

  /**
   * Display quick tag assignment menu for a PR
   * 
   * @param {HTMLElement} button - Button element that triggered the menu
   * @param {number} prNumber - PR number to assign tag to
   * @returns {void}
   */
  showQuickTagMenu(button, prNumber) {
    // Remove any existing menus
    DOMSelectors.tagSelectors().forEach(menu => menu.remove());
    
    if (this.customTags.length === 0) {
      // If no tags exist, prompt to create one
      this.pendingTagPRNumber = prNumber; // Store for after tag creation
      const suggestions = ['Backlog', 'P0 Priority', 'Customer', 'Review Later', 'Blocked'];
      
      this.modalManager.showPrompt(
        'Create Your First Tag',
        'Create your first tag to organize PRs:',
        '',
        'createFirstTag',
        suggestions
      );
      return;
    }

    // Create dropdown menu
    const menu = document.createElement('div');
    menu.className = 'tag-selector';
    
    // Add "Remove tag" option if PR has a tag
    const currentPR = this.allPRs.find(pr => pr.number === prNumber);
    if (currentPR?.customTag) {
      const removeOption = document.createElement('div');
      removeOption.style.cssText = `padding: 8px 12px; cursor: pointer; border-bottom: 1px solid ${Constants.UI_COLORS.HOVER_BACKGROUND}; color: #d1242f;`;
      removeOption.textContent = '✖️ Remove tag';
      removeOption.addEventListener('click', () => {
        this.prTagAssignments.delete(prNumber);
        this.saveCustomTags();
        this.renderPRs(this.allPRs);
        menu.remove();
      });
      menu.appendChild(removeOption);
    }
    
    // Add tag options
    this.customTags.forEach(tag => {
      const option = document.createElement('div');
      option.style.cssText = `
        padding: 8px 12px; 
        cursor: pointer; 
        display: flex; 
        align-items: center; 
        gap: 6px;
        border-bottom: 1px solid ${Constants.UI_COLORS.HOVER_BACKGROUND};
      `;
      option.innerHTML = `
        <span style="width: 8px; height: 8px; border-radius: 50%; background: ${tag.color};"></span>
        📁 ${tag.name}
      `;
      option.addEventListener('click', () => {
        this.prTagAssignments.set(prNumber, tag.name);
        this.saveCustomTags();
        this.renderPRs(this.allPRs);
        menu.remove();
      });
      option.addEventListener('mouseover', () => {
        option.style.backgroundColor = Constants.UI_COLORS.HOVER_BACKGROUND;
      });
      option.addEventListener('mouseout', () => {
        option.style.backgroundColor = Constants.UI_COLORS.TRANSPARENT;
      });
      menu.appendChild(option);
    });
    
    // Position and show menu with boundary detection
    const rect = button.getBoundingClientRect();
    const menuWidth = Constants.TAG_MENU_WIDTH;
    const sidebarRect = DOMSelectors.sidebarContainer()?.getBoundingClientRect() || 
                       { left: 0, right: window.innerWidth };
    
    // Calculate optimal position
    let left = rect.left;
    let top = rect.bottom + 4;
    
    // Adjust horizontal position if menu would overflow sidebar
    const availableRight = sidebarRect.right - left;
    if (availableRight < menuWidth) {
      // Not enough space on the right, try aligning to button's right edge
      left = rect.right - menuWidth;
      
      // If still not enough space, align to sidebar right edge with margin
      if (left < sidebarRect.left) {
        left = Math.max(sidebarRect.left + 8, sidebarRect.right - menuWidth - 8);
      }
    }
    
    // Ensure menu stays within sidebar bounds
    left = Math.max(sidebarRect.left + 4, Math.min(left, sidebarRect.right - menuWidth - 4));
    
    // Adjust vertical position if near bottom of viewport
    const menuHeight = Math.min((this.customTags.length + 1) * Constants.TAG_ITEM_HEIGHT + Constants.UI_MARGIN, Constants.TAG_MENU_MAX_HEIGHT);
    if (top + menuHeight > window.innerHeight - Constants.UI_MARGIN) {
      top = rect.top - menuHeight - 4; // Show above button
      
      // If still not enough space above, position at top of viewport
      if (top < Constants.UI_MARGIN) {
        top = Constants.UI_MARGIN;
      }
    }
    
    menu.style.cssText += `
      position: fixed;
      top: ${top}px;
      left: ${left}px;
      z-index: 1000;
      max-width: ${menuWidth}px;
      min-width: ${Constants.TAG_MENU_MIN_WIDTH}px;
    `;
    
    document.body.appendChild(menu);
    
    // Close menu when clicking outside
    const closeMenu = (e) => {
      if (!menu.contains(e.target) && e.target !== button) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  /**
   * Get a random color from the predefined tag color palette
   * 
   * @returns {string} Hex color code
   */
  getRandomTagColor() {
    return Constants.TAG_COLORS[Math.floor(Math.random() * Constants.TAG_COLORS.length)];
  }

  removePRTag(prNumber) {
    this.prTagAssignments.delete(prNumber);
    this.saveCustomTags();
    this.renderPRs(this.allPRs); // Re-render to remove the tag
  }

  manageCustomTags() {
    this.modalManager.showTagManagement();
  }

  deleteTag(tagIndex) {
    if (tagIndex >= 0 && tagIndex < this.customTags.length) {
      const tagToDelete = this.customTags[tagIndex];
      
      this.modalManager.showConfirm(
        'Delete Tag',
        `Delete tag "${tagToDelete.name}"? This will remove it from all assigned PRs.`,
        `confirmDeleteTag.bind(prShepherd, ${tagIndex})`
      );
    }
  }

  confirmDeleteTag(tagIndex) {
    const tagToDelete = this.customTags[tagIndex];
    
    // Remove tag assignments
    for (const [prNumber, tagName] of this.prTagAssignments.entries()) {
      if (tagName === tagToDelete.name) {
        this.prTagAssignments.delete(prNumber);
      }
    }
    
    // Remove tag
    this.customTags.splice(tagIndex, 1);
    this.saveCustomTags();
    this.renderCustomTagFilters();
    this.renderPRs(this.allPRs);
    
    // Show success and return to manage view
    setTimeout(() => {
      if (this.customTags.length > 0) {
        this.manageCustomTags();
      }
    }, 100);
  }
}

/**
 * Global reference for onclick handlers in HTML
 * @type {PRShepherdSidebar|null}
 */
let prShepherd;

/**
 * Initialize the application when DOM is loaded
 * Creates global PRShepherdSidebar instance
 */
document.addEventListener('DOMContentLoaded', () => {
  prShepherd = new PRShepherdSidebar();
});