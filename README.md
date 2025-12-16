# PR Shepherd

A Chrome extension for tracking GitHub PRs you're shepherding. Designed for maintainers who follow dozens of PRs and need a quick way to monitor their status.

## Features

- **Priority groups**: Organize PRs into customizable groups (default: P0, P1, Backlog)
- **One-click tracking**: Add PRs directly from GitHub PR pages via a button in the header
- **Status dashboard**: View CI status, review state, labels, and recent activity in a sidebar
- **Change detection**: See what changed since your last refresh (new commits, approvals, CI failures)
- **Failed test visibility**: Expandable list of failed CI checks

## Installation

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked" and select the `shepherd2` folder
5. Click the extension icon to open the sidebar

## Usage

**Adding PRs**: Navigate to any GitHub PR page. Click the "Shepherd" button in the PR header and select a priority group.

**Viewing PRs**: Click the extension icon to open the sidebar. PRs are organized by group tabs.

**Refreshing**: Click "Refresh" to fetch latest status for all PRs, or use the ↻ button on individual PRs.

**Settings**: Configure priority groups and optionally add a GitHub token for higher API rate limits.

## Architecture

```
manifest.json     # Extension configuration (Manifest V3)
sidepanel.html/js # Main dashboard UI (Chrome Side Panel API)
content.js/css    # Injects "Shepherd" button on PR pages
background.js     # Service worker for initialization and side panel control
```

Data is stored in `chrome.storage.local`:
- `groups`: Array of priority group names
- `prs`: Object mapping PR URLs to `{ group, data, updates, lastSeen }`
- `token`: Optional GitHub personal access token

## GitHub API Usage

The extension fetches from the public GitHub API:
- `GET /repos/:owner/:repo/pulls/:number` - PR metadata
- `GET /repos/:owner/:repo/pulls/:number/reviews` - Review states
- `GET /repos/:owner/:repo/commits/:sha/check-runs` - CI check results
- `GET /repos/:owner/:repo/commits/:sha/status` - Commit statuses

Without a token, GitHub allows 60 requests/hour. With a token, this increases to 5,000/hour.

## Scope

This is intentionally a lightweight tool. Current scope:

**In scope**:
- Track PRs across priority groups
- Display CI, review, and label status
- Detect changes between refreshes
- Manual refresh of PR data

**Out of scope** (for now):
- Automatic background refresh
- Notifications
- Multiple repository presets
- PR filtering/search within groups
- Syncing across devices

## Development

Edit the JS/CSS files directly and reload the extension in `chrome://extensions` to see changes. The codebase is vanilla JS with no build step.
