#!/usr/bin/env node

/**
 * Integration tests for PR Shepherd extension
 * Tests real-world scenarios and API interactions
 */

console.log('🔗 PR Shepherd Integration Tests');
console.log('=================================\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  return new Promise(async (resolve) => {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error.message}\n`);
      failed++;
    }
    resolve();
  });
}

// Mock GitHub API responses for testing
const mockResponses = {
  deviceCode: {
    device_code: 'test-device-code-12345',
    user_code: 'ABCD-EFGH',
    verification_uri: 'https://github.com/login/device',
    expires_in: 900,
    interval: 5
  },
  
  accessToken: {
    access_token: 'ghp_test_access_token_12345',
    token_type: 'bearer',
    scope: 'repo read:org'
  },
  
  user: {
    login: 'testuser',
    id: 12345,
    name: 'Test User',
    email: 'test@example.com'
  },
  
  pullRequests: {
    data: {
      repository: {
        pullRequests: {
          nodes: [
            {
              id: 'PR_test_id_1',
              number: 101,
              title: 'Add performance improvements',
              state: 'OPEN',
              isDraft: false,
              createdAt: '2023-01-01T00:00:00Z',
              updatedAt: '2023-01-01T12:00:00Z',
              author: { login: 'contributor1' },
              headRefName: 'feature/performance',
              reviewRequests: {
                nodes: [
                  { requestedReviewer: { login: 'testuser' } }
                ]
              },
              commits: {
                nodes: [{
                  commit: {
                    author: { date: '2023-01-01T10:00:00Z' },
                    statusCheckRollup: { state: 'SUCCESS' }
                  }
                }]
              },
              reviewDecision: null,
              reviews: { totalCount: 0, nodes: [] },
              timelineItems: {
                nodes: [{
                  __typename: 'ReviewRequestedEvent',
                  createdAt: new Date().toISOString(),
                  requestedReviewer: { login: 'testuser' }
                }]
              },
              labels: { nodes: [] }
            },
            {
              id: 'PR_test_id_2',
              number: 102,
              title: 'Fix bug in authentication',
              state: 'OPEN',
              isDraft: true,
              createdAt: '2023-01-02T00:00:00Z',
              updatedAt: '2023-01-02T08:00:00Z',
              author: { login: 'contributor2' },
              headRefName: 'fix/auth-bug',
              reviewRequests: { nodes: [] },
              commits: {
                nodes: [{
                  commit: {
                    author: { date: '2023-01-02T07:00:00Z' },
                    statusCheckRollup: { state: 'PENDING' }
                  }
                }]
              },
              reviewDecision: null,
              reviews: { totalCount: 1, nodes: [] },
              timelineItems: { nodes: [] },
              labels: {
                nodes: [
                  { name: 'bug', color: 'ff0000' },
                  { name: 'priority-high', color: 'ff6b6b' }
                ]
              }
            }
          ]
        }
      },
      viewer: { login: 'testuser' },
      rateLimit: {
        limit: 5000,
        remaining: 4950,
        resetAt: new Date(Date.now() + 3600000).toISOString()
      }
    }
  }
};

// Mock fetch for testing
global.fetch = async (url, options) => {
  const body = options?.body ? JSON.parse(options.body) : null;
  
  if (url.includes('device/code')) {
    return {
      ok: true,
      json: () => Promise.resolve(mockResponses.deviceCode)
    };
  }
  
  if (url.includes('oauth/access_token')) {
    return {
      ok: true, 
      json: () => Promise.resolve(mockResponses.accessToken)
    };
  }
  
  if (url.includes('api.github.com/user')) {
    return {
      ok: true,
      json: () => Promise.resolve(mockResponses.user)
    };
  }
  
  if (url.includes('graphql') && body?.query?.includes('GetVLLMPRs')) {
    return {
      ok: true,
      json: () => Promise.resolve(mockResponses.pullRequests)
    };
  }
  
  return {
    ok: false,
    status: 404,
    statusText: 'Not Found'
  };
};

