import { storageGet, storageSet, DEFAULTS, SYNC_KEYS, LOCAL_KEYS } from './storage-module.js';

// State
let state = {
  groups: DEFAULTS.groups,
  prs: DEFAULTS.prs,
  activeGroup: 'P0',
  token: DEFAULTS.token,
  darkMode: DEFAULTS.darkMode
};

// Load state from storage
async function loadState() {
  const stored = await storageGet(['groups', 'token', 'darkMode', 'prs']);
  if (stored.groups) state.groups = stored.groups;
  if (stored.token) state.token = stored.token;
  if (stored.darkMode !== undefined) state.darkMode = stored.darkMode;
  if (stored.prs) state.prs = stored.prs;
}

// Save state to storage
async function saveState() {
  await storageSet({
    groups: state.groups,
    token: state.token,
    darkMode: state.darkMode,
    prs: state.prs
  });
}

// Apply dark mode to the page
function applyDarkMode() {
  if (state.darkMode) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
}

// Parse PR URL
function parsePrUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (match) return { owner: match[1], repo: match[2], number: parseInt(match[3]) };
  return null;
}

// Fetch PR data from GitHub API
async function fetchPrData(owner, repo, number) {
  const headers = { 'Accept': 'application/vnd.github.v3+json' };
  if (state.token) headers['Authorization'] = `token ${state.token}`;

  const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    // Fetch PR, reviews, and check runs in parallel
    const [prRes, reviewsRes, checksRes] = await Promise.all([
      fetch(`${baseUrl}/pulls/${number}`, { headers }),
      fetch(`${baseUrl}/pulls/${number}/reviews`, { headers }),
      fetch(`${baseUrl}/commits/${number}/check-runs`, { headers }).catch(() => null)
    ]);

    if (!prRes.ok) {
      if (prRes.status === 403) {
        const rateLimitRemaining = prRes.headers.get('X-RateLimit-Remaining');
        if (rateLimitRemaining === '0') {
          throw new Error('GitHub API rate limit exceeded. Add a token in Settings for higher limits.');
        }
        throw new Error('GitHub API access forbidden. Check your token permissions.');
      }
      if (prRes.status === 404) {
        throw new Error('PR not found. It may be private (add a token) or deleted.');
      }
      throw new Error(`PR fetch failed: ${prRes.status}`);
    }

    const pr = await prRes.json();
    const reviews = reviewsRes.ok ? await reviewsRes.json() : [];

    // Get check runs from the PR's head SHA
    let checks = { check_runs: [] };
    try {
      const checksRes2 = await fetch(`${baseUrl}/commits/${pr.head.sha}/check-runs`, { headers });
      if (checksRes2.ok) checks = await checksRes2.json();
    } catch (e) {}

    // Get commit status (for older-style statuses)
    let statuses = [];
    try {
      const statusRes = await fetch(`${baseUrl}/commits/${pr.head.sha}/status`, { headers });
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        statuses = statusData.statuses || [];
      }
    } catch (e) {}

    return {
      title: pr.title,
      number: pr.number,
      url: pr.html_url,
      state: pr.state,
      draft: pr.draft,
      merged: pr.merged || false,
      user: pr.user.login,
      labels: pr.labels.map(l => ({ name: l.name, color: l.color })),
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      headSha: pr.head.sha,
      reviews: reviews,
      checks: checks.check_runs || [],
      statuses: statuses,
      mergeable: pr.mergeable,
      reviewRequested: pr.requested_reviewers?.map(r => r.login) || [],
      fetchedAt: Date.now()
    };
  } catch (error) {
    console.error('Fetch error:', error);
    return { error: error.message };
  }
}

// Get review summary
function getReviewSummary(reviews) {
  const byUser = {};
  // Get latest review per user
  for (const r of reviews) {
    if (r.state !== 'COMMENTED') {
      byUser[r.user.login] = r.state;
    }
  }
  const approved = Object.values(byUser).filter(s => s === 'APPROVED').length;
  const changesRequested = Object.values(byUser).filter(s => s === 'CHANGES_REQUESTED').length;
  return { approved, changesRequested, total: Object.keys(byUser).length };
}

// Get CI status summary
function getCiSummary(checks, statuses) {
  const allChecks = [
    ...checks.map(c => ({
      name: c.name,
      status: c.status,
      conclusion: c.conclusion,
      url: c.html_url || c.details_url || null
    })),
    ...statuses.map(s => ({
      name: s.context,
      status: 'completed',
      conclusion: s.state === 'success' ? 'success' : s.state === 'pending' ? null : 'failure',
      url: s.target_url || null
    }))
  ];

  const total = allChecks.length;
  const passed = allChecks.filter(c => c.conclusion === 'success').length;
  const failed = allChecks.filter(c => c.conclusion === 'failure').length;
  const pending = allChecks.filter(c => c.status !== 'completed' || c.conclusion === null).length;
  const failedChecks = allChecks.filter(c => c.conclusion === 'failure').map(c => ({ name: c.name, url: c.url }));

  return { total, passed, failed, pending, failedChecks };
}

// Detect updates since last seen
function detectUpdates(prData, lastSeen) {
  const updates = [];
  if (!lastSeen) return updates;

  const lastData = lastSeen.data;
  if (!lastData) return updates;

  // New commits
  if (lastData.headSha && prData.headSha !== lastData.headSha) {
    updates.push({ type: 'commits', text: 'New commits pushed', isNew: true });
  }

  // Review requested
  const oldRequested = new Set(lastData.reviewRequested || []);
  const newRequested = prData.reviewRequested || [];
  for (const user of newRequested) {
    if (!oldRequested.has(user)) {
      updates.push({ type: 'review-request', text: `Review requested from ${user}`, isNew: true });
    }
  }

  // New approvals
  const oldApproved = getReviewSummary(lastData.reviews || []).approved;
  const newApproved = getReviewSummary(prData.reviews).approved;
  if (newApproved > oldApproved) {
    updates.push({ type: 'approved', text: `${newApproved - oldApproved} new approval(s)`, isNew: true });
  }

  // CI status changed
  const oldCi = getCiSummary(lastData.checks || [], lastData.statuses || []);
  const newCi = getCiSummary(prData.checks, prData.statuses);
  if (oldCi.failed === 0 && newCi.failed > 0) {
    updates.push({ type: 'ci-failed', text: 'CI started failing', isNew: true });
  } else if (oldCi.failed > 0 && newCi.failed === 0 && newCi.pending === 0) {
    updates.push({ type: 'ci-passed', text: 'CI now passing', isNew: true });
  }

  return updates;
}

// Render tabs
function renderTabs() {
  const tabs = document.getElementById('tabs');
  tabs.innerHTML = '';

  for (const group of state.groups) {
    const count = Object.values(state.prs).filter(p => p.group === group).length;
    const tab = document.createElement('div');
    tab.className = `tab ${state.activeGroup === group ? 'active' : ''}`;
    tab.innerHTML = `${group}<span class="count">${count}</span>`;
    tab.onclick = () => {
      state.activeGroup = group;
      renderTabs();
      renderPrList();
    };
    tabs.appendChild(tab);
  }
}

// Render PR list
function renderPrList() {
  const container = document.getElementById('prList');
  const prsInGroup = Object.entries(state.prs)
    .filter(([_, p]) => p.group === state.activeGroup)
    .sort((a, b) => (b[1].data?.updatedAt || 0) - (a[1].data?.updatedAt || 0));

  if (prsInGroup.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/>
        </svg>
        <strong>No PRs in ${escapeHtml(state.activeGroup)}</strong>
        <p>Visit a GitHub PR page and click "Add to PR Shepherd"</p>
      </div>
    `;
    return;
  }

  container.innerHTML = prsInGroup.map(([url, pr]) => renderPrItem(url, pr)).join('');

  // Add event listeners for group selects
  container.querySelectorAll('.move-group').forEach(select => {
    select.onchange = async (e) => {
      const url = e.target.dataset.url;
      const newGroup = e.target.value;
      state.prs[url].group = newGroup;
      await saveState();
      renderTabs();
      renderPrList();
    };
  });

  // Add event listeners for refresh buttons
  container.querySelectorAll('.refresh-pr').forEach(btn => {
    btn.onclick = async (e) => {
      const button = e.target.closest('.action-btn');
      const url = button.dataset.url;
      button.classList.add('loading');
      await refreshPr(url);
      button.classList.remove('loading');
    };
  });

  // Add event listeners for remove buttons
  container.querySelectorAll('.remove-pr').forEach(btn => {
    btn.onclick = async (e) => {
      const button = e.target.closest('.action-btn');
      const url = button.dataset.url;
      delete state.prs[url];
      await saveState();
      renderTabs();
      renderPrList();
    };
  });
}

// SVG Icons
const icons = {
  refresh: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"/></svg>`,
  remove: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>`,
  check: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>`,
  x: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>`,
  dot: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>`,
  clock: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z"/></svg>`,
  prOpen: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>`,
  prMerged: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z"/></svg>`,
  prClosed: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM3.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg>`,
  prDraft: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5Zm-9.5-14a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z"/></svg>`,
  alert: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>`,
  arrow: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8.22 2.97a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l2.97-2.97H3.75a.75.75 0 0 1 0-1.5h7.44L8.22 4.03a.75.75 0 0 1 0-1.06Z"/></svg>`
};

// Render single PR item
function renderPrItem(url, pr) {
  const data = pr.data;

  // Handle loading state
  if (!data) {
    return `
      <div class="pr-item">
        <div class="pr-header">
          <div class="pr-title-row">
            <a class="pr-title" href="${url}" target="_blank">Loading...</a>
          </div>
        </div>
        <div class="pr-meta">
          <span class="pr-meta-item">
            <div class="loading-spinner" style="width: 12px; height: 12px;"></div>
            Fetching PR data...
          </span>
        </div>
      </div>
    `;
  }

  // Handle error state
  if (data.error) {
    const groupOptions = state.groups.map(g =>
      `<option value="${g}" ${g === pr.group ? 'selected' : ''}>${escapeHtml(g)}</option>`
    ).join('');

    return `
      <div class="pr-item" style="border-color: var(--color-danger-emphasis);">
        <div class="pr-header">
          <div class="pr-title-row">
            <a class="pr-title" href="${url}" target="_blank">${escapeHtml(url.split('/').slice(-3).join('/'))}</a>
          </div>
          <div class="pr-actions" style="opacity: 1;">
            <select class="move-group" data-url="${url}" title="Move to group">
              ${groupOptions}
            </select>
            <button class="action-btn refresh-pr" data-url="${url}" title="Retry">
              ${icons.refresh}
            </button>
            <button class="action-btn danger remove-pr" data-url="${url}" title="Remove">
              ${icons.remove}
            </button>
          </div>
        </div>
        <div class="pr-meta">
          <span class="status-badge status-failure">${icons.alert} Error</span>
          <span class="pr-meta-item" style="color: var(--color-danger-fg);">${escapeHtml(data.error)}</span>
        </div>
      </div>
    `;
  }

  const reviewSummary = getReviewSummary(data.reviews);
  const ciSummary = getCiSummary(data.checks, data.statuses);
  const updates = pr.updates || [];

  // Parse repo from URL
  const urlMatch = url.match(/github\.com\/([^/]+\/[^/]+)/);
  const repoName = urlMatch ? urlMatch[1] : '';

  // CI status with icon
  let ciClass = 'status-neutral';
  let ciIcon = icons.dot;
  let ciText = 'No checks';
  if (ciSummary.total > 0) {
    if (ciSummary.pending > 0) {
      ciClass = 'status-pending';
      ciIcon = icons.dot;
      ciText = `${ciSummary.pending} pending`;
    } else if (ciSummary.failed > 0) {
      ciClass = 'status-failure';
      ciIcon = icons.x;
      ciText = `${ciSummary.failed} failed`;
    } else {
      ciClass = 'status-success';
      ciIcon = icons.check;
      ciText = `${ciSummary.passed} passed`;
    }
  }

  // Review status with icon
  let reviewClass = 'review-none';
  let reviewIcon = icons.dot;
  let reviewText = 'No reviews';
  if (reviewSummary.total > 0) {
    if (reviewSummary.changesRequested > 0) {
      reviewClass = 'review-changes';
      reviewIcon = icons.x;
      reviewText = 'Changes requested';
    } else if (reviewSummary.approved > 0) {
      reviewClass = 'review-approved';
      reviewIcon = icons.check;
      reviewText = `${reviewSummary.approved} approved`;
    } else {
      reviewClass = 'review-pending';
      reviewIcon = icons.clock;
      reviewText = 'Review pending';
    }
  }

  // Labels
  const labels = data.labels.map(l =>
    `<span class="label" style="background: #${l.color}20; color: #${l.color}; border: 1px solid #${l.color}40">${escapeHtml(l.name)}</span>`
  ).join('');

  // Group options
  const groupOptions = state.groups.map(g =>
    `<option value="${g}" ${g === pr.group ? 'selected' : ''}>${escapeHtml(g)}</option>`
  ).join('');

  // Failed tests expandable with clickable links
  const failedTests = ciSummary.failedChecks.length > 0 ? `
    <details class="failed-tests">
      <summary>${icons.alert} ${ciSummary.failed} failed check${ciSummary.failed > 1 ? 's' : ''}</summary>
      <ul>${ciSummary.failedChecks.slice(0, 5).map(c =>
        c.url
          ? `<li><a href="${c.url}" target="_blank" class="failed-check-link">${escapeHtml(c.name)}</a></li>`
          : `<li>${escapeHtml(c.name)}</li>`
      ).join('')}${ciSummary.failedChecks.length > 5 ? `<li>...and ${ciSummary.failedChecks.length - 5} more</li>` : ''}</ul>
    </details>
  ` : '';

  // Updates section
  const updatesHtml = updates.length > 0 ? `
    <div class="updates">
      ${updates.map(u => `<div class="update-item ${u.isNew ? 'new' : ''}">${icons.arrow} ${escapeHtml(u.text)}</div>`).join('')}
    </div>
  ` : '';

  // Determine PR state
  let stateClass = 'state-open';
  let stateIcon = icons.prOpen;
  let stateText = 'Open';
  if (data.merged) {
    stateClass = 'state-merged';
    stateIcon = icons.prMerged;
    stateText = 'Merged';
  } else if (data.state === 'closed') {
    stateClass = 'state-closed';
    stateIcon = icons.prClosed;
    stateText = 'Closed';
  } else if (data.draft) {
    stateClass = 'state-draft';
    stateIcon = icons.prDraft;
    stateText = 'Draft';
  }

  return `
    <div class="pr-item ${data.merged ? 'pr-merged' : ''} ${data.state === 'closed' && !data.merged ? 'pr-closed' : ''}">
      <div class="pr-header">
        <div class="pr-title-row">
          <a class="pr-title" href="${url}" target="_blank">
            ${escapeHtml(data.title)} <span class="pr-number">#${data.number}</span>
          </a>
          ${repoName ? `<div class="pr-repo">${escapeHtml(repoName)}</div>` : ''}
        </div>
        <div class="pr-actions">
          <select class="move-group" data-url="${url}" title="Move to group">
            ${groupOptions}
          </select>
          <button class="action-btn refresh-pr" data-url="${url}" title="Refresh">
            ${icons.refresh}
          </button>
          <button class="action-btn danger remove-pr" data-url="${url}" title="Remove">
            ${icons.remove}
          </button>
        </div>
      </div>
      <div class="pr-meta">
        <span class="state-badge ${stateClass}">${stateIcon} ${stateText}</span>
        <span class="pr-meta-item">${escapeHtml(data.user)}</span>
        <span class="status-badge ${ciClass}">${ciIcon} ${ciText}</span>
        <span class="review-badge ${reviewClass}">${reviewIcon} ${reviewText}</span>
        <span class="pr-meta-item">${icons.clock} ${timeAgo(data.updatedAt)}</span>
      </div>
      ${labels ? `<div class="labels">${labels}</div>` : ''}
      ${failedTests}
      ${updatesHtml}
    </div>
  `;
}

// Escape HTML
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Time ago helper
function timeAgo(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Refresh single PR
async function refreshPr(url) {
  const parsed = parsePrUrl(url);
  if (!parsed) return;

  const oldPr = state.prs[url];
  const data = await fetchPrData(parsed.owner, parsed.repo, parsed.number);

  if (data) {
    // Handle error responses - store the error but don't remove the PR
    if (data.error) {
      state.prs[url] = {
        ...oldPr,
        data: { error: data.error },
        updates: []
      };
      await saveState();
      renderPrList();
      return;
    }

    // Auto-remove merged PRs
    if (data.merged) {
      delete state.prs[url];
      await saveState();
      renderTabs();
      renderPrList();
      return;
    }

    const updates = detectUpdates(data, oldPr);
    state.prs[url] = {
      ...oldPr,
      data,
      updates,
      lastSeen: { data: oldPr?.data, at: Date.now() }
    };
    await saveState();
    renderPrList();
  }
}

// Refresh all PRs
async function refreshAll() {
  const urls = Object.keys(state.prs);
  document.getElementById('prList').innerHTML = '<div class="loading">Refreshing...</div>';

  for (const url of urls) {
    await refreshPr(url);
  }

  renderPrList();
}

// Render groups settings
function renderGroups() {
  const container = document.getElementById('groupList');
  container.innerHTML = state.groups.map((g, i) => `
    <div class="group-item">
      <input type="text" value="${escapeHtml(g)}" data-index="${i}" class="group-name-input">
      <span class="delete-group" data-index="${i}">×</span>
    </div>
  `).join('');

  container.querySelectorAll('.group-name-input').forEach(input => {
    input.onchange = async (e) => {
      const oldName = state.groups[e.target.dataset.index];
      const newName = e.target.value.trim();
      if (newName && newName !== oldName) {
        state.groups[e.target.dataset.index] = newName;
        // Update PRs with old group name
        for (const url of Object.keys(state.prs)) {
          if (state.prs[url].group === oldName) {
            state.prs[url].group = newName;
          }
        }
        if (state.activeGroup === oldName) state.activeGroup = newName;
        await saveState();
        renderTabs();
        renderGroups();
      }
    };
  });

  container.querySelectorAll('.delete-group').forEach(btn => {
    btn.onclick = async (e) => {
      const index = parseInt(e.target.dataset.index);
      const groupName = state.groups[index];
      // Move PRs to first remaining group
      const remainingGroups = state.groups.filter((_, i) => i !== index);
      if (remainingGroups.length === 0) return; // Keep at least one group

      for (const url of Object.keys(state.prs)) {
        if (state.prs[url].group === groupName) {
          state.prs[url].group = remainingGroups[0];
        }
      }
      state.groups = remainingGroups;
      if (state.activeGroup === groupName) state.activeGroup = remainingGroups[0];
      await saveState();
      renderTabs();
      renderGroups();
      renderPrList();
    };
  });
}

// Listen for storage changes (e.g., when PR is added from content script or settings sync)
chrome.storage.onChanged.addListener((changes, areaName) => {
  // Only handle changes from the expected storage area for each key
  const validKeys = areaName === 'sync' ? SYNC_KEYS : LOCAL_KEYS;

  for (const [key, { newValue }] of Object.entries(changes)) {
    if (!validKeys.includes(key)) continue;

    if (key === 'prs' && newValue) {
      // Find newly added PRs (ones that don't have data yet)
      const oldPrs = state.prs;
      state.prs = newValue;
      for (const url of Object.keys(newValue)) {
        if (!oldPrs[url]) refreshPr(url);
      }
      renderTabs();
      renderPrList();
    } else if (key === 'groups' && newValue) {
      state.groups = newValue;
      renderTabs();
      renderGroups();
    } else if (key === 'darkMode' && newValue !== undefined) {
      state.darkMode = newValue;
      applyDarkMode();
      document.getElementById('darkModeToggle').checked = state.darkMode;
    } else if (key === 'token') {
      state.token = newValue || '';
      document.getElementById('githubToken').value = state.token;
    }
  }
});

// Initialize
async function init() {
  await loadState();

  // Apply dark mode immediately
  applyDarkMode();

  renderTabs();
  renderPrList();
  renderGroups();

  // Token input
  document.getElementById('githubToken').value = state.token;
  document.getElementById('githubToken').onchange = async (e) => {
    state.token = e.target.value.trim();
    await saveState();
  };

  // Dark mode toggle
  const darkModeToggle = document.getElementById('darkModeToggle');
  darkModeToggle.checked = state.darkMode;
  darkModeToggle.onchange = async (e) => {
    state.darkMode = e.target.checked;
    applyDarkMode();
    await saveState();
  };

  // Settings toggle
  document.getElementById('settingsBtn').onclick = () => {
    document.getElementById('settingsPanel').classList.toggle('open');
  };

  // Add group
  document.getElementById('addGroupBtn').onclick = async () => {
    const input = document.getElementById('newGroupName');
    const name = input.value.trim();
    if (name && !state.groups.includes(name)) {
      state.groups.push(name);
      input.value = '';
      await saveState();
      renderTabs();
      renderGroups();
    }
  };

  // Refresh all
  document.getElementById('refreshAll').onclick = refreshAll;

  // Initial refresh if we have PRs
  if (Object.keys(state.prs).length > 0) {
    refreshAll();
  }
}

init();
