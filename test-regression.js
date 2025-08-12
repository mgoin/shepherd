#!/usr/bin/env node

/**
 * Regression tests for PR Shepherd extension
 * These tests validate the CURRENT WORKING STATE and should always pass
 * If these tests fail, the extension has regressed from the known good state
 */

console.log('🛡️  PR Shepherd Regression Tests');
console.log('==================================\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   REGRESSION: ${error.message}\n`);
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

const fs = require('fs');

// CRITICAL: Test the simplified GraphQL query that is currently working
test('GraphQL query maintains working structure', () => {
  const sidebarCode = fs.readFileSync('sidebar.js', 'utf8');
  
  // Ensure we're still using the simplified query (30 PRs, basic fields)
  assertTrue(sidebarCode.includes('first: 30'), 'Query should limit to 30 PRs for performance');
  assertTrue(sidebarCode.includes('pullRequests(first: 30'), 'Should fetch 30 pull requests');
  
  // Essential fields that must be present
  assertTrue(sidebarCode.includes('number'), 'Query must include PR number');
  assertTrue(sidebarCode.includes('title'), 'Query must include PR title');
  assertTrue(sidebarCode.includes('state'), 'Query must include PR state');
  assertTrue(sidebarCode.includes('isDraft'), 'Query must include draft status');
  assertTrue(sidebarCode.includes('author'), 'Query must include author info');
  assertTrue(sidebarCode.includes('reviewRequests'), 'Query must include review requests');
  assertTrue(sidebarCode.includes('statusCheckRollup'), 'Query must include CI status');
  
  // Ensure we haven't re-added complex fields that caused timeouts
  if (sidebarCode.includes('timelineItems')) {
    throw new Error('REGRESSION: timelineItems should not be in query (causes timeouts)');
  }
  if (sidebarCode.includes('contexts(first: 20)')) {
    throw new Error('REGRESSION: detailed CI contexts should not be in query (causes timeouts)');
  }
});

// CRITICAL: Test that we're not using AbortController/timeouts that caused errors
test('Fetch calls do not use problematic timeout handling', () => {
  const sidebarCode = fs.readFileSync('sidebar.js', 'utf8');
  const backgroundCode = fs.readFileSync('background.js', 'utf8');
  
  // These caused the sidebar.js:399 errors
  if (sidebarCode.includes('AbortController')) {
    throw new Error('REGRESSION: AbortController should not be used in sidebar.js');
  }
  if (sidebarCode.includes('setTimeout') && sidebarCode.includes('abort')) {
    throw new Error('REGRESSION: timeout abort logic should not be in sidebar.js');
  }
  if (backgroundCode.includes('AbortController')) {
    throw new Error('REGRESSION: AbortController should not be used in background.js');
  }
});

// CRITICAL: Verify essential functions exist and work
test('Core PR rendering functions exist', () => {
  const sidebarCode = fs.readFileSync('sidebar.js', 'utf8');
  
  assertTrue(sidebarCode.includes('renderPR(pr)'), 'renderPR function must exist');
  assertTrue(sidebarCode.includes('getStatusIcon(pr)'), 'getStatusIcon function must exist');
  assertTrue(sidebarCode.includes('getReviewStatus(pr)'), 'getReviewStatus function must exist');
  assertTrue(sidebarCode.includes('getActivityInfo(pr)'), 'getActivityInfo function must exist');
  assertTrue(sidebarCode.includes('applyFilters()'), 'applyFilters function must exist');
});

// CRITICAL: Test simplified CI status handling
test('CI status functions use simplified data structure', () => {
  const sidebarCode = fs.readFileSync('sidebar.js', 'utf8');
  
  // Should have simple CI status, not complex detailed version
  assertTrue(sidebarCode.includes('getCIStatus(pr)'), 'getCIStatus function must exist');
  assertTrue(sidebarCode.includes('getDetailedCIDisplay(pr)'), 'getDetailedCIDisplay function must exist');
  
  // Verify it returns simple span, not complex detailed HTML
  const getCIDisplayMatch = sidebarCode.match(/getDetailedCIDisplay\(pr\)\s*\{[\s\S]*?return\s*`([^`]*)`/);
  if (getCIDisplayMatch) {
    const returnValue = getCIDisplayMatch[1];
    assertTrue(returnValue.includes('ci-state'), 'Should return element with ci-state class');
    // Should NOT return complex detailed structure
    if (returnValue.includes('ci-details') || returnValue.includes('ci-summary')) {
      throw new Error('REGRESSION: CI display should be simple, not detailed (caused timeouts)');
    }
  }
});

// CRITICAL: Test that authentication is still working
test('OAuth authentication structure intact', () => {
  const sidebarCode = fs.readFileSync('sidebar.js', 'utf8');
  const oauthCode = fs.readFileSync('oauth.js', 'utf8');
  
  assertTrue(sidebarCode.includes('this.oauthClient = new GitHubOAuth()'), 'OAuth client must be initialized');
  assertTrue(sidebarCode.includes('handleOAuthFlow()'), 'OAuth flow handler must exist');
  assertTrue(oauthCode.includes('class GitHubOAuth'), 'GitHubOAuth class must exist');
  assertTrue(oauthCode.includes('authenticate()'), 'OAuth authenticate method must exist');
});

// CRITICAL: Test that filtering and search work
test('Search and filter functionality intact', () => {
  const sidebarCode = fs.readFileSync('sidebar.js', 'utf8');
  
  assertTrue(sidebarCode.includes('fuzzyMatch('), 'Fuzzy search function must exist');
  assertTrue(sidebarCode.includes('shouldShowPR('), 'PR filtering function must exist');
  assertTrue(sidebarCode.includes('reviewerOnlyMode'), 'Reviewer-only filter must exist');
  
  // Test key filter types
  assertTrue(sidebarCode.includes("case 'ready':"), 'Ready filter must exist');
  assertTrue(sidebarCode.includes("case 'wip':"), 'WIP filter must exist');
  assertTrue(sidebarCode.includes("case 'pinged':"), 'Pinged filter must exist');
});

// Test that manifest hasn't broken
test('Manifest maintains required permissions', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  
  assertEquals(manifest.manifest_version, 3, 'Must use Manifest V3');
  assertTrue(manifest.permissions.includes('storage'), 'Storage permission required');
  assertTrue(manifest.permissions.includes('identity'), 'Identity permission required for OAuth');
  assertTrue(manifest.permissions.includes('sidePanel'), 'SidePanel permission required');
  assertTrue(manifest.host_permissions.includes('https://api.github.com/*'), 'GitHub API access required');
});

// Test that HTML structure supports current functionality
test('HTML contains required elements for current functionality', () => {
  const html = fs.readFileSync('sidebar.html', 'utf8');
  
  assertTrue(html.includes('id="oauth-btn"'), 'OAuth button must exist');
  assertTrue(html.includes('id="pr-list"'), 'PR list container must exist');
  assertTrue(html.includes('id="search-input"'), 'Search input must exist');
  assertTrue(html.includes('data-filter="ready"'), 'Ready filter button must exist');
  assertTrue(html.includes('data-filter="wip"'), 'WIP filter button must exist');
  assertTrue(html.includes('data-filter="pinged"'), 'Pinged filter button must exist');
});

// CRITICAL: Verify we haven't re-added notification code without permissions
test('Notification code properly disabled', () => {
  const backgroundCode = fs.readFileSync('background.js', 'utf8');
  
  // Background should not try to create notifications
  if (backgroundCode.includes('chrome.notifications.create') && 
      !backgroundCode.includes('if (chrome.notifications)')) {
    throw new Error('REGRESSION: Notifications used without permission check');
  }
});

// Test current working state indicators
test('Current working indicators are maintained', () => {
  const sidebarCode = fs.readFileSync('sidebar.js', 'utf8');
  
  // These are the working activity indicators
  assertTrue(sidebarCode.includes('Review requested'), 'Review requested indicator must exist');
  assertTrue(sidebarCode.includes('Recently updated'), 'Recently updated indicator must exist');
  
  // These should NOT be present (they depend on timeline data we removed)
  if (sidebarCode.includes('Recently pinged') && !sidebarCode.includes('// ')) {
    console.warn('WARNING: "Recently pinged" may not work without timeline data');
  }
});

console.log(`\n📊 Regression Test Results:`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failed > 0) {
  console.log(`\n🚨 REGRESSION DETECTED: ${failed} test(s) failed!`);
  console.log(`The extension has regressed from the known working state.`);
  console.log(`Please fix these issues before making further changes.`);
  process.exit(1);
} else {
  console.log(`\n🛡️  All regression tests passed! The working state is maintained.`);
  process.exit(0);
}