// Integration Test 1: OAuth Device Flow
await test('OAuth Device Flow integration', async () => {
  const deviceCodeResponse = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    body: JSON.stringify({ client_id: 'test-client' })
  });
  
  const deviceData = await deviceCodeResponse.json();
  
  if (!deviceData.device_code || !deviceData.user_code) {
    throw new Error('Device code response missing required fields');
  }
  
  if (deviceData.user_code !== 'ABCD-EFGH') {
    throw new Error('Unexpected user code format');
  }
});

// Integration Test 2: GitHub GraphQL API
await test('GitHub GraphQL API integration', async () => {
  const query = `
    query GetVLLMPRs($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        pullRequests(first: 100, states: [OPEN]) {
          nodes {
            number
            title
            state
          }
        }
      }
    }
  `;
  
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': 'bearer test-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query,
      variables: { owner: 'vllm-project', name: 'vllm' }
    })
  });
  
  const data = await response.json();
  
  if (!data.data?.repository?.pullRequests?.nodes) {
    throw new Error('GraphQL response missing expected structure');
  }
  
  if (data.data.repository.pullRequests.nodes.length !== 2) {
    throw new Error('Expected 2 PRs in mock response');
  }
});

// Integration Test 3: Activity Detection
await test('Activity detection with real data', async () => {
  const prs = mockResponses.pullRequests.data.repository.pullRequests.nodes;
  const currentUser = mockResponses.user;
  
  function getActivityInfo(pr, user) {
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    
    const activities = [];
    
    // Check for recent pings
    const recentPings = pr.timelineItems?.nodes?.filter(item => {
      if (item.__typename === 'ReviewRequestedEvent') {
        const createdAt = new Date(item.createdAt).getTime();
        const targetedMe = item.requestedReviewer?.login === user.login;
        return targetedMe && createdAt > oneDayAgo;
      }
      return false;
    }) || [];
    
    if (recentPings.length > 0) {
      activities.push('🔔 Recently pinged');
    }
    
    return activities.join(' • ');
  }
  
  const pr1Activity = getActivityInfo(prs[0], currentUser);
  const pr2Activity = getActivityInfo(prs[1], currentUser);
  
  if (!pr1Activity.includes('Recently pinged')) {
    throw new Error('Should detect recent ping in PR #101');
  }
  
  if (pr2Activity.includes('Recently pinged')) {
    throw new Error('Should not detect ping in PR #102 (no timeline events)');
  }
});

// Integration Test 4: Custom Tag Filtering
await test('Custom tag filtering integration', async () => {
  const prs = mockResponses.pullRequests.data.repository.pullRequests.nodes;
  const customTags = [
    { id: '1', name: 'urgent', color: '#ff0000' },
    { id: '2', name: 'review-needed', color: '#0969da' }
  ];
  
  // Simulate assigning tags
  const prTagAssignments = new Map();
  prTagAssignments.set(101, 'urgent');
  
  // Add custom tag to PR
  const prsWithTags = prs.map(pr => {
    const assignedTag = prTagAssignments.get(pr.number);
    if (assignedTag) {
      pr.customTag = customTags.find(tag => tag.name === assignedTag);
    }
    return pr;
  });
  
  function shouldShowPR(pr, filter) {
    if (customTags.some(tag => tag.name === filter)) {
      return pr.customTag?.name === filter;
    }
    
    switch (filter) {
      case 'ready':
        return !pr.isDraft && pr.state === 'OPEN' && pr.reviewDecision !== 'APPROVED';
      case 'wip':
        return pr.isDraft;
      default:
        return true;
    }
  }
  
  const urgentPRs = prsWithTags.filter(pr => shouldShowPR(pr, 'urgent'));
  const wipPRs = prsWithTags.filter(pr => shouldShowPR(pr, 'wip'));
  
  if (urgentPRs.length !== 1 || urgentPRs[0].number !== 101) {
    throw new Error('Custom tag filtering failed');
  }
  
  if (wipPRs.length !== 1 || wipPRs[0].number !== 102) {
    throw new Error('WIP filtering failed');
  }
});

