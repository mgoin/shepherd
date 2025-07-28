# 🐑 PR Shepherd

A Chrome extension for managing and tracking your vLLM GitHub pull requests. Keep your PRs organized, monitor CI status, and never miss important updates.

## Features (Planned)

### Core Features
- **PR Dashboard** - Categorized view (Finished, Ready for Review, WIP)
- **Real-time Status** - CI checks, review status, merge conflicts  
- **Activity Tracking** - Latest comments, commits, reviews
- **Quick Actions** - One-click review requests, merges, status updates
- **Smart Notifications** - Configurable alerts for status changes

### Current Status
- ✅ Basic Chrome extension structure (Manifest V3)
- ✅ GitHub GraphQL API integration planning
- ✅ Popup UI foundation with filtering
- ✅ Background service worker for periodic updates
- ⏳ OAuth authentication (currently uses PAT)
- ⏳ Rate limit monitoring and optimization
- ⏳ IndexedDB storage for large datasets

## Installation (Development)

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the project directory
5. The extension icon should appear in your toolbar

## Setup

### Temporary GitHub Token Setup
Currently using Personal Access Token (OAuth coming soon):

1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate a new token with these scopes:
   - `repo` (for private repos) or `public_repo` (for public only)
   - `read:org` (to read organization membership)
3. Click the Shepherd extension icon
4. Enter your token when prompted

⚠️ **Security Note**: This is temporary. OAuth Device Flow implementation is planned for secure token management.

## Development Roadmap

### Phase 1: Foundation (Week 1-2)
- [x] Chrome extension boilerplate with Manifest V3
- [x] GitHub GraphQL API integration
- [x] Basic PR fetching and display
- [ ] OAuth Device Flow authentication
- [ ] Rate limit monitoring with X-RateLimit headers

### Phase 2: Core Features (Week 2-3)
- [ ] PR categorization system
- [ ] Comprehensive CI status (Checks + Status APIs)
- [ ] Activity timeline with incremental updates
- [ ] IndexedDB storage with Dexie.js
- [ ] Service worker lifecycle management

### Phase 3: Advanced Features (Week 4-5)
- [ ] Smart notifications with filtering
- [ ] Quick actions (merge, review, etc.)
- [ ] Performance optimization
- [ ] Cross-repository support
- [ ] Export/import PR lists

### Phase 4: Polish (Week 6)
- [ ] UI/UX improvements
- [ ] Error handling and offline mode
- [ ] Chrome Web Store preparation
- [ ] Documentation and testing

## Technical Architecture

### Chrome Extension (Manifest V3)
- **Background Service Worker**: Periodic PR updates using `chrome.alarms`
- **Popup Interface**: Main dashboard for PR management
- **Storage**: `chrome.storage.local` for preferences, IndexedDB for PR data

### GitHub API Integration
- **GraphQL v4**: Efficient batched queries for PR data
- **Authentication**: OAuth Device Flow (replacing temporary PAT)
- **Rate Limiting**: Point-based system with intelligent caching

### Key Optimizations
- ETags for conditional requests
- Incremental updates using `updatedAt` timestamps  
- Pagination for large PR sets
- Background sync with chrome.alarms

## Contributing

This is currently a personal project for managing vLLM PRs, but contributions welcome!

## Rate Limiting Strategy

GitHub GraphQL uses a point-based system (5000 points/hour):
- Each field costs points based on complexity
- Current query costs ~52 points for 25 PRs with full status
- Background updates every 5 minutes with smart caching
- Incremental fetching for PRs updated since last sync

## Lessons Learned (So Far)

1. **Service Worker Lifecycle**: MV3 service workers are ephemeral - use `chrome.alarms` for persistence
2. **Storage Limits**: Chrome storage has 5MB quota - IndexedDB needed for PR data
3. **Security**: OAuth Device Flow essential for production token management
4. **API Efficiency**: GraphQL batching saves significant rate limit quota vs REST
5. **CI Status Complexity**: Need both Checks API and Status API for full coverage