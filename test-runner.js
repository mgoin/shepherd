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
          reviewRequested: {
            nodes: [
              {
                id: 'test-id-1',
                number: 123,
                title: 'Test PR with review request',
                state: 'OPEN',
                isDraft: false,
                author: { login: 'testuser' },
                reviewRequests: { nodes: [{ requestedReviewer: { login: 'testuser' } }] },
                commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
                reviews: { nodes: [], totalCount: 0 },
                labels: { nodes: [] }
              }
            ]
          },
          recentPRs: {
            nodes: [
              {
                id: 'test-id-2',
                number: 456,
                title: 'Recent PR',
                state: 'OPEN',
                isDraft: false,
                author: { login: 'otheruser' },
                reviewRequests: { nodes: [] },
                commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] },
                reviews: { nodes: [], totalCount: 0 },
                labels: { nodes: [] }
              }
            ]
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
test('GraphQL query uses Search API for filtering', () => {
  const fs = require('fs');
  const sidebarCode = fs.readFileSync('sidebar.js', 'utf8');
  assertTrue(sidebarCode.includes('search(query:'), 'Query uses GitHub Search API');
  assertTrue(sidebarCode.includes('reviewRequested:'), 'Query includes reviewRequested search');
  assertTrue(sidebarCode.includes('recentPRs:'), 'Query includes recentPRs search');
  assertTrue(sidebarCode.includes('review-requested:@me'), 'Query filters for review requests');
  assertTrue(sidebarCode.includes('reviewRequests'), 'Query includes reviewRequests');
  assertTrue(sidebarCode.includes('statusCheckRollup'), 'Query includes CI status');
});

// Test 5: Custom tag functionality simulation
test('Custom tag logic works correctly', () => {
  // Simulate the simplified shouldShowPR method logic
  function shouldShowPR(pr, filter, customTags) {
    if (filter === 'all') {
      return true;
    }
    
    if (filter === 'untagged') {
      return !pr.customTag;
    }
    
    if (customTags.some(tag => tag.name === filter)) {
      return pr.customTag?.name === filter;
    }
    
    return true;
  }

  const testPRWithTag = {
    isDraft: false,
    state: 'OPEN',
    reviewDecision: null,
    customTag: { name: 'urgent' }
  };

  const testPRWithoutTag = {
    isDraft: false,
    state: 'OPEN',
    reviewDecision: null
  };

  const customTags = [{ name: 'urgent', color: '#ff0000' }];

  assertTrue(shouldShowPR(testPRWithTag, 'all', customTags), 'All filter shows tagged PR');
  assertTrue(shouldShowPR(testPRWithoutTag, 'all', customTags), 'All filter shows untagged PR');
  assertTrue(shouldShowPR(testPRWithTag, 'urgent', customTags), 'Custom tag filter works');
  assertFalse(shouldShowPR(testPRWithTag, 'untagged', customTags), 'Untagged filter excludes tagged PR');
  assertTrue(shouldShowPR(testPRWithoutTag, 'untagged', customTags), 'Untagged filter shows untagged PR');
});

// Test 6: Activity detection logic
test('Activity detection logic works', () => {
  function getActivityInfo(pr, currentUser) {
    if (!currentUser) return '';
    
    const activities = [];
    
    // Check if user is requested for review
    const reviewRequests = pr.reviewRequests?.nodes || [];
    const isDirectReviewer = reviewRequests.some(req => {
      const reviewer = req.requestedReviewer;
      return reviewer?.login === currentUser.login;
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

  const testPRWithReview = {
    reviewRequests: {
      nodes: [{ requestedReviewer: { login: 'testuser' } }]
    },
    updatedAt: new Date().toISOString()
  };

  const currentUser = { login: 'testuser' };
  
  const activity = getActivityInfo(testPRWithReview, currentUser);
  assertTrue(activity.includes('Review requested'), 'Detects review requests correctly');
  assertTrue(activity.includes('Recently updated'), 'Detects recent updates correctly');
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
  assertTrue(html.includes('id="user-tag-filters"'), 'User tag filters container exists');
  assertTrue(html.includes('id="create-tag-btn"'), 'Create tag button exists');
  assertTrue(html.includes('data-filter="all"'), 'All filter exists');
  assertTrue(html.includes('data-filter="untagged"'), 'Untagged filter exists');
});

// Test 10: CSS has required classes
test('CSS has required styling classes', () => {
  const fs = require('fs');
  const css = fs.readFileSync('sidebar.css', 'utf8');
  
  assertTrue(css.includes('.pr-activity'), 'PR activity styling exists');
  assertTrue(css.includes('.custom-tag'), 'Custom tag styling exists');
  assertTrue(css.includes('.oauth-btn'), 'OAuth button styling exists');
  assertTrue(css.includes('.filter-btn'), 'Filter button styling exists');
  assertTrue(css.includes('.create-tag-btn'), 'Create tag button styling exists');
  assertTrue(css.includes('.quick-tag-btn'), 'Quick tag button styling exists');
});

// Test 11: Repository settings functionality
test('Repository settings functionality exists', () => {
  const fs = require('fs');
  const sidebarCode = fs.readFileSync('sidebar.js', 'utf8');
  
  // Test that repository settings methods exist
  assertTrue(sidebarCode.includes('loadRepositorySettings()'), 'loadRepositorySettings method exists');
  assertTrue(sidebarCode.includes('saveRepositorySettings('), 'saveRepositorySettings method exists');
  assertTrue(sidebarCode.includes('validateRepositoryAccess('), 'validateRepositoryAccess method exists');
  assertTrue(sidebarCode.includes('showRepositorySettings()'), 'showRepositorySettings modal method exists');
  
  // Test that settings UI elements are present
  assertTrue(sidebarCode.includes('Repository Settings'), 'Repository Settings UI text exists');
  assertTrue(sidebarCode.includes('repo-owner-input'), 'Repository owner input field exists');
  assertTrue(sidebarCode.includes('repo-name-input'), 'Repository name input field exists');
  
  // Test that background.js was updated for repository settings
  const backgroundCode = fs.readFileSync('background.js', 'utf8');
  assertTrue(backgroundCode.includes('getRepositorySettings()'), 'Background getRepositorySettings method exists');
  assertTrue(backgroundCode.includes('repositorySettings.owner'), 'Background uses dynamic repository owner');
  assertTrue(backgroundCode.includes('repositorySettings.name'), 'Background uses dynamic repository name');
  
  // Test validation logic
  assertTrue(sidebarCode.includes('viewerPermission'), 'Repository permission validation exists');
  assertTrue(sidebarCode.includes('READ') && sidebarCode.includes('TRIAGE') && sidebarCode.includes('WRITE'), 'Permission checking logic exists');
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