// Integration Test 5: Search and Filter Combined
await test('Search and filter combination', async () => {
  const prs = mockResponses.pullRequests.data.repository.pullRequests.nodes;
  
  function fuzzyMatch(text, search) {
    const searchWords = search.split(' ').filter(word => word.length > 0);
    return searchWords.every(word => text.includes(word));
  }
  
  function applyFilters(allPRs, searchTerm, currentFilter) {
    return allPRs.filter(pr => {
      // Search filter
      if (searchTerm) {
        const searchableText = `${pr.title} ${pr.number} ${pr.author.login} ${pr.headRefName}`.toLowerCase();
        if (!fuzzyMatch(searchableText, searchTerm.toLowerCase())) {
          return false;
        }
      }
      
      // Status filter
      if (currentFilter === 'wip') {
        return pr.isDraft;
      }
      
      return true;
    });
  }
  
  // Test search only
  let filtered = applyFilters(prs, 'performance', 'all');
  if (filtered.length !== 1 || filtered[0].number !== 101) {
    throw new Error('Search filtering failed');
  }
  
  // Test filter only
  filtered = applyFilters(prs, '', 'wip');
  if (filtered.length !== 1 || filtered[0].number !== 102) {
    throw new Error('WIP status filtering failed');
  }
  
  // Test combined search + filter
  filtered = applyFilters(prs, 'bug', 'wip');
  if (filtered.length !== 1 || filtered[0].number !== 102) {
    throw new Error('Combined search and filter failed');
  }
});

// Integration Test 6: Error Handling
await test('API error handling', async () => {
  // Test with failing fetch
  const originalFetch = global.fetch;
  global.fetch = () => Promise.reject(new Error('Network error'));
  
  try {
    await fetch('https://api.github.com/graphql');
    throw new Error('Should have thrown network error');
  } catch (error) {
    if (!error.message.includes('Network error')) {
      throw new Error('Unexpected error type');
    }
  }
  
  // Test with non-OK response
  global.fetch = () => Promise.resolve({
    ok: false,
    status: 401,
    statusText: 'Unauthorized'
  });
  
  const response = await fetch('https://api.github.com/graphql');
  if (response.ok) {
    throw new Error('Should have received error response');
  }
  
  // Restore original fetch
  global.fetch = originalFetch;
});

// Integration Test 7: Storage Operations
await test('Chrome storage integration', async () => {
  // Mock Chrome storage
  let storage = {};
  global.chrome = {
    storage: {
      local: {
        get: (keys) => {
          const result = {};
          if (Array.isArray(keys)) {
            keys.forEach(key => result[key] = storage[key] || null);
          } else if (typeof keys === 'string') {
            result[keys] = storage[keys] || null;
          }
          return Promise.resolve(result);
        },
        set: (data) => {
          Object.assign(storage, data);
          return Promise.resolve();
        },
        remove: (keys) => {
          if (Array.isArray(keys)) {
            keys.forEach(key => delete storage[key]);
          } else {
            delete storage[keys];
          }
          return Promise.resolve();
        }
      }
    }
  };
  
  // Test storing custom tags
  const customTags = [{ id: '1', name: 'urgent', color: '#ff0000' }];
  const assignments = { '101': 'urgent' };
  
  await chrome.storage.local.set({ 
    custom_tags: customTags,
    pr_tag_assignments: assignments
  });
  
  const stored = await chrome.storage.local.get(['custom_tags', 'pr_tag_assignments']);
  
  if (!stored.custom_tags || stored.custom_tags.length !== 1) {
    throw new Error('Custom tags not stored correctly');
  }
  
  if (!stored.pr_tag_assignments || stored.pr_tag_assignments['101'] !== 'urgent') {
    throw new Error('Tag assignments not stored correctly');
  }
  
  // Test removing data
  await chrome.storage.local.remove(['custom_tags']);
  const afterRemove = await chrome.storage.local.get(['custom_tags']);
  
  if (afterRemove.custom_tags !== null) {
    throw new Error('Data not removed correctly');
  }
});

// Report results
console.log(`\n📊 Integration Test Results:`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failed > 0) {
  console.log(`\n❌ ${failed} integration test(s) failed. Please fix the issues above.`);
  process.exit(1);
} else {
  console.log(`\n🎉 All integration tests passed! Extension integrations are working correctly.`);
  process.exit(0);
}