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
    this.customGroups = [];
    this.searchTerm = '';
    this.reviewerOnlyMode = true;
    this.includeTeamRequests = false;
    
    this.init();
  }

  async init() {
    await this.loadCustomGroups();
    await this.checkAuth();
    this.setupEventListeners();
    
    // Load cached data first, then fetch fresh data
    await this.loadCachedData();
    this.loadPRs(); // Don't await - let it happen in background
    
    this.setupAutoRefresh();
  }

  async checkAuth() {
    const token = await this.getStoredToken();
    const authSection = document.getElementById('auth-section');
    const mainContent = document.getElementById('main-content');
    
    if (token) {
      authSection.style.display = 'none';
      mainContent.style.display = 'flex';
      this.token = token;
    } else {
      authSection.style.display = 'flex';
      mainContent.style.display = 'none';
    }
  }

  async getStoredToken() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['github_token'], (result) => {
        resolve(result.github_token);
      });
    });
  }

  setupEventListeners() {
    // Auth button
    document.getElementById('auth-btn').addEventListener('click', () => {
      this.handleAuth();
    });

    // Settings button
    document.getElementById('settings-btn').addEventListener('click', () => {
      this.handleAuth();
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

    // Add group button
    document.getElementById('add-group-btn').addEventListener('click', () => {
      this.createCustomGroup();
    });

    // Listen for background updates
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'pr-updated') {
        this.loadPRsFromCache();
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

  async handleAuth() {
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
      // Validate token format
      if (!token.trim().startsWith('ghp_') && !token.trim().startsWith('github_pat_')) {
        alert('⚠️ Invalid token format. GitHub tokens start with "ghp_" or "github_pat_"');
        return;
      }
      
      await this.storeToken(token.trim());
      this.token = token.trim();
      await this.checkAuth();
      await this.loadPRs();
    }
  }

  async storeToken(token) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ github_token: token }, resolve);
    });
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
    
    switch (filter) {
      case 'ready':
        return !isDraft && pr.state === 'OPEN' && reviewDecision !== 'APPROVED';
      case 'wip':
        return isDraft;
      case 'finished':
        return pr.state === 'MERGED' || pr.state === 'CLOSED' || reviewDecision === 'APPROVED';
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
            GitHub API temporarily unavailable. 
            <br><small>Try again in a few minutes.</small>
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
          pullRequests(first: 100, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              id
              number
              title
              state
              isDraft
              mergeable
              createdAt
              updatedAt
              author {
                login
              }
              headRefName
              reviewRequests(first: 10) {
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
              reviews(first: 10, states: [APPROVED, CHANGES_REQUESTED, COMMENTED]) {
                totalCount
                nodes {
                  state
                  author {
                    login
                  }
                }
              }
              labels(first: 5) {
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
    this.allPRs = prs;
    this.currentFilter = 'all';
    this.applyFilters();
    this.renderCustomGroups();
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
    const statusIcon = this.getStatusIcon(pr);
    const reviewStatus = this.getReviewStatus(pr);
    const ciStatus = this.getCIStatus(pr);
    const labels = this.renderLabels(pr.labels.nodes);
    
    return `
      <div class="pr-item" 
           data-pr-number="${pr.number}"
           data-status="${pr.state}" 
           data-draft="${pr.isDraft}"
           data-review-decision="${pr.reviewDecision || ''}"
           draggable="true">
        <div class="pr-header">
          <div class="pr-title">
            <a href="https://github.com/${this.repo.owner}/${this.repo.name}/pull/${pr.number}" 
               target="_blank" class="pr-link">
              #${pr.number} ${pr.title}
            </a>
            ${pr.isDraft ? '<span class="draft-badge">DRAFT</span>' : ''}
          </div>
          <div class="pr-meta">
            by ${pr.author.login} • ${this.formatDate(pr.updatedAt)}
          </div>
        </div>
        <div class="pr-status">
          <div class="status-item">
            ${statusIcon} ${ciStatus}
          </div>
          <div class="status-item">
            ${reviewStatus}
          </div>
        </div>
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
    const ciState = pr.commits.nodes[0]?.commit?.statusCheckRollup?.state;
    if (!ciState) return 'unknown';
    
    return ciState.toLowerCase().replace('_', ' ');
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

  // Custom Groups Functionality
  async loadCustomGroups() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['custom_groups'], (result) => {
        this.customGroups = result.custom_groups || [];
        resolve();
      });
    });
  }

  async saveCustomGroups() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ custom_groups: this.customGroups }, resolve);
    });
  }

  createCustomGroup() {
    const name = prompt('Enter group name:');
    if (name && name.trim()) {
      const group = {
        id: Date.now().toString(),
        name: name.trim(),
        prNumbers: []
      };
      this.customGroups.push(group);
      this.saveCustomGroups();
      this.renderCustomGroups();
    }
  }

  renderCustomGroups() {
    const container = document.getElementById('custom-groups');
    
    if (this.customGroups.length === 0) {
      container.innerHTML = '';
      return;
    }

    const groupsHTML = this.customGroups.map(group => this.renderCustomGroup(group)).join('');
    container.innerHTML = groupsHTML;
    this.setupGroupEventListeners();
  }

  renderCustomGroup(group) {
    const prsInGroup = group.prNumbers.map(prNumber => {
      const pr = this.allPRs.find(p => p.number === prNumber);
      return pr ? `
        <div class="group-pr-item">
          #${pr.number} ${pr.title.substring(0, 30)}${pr.title.length > 30 ? '...' : ''}
          <button class="group-pr-remove" onclick="prShepherd.removePRFromGroup('${group.id}', ${pr.number})">×</button>
        </div>
      ` : '';
    }).filter(html => html).join('');

    return `
      <div class="custom-group" data-group-id="${group.id}">
        <div class="group-header">
          <span class="group-title">${group.name}</span>
          <div class="group-actions">
            <span class="group-count">${group.prNumbers.length}</span>
            <button class="group-delete-btn" onclick="prShepherd.deleteGroup('${group.id}')">×</button>
          </div>
        </div>
        <div class="group-content" data-group-id="${group.id}">
          ${prsInGroup}
        </div>
      </div>
    `;
  }

  setupGroupEventListeners() {
    // Setup drop zones for custom groups
    document.querySelectorAll('.group-content').forEach(groupContent => {
      groupContent.addEventListener('dragover', (e) => {
        e.preventDefault();
        groupContent.classList.add('drag-over');
      });

      groupContent.addEventListener('dragleave', (e) => {
        if (!groupContent.contains(e.relatedTarget)) {
          groupContent.classList.remove('drag-over');
        }
      });

      groupContent.addEventListener('drop', (e) => {
        e.preventDefault();
        groupContent.classList.remove('drag-over');
        
        const prNumber = parseInt(e.dataTransfer.getData('text/plain'));
        const groupId = groupContent.dataset.groupId;
        this.addPRToGroup(groupId, prNumber);
      });
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

  addPRToGroup(groupId, prNumber) {
    const group = this.customGroups.find(g => g.id === groupId);
    if (group && !group.prNumbers.includes(prNumber)) {
      group.prNumbers.push(prNumber);
      this.saveCustomGroups();
      this.renderCustomGroups();
    }
  }

  removePRFromGroup(groupId, prNumber) {
    const group = this.customGroups.find(g => g.id === groupId);
    if (group) {
      group.prNumbers = group.prNumbers.filter(num => num !== prNumber);
      this.saveCustomGroups();
      this.renderCustomGroups();
    }
  }

  deleteGroup(groupId) {
    if (confirm('Delete this group?')) {
      this.customGroups = this.customGroups.filter(g => g.id !== groupId);
      this.saveCustomGroups();
      this.renderCustomGroups();
    }
  }
}

// Global reference for onclick handlers
let prShepherd;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  prShepherd = new PRShepherdSidebar();
});