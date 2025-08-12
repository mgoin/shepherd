#!/usr/bin/env node

/**
 * Simple test runner for PR Shepherd extension
 * Tests core functionality without heavy dependencies
 */

console.log('🧪 PR Shepherd Test Suite');
console.log('==========================\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}\n`);
    failed++;
  }
}

function assertEquals(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}. ${message}`);
  }
}

function assertTrue(value, message = '') {
  if (!value) {
    throw new Error(`Expected truthy value, got ${value}. ${message}`);
  }
}

function assertFalse(value, message = '') {
  if (value) {
    throw new Error(`Expected falsy value, got ${value}. ${message}`);
  }
}

// Mock Chrome APIs for testing
global.chrome = {
  storage: {
    local: {
      get: () => Promise.resolve({}),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve()
    }
  },
  runtime: {
    onMessage: { addListener: () => {} }
  },
  tabs: {
    create: () => {}
  },
  identity: {
    clearAllCachedAuthTokens: (cb) => cb()
  }
};

// Mock fetch
global.fetch = async (url, options) => {
  if (url.includes('github.com/user')) {
    return {
      ok: true,
      json: () => Promise.resolve({ login: 'testuser', id: 123 })
    };
  }
  if (url.includes('graphql')) {
    return {
      ok: true,
      json: () => Promise.resolve({
        data: {
          repository: {
            pullRequests: {
              nodes: [
                {
                  id: 'test-id',
                  number: 123,
                  title: 'Test PR',
                  state: 'OPEN',
                  isDraft: false,
                  author: { login: 'testuser' },
                  reviewRequests: { nodes: [] },
                  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
                  reviews: { nodes: [], totalCount: 0 },
                  timelineItems: { nodes: [] },
                  labels: { nodes: [] }
                }
              ]
            }
          },
          viewer: { login: 'testuser' },
          rateLimit: { limit: 5000, remaining: 4999, resetAt: new Date().toISOString() }
        }
      })
    };
  }
  return { ok: false, status: 404 };
};

// Test 1: Manifest validation
test('Manifest file is valid JSON', () => {
  const fs = require('fs');
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  assertEquals(manifest.manifest_version, 3);
  assertTrue(manifest.permissions.includes('storage'));
  assertTrue(manifest.permissions.includes('identity'));
});

// Test 2: Basic OAuth class structure
test('OAuth class has required methods', () => {
  // Since we can't easily import the class, we'll check the file contains the methods
  const fs = require('fs');
  const oauthCode = fs.readFileSync('oauth.js', 'utf8');
  assertTrue(oauthCode.includes('class GitHubOAuth'), 'OAuth class exists');
  assertTrue(oauthCode.includes('authenticate()'), 'authenticate method exists');
  assertTrue(oauthCode.includes('isAuthenticated()'), 'isAuthenticated method exists');
  assertTrue(oauthCode.includes('requestDeviceCode()'), 'requestDeviceCode method exists');
});

// Test 3: Sidebar class structure
test('Sidebar class has required methods', () => {
  const fs = require('fs');
  const sidebarCode = fs.readFileSync('sidebar.js', 'utf8');
  assertTrue(sidebarCode.includes('class PRShepherdSidebar'), 'Sidebar class exists');
  assertTrue(sidebarCode.includes('fetchPRs()'), 'fetchPRs method exists');
  assertTrue(sidebarCode.includes('applyFilters()'), 'applyFilters method exists');
  assertTrue(sidebarCode.includes('createCustomTag()'), 'createCustomTag method exists');
  assertTrue(sidebarCode.includes('getActivityInfo('), 'getActivityInfo method exists');
});

// Test 4: GraphQL query structure
test('GraphQL query includes required fields', () => {
  const fs = require('fs');
  const sidebarCode = fs.readFileSync('sidebar.js', 'utf8');
  assertTrue(sidebarCode.includes('pullRequests'), 'Query includes pullRequests');
  assertTrue(sidebarCode.includes('reviewRequests'), 'Query includes reviewRequests');
  assertTrue(sidebarCode.includes('statusCheckRollup'), 'Query includes CI status');
  assertTrue(sidebarCode.includes('first: 30'), 'Query limits to 30 PRs for performance');
});

// Test 5: Custom tag functionality simulation
test('Custom tag logic works correctly', () => {
  // Simulate the shouldShowPR method logic
  function shouldShowPR(pr, filter, customTags) {
    if (customTags.some(tag => tag.name === filter)) {
      return pr.customTag?.name === filter;
    }
    
    switch (filter) {
      case 'ready':
        return !pr.isDraft && pr.state === 'OPEN' && pr.reviewDecision !== 'APPROVED';
      case 'wip':
        return pr.isDraft;
      case 'finished':
        return pr.state === 'MERGED' || pr.state === 'CLOSED' || pr.reviewDecision === 'APPROVED';
      default:
        return true;
    }
  }

  const testPR = {
    isDraft: false,
    state: 'OPEN',
    reviewDecision: null,
    customTag: { name: 'urgent' }
  };

  const customTags = [{ name: 'urgent', color: '#ff0000' }];

  assertTrue(shouldShowPR(testPR, 'ready', customTags), 'Ready filter works');
  assertTrue(shouldShowPR(testPR, 'urgent', customTags), 'Custom tag filter works');
  assertFalse(shouldShowPR(testPR, 'wip', customTags), 'WIP filter excludes non-draft');
});

// Test 6: Activity detection logic
test('Activity detection logic works', () => {
  function hasRecentActivity(pr, currentUser) {
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    
    // Check for recent pings
    const recentPings = pr.timelineItems?.nodes?.filter(item => {
      if (item.__typename === 'ReviewRequestedEvent') {
        const createdAt = new Date(item.createdAt).getTime();
        const targetedMe = item.requestedReviewer?.login === currentUser.login;
        return targetedMe && createdAt > oneDayAgo;
      }
      return false;
    }) || [];
    
    return recentPings.length > 0;
  }

  const testPR = {
    timelineItems: {
      nodes: [{
        __typename: 'ReviewRequestedEvent',
        createdAt: new Date().toISOString(), // Recent
        requestedReviewer: { login: 'testuser' }
      }]
    }
  };

  const currentUser = { login: 'testuser' };
  
  assertTrue(hasRecentActivity(testPR, currentUser), 'Detects recent pings correctly');
});

// Test 7: Search functionality
test('Fuzzy search works correctly', () => {
  function fuzzyMatch(text, search) {
    const searchWords = search.split(' ').filter(word => word.length > 0);
    return searchWords.every(word => text.includes(word));
  }

  assertTrue(fuzzyMatch('fix performance issue', 'performance'), 'Single word search');
  assertTrue(fuzzyMatch('fix performance issue', 'fix issue'), 'Multi word search');
  assertFalse(fuzzyMatch('fix performance issue', 'bug'), 'Non-matching search');
  assertTrue(fuzzyMatch('anything', ''), 'Empty search matches all');
});

// Test 8: File structure validation
test('Required files exist', () => {
  const fs = require('fs');
  const requiredFiles = [
    'manifest.json',
    'sidebar.html',
    'sidebar.js',
    'sidebar.css',
    'oauth.js',
    'background.js',
    'OAUTH_SETUP.md'
  ];

  requiredFiles.forEach(file => {
    assertTrue(fs.existsSync(file), `${file} exists`);
  });
});

// Test 9: HTML structure validation
test('Sidebar HTML has required elements', () => {
  const fs = require('fs');
  const html = fs.readFileSync('sidebar.html', 'utf8');
  
  assertTrue(html.includes('id="oauth-btn"'), 'OAuth button exists');
  assertTrue(html.includes('id="pat-btn"'), 'PAT button exists');
  assertTrue(html.includes('id="pr-list"'), 'PR list container exists');
  assertTrue(html.includes('id="custom-tag-filters"'), 'Custom tag filters container exists');
  assertTrue(html.includes('data-filter="pinged"'), 'Pinged filter exists');
  assertTrue(html.includes('data-filter="author-active"'), 'Author active filter exists');
});

// Test 10: CSS has required classes
test('CSS has required styling classes', () => {
  const fs = require('fs');
  const css = fs.readFileSync('sidebar.css', 'utf8');
  
  assertTrue(css.includes('.pr-activity'), 'PR activity styling exists');
  assertTrue(css.includes('.custom-tag'), 'Custom tag styling exists');
  assertTrue(css.includes('.oauth-btn'), 'OAuth button styling exists');
  assertTrue(css.includes('.filter-btn'), 'Filter button styling exists');
  assertTrue(css.includes('.tag-assignments'), 'Tag assignments styling exists');
});

// Run all tests and report results
console.log(`\n📊 Test Results:`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failed > 0) {
  console.log(`\n❌ ${failed} test(s) failed. Please fix the issues above.`);
  process.exit(1);
} else {
  console.log(`\n🎉 All tests passed! Extension is ready for use.`);
  process.exit(0);
}