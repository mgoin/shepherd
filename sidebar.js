// PR Shepherd Sidebar Script

class PRShepherdSidebar {
  constructor() {
    this.baseUrl = 'https://api.github.com/graphql';
    this.repo = { owner: 'vllm-project', name: 'vllm' };
    this.rateLimitInfo = { remaining: 5000, reset: 0 };
    this.lastUpdate = null;
    this.allPRs = [];
    this.filteredPRs = [];
    this.currentUser = null;
    this.customTags = [];
    this.prTagAssignments = new Map(); // Map PR numbers to custom tags
    this.searchTerm = '';
    this.reviewerOnlyMode = true;
    this.includeTeamRequests = false;
    this.oauthClient = new GitHubOAuth();
    
    this.init();
  }

  async init() {
    await this.loadCustomTags();
    await this.checkAuth();
    this.setupEventListeners();
    
    // Load cached data first, then fetch fresh data
    await this.loadCachedData();
    this.loadPRs(); // Don't await - let it happen in background
    
    this.setupAutoRefresh();
  }

  async checkAuth() {
    const authSection = document.getElementById('auth-section');
    const mainContent = document.getElementById('main-content');
    
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
        const response = await fetch('https://api.github.com/user', {
          headers: {
            'Authorization': `token ${this.token}`,
            'Accept': 'application/vnd.github.v3+json'
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

  setupEventListeners() {
    // OAuth button
    document.getElementById('oauth-btn').addEventListener('click', () => {
      this.handleOAuthFlow();
    });

    // PAT button
    document.getElementById('pat-btn').addEventListener('click', () => {
      this.handlePATFlow();
    });

    // Settings button
    document.getElementById('settings-btn').addEventListener('click', () => {
      this.showAuthSettings();
    });

    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
      this.loadPRs(true);
    });

    // Search input
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
      this.searchTerm = e.target.value.toLowerCase();
      this.applyFilters();
    });

    // Reviewer only checkbox
    document.getElementById('reviewer-only').addEventListener('change', (e) => {
      this.reviewerOnlyMode = e.target.checked;
      this.applyFilters();
    });

    // Include team requests checkbox
    document.getElementById('include-teams').addEventListener('change', (e) => {
      this.includeTeamRequests = e.target.checked;
      this.applyFilters();
    });

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.handleFilterClick(e);
      });
    });

    // Add tag button
    document.getElementById('add-tag-btn').addEventListener('click', () => {
      this.createCustomTag();
    });

    // Manage tags button
    document.getElementById('manage-tags-btn').addEventListener('click', () => {
      this.manageCustomTags();
    });

    // Listen for background updates
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'pr-updated') {
        this.loadPRsFromCache();
      }
    });

    // CI status expansion toggle
    document.addEventListener('click', (e) => {
      if (e.target.closest('.ci-summary')) {
        const statusContainer = e.target.closest('.ci-status-detailed');
        const details = statusContainer?.querySelector('.ci-details');
        if (details) {
          const isVisible = details.style.display !== 'none';
          details.style.display = isVisible ? 'none' : 'block';
          
          // Update summary visual state
          const summary = statusContainer.querySelector('.ci-summary');
          if (summary) {
            summary.classList.toggle('expanded', !isVisible);
          }
        }
      }
    });
  }

  setupAutoRefresh() {
    // Refresh every 5 minutes when sidebar is visible, but respect rate limits
    setInterval(() => {
      if (document.visibilityState === 'visible' && this.token) {
        // Only refresh if we have sufficient rate limit remaining
        if (this.rateLimitInfo.remaining > 50) {
          this.loadPRs();
        } else {
          console.log('Skipping auto-refresh due to low rate limit:', this.rateLimitInfo.remaining);
        }
      }
    }, 5 * 60 * 1000);
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
    const token = prompt(
      '🔑 GitHub Personal Access Token Setup\n\n' +
      '1. Go to: https://github.com/settings/tokens\n' +
      '2. Click "Generate new token (classic)"\n' +
      '3. Select these scopes:\n' +
      '   ✅ repo (Full control of private repositories)\n' +
      '   ✅ read:org (Read org and team membership)\n' +
      '4. Copy and paste the token below:\n\n' +
      'Token:'
    );
    
    if (token && token.trim()) {
      try {
        // Validate token format
        if (!token.trim().startsWith('ghp_') && !token.trim().startsWith('github_pat_')) {
          alert('⚠️ Invalid token format. GitHub tokens start with "ghp_" or "github_pat_"');
          return;
        }
        
        this.showAuthStatus('Validating token...');
        
        const authResult = await this.oauthClient.authenticateWithPAT(token.trim());
        
        if (authResult && authResult.authenticated) {
          this.hideAuthStatus();
          await this.checkAuth();
          await this.loadPRs();
        } else {
          this.showAuthError('Invalid token. Please check your token and try again.');
        }
      } catch (error) {
        console.error('PAT authentication failed:', error);
        this.showAuthError(`Token validation failed: ${error.message}`);
      }
    }
  }

  async showAuthSettings() {
    const currentAuth = await this.oauthClient.getCurrentAuth();
    
    if (!currentAuth) {
      alert('No authentication configured. Please connect to GitHub first.');
      return;
    }

    const method = currentAuth.method === 'oauth' ? 'OAuth' : 'Personal Access Token';
    const action = confirm(
      `Currently authenticated via ${method}\n\n` +
      'Would you like to logout and connect a different account?'
    );

    if (action) {
      await this.logout();
    }
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
      alert('Logout failed. Please try again.');
    }
  }

  showAuthStatus(message) {
    const statusElement = document.getElementById('auth-status');
    const statusText = document.getElementById('auth-status-text');
    
    statusText.textContent = message;
    statusElement.style.display = 'flex';
  }

  hideAuthStatus() {
    const statusElement = document.getElementById('auth-status');
    statusElement.style.display = 'none';
  }

  showAuthError(message) {
    this.hideAuthStatus();
    alert(`❌ ${message}`);
  }


  handleFilterClick(e) {
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    e.target.classList.add('active');
    
    this.currentFilter = e.target.dataset.filter;
    this.applyFilters();
  }

  applyFilters() {
    this.filteredPRs = this.allPRs.filter(pr => {
      // Search filter
      if (this.searchTerm) {
        const searchableText = `${pr.title} ${pr.number} ${pr.author.login} ${pr.headRefName}`.toLowerCase();
        if (!this.fuzzyMatch(searchableText, this.searchTerm)) {
          return false;
        }
      }

      // Reviewer only filter
      if (this.reviewerOnlyMode && this.currentUser) {
        const isDirectReviewer = pr.reviewRequests.nodes.some(req => {
          const reviewer = req.requestedReviewer;
          return reviewer?.login === this.currentUser.login;
        });
        
        const hasTeamRequest = this.includeTeamRequests && pr.reviewRequests.nodes.some(req => {
          const reviewer = req.requestedReviewer;
          return reviewer?.slug; // This means it's a team
        });
        
        const hasReviewed = pr.reviews.nodes.some(review => 
          review.author.login === this.currentUser.login
        );
        
        if (!isDirectReviewer && !hasTeamRequest && !hasReviewed) {
          return false;
        }
      }

      // Status filter
      if (this.currentFilter && this.currentFilter !== 'all') {
        return this.shouldShowPR(pr, this.currentFilter);
      }

      return true;
    });

    this.renderFilteredPRs();
  }

  fuzzyMatch(text, search) {
    const searchWords = search.split(' ').filter(word => word.length > 0);
    return searchWords.every(word => text.includes(word));
  }

  shouldShowPR(pr, filter) {
    const isDraft = pr.isDraft;
    const reviewDecision = pr.reviewDecision || '';
    
    // Check if it's a custom tag filter
    if (this.customTags.some(tag => tag.name === filter)) {
      return pr.customTag?.name === filter;
    }
    
    switch (filter) {
      case 'ready':
        return !isDraft && pr.state === 'OPEN' && reviewDecision !== 'APPROVED';
      case 'wip':
        return isDraft;
      case 'finished':
        return pr.state === 'MERGED' || pr.state === 'CLOSED' || reviewDecision === 'APPROVED';
      case 'pinged':
        return this.getActivityInfo(pr).includes('Review requested');
      case 'author-active':
        const activity = this.getActivityInfo(pr);
        return activity.includes('Recently updated');
      default:
        return true;
    }
  }

  async loadPRs(forceRefresh = false) {
    if (!this.token) return;

    const listElement = document.getElementById('pr-list');
    const refreshBtn = document.getElementById('refresh-btn');
    
    // Only show loading state if we don't have cached data or forced refresh
    const hasExistingData = this.allPRs && this.allPRs.length > 0;
    refreshBtn.classList.add('updating');
    
    if (!hasExistingData || forceRefresh) {
      listElement.innerHTML = '<div class="loading">Loading your PRs...</div>';
    }

    try {
      const prs = await this.fetchPRs();
      this.renderPRs(prs);
      await this.savePRCache(prs); // Save to cache
      this.updateFooter();
      this.lastUpdate = new Date();
    } catch (error) {
      console.error('Error loading PRs:', error);
      if (error.message.includes('401') || error.message.includes('Bad credentials')) {
        listElement.innerHTML = `
          <div class="error">
            Authentication failed. Please check your token.
            <br><br>
            <button class="btn" onclick="document.getElementById('auth-btn').click()">
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
            <button class="btn" onclick="document.getElementById('auth-btn').click()">
              Update Token
            </button>
          </div>
        `;
      } else if (error.message.includes('403')) {
        listElement.innerHTML = `
          <div class="error">
            Rate limit exceeded. Please wait before refreshing.
            <br><small>Limit resets at ${new Date(this.rateLimitInfo.resetAt || Date.now() + 3600000).toLocaleTimeString()}</small>
          </div>
        `;
      } else if (error.message.includes('502') || error.message.includes('503') || error.message.includes('504')) {
        listElement.innerHTML = `
          <div class="error">
            GitHub API temporarily unavailable (${error.message.includes('504') ? 'timeout' : 'server error'}).
            <br><small>GitHub is experiencing issues. This is not a problem with the extension.</small>
            <br><br>
            <button class="btn" onclick="document.getElementById('refresh-btn').click()">
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

  async fetchPRs() {
    const query = `
      query GetVLLMPRs($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          pullRequests(first: 50, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              id
              number
              title
              state
              isDraft
              createdAt
              updatedAt
              author {
                login
              }
              headRefName
              reviewRequests(first: 5) {
                nodes {
                  requestedReviewer {
                    ... on User {
                      login
                    }
                    ... on Team {
                      slug
                      name
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
              reviews(first: 5) {
                totalCount
                nodes {
                  state
                  author {
                    login
                  }
                }
              }
              labels(first: 3) {
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
          limit
          remaining
          resetAt
        }
      }
    `;

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          owner: this.repo.owner,
          name: this.repo.name
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
    
    return data.data.repository.pullRequests.nodes;
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
    this.renderTagAssignments();
  }

  renderFilteredPRs() {
    const listElement = document.getElementById('pr-list');
    
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
    
    // Add drag and drop functionality
    this.setupDragAndDrop();
  }

  renderPR(pr) {
    const reviewStatus = this.getReviewStatus(pr);
    const detailedCIStatus = this.getDetailedCIDisplay(pr);
    const labels = this.renderLabels(pr.labels.nodes);
    const activityInfo = this.getActivityInfo(pr);
    const assignedTag = pr.customTag ? `<span class="custom-tag" style="background-color: ${pr.customTag.color}">${pr.customTag.name}</span>` : '';
    
    return `
      <div class="pr-item" 
           data-pr-number="${pr.number}"
           data-status="${pr.state}" 
           data-draft="${pr.isDraft}"
           data-review-decision="${pr.reviewDecision || ''}"
           data-custom-tag="${pr.customTag?.name || ''}"
           draggable="true">
        <div class="pr-header">
          <div class="pr-title">
            <a href="https://github.com/${this.repo.owner}/${this.repo.name}/pull/${pr.number}" 
               target="_blank" class="pr-link">
              #${pr.number} ${pr.title}
            </a>
            ${pr.isDraft ? '<span class="draft-badge">DRAFT</span>' : ''}
            ${assignedTag}
          </div>
          <div class="pr-meta">
            by ${pr.author.login} • ${this.formatDate(pr.updatedAt)}
          </div>
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
      case 'SUCCESS': return '✅';
      case 'FAILURE': case 'ERROR': return '❌';
      case 'PENDING': return '🟡';
      default: return '⚪';
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
  
  getCIIcon(state) {
    switch (state) {
      case 'success': return '✅';
      case 'failure': return '❌';
      case 'error': return '🚫';
      case 'pending': return '🟡';
      case 'in_progress': return '🔄';
      case 'queued': return '⏳';
      case 'completed': return '✅';
      case 'cancelled': return '⚪';
      case 'skipped': return '⏭️';
      case 'neutral': return '⚪';
      case 'timed_out': return '⏰';
      case 'action_required': return '⚠️';
      default: return '❓';
    }
  }

  getReviewStatus(pr) {
    if (pr.reviewDecision === 'APPROVED') return '👍 Approved';
    if (pr.reviewDecision === 'CHANGES_REQUESTED') return '👎 Changes requested';
    
    // Check if user is directly requested for review
    const isDirectReviewer = pr.reviewRequests.nodes.some(req => {
      const reviewer = req.requestedReviewer;
      return reviewer?.login === this.currentUser?.login;
    });
    
    // Check for team requests
    const teamRequests = pr.reviewRequests.nodes.filter(req => req.requestedReviewer?.slug);
    
    if (isDirectReviewer) return '👤 You requested';
    if (teamRequests.length > 0) return `👥 Team review (${teamRequests.length})`;
    
    const reviewCount = pr.reviews.totalCount;
    if (reviewCount === 0) return '⏳ No reviews';
    
    return `💬 ${reviewCount} review${reviewCount > 1 ? 's' : ''}`;
  }

  getActivityInfo(pr) {
    if (!this.currentUser) return '';
    
    const activities = [];
    
    // Check if user is requested for review
    const isDirectReviewer = pr.reviewRequests.nodes.some(req => {
      const reviewer = req.requestedReviewer;
      return reviewer?.login === this.currentUser.login;
    });
    
    if (isDirectReviewer) {
      activities.push('🔔 Review requested');
    }
    
    // Check for recent updates (within 1 day)
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    const updatedAt = new Date(pr.updatedAt).getTime();
    
    if (updatedAt > oneDayAgo) {
      activities.push('🔄 Recently updated');
    }
    
    return activities.length > 0 ? activities.join(' • ') : '';
  }

  renderLabels(labels) {
    if (!labels.length) return '';
    
    return labels.map(label => 
      `<span class="label" style="background-color: #${label.color}">${label.name}</span>`
    ).join('');
  }

  formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffMinutes < 1) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  }

  updateFooter() {
    const rateLimitElement = document.getElementById('rate-limit-info');
    const lastUpdateElement = document.getElementById('last-update');
    
    if (this.rateLimitInfo) {
      const resetTime = new Date(this.rateLimitInfo.resetAt).toLocaleTimeString();
      rateLimitElement.textContent = `API: ${this.rateLimitInfo.remaining}/${this.rateLimitInfo.limit} (resets ${resetTime})`;
    }
    
    if (this.lastUpdate) {
      const timeAgo = this.getTimeAgo(this.lastUpdate);
      lastUpdateElement.textContent = `Updated: ${timeAgo}`;
    }
  }

  getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffMinutes < 1) return 'just now';
    if (diffMinutes === 1) return '1 minute ago';
    if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
    
    return date.toLocaleTimeString();
  }

  // Custom Tags Functionality
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
    const name = prompt('Enter tag name:');
    if (name && name.trim()) {
      const color = prompt('Enter tag color (hex, e.g. #ff6b6b):', '#0969da');
      if (color) {
        const tag = {
          id: Date.now().toString(),
          name: name.trim(),
          color: color.trim()
        };
        this.customTags.push(tag);
        this.saveCustomTags();
        this.renderCustomTagFilters();
        this.renderTagAssignments();
      }
    }
  }

  renderCustomTagFilters() {
    const container = document.getElementById('custom-tag-filters');
    
    if (this.customTags.length === 0) {
      container.innerHTML = '';
      return;
    }

    const filtersHTML = this.customTags.map(tag => 
      `<button class="filter-btn" data-filter="${tag.name}" style="border-color: ${tag.color}; color: ${tag.color};">
        ${tag.name}
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

  renderTagAssignments() {
    const container = document.getElementById('tag-assignments');
    
    if (this.customTags.length === 0) {
      container.innerHTML = '<p class="tag-help">Create custom tags to organize your PRs</p>';
      return;
    }

    const assignedPRs = Array.from(this.prTagAssignments.entries()).map(([prNumber, tagName]) => {
      const pr = this.allPRs.find(p => p.number === prNumber);
      const tag = this.customTags.find(t => t.name === tagName);
      if (pr && tag) {
        return `
          <div class="assigned-pr-item" style="border-left-color: ${tag.color};">
            <span class="custom-tag" style="background-color: ${tag.color};">${tag.name}</span>
            #${pr.number} ${pr.title.substring(0, 25)}${pr.title.length > 25 ? '...' : ''}
            <button class="remove-tag-btn" onclick="prShepherd.removePRTag(${pr.number})">×</button>
          </div>
        `;
      }
      return '';
    }).filter(html => html).join('');

    container.innerHTML = assignedPRs || '<p class="tag-help">Drag PRs here to assign custom tags</p>';
    this.setupTagDropZone();
  }

  setupTagDropZone() {
    const dropZone = document.getElementById('tag-assignments');
    
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
      if (!dropZone.contains(e.relatedTarget)) {
        dropZone.classList.remove('drag-over');
      }
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      
      const prNumber = parseInt(e.dataTransfer.getData('text/plain'));
      this.assignTagToPR(prNumber);
    });
  }

  setupDragAndDrop() {
    document.querySelectorAll('.pr-item[draggable="true"]').forEach(prItem => {
      prItem.addEventListener('dragstart', (e) => {
        const prNumber = parseInt(prItem.dataset.prNumber);
        e.dataTransfer.setData('text/plain', prNumber.toString());
        prItem.classList.add('dragging');
      });

      prItem.addEventListener('dragend', (e) => {
        prItem.classList.remove('dragging');
      });
    });
  }

  assignTagToPR(prNumber) {
    if (this.customTags.length === 0) {
      alert('Please create custom tags first');
      return;
    }

    const tagOptions = this.customTags.map((tag, index) => `${index + 1}. ${tag.name}`).join('\n');
    const choice = prompt(`Select a tag for PR #${prNumber}:\n\n${tagOptions}\n\nEnter number:`);
    
    if (choice) {
      const tagIndex = parseInt(choice) - 1;
      if (tagIndex >= 0 && tagIndex < this.customTags.length) {
        const selectedTag = this.customTags[tagIndex];
        this.prTagAssignments.set(prNumber, selectedTag.name);
        this.saveCustomTags();
        this.renderPRs(this.allPRs); // Re-render to show the tag
      }
    }
  }

  removePRTag(prNumber) {
    this.prTagAssignments.delete(prNumber);
    this.saveCustomTags();
    this.renderPRs(this.allPRs); // Re-render to remove the tag
  }

  manageCustomTags() {
    if (this.customTags.length === 0) {
      alert('No custom tags created yet. Click the + button to create one.');
      return;
    }

    const tagList = this.customTags.map((tag, index) => 
      `${index + 1}. ${tag.name} (${tag.color})`
    ).join('\n');
    
    const action = prompt(`Custom Tags:\n\n${tagList}\n\nEnter tag number to delete, or 'cancel':`);
    
    if (action && action !== 'cancel') {
      const tagIndex = parseInt(action) - 1;
      if (tagIndex >= 0 && tagIndex < this.customTags.length) {
        const tagToDelete = this.customTags[tagIndex];
        if (confirm(`Delete tag "${tagToDelete.name}"? This will remove it from all assigned PRs.`)) {
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
          this.renderTagAssignments();
          this.renderPRs(this.allPRs);
        }
      }
    }
  }
}

// Global reference for onclick handlers
let prShepherd;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  prShepherd = new PRShepherdSidebar();
});