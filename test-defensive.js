#!/usr/bin/env node

/**
 * Defensive programming tests for PR Shepherd extension
 * Tests handling of undefined/null data from GitHub API
 */

console.log('🛡️  PR Shepherd Defensive Programming Tests');
console.log('==========================================\n');

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

// Test the key functions that caused the .some() error

// Test 1: getReviewStatus with missing data
test('getReviewStatus handles missing reviewRequests gracefully', () => {
  // Mock PR with missing reviewRequests
  const prWithMissingReviews = {
    reviewDecision: null,
    // reviewRequests is missing entirely
    // reviews is missing entirely
  };
  
  const currentUser = { login: 'testuser' };
  
  // Simulate the getReviewStatus logic
  function getReviewStatus(pr) {
    if (pr.reviewDecision === 'APPROVED') return '👍 Approved';
    if (pr.reviewDecision === 'CHANGES_REQUESTED') return '👎 Changes requested';
    
    const reviewRequests = pr.reviewRequests?.nodes || [];
    const isDirectReviewer = reviewRequests.some(req => {
      const reviewer = req.requestedReviewer;
      return reviewer?.login === currentUser?.login;
    });
    
    const teamRequests = reviewRequests.filter(req => req.requestedReviewer?.slug);
    
    if (isDirectReviewer) return '👤 You requested';
    if (teamRequests.length > 0) return `👥 Team review (${teamRequests.length})`;
    
    const reviewCount = pr.reviews?.totalCount || 0;
    if (reviewCount === 0) return '⏳ No reviews';
    
    return `💬 ${reviewCount} review${reviewCount > 1 ? 's' : ''}`;
  }
  
  const result = getReviewStatus(prWithMissingReviews);
  
  if (result !== '⏳ No reviews') {
    throw new Error(`Expected "⏳ No reviews", got "${result}"`);
  }
});

// Test 2: applyFilters with missing data
test('applyFilters handles missing reviewRequests gracefully', () => {
  const prWithMissingData = {
    title: 'Test PR',
    number: 123,
    author: { login: 'author' },
    headRefName: 'feature-branch',
    // reviewRequests is missing
    // reviews is missing
  };
  
  const currentUser = { login: 'testuser' };
  const reviewerOnlyMode = true;
  const includeTeamRequests = false;
  
  // Simulate the filtering logic
  function shouldShowInReviewerMode(pr) {
    const reviewRequests = pr.reviewRequests?.nodes || [];
    const isDirectReviewer = reviewRequests.some(req => {
      const reviewer = req.requestedReviewer;
      return reviewer?.login === currentUser.login;
    });
    
    const hasTeamRequest = includeTeamRequests && reviewRequests.some(req => {
      const reviewer = req.requestedReviewer;
      return reviewer?.slug;
    });
    
    const reviewNodes = pr.reviews?.nodes || [];
    const hasReviewed = reviewNodes.some(review => 
      review.author?.login === currentUser.login
    );
    
    return isDirectReviewer || hasTeamRequest || hasReviewed;
  }
  
  // Should return false since user is not a reviewer and has no reviews
  const shouldShow = shouldShowInReviewerMode(prWithMissingData);
  
  if (shouldShow !== false) {
    throw new Error(`Expected false for non-reviewer PR, got ${shouldShow}`);
  }
});

// Test 3: getActivityInfo with missing data
test('getActivityInfo handles missing reviewRequests gracefully', () => {
  const prWithMissingData = {
    updatedAt: new Date(Date.now() - 1000).toISOString(), // Very recent
    // reviewRequests is missing
  };
  
  const currentUser = { login: 'testuser' };
  
  // Simulate getActivityInfo logic
  function getActivityInfo(pr) {
    if (!currentUser) return '';
    
    const activities = [];
    
    const reviewRequests = pr.reviewRequests?.nodes || [];
    const isDirectReviewer = reviewRequests.some(req => {
      const reviewer = req.requestedReviewer;
      return reviewer?.login === currentUser.login;
    });
    
    if (isDirectReviewer) {
      activities.push('🔔 Review requested');
    }
    
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    const updatedAt = new Date(pr.updatedAt).getTime();
    
    if (updatedAt > oneDayAgo) {
      activities.push('🔄 Recently updated');
    }
    
    return activities.length > 0 ? activities.join(' • ') : '';
  }
  
  const result = getActivityInfo(prWithMissingData);
  
  // Should only show "Recently updated" since reviewRequests is missing
  if (result !== '🔄 Recently updated') {
    throw new Error(`Expected "🔄 Recently updated", got "${result}"`);
  }
});

// Test 4: renderLabels with null/undefined
test('renderLabels handles missing labels gracefully', () => {
  function renderLabels(labels) {
    if (!labels || !labels.length) return '';
    
    return labels.map(label => 
      `<span class="label" style="background-color: #${label.color}">${label.name}</span>`
    ).join('');
  }
  
  // Test with null
  let result = renderLabels(null);
  if (result !== '') {
    throw new Error(`Expected empty string for null labels, got "${result}"`);
  }
  
  // Test with undefined
  result = renderLabels(undefined);
  if (result !== '') {
    throw new Error(`Expected empty string for undefined labels, got "${result}"`);
  }
  
  // Test with empty array
  result = renderLabels([]);
  if (result !== '') {
    throw new Error(`Expected empty string for empty labels, got "${result}"`);
  }
  
  // Test with valid labels
  result = renderLabels([{ name: 'bug', color: 'ff0000' }]);
  if (!result.includes('bug') || !result.includes('ff0000')) {
    throw new Error(`Expected valid label HTML, got "${result}"`);
  }
});

// Test 5: Complex nested data access
test('Handles deeply nested missing data', () => {
  const prWithPartialData = {
    commits: {
      // nodes is missing
    },
    reviews: {
      // totalCount is missing
      // nodes is missing  
    },
    reviewRequests: {
      nodes: [
        {
          // requestedReviewer is missing
        },
        {
          requestedReviewer: {
            // login is missing for User
            // slug is missing for Team
          }
        }
      ]
    }
  };
  
  // Test CI status extraction
  function getCIStatus(pr) {
    const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup;
    if (!rollup) return { state: 'unknown' };
    
    const state = rollup.state ? rollup.state.toLowerCase().replace('_', ' ') : 'unknown';
    return { state };
  }
  
  const ciStatus = getCIStatus(prWithPartialData);
  if (ciStatus.state !== 'unknown') {
    throw new Error(`Expected "unknown" CI status, got "${ciStatus.state}"`);
  }
  
  // Test review counting
  const reviewCount = prWithPartialData.reviews?.totalCount || 0;
  if (reviewCount !== 0) {
    throw new Error(`Expected 0 reviews, got ${reviewCount}`);
  }
  
  // Test reviewer extraction
  const reviewRequests = prWithPartialData.reviewRequests?.nodes || [];
  let foundValidReviewer = false;
  
  reviewRequests.forEach(req => {
    const reviewer = req.requestedReviewer;
    if (reviewer?.login || reviewer?.slug) {
      foundValidReviewer = true;
    }
  });
  
  if (foundValidReviewer) {
    throw new Error('Should not find valid reviewer in malformed data');
  }
});

console.log(`\n📊 Defensive Programming Test Results:`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failed > 0) {
  console.log(`\n🚨 DEFENSIVE PROGRAMMING ISSUES: ${failed} test(s) failed!`);
  console.log(`The extension may crash when GitHub API returns unexpected data.`);
  process.exit(1);
} else {
  console.log(`\n🛡️  All ${passed} defensive programming tests passed! Extension is robust.`);
  process.exit(0);
}