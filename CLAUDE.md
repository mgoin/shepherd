# PR Shepherd - Claude Code Development Documentation

## 🎯 Project Overview

**PR Shepherd** is a Chrome extension designed to help developers efficiently manage and track GitHub pull requests. Built specifically for high-volume repositories like vLLM, it provides advanced filtering, organization, and status tracking capabilities in a persistent sidebar interface.

## 🚀 Current Status (v0.2.0)

### ✅ **Completed Major Features**

#### **Core Extension Infrastructure**
- **Chrome Extension (Manifest V3)** - Modern sidebar-based interface using Side Panel API
- **GitHub API Integration** - Efficient GraphQL queries with comprehensive error handling
- **Instant Loading** - Smart caching system with background refresh for immediate startup

#### **Authentication System**
- **OAuth Device Flow** - Seamless GitHub authentication with automatic token management
- **Personal Access Token Fallback** - Support for users who prefer manual token setup
- **Secure Token Storage** - Encrypted storage with automatic validation and refresh

#### **Advanced PR Management**
- **Fuzzy Search** - Real-time filtering across PR titles, numbers, authors, and branches
- **Smart Reviewer Filtering** - Default to PRs requiring your attention with team support
- **Custom Groups** - Drag-and-drop PR organization with persistent storage
- **Enhanced CI Status** - Detailed check information combining GitHub Status + Checks APIs

#### **Testing & Quality Assurance**
- **Comprehensive Test Suite** - Unit tests, integration tests, and CI/CD pipeline
- **GitHub Actions Integration** - Automated testing on every commit
- **Code Quality Standards** - Linting, type checking, and performance monitoring

### 🛠 **Technical Architecture**

```
Chrome Extension (Manifest V3)
├── Authentication Layer
│   ├── OAuth Device Flow (oauth.js)
│   ├── PAT Fallback Support
│   └── Secure Token Management
├── GitHub API Integration
│   ├── GraphQL API (PRs, Reviews, Teams)
│   ├── REST Checks API (CI Status)
│   ├── REST Status API (Legacy CI)
│   └── Rate Limiting & Error Handling
├── User Interface
│   ├── Sidebar Interface (sidebar.html/css/js)
│   ├── Drag & Drop PR Management
│   ├── Real-time Search & Filtering
│   └── Custom Group Organization
├── Data Management
│   ├── Chrome Storage (preferences)
│   ├── Local Caching System
│   └── Background Sync
└── Testing Infrastructure
    ├── Unit Tests (test-runner.js)
    ├── Integration Tests (test-integration.js)
    └── CI/CD Pipeline (.github/workflows/)
```

## 📋 **Development Commands**

### **Testing**
```bash
# Run unit tests
node test-runner.js

# Run integration tests  
node test-integration.js

# Run all tests (via GitHub Actions)
git push  # Triggers automated testing
```

### **Development Workflow**
```bash
# Load extension in Chrome
# 1. Go to chrome://extensions/
# 2. Enable Developer mode
# 3. Click "Load unpacked" and select project directory

# Create feature branch
git checkout -b feature/your-feature-name

# Make changes and test
# Load/reload extension in Chrome for testing

# Commit and push
git add .
git commit -m "feat: description of changes"
git push origin feature/your-feature-name

# Create pull request on GitHub
```

## 🎛 **Configuration**

### **GitHub OAuth Setup** (Recommended)
The extension includes OAuth Device Flow for seamless authentication:
1. Click "Connect with GitHub OAuth" in the extension
2. Follow the browser flow to authorize
3. Extension automatically manages token refresh

### **Manual Token Setup** (Fallback)
If OAuth is unavailable, use Personal Access Token:
1. Go to https://github.com/settings/tokens
2. Generate token with scopes: `repo`, `read:org`
3. Click "Use Personal Access Token" in extension
4. Paste token when prompted

### **Repository Configuration**
Currently optimized for `vllm-project/vllm` but extensible:
- Modify `this.repo` in `sidebar.js` for different repositories
- Multi-repo support planned for future releases

## 🔧 **Extension Settings**

### **Available Filters**
- **My reviews only** - Show PRs where you're requested as reviewer
- **Include team requests** - Show PRs assigned to teams you're part of
- **Status filters** - All, Ready for Review, WIP, Finished
- **Custom groups** - User-created organization categories

### **Keyboard Shortcuts**
- Search is instant - no need to press Enter
- Drag and drop PRs to custom groups
- Click refresh icon for manual data update

## 🐛 **Troubleshooting**

### **Common Issues**

#### **"Error loading PRs: GraphQL Error: required scopes"**
- **Cause**: Token missing `read:org` scope
- **Solution**: Regenerate token with both `repo` and `read:org` scopes

#### **"Authentication failed"**
- **Cause**: Expired or invalid token
- **Solution**: Click Settings gear → logout and reconnect

#### **"Extension not loading"**
- **Cause**: Missing icon files or manifest issues
- **Solution**: Ensure all files present, reload extension in chrome://extensions/

#### **"No PRs showing with 'My reviews only'"**
- **Cause**: No direct review assignments found
- **Solution**: Check "Include team requests" if you're assigned via teams

### **Debug Information**
- Check browser console for detailed error messages
- Rate limit information shown in footer
- Last update timestamp indicates data freshness

## 📈 **Performance Considerations**

### **Rate Limiting**
- Extension respects GitHub API limits (5000 requests/hour)
- Smart caching reduces API calls
- Background refresh only when rate limit allows
- Shows current limit usage in footer

### **Memory Usage**
- Caches PR data locally for instant loading
- Clears old data automatically
- Drag/drop operations are memory efficient

## 🔮 **Upcoming Features**

### **Immediate Roadmap** 
- **Multi-Repository Support** - Manage PRs across multiple repos
- **Enhanced Notifications** - Browser notifications for status changes  
- **Quick Actions** - Approve, merge, comment directly from sidebar

### **Future Enhancements**
- **IndexedDB Storage** - Handle unlimited PR datasets
- **Team Collaboration** - Share custom groups and workflows
- **Chrome Web Store** - Public distribution and auto-updates

## 🤝 **Contributing**

### **Development Guidelines**
1. **Feature branches** for all changes
2. **Comprehensive tests** for new functionality  
3. **Backward compatibility** - don't break existing setups
4. **Performance first** - consider rate limits and memory usage

### **Code Style**
- ES6+ JavaScript with clear variable names
- Comprehensive error handling for all API calls
- Semantic CSS classes with consistent naming
- Detailed comments for complex logic

### **Testing Requirements**
- Unit tests for core functionality
- Integration tests for GitHub API interactions
- Manual testing with various token types and repositories

## 📚 **Additional Resources**

- **GitHub GraphQL API**: https://docs.github.com/en/graphql
- **Chrome Extension API**: https://developer.chrome.com/docs/extensions/
- **OAuth Device Flow**: https://docs.github.com/en/developers/apps/building-oauth-apps/authorizing-oauth-apps#device-flow

## 🔄 **Version History**

- **v0.2.0** - OAuth authentication, enhanced CI status, comprehensive testing
- **v0.1.0** - Basic sidebar interface with advanced PR management features  
- **v0.0.1** - Initial popup-based extension prototype

---

*This documentation is maintained alongside the codebase. For the latest updates, see ROADMAP.md and recent commit messages.*