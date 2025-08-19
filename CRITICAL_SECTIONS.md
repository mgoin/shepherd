# 🚨 Critical Code Sections - DO NOT MODIFY

This document identifies code sections that are currently working and should **NOT** be modified without extreme caution, as they have been the source of regressions.

## 🔒 CRITICAL: GraphQL Query (sidebar.js:498-563)

**Status: WORKING - DO NOT EXPAND**

```javascript
// This query structure is proven to work
query GetVLLMPRs($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 50, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) {
```

### ✅ Safe fields (currently included):
- `id`, `number`, `title`, `state`, `isDraft`
- `createdAt`, `updatedAt`, `author { login }`
- `headRefName`, `reviewDecision`
- `reviewRequests(first: 5)` - basic reviewer info
- `commits(last: 1) { commit { statusCheckRollup { state } } }` - basic CI status
- `reviews(first: 5)` - basic review info
- `labels(first: 3)` - basic labels

### 🚫 DANGEROUS fields (cause timeouts - DO NOT ADD):
- `timelineItems` - Complex, causes 504 errors
- `contexts(first: 20)` with detailed CheckRun/StatusContext - Too complex
- `checkSuite { app { name } }` - Nested complexity
- Large `first:` values (>50 PRs)
- Deep nested queries with multiple levels

### 🔧 If you MUST modify:
1. Test with regression tests first
2. Start with `first: 10` and gradually increase
3. Add ONE field at a time
4. Monitor for 504 timeouts

---

## 🔒 CRITICAL: Fetch Implementation (sidebar.js:565-575)

**Status: WORKING - DO NOT ADD TIMEOUTS**

```javascript
// This simple fetch is proven to work
const response = await fetch(this.baseUrl, {
  method: 'POST',
  headers: {
    'Authorization': `bearer ${this.token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query,
    variables: { owner: this.repo.owner, name: this.repo.name }
  })
});
```

### ✅ Current working approach:
- Simple `await fetch()` call
- No AbortController
- No setTimeout/clearTimeout
- Basic error handling in catch block

### 🚫 DO NOT ADD:
- `AbortController` and `signal: controller.signal`
- `setTimeout(() => controller.abort(), timeout)`
- Complex timeout handling - **CAUSES sidebar.js:399 ERRORS**

### 💡 If GitHub API times out:
- This is GitHub's problem, not ours
- Let the browser handle the timeout naturally
- Show appropriate error message to user
- Don't try to "fix" with complex timeout code

---

## 🔒 CRITICAL: Activity Detection (sidebar.js:818-843)

**Status: WORKING - Uses available data only**

```javascript
getActivityInfo(pr) {
  // Only uses data we actually fetch in GraphQL query
  const isDirectReviewer = pr.reviewRequests.nodes.some(...)
  const updatedAt = new Date(pr.updatedAt).getTime()
  // Simple, reliable logic
}
```

### ✅ Works with current data:
- `pr.reviewRequests.nodes` - We fetch this
- `pr.updatedAt` - We fetch this
- `this.currentUser.login` - We have this

### 🚫 DO NOT reference fields we don't fetch:
- `pr.timelineItems` - Not in simplified query
- `pr.commits.nodes[0].commit.author.date` - Too nested
- Complex timeline event processing

---

## 🔒 CRITICAL: CI Status (sidebar.js:695-706)

**Status: WORKING - Simplified implementation**

```javascript
getCIStatus(pr) {
  const rollup = pr.commits.nodes[0]?.commit?.statusCheckRollup;
  if (!rollup) return { state: 'unknown' };
  const state = rollup.state ? rollup.state.toLowerCase().replace('_', ' ') : 'unknown';
  return { state };
}
```

### ✅ Simple, reliable:
- Only uses `statusCheckRollup.state`
- Returns simple `{ state }` object
- No complex `details` array processing

### 🚫 DO NOT expand to:
- Processing `contexts.nodes` (not in query)
- Complex CheckRun/StatusContext handling
- Detailed CI information (causes timeouts)
- Expandable UI components for CI details

---

## 🔒 CRITICAL: Background Service (background.js:103-132)

**Status: WORKING - Simplified query**

```javascript
// Uses same simplified query as sidebar
pullRequests(first: 50, states: [OPEN]) {
  // Only basic fields, no complex nested data
}
```

### ✅ Keep it simple:
- Same field structure as sidebar.js
- No AbortController
- Simple error logging
- Disabled notifications (no permission)

---

## 🛡️ Testing Requirements

Before modifying ANY critical section:

1. **Run regression tests**: `node test-regression.js`
2. **Test manually**: Load extension, open sidebar, verify PR list loads
3. **Monitor console**: No errors in browser console
4. **Check for 504s**: GitHub API should respond (may be slow but not error)

## 🚨 Red Flags - Stop Immediately If You See:

- `sidebar.js:399` errors in console
- `background.js:94` errors in console
- HTTP 504 timeout errors that persist
- Empty PR list when there should be PRs
- Extension failing to load completely

## 📝 Safe Modifications

These areas are safer to modify:

- **UI styling** (sidebar.css) 
- **Filter logic** (shouldShowPR method)
- **Search functionality** (fuzzyMatch)
- **Custom tags** (completely separate from GitHub API)
- **Error message text** (but not error handling logic)
- **Icon/emoji choices** (but not the underlying data)

## 🎯 Current Known Issues (Safe to Fix)

1. **Duplicate emojis** (🟡🟡, ❌❌) - UI issue, safe to fix
2. **Filter button active states** - UI issue
3. **Cosmetic polish** - Safe improvements

Remember: **A working extension with cosmetic issues is infinitely better than a broken extension with perfect styling**.