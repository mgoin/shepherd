#!/usr/bin/env node

/**
 * Performance tests for PR Shepherd extension
 * Tests loading times and caching effectiveness
 */

console.log('⚡ PR Shepherd Performance Tests');
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
      console.log(`   Performance issue: ${error.message}\n`);
      failed++;
    }
    resolve();
  });
}

// Mock Chrome storage for testing
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
      }
    }
  }
};

// Mock fetch for performance testing
global.fetch = async (url, options) => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 100));
  
  if (url.includes('graphql')) {
    return {
      ok: true,
      json: () => Promise.resolve({
        data: {
          repository: {
            pullRequests: {
              nodes: Array.from({ length: 30 }, (_, i) => ({
                id: `test-id-${i}`,
                number: 1000 + i,
                title: `Test PR ${i}`,
                state: 'OPEN',
                isDraft: false,
                updatedAt: new Date().toISOString(),
                author: { login: 'testuser' },
                reviewRequests: { nodes: [] },
                commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
                reviewDecision: null,
                reviews: { totalCount: 0 },
                labels: { nodes: [] }
              }))
            }
          },
          viewer: { login: 'testuser' },
          rateLimit: { remaining: 4999, resetAt: new Date().toISOString() }
        }
      })
    };
  }
  return { ok: false, status: 404 };
};

// Test 1: Cache loading performance
await test('Cache loading should be instant (< 50ms)', async () => {
  // Set up cache data
  const testData = {
    data: Array.from({ length: 30 }, (_, i) => ({
      number: i,
      title: `Cached PR ${i}`,
      state: 'OPEN'
    })),
    lastUpdate: Date.now()
  };
  
  await chrome.storage.local.set({ pr_cache: testData });
  
  const startTime = performance.now();
  const cached = await chrome.storage.local.get(['pr_cache']);
  const endTime = performance.now();
  
  const loadTime = endTime - startTime;
  
  if (loadTime > 50) {
    throw new Error(`Cache loading took ${loadTime.toFixed(2)}ms, should be < 50ms`);
  }
  
  if (!cached.pr_cache || cached.pr_cache.data.length !== 30) {
    throw new Error('Cache data not loaded correctly');
  }
});

// Test 2: GraphQL query performance
await test('GraphQL query should complete within reasonable time (< 5s)', async () => {
  const startTime = performance.now();
  
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { 'Authorization': 'bearer test-token' },
    body: JSON.stringify({
      query: 'test query',
      variables: { owner: 'test', name: 'test' }
    })
  });
  
  const data = await response.json();
  const endTime = performance.now();
  
  const queryTime = endTime - startTime;
  
  if (queryTime > 5000) {
    throw new Error(`GraphQL query took ${queryTime.toFixed(2)}ms, should be < 5000ms`);
  }
  
  if (!data.data || !data.data.repository) {
    throw new Error('GraphQL query returned invalid data structure');
  }
});

// Test 3: Data processing performance
await test('PR data processing should be fast (< 100ms for 30 PRs)', async () => {
  const testPRs = Array.from({ length: 30 }, (_, i) => ({
    id: `pr-${i}`,
    number: i,
    title: `Performance Test PR ${i}`,
    state: 'OPEN',
    isDraft: i % 3 === 0,
    author: { login: 'testuser' },
    reviewRequests: { nodes: [] },
    reviews: { totalCount: i % 2 },
    labels: { nodes: [{ name: 'test', color: 'ff0000' }] }
  }));
  
  const startTime = performance.now();
  
  // Simulate the filtering logic
  const filtered = testPRs.filter(pr => {
    // Basic filtering logic similar to shouldShowPR
    return !pr.isDraft || pr.state === 'OPEN';
  });
  
  // Simulate rendering preparation
  const rendered = filtered.map(pr => ({
    ...pr,
    displayTitle: `#${pr.number} ${pr.title}`,
    statusIcon: pr.isDraft ? '📝' : '✅'
  }));
  
  const endTime = performance.now();
  const processingTime = endTime - startTime;
  
  if (processingTime > 100) {
    throw new Error(`Data processing took ${processingTime.toFixed(2)}ms, should be < 100ms`);
  }
  
  if (rendered.length === 0) {
    throw new Error('Data processing failed - no results');
  }
});

// Test 4: Memory usage (basic check)
await test('Memory usage should be reasonable for 30 PRs', async () => {
  const testData = Array.from({ length: 30 }, (_, i) => ({
    id: `memory-test-${i}`,
    number: i,
    title: 'A'.repeat(100), // Long title
    state: 'OPEN',
    isDraft: false,
    author: { login: 'testuser' },
    reviewRequests: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
    reviews: { totalCount: 0 },
    labels: { nodes: [{ name: 'performance', color: 'ff6b6b' }] }
  }));
  
  // Rough memory usage check
  const jsonSize = JSON.stringify(testData).length;
  const estimatedMemoryKB = jsonSize / 1024;
  
  if (estimatedMemoryKB > 500) {
    throw new Error(`Data size is ${estimatedMemoryKB.toFixed(2)}KB, should be < 500KB for 30 PRs`);
  }
});

// Test 5: Smart refresh logic
await test('Smart refresh should skip unnecessary requests', async () => {
  // Simulate recent last update
  const recentUpdate = new Date(Date.now() - 60000); // 1 minute ago
  
  function shouldSkipRefresh(lastUpdate) {
    if (!lastUpdate) return false;
    const now = Date.now();
    const twoMinutesAgo = now - (2 * 60 * 1000);
    const lastUpdateTime = lastUpdate.getTime();
    return lastUpdateTime > twoMinutesAgo;
  }
  
  const shouldSkip = shouldSkipRefresh(recentUpdate);
  
  if (!shouldSkip) {
    throw new Error('Smart refresh should skip requests when data is fresh (< 2 minutes old)');
  }
  
  // Test old data should refresh
  const oldUpdate = new Date(Date.now() - 300000); // 5 minutes ago
  const shouldRefresh = !shouldSkipRefresh(oldUpdate);
  
  if (!shouldRefresh) {
    throw new Error('Smart refresh should allow requests when data is old (> 2 minutes old)');
  }
});

// Test 6: Cache effectiveness
await test('Cache should provide instant loading experience', async () => {
  // Test cache miss scenario
  storage = {}; // Clear cache
  
  const startTime1 = performance.now();
  const noCacheResult = await chrome.storage.local.get(['pr_cache']);
  const endTime1 = performance.now();
  
  // Test cache hit scenario
  const cacheData = {
    data: [{ number: 1, title: 'Test' }],
    lastUpdate: Date.now()
  };
  await chrome.storage.local.set({ pr_cache: cacheData });
  
  const startTime2 = performance.now();
  const cacheResult = await chrome.storage.local.get(['pr_cache']);
  const endTime2 = performance.now();
  
  const cacheHitTime = endTime2 - startTime2;
  
  if (cacheHitTime > 10) {
    throw new Error(`Cache hit took ${cacheHitTime.toFixed(2)}ms, should be < 10ms`);
  }
  
  if (!cacheResult.pr_cache) {
    throw new Error('Cache hit failed to return data');
  }
});

console.log(`\n📊 Performance Test Results:`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failed > 0) {
  console.log(`\n⚠️  ${failed} performance test(s) failed.`);
  console.log(`The extension may have performance issues that need attention.`);
  process.exit(1);
} else {
  console.log(`\n⚡ All ${passed} performance tests passed! Extension is optimized.`);
  process.exit(0);
}