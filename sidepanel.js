// State
let state = {
  groups: ['P0', 'P1', 'Backlog'],
  prs: {}, // { prUrl: { group, data, lastSeen } }
  activeGroup: 'P0',
  token: ''
};

// Load state from storage
async function loadState() {
  const stored = await chrome.storage.local.get(['groups', 'prs', 'token']);
  if (stored.groups) state.groups = stored.groups;
  if (stored.prs) state.prs = stored.prs;
  if (stored.token) state.token = stored.token;
}

// Save state to storage
async function saveState() {
  await chrome.storage.local.set({
    groups: state.groups,
    prs: state.prs,
    token: state.token
  });
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

    if (!prRes.ok) throw new Error(`PR fetch failed: ${prRes.status}`);

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
    return null;
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
    ...checks.map(c => ({ name: c.name, status: c.status, conclusion: c.conclusion })),
    ...statuses.map(s => ({ name: s.context, status: 'completed', conclusion: s.state === 'success' ? 'success' : s.state === 'pending' ? null : 'failure' }))
  ];

  const total = allChecks.length;
  const passed = allChecks.filter(c => c.conclusion === 'success').length;
  const failed = allChecks.filter(c => c.conclusion === 'failure').length;
  const pending = allChecks.filter(c => c.status !== 'completed' || c.conclusion === null).length;
  const failedNames = allChecks.filter(c => c.conclusion === 'failure').map(c => c.name);

  return { total, passed, failed, pending, failedNames };
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
        <strong>No PRs in ${state.activeGroup}</strong>
        <p>Add PRs from GitHub PR pages using the button in the header</p>
      </div>
    `;
    return;
  }

  container.innerHTML = prsInGroup.map(([url, pr]) => renderPrItem(url, pr)).join('');

  // Add event listeners
  container.querySelectorAll('.move-group').forEach(select => {
    select.onchange = async (e) => {
      const url = e.target.dataset.url;
      const newGroup = e.target.value;
      if (newGroup === '__remove__') {
        delete state.prs[url];
      } else {
        state.prs[url].group = newGroup;
      }
      await saveState();
      renderTabs();
      renderPrList();
    };
  });

  container.querySelectorAll('.refresh-pr').forEach(btn => {
    btn.onclick = async (e) => {
      const url = e.target.dataset.url;
      await refreshPr(url);
    };
  });
}

// Render single PR item
function renderPrItem(url, pr) {
  const data = pr.data;
  if (!data) {
    return `
      <div class="pr-item">
        <div class="pr-header">
          <a class="pr-title" href="${url}" target="_blank">Loading...</a>
        </div>
      </div>
    `;
  }

  const reviewSummary = getReviewSummary(data.reviews);
  const ciSummary = getCiSummary(data.checks, data.statuses);
  const updates = pr.updates || [];

  let ciClass = 'status-neutral';
  let ciText = 'No checks';
  if (ciSummary.total > 0) {
    if (ciSummary.pending > 0) {
      ciClass = 'status-pending';
      ciText = `${ciSummary.passed}/${ciSummary.total} (${ciSummary.pending} pending)`;
    } else if (ciSummary.failed > 0) {
      ciClass = 'status-failure';
      ciText = `${ciSummary.passed}/${ciSummary.total} passed`;
    } else {
      ciClass = 'status-success';
      ciText = `${ciSummary.passed}/${ciSummary.total} passed`;
    }
  }

  let reviewClass = 'review-pending';
  let reviewText = 'No reviews';
  if (reviewSummary.total > 0) {
    if (reviewSummary.changesRequested > 0) {
      reviewClass = 'review-changes';
      reviewText = `Changes requested`;
    } else if (reviewSummary.approved > 0) {
      reviewClass = 'review-approved';
      reviewText = `${reviewSummary.approved} approved`;
    } else {
      reviewText = `${reviewSummary.total} reviewed`;
    }
  }

  const labels = data.labels.map(l =>
    `<span class="label" style="background: #${l.color}20; color: #${l.color}; border: 1px solid #${l.color}40">${l.name}</span>`
  ).join('');

  const groupOptions = state.groups.map(g =>
    `<option value="${g}" ${g === pr.group ? 'selected' : ''}>${g}</option>`
  ).join('');

  const failedTests = ciSummary.failedNames.length > 0 ? `
    <details class="failed-tests">
      <summary>${ciSummary.failed} failed check(s)</summary>
      <ul>${ciSummary.failedNames.map(n => `<li>${n}</li>`).join('')}</ul>
    </details>
  ` : '';

  const updatesHtml = updates.length > 0 ? `
    <div class="updates">
      ${updates.map(u => `<div class="update-item ${u.isNew ? 'new' : ''}"><span class="update-icon">→</span>${u.text}</div>`).join('')}
    </div>
  ` : '';

  return `
    <div class="pr-item">
      <div class="pr-header">
        <a class="pr-title" href="${url}" target="_blank">
          ${data.draft ? '[Draft] ' : ''}${escapeHtml(data.title)} <span class="pr-number">#${data.number}</span>
        </a>
        <div class="pr-actions">
          <select class="move-group" data-url="${url}">
            ${groupOptions}
            <option value="__remove__">Remove</option>
          </select>
          <button class="refresh-pr" data-url="${url}">↻</button>
        </div>
      </div>
      <div class="pr-meta">
        <span class="pr-meta-item">by ${data.user}</span>
        <span class="status-badge ${ciClass}">${ciText}</span>
        <span class="review-badge ${reviewClass}">${reviewText}</span>
        <span class="pr-meta-item">${timeAgo(data.updatedAt)}</span>
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

// Listen for storage changes (e.g., when PR is added from content script)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  let needsRefresh = false;

  if (changes.prs) {
    // Find newly added PRs (ones that don't have data yet)
    const oldPrs = changes.prs.oldValue || {};
    const newPrs = changes.prs.newValue || {};

    for (const url of Object.keys(newPrs)) {
      if (!oldPrs[url]) {
        // New PR added - fetch its data
        state.prs = newPrs;
        refreshPr(url);
        needsRefresh = true;
      }
    }

    // Update state with new PRs
    state.prs = newPrs;
    if (needsRefresh) {
      renderTabs();
      renderPrList();
    }
  }

  if (changes.groups) {
    state.groups = changes.groups.newValue || state.groups;
    renderTabs();
    renderGroups();
  }
});

// Initialize
async function init() {
  await loadState();

  renderTabs();
  renderPrList();
  renderGroups();

  // Token input
  document.getElementById('githubToken').value = state.token;
  document.getElementById('githubToken').onchange = async (e) => {
    state.token = e.target.value.trim();
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
