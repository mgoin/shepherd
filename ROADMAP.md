# 🐑 PR Shepherd Development Roadmap

## 📍 Current State (v0.1.0)

### ✅ **Completed Features**
- **Chrome Extension Foundation** - Manifest V3 with sidebar interface
- **GitHub GraphQL Integration** - Efficient API usage with rate limiting
- **Advanced PR Management** - Search, filtering, custom groups, drag & drop
- **Smart Caching** - Instant loading with background refresh
- **Reviewer Filtering** - Focus on PRs requiring your attention
- **Error Handling** - Comprehensive auth and API error management

### 📊 **Current Capabilities**
- Manages vLLM repository PRs efficiently
- Real-time search and filtering
- Custom PR organization with persistent groups
- Team and individual reviewer detection
- Visual CI status indicators (basic)
- Background data synchronization

---

## 🎯 **Next Phase: Core Experience Enhancement**

### **Priority 1: OAuth Device Flow Implementation**
**Target:** Eliminate authentication friction and improve security

#### **Why This Matters**
- Current PAT setup is confusing (repo + read:org scopes)
- Manual token management creates barriers to adoption
- Security concerns with token storage
- Poor user onboarding experience

#### **Technical Implementation**
```
1. Chrome Identity API Integration
   - chrome.identity.launchWebAuthFlow()
   - GitHub OAuth Device Flow
   - Secure token storage with encryption

2. OAuth Flow Components
   - Device authorization request
   - User authentication in GitHub
   - Token exchange and refresh handling
   - Graceful fallback to PAT if needed

3. Enhanced Security
   - Token encryption in chrome.storage
   - Automatic token refresh
   - Scope validation and error handling
```

#### **User Experience Goals**
- One-click "Connect with GitHub" button
- No manual scope selection required
- Automatic token refresh handling
- Clear connection status indicators

#### **Acceptance Criteria**
- [ ] OAuth device flow working end-to-end
- [ ] Fallback to manual PAT still available
- [ ] Token refresh handled automatically
- [ ] Error states clearly communicated
- [ ] Migration path for existing PAT users

---

### **Priority 2: Enhanced CI Status Integration**
**Target:** Comprehensive CI/CD status visibility for better PR shepherding

#### **Why This Matters**
- Current CI status is basic (success/failure/pending)
- No visibility into specific failing checks
- Can't distinguish between different CI systems
- Missing actionable information for debugging

#### **Technical Implementation**
```
1. Dual API Integration
   - GitHub Status API (legacy CI systems)
   - GitHub Checks API (modern CI/CD)
   - Intelligent merging of both data sources

2. Enhanced Data Model
   - Individual check status and conclusions
   - Check suite grouping and organization
   - Timestamps and duration tracking
   - Links to logs and detailed information

3. Visual Improvements
   - Expandable check status section
   - Color-coded status indicators
   - Progress indicators for running checks
   - Quick access to failure details
```

#### **User Experience Goals**
- See all CI checks at a glance
- Understand what specifically is failing
- Quick access to logs and details
- Historical check status tracking

#### **Acceptance Criteria**
- [ ] All CI checks visible (Status + Checks APIs)
- [ ] Individual check status with details
- [ ] Expandable UI for check information
- [ ] Click-through to external CI systems
- [ ] Performance optimized for many checks

---

## 🗺 **Future Roadmap**

### **Phase 3: Multi-Repository Support** *(Medium Priority)*
- Add/remove repositories dynamically
- Unified view across multiple projects
- Per-repository settings and groups
- Cross-repo PR correlation

### **Phase 4: Smart Notifications** *(Medium Priority)*
- Configurable browser notifications
- PR status change alerts
- Review request notifications
- Chrome badge integration

### **Phase 5: Performance & Scale** *(Medium Priority)*
- IndexedDB for unlimited data storage
- Offline mode with cached data
- Pagination for large PR sets
- Background sync optimization

### **Phase 6: Advanced Features** *(Lower Priority)*
- Quick actions (approve, merge, comment)
- Export/import functionality
- Team collaboration features
- Integration with external tools

### **Phase 7: Publication & Polish** *(Future)*
- Chrome Web Store preparation
- Public documentation
- User onboarding flow
- Marketing and distribution

---

## 🛠 **Technical Architecture Evolution**

### **Current Architecture**
```
Chrome Extension (Manifest V3)
├── Sidebar Interface (sidebar.html/js/css)
├── Background Service Worker (background.js)
├── GitHub GraphQL API Integration
├── Chrome Storage (local) for caching
└── Custom Groups with drag & drop
```

### **Target Architecture (Post OAuth + CI)**
```
Chrome Extension (Manifest V3)
├── Sidebar Interface (enhanced)
├── Background Service Worker (enhanced)
├── OAuth Authentication Module
├── GitHub API Abstraction Layer
│   ├── GraphQL API (PRs, Reviews)
│   ├── REST Status API (legacy CI)
│   └── REST Checks API (modern CI)
├── Data Layer
│   ├── Chrome Storage (preferences)
│   ├── IndexedDB (large datasets)
│   └── Encrypted token storage
└── Notification System
```

---

## 📈 **Success Metrics**

### **User Experience**
- Setup time: 10+ minutes → under 1 minute
- CI visibility: basic status → detailed check information
- User retention: measure weekly active users
- Error rates: authentication and API failures

### **Technical Performance**
- API rate limit efficiency
- Cache hit rates for instant loading
- Extension bundle size optimization
- Memory usage and performance

---

## 🚧 **Implementation Notes**

### **Development Approach**
1. **Feature branches** for each major component
2. **Progressive enhancement** - don't break existing functionality
3. **Backward compatibility** - support existing user setups
4. **Comprehensive testing** at each milestone

### **Risk Management**
- **OAuth complexity**: Have PAT fallback ready
- **API rate limits**: Careful testing with enhanced CI calls
- **User migration**: Smooth transition from current setup
- **Chrome API changes**: Monitor Manifest V3 evolution

---

## 📅 **Timeline Estimate**

### **OAuth Implementation** *(1-2 weeks)*
- Week 1: OAuth flow implementation and testing
- Week 2: UI integration and user migration path

### **Enhanced CI Status** *(1-2 weeks)*
- Week 1: API integration and data modeling
- Week 2: UI enhancements and performance optimization

### **Integration & Polish** *(1 week)*
- Combined testing and refinement
- Documentation updates
- User feedback integration

**Total estimated timeline: 3-5 weeks for Phase 2 completion**

---

*Last updated: 2025-01-29*  
*Next review: After OAuth + CI Status implementation*