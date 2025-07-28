// PR Shepherd Sidebar Script

class PRShepherdSidebar {
  constructor() {
    this.baseUrl = 'https://api.github.com/graphql';
    this.repo = { owner: 'vllm-project', name: 'vllm' };
    this.rateLimitInfo = { remaining: 5000, reset: 0 };
    this.lastUpdate = null;
    
    this.init();
  }

  async init() {
    await this.checkAuth();
    this.setupEventListeners();
    await this.loadPRs();
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

    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
      this.loadPRs(true);
    });

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.handleFilterClick(e);
      });
    });

    // Listen for background updates
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'pr-updated') {
        this.loadPRsFromCache();
      }
    });
  }

  setupAutoRefresh() {
    // Refresh every 5 minutes when sidebar is visible
    setInterval(() => {
      if (document.visibilityState === 'visible' && this.token) {
        this.loadPRs();
      }
    }, 5 * 60 * 1000);
  }

  async handleAuth() {
    const token = prompt(
      'Enter your GitHub Personal Access Token:\n\n' +
      'Required scopes: repo, read:org\n' +
      '(OAuth coming soon!)'
    );
    
    if (token && token.trim()) {
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
    
    const filter = e.target.dataset.filter;
    this.filterPRs(filter);
  }

  filterPRs(filter) {
    const prItems = document.querySelectorAll('.pr-item');
    prItems.forEach(item => {
      const shouldShow = this.shouldShowPR(item, filter);
      item.style.display = shouldShow ? 'block' : 'none';
    });
  }

  shouldShowPR(prItem, filter) {
    if (filter === 'all') return true;
    
    const status = prItem.dataset.status || '';
    const isDraft = prItem.dataset.draft === 'true';
    const reviewDecision = prItem.dataset.reviewDecision || '';
    
    switch (filter) {
      case 'ready':
        return !isDraft && status === 'OPEN' && reviewDecision !== 'APPROVED';
      case 'wip':
        return isDraft;
      case 'finished':
        return status === 'MERGED' || status === 'CLOSED' || reviewDecision === 'APPROVED';
      default:
        return true;
    }
  }

  async loadPRs(forceRefresh = false) {
    if (!this.token) return;

    const listElement = document.getElementById('pr-list');
    const refreshBtn = document.getElementById('refresh-btn');
    
    // Show loading state
    refreshBtn.style.opacity = '0.5';
    if (listElement.children.length === 0 || forceRefresh) {
      listElement.innerHTML = '<div class="loading">Loading your PRs...</div>';
    }

    try {
      const prs = await this.fetchPRs();
      this.renderPRs(prs);
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
      } else {
        listElement.innerHTML = `<div class="error">Error loading PRs: ${error.message}</div>`;
      }
    } finally {
      refreshBtn.style.opacity = '1';
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
      console.log('No cached data available, fetching fresh');
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
              reviews(first: 5, states: [APPROVED, CHANGES_REQUESTED]) {
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

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.errors) {
      throw new Error(`GraphQL Error: ${data.errors[0].message}`);
    }

    // Store rate limit info
    this.rateLimitInfo = data.data.rateLimit;
    
    return data.data.repository.pullRequests.nodes;
  }

  renderPRs(prs) {
    const listElement = document.getElementById('pr-list');
    
    if (prs.length === 0) {
      listElement.innerHTML = '<div class="empty">No open pull requests found.</div>';
      return;
    }

    const prHTML = prs.map(pr => this.renderPR(pr)).join('');
    listElement.innerHTML = prHTML;
  }

  renderPR(pr) {
    const statusIcon = this.getStatusIcon(pr);
    const reviewStatus = this.getReviewStatus(pr);
    const ciStatus = this.getCIStatus(pr);
    const labels = this.renderLabels(pr.labels.nodes);
    
    return `
      <div class="pr-item" 
           data-status="${pr.state}" 
           data-draft="${pr.isDraft}"
           data-review-decision="${pr.reviewDecision || ''}">
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
      lastUpdateElement.textContent = `Updated: ${this.lastUpdate.toLocaleTimeString()}`;
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PRShepherdSidebar();
});