// PR Shepherd Popup Script

class PRShepherd {
  constructor() {
    this.baseUrl = 'https://api.github.com/graphql';
    this.repo = { owner: 'vllm-project', name: 'vllm' };
    this.rateLimitInfo = { remaining: 5000, reset: 0 };
    
    this.init();
  }

  async init() {
    await this.checkAuth();
    this.setupEventListeners();
    await this.loadPRs();
  }

  async checkAuth() {
    const token = await this.getStoredToken();
    const authSection = document.getElementById('auth-section');
    const mainContent = document.getElementById('main-content');
    
    if (token) {
      authSection.style.display = 'none';
      mainContent.style.display = 'block';
      this.token = token;
    } else {
      authSection.style.display = 'block';
      mainContent.style.display = 'none';
    }
  }

  async getStoredToken() {
    // For now, check for environment variable or temporary storage
    // TODO: Implement proper OAuth flow
    return new Promise((resolve) => {
      chrome.storage.local.get(['github_token'], (result) => {
        resolve(result.github_token);
      });
    });
  }

  setupEventListeners() {
    document.getElementById('auth-btn').addEventListener('click', () => {
      this.handleAuth();
    });

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.handleFilterClick(e);
      });
    });
  }

  async handleAuth() {
    // Temporary: prompt for token (replace with OAuth later)
    const token = prompt('Enter your GitHub Personal Access Token:\n(This is temporary - OAuth coming soon!)');
    if (token) {
      await this.storeToken(token);
      this.token = token;
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
    
    switch (filter) {
      case 'ready':
        return !isDraft && status !== 'MERGED' && status !== 'CLOSED';
      case 'wip':
        return isDraft;
      case 'finished':
        return status === 'MERGED' || status === 'CLOSED';
      default:
        return true;
    }
  }

  async loadPRs() {
    if (!this.token) return;

    const listElement = document.getElementById('pr-list');
    listElement.innerHTML = '<div class="loading">Loading your PRs...</div>';

    try {
      const prs = await this.fetchPRs();
      this.renderPRs(prs);
      this.updateRateLimitDisplay();
    } catch (error) {
      console.error('Error loading PRs:', error);
      listElement.innerHTML = `<div class="error">Error loading PRs: ${error.message}</div>`;
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
      <div class="pr-item" data-status="${pr.state}" data-draft="${pr.isDraft}">
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
    return ciState ? ciState.toLowerCase() : 'unknown';
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
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffHours < 1) return 'just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  }

  updateRateLimitDisplay() {
    const rateLimitElement = document.getElementById('rate-limit-info');
    const resetTime = new Date(this.rateLimitInfo.resetAt).toLocaleTimeString();
    
    rateLimitElement.innerHTML = `
      Rate limit: ${this.rateLimitInfo.remaining}/${this.rateLimitInfo.limit} 
      (resets at ${resetTime})
    `;
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PRShepherd();
});