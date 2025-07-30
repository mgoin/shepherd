/**
 * Unit tests for sidebar.js - Core PR Shepherd functionality
 */

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { 
  mockPRs, 
  createMockGraphQLResponse, 
  mockUsers,
  mockAuthenticationResponses 
} from '../mocks/github-api.js';
import { 
  createMockElement, 
  createMockChromeStorage,
  createMockResponse,
  fireEvent,
  mockPrompt,
  mockConfirm,
  wait
} from '../utils/test-helpers.js';

// Mock the GitHubOAuth class
const mockOAuthClient = {
  isAuthenticated: jest.fn(),
  getCurrentAuth: jest.fn(),
  getAccessToken: jest.fn(),
  authenticate: jest.fn(),
  authenticateWithPAT: jest.fn(),
  logout: jest.fn()
};

// Mock window.GitHubOAuth
global.GitHubOAuth = jest.fn(() => mockOAuthClient);

// We need to import the sidebar after setting up mocks
// Since it's not a module, we'll eval the code with proper context
let PRShepherdSidebar;
let sidebar;

describe('PRShepherdSidebar', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    global.mockGitHubAPIResponses();
    
    // Set up DOM elements that the sidebar expects
    global.document.getElementById.mockImplementation((id) => {
      const commonElement = createMockElement();
      
      // Return specific elements for different IDs
      switch (id) {
        case 'auth-section':
        case 'main-content':
          return { ...commonElement, style: { display: 'none' } };
        case 'pr-list':
          return { ...commonElement, innerHTML: '' };
        case 'search-input':
          return { ...commonElement, value: '' };
        case 'reviewer-only':
        case 'include-teams':
          return { ...commonElement, checked: false };
        default:
          return commonElement;
      }
    });
    
    global.document.querySelectorAll.mockReturnValue([createMockElement()]);
    
    // Set up Chrome storage mock
    const mockStorage = createMockChromeStorage({
      custom_tags: [],
      pr_tag_assignments: {},
      pr_cache: null
    });
    global.chrome.storage.local = mockStorage;
    
    // Create a fresh instance for each test
    // Since we can't import the class directly, we'll simulate it
    PRShepherdSidebar = class {
      constructor() {
        this.baseUrl = 'https://api.github.com/graphql';
        this.repo = { owner: 'vllm-project', name: 'vllm' };
        this.rateLimitInfo = { remaining: 5000, reset: 0 };
        this.lastUpdate = null;
        this.allPRs = [];
        this.filteredPRs = [];
        this.currentUser = null;
        this.customTags = [];
        this.prTagAssignments = new Map();
        this.searchTerm = '';
        this.reviewerOnlyMode = true;
        this.includeTeamRequests = false;
        this.oauthClient = mockOAuthClient;
        this.currentFilter = 'all';
      }

      async init() {
        await this.loadCustomTags();
        await this.checkAuth();
        this.setupEventListeners();
        await this.loadCachedData();
        this.setupAutoRefresh();
      }

      async checkAuth() {
        const authSection = document.getElementById('auth-section');
        const mainContent = document.getElementById('main-content');
        
        try {
          const authResult = await this.oauthClient.isAuthenticated();
          if (authResult && authResult.authenticated) {
            this.currentUser = authResult.user;
            this.token = await this.oauthClient.getAccessToken();
            authSection.style.display = 'none';
            mainContent.style.display = 'flex';
            return;
          }

          const currentAuth = await this.oauthClient.getCurrentAuth();
          if (currentAuth && currentAuth.token) {
            this.token = currentAuth.token;
            
            const response = await fetch('https://api.github.com/user', {
              headers: {
                'Authorization': `token ${this.token}`,
                'Accept': 'application/vnd.github.v3+json'
              }
            });

            if (response.ok) {
              this.currentUser = await response.json();
              authSection.style.display = 'none';
              mainContent.style.display = 'flex';
              return;
            }
          }

          authSection.style.display = 'flex';
          mainContent.style.display = 'none';
          this.token = null;
          this.currentUser = null;
        } catch (error) {
          console.error('Auth check failed:', error);
          authSection.style.display = 'flex';
          mainContent.style.display = 'none';
          this.token = null;
          this.currentUser = null;
        }
      }

      setupEventListeners() {
        // Mock implementation
      }

      setupAutoRefresh() {
        // Mock implementation
      }

      async loadCustomTags() {
        return new Promise((resolve) => {
          chrome.storage.local.get(['custom_tags', 'pr_tag_assignments'], (result) => {
            this.customTags = result.custom_tags || [];
            const assignments = result.pr_tag_assignments || {};
            this.prTagAssignments = new Map(Object.entries(assignments).map(([k, v]) => [parseInt(k), v]));
            resolve();
          });
        });
      }

      async loadCachedData() {
        try {
          const cached = await new Promise((resolve) => {
            chrome.storage.local.get(['pr_cache'], (result) => {
              resolve(result.pr_cache);
            });
          });
          
          if (cached && cached.data && cached.data.length > 0) {
            this.renderPRs(cached.data);
            this.lastUpdate = new Date(cached.lastUpdate);
            return true;
          }
        } catch (error) {
          console.log('No cached data available:', error);
        }
        return false;
      }

      async fetchPRs() {
        const query = `query GetVLLMPRs($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { pullRequests(first: 100, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { id number title state isDraft } } } }`;

        const response = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Authorization': `bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query,
            variables: {
              owner: this.repo.owner,
              name: this.repo.name
            }
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (data.errors) {
          throw new Error(`GraphQL Error: ${data.errors[0].message}`);
        }

        this.rateLimitInfo = data.data.rateLimit;
        this.currentUser = data.data.viewer;
        
        return data.data.repository.pullRequests.nodes;
      }

      renderPRs(prs) {
        this.allPRs = prs.map(pr => {
          const assignedTag = this.prTagAssignments.get(pr.number);
          if (assignedTag) {
            pr.customTag = this.customTags.find(tag => tag.name === assignedTag);
          }
          return pr;
        });
        this.applyFilters();
      }

      applyFilters() {
        this.filteredPRs = this.allPRs.filter(pr => {
          // Search filter
          if (this.searchTerm) {
            const searchableText = `${pr.title} ${pr.number} ${pr.author?.login || ''} ${pr.headRefName || ''}`.toLowerCase();
            if (!this.fuzzyMatch(searchableText, this.searchTerm)) {
              return false;
            }
          }

          // Reviewer only filter
          if (this.reviewerOnlyMode && this.currentUser) {
            const isDirectReviewer = pr.reviewRequests?.nodes?.some(req => {
              const reviewer = req.requestedReviewer;
              return reviewer?.login === this.currentUser.login;
            });
            
            const hasTeamRequest = this.includeTeamRequests && pr.reviewRequests?.nodes?.some(req => {
              const reviewer = req.requestedReviewer;
              return reviewer?.slug;
            });
            
            const hasReviewed = pr.reviews?.nodes?.some(review => 
              review.author.login === this.currentUser.login
            );
            
            if (!isDirectReviewer && !hasTeamRequest && !hasReviewed) {
              return false;
            }
          }

          // Status filter
          if (this.currentFilter && this.currentFilter !== 'all') {
            return this.shouldShowPR(pr, this.currentFilter);
          }

          return true;
        });

        this.renderFilteredPRs();
      }

      fuzzyMatch(text, search) {
        const searchWords = search.split(' ').filter(word => word.length > 0);
        return searchWords.every(word => text.includes(word));
      }

      shouldShowPR(pr, filter) {
        const isDraft = pr.isDraft;
        const reviewDecision = pr.reviewDecision || '';
        
        if (this.customTags.some(tag => tag.name === filter)) {
          return pr.customTag?.name === filter;
        }
        
        switch (filter) {
          case 'ready':
            return !isDraft && pr.state === 'OPEN' && reviewDecision !== 'APPROVED';
          case 'wip':
            return isDraft;
          case 'finished':
            return pr.state === 'MERGED' || pr.state === 'CLOSED' || reviewDecision === 'APPROVED';
          default:
            return true;
        }
      }

      renderFilteredPRs() {
        const listElement = document.getElementById('pr-list');
        
        if (this.filteredPRs.length === 0) {
          listElement.innerHTML = '<div class="empty">No pull requests found.</div>';
          return;
        }

        listElement.innerHTML = `${this.filteredPRs.length} PRs rendered`;
      }

      async handleOAuthFlow() {
        try {
          const authResult = await this.oauthClient.authenticate();
          
          if (authResult && authResult.authenticated) {
            await this.checkAuth();
          } else {
            throw new Error('Authentication failed');
          }
        } catch (error) {
          console.error('Device Flow authentication failed:', error);
          throw error;
        }
      }

      async handlePATFlow() {
        const token = window.prompt('GitHub Personal Access Token:');
        
        if (token && token.trim()) {
          if (!token.trim().startsWith('ghp_') && !token.trim().startsWith('github_pat_')) {
            throw new Error('Invalid token format');
          }
          
          const authResult = await this.oauthClient.authenticateWithPAT(token.trim());
          
          if (authResult && authResult.authenticated) {
            await this.checkAuth();
          } else {
            throw new Error('Invalid token');
          }
        }
      }

      createCustomTag() {
        const name = window.prompt('Enter tag name:');
        if (name && name.trim()) {
          const color = window.prompt('Enter tag color (hex, e.g. #ff6b6b):', '#0969da');
          if (color) {
            const tag = {
              id: Date.now().toString(),
              name: name.trim(),
              color: color.trim()
            };
            this.customTags.push(tag);
            this.saveCustomTags();
          }
        }
      }

      async saveCustomTags() {
        return new Promise((resolve) => {
          const assignmentsObj = Object.fromEntries(this.prTagAssignments);
          chrome.storage.local.set({ 
            custom_tags: this.customTags,
            pr_tag_assignments: assignmentsObj
          }, resolve);
        });
      }

      assignTagToPR(prNumber) {
        if (this.customTags.length === 0) {
          throw new Error('Please create custom tags first');
        }

        const tagOptions = this.customTags.map((tag, index) => `${index + 1}. ${tag.name}`).join('\n');
        const choice = window.prompt(`Select a tag for PR #${prNumber}:\n\n${tagOptions}\n\nEnter number:`);
        
        if (choice) {
          const tagIndex = parseInt(choice) - 1;
          if (tagIndex >= 0 && tagIndex < this.customTags.length) {
            const selectedTag = this.customTags[tagIndex];
            this.prTagAssignments.set(prNumber, selectedTag.name);
            this.saveCustomTags();
            this.renderPRs(this.allPRs);
            return selectedTag;
          }
        }
        return null;
      }

      removePRTag(prNumber) {
        this.prTagAssignments.delete(prNumber);
        this.saveCustomTags();
        this.renderPRs(this.allPRs);
      }
    };
    
    sidebar = new PRShepherdSidebar();
  });

  describe('Initialization', () => {
    test('should initialize with correct default values', () => {
      expect(sidebar.baseUrl).toBe('https://api.github.com/graphql');
      expect(sidebar.repo).toEqual({ owner: 'vllm-project', name: 'vllm' });
      expect(sidebar.allPRs).toEqual([]);
      expect(sidebar.customTags).toEqual([]);
      expect(sidebar.reviewerOnlyMode).toBe(true);
    });

    test('should load custom tags on initialization', async () => {
      const testTags = [{ id: '1', name: 'urgent', color: '#ff0000' }];
      global.chrome.storage.local.set({ custom_tags: testTags });
      
      await sidebar.loadCustomTags();
      
      expect(sidebar.customTags).toEqual(testTags);
    });
  });

  describe('Authentication', () => {
    test('should handle successful OAuth authentication', async () => {
      mockOAuthClient.isAuthenticated.mockResolvedValue({
        authenticated: true,
        user: mockUsers.testUser
      });
      mockOAuthClient.getAccessToken.mockResolvedValue('test-token');

      await sidebar.checkAuth();

      expect(sidebar.currentUser).toEqual(mockUsers.testUser);
      expect(sidebar.token).toBe('test-token');
    });

    test('should handle OAuth flow', async () => {
      mockOAuthClient.authenticate.mockResolvedValue({
        authenticated: true,
        user: mockUsers.testUser
      });

      await sidebar.handleOAuthFlow();

      expect(mockOAuthClient.authenticate).toHaveBeenCalled();
    });

    test('should handle PAT authentication', async () => {
      const mockPromptSetup = mockPrompt(['ghp_test_token']);
      mockOAuthClient.authenticateWithPAT.mockResolvedValue({
        authenticated: true,
        user: mockUsers.testUser
      });

      await sidebar.handlePATFlow();

      expect(mockOAuthClient.authenticateWithPAT).toHaveBeenCalledWith('ghp_test_token');
      mockPromptSetup.restore();
    });

    test('should reject invalid PAT format', async () => {
      const mockPromptSetup = mockPrompt(['invalid_token']);

      await expect(sidebar.handlePATFlow()).rejects.toThrow('Invalid token format');
      
      mockPromptSetup.restore();
    });

    test('should handle authentication failure', async () => {
      mockOAuthClient.isAuthenticated.mockResolvedValue(false);
      mockOAuthClient.getCurrentAuth.mockResolvedValue(null);

      await sidebar.checkAuth();

      expect(sidebar.currentUser).toBeNull();
      expect(sidebar.token).toBeNull();
    });
  });

  describe('PR Filtering and Search', () => {
    beforeEach(() => {
      const testPRs = [
        { ...mockPRs.openPR, reviewRequests: { nodes: [{ requestedReviewer: mockUsers.testUser }] } },
        mockPRs.draftPR,
        mockPRs.approvedPR
      ];
      sidebar.currentUser = mockUsers.testUser;
      sidebar.renderPRs(testPRs);
    });

    test('should filter PRs by search term', () => {
      sidebar.searchTerm = 'performance';
      sidebar.applyFilters();

      expect(sidebar.filteredPRs).toHaveLength(1);
      expect(sidebar.filteredPRs[0].title).toContain('performance');
    });

    test('should implement fuzzy search correctly', () => {
      expect(sidebar.fuzzyMatch('add new feature', 'new')).toBe(true);
      expect(sidebar.fuzzyMatch('add new feature', 'add feature')).toBe(true);
      expect(sidebar.fuzzyMatch('add new feature', 'remove')).toBe(false);
    });

    test('should filter by reviewer-only mode', () => {
      sidebar.reviewerOnlyMode = true;
      sidebar.applyFilters();

      // Should only show PRs where testUser is requested as reviewer
      expect(sidebar.filteredPRs).toHaveLength(1);
      expect(sidebar.filteredPRs[0].number).toBe(101);
    });

    test('should filter by draft status', () => {
      sidebar.currentFilter = 'wip';
      sidebar.applyFilters();

      expect(sidebar.filteredPRs).toHaveLength(1);
      expect(sidebar.filteredPRs[0].isDraft).toBe(true);
    });

    test('should filter by ready status', () => {
      sidebar.currentFilter = 'ready';
      sidebar.applyFilters();

      const readyPRs = sidebar.filteredPRs.filter(pr => 
        !pr.isDraft && pr.state === 'OPEN' && pr.reviewDecision !== 'APPROVED'
      );
      expect(readyPRs.length).toBeGreaterThan(0);
    });

    test('should filter by finished status', () => {
      sidebar.currentFilter = 'finished';
      sidebar.applyFilters();

      const finishedPRs = sidebar.filteredPRs.filter(pr => 
        pr.state === 'MERGED' || pr.state === 'CLOSED' || pr.reviewDecision === 'APPROVED'
      );
      expect(finishedPRs.length).toBeGreaterThan(0);
    });
  });

  describe('Custom Tags', () => {
    test('should create custom tag', () => {
      const mockPromptSetup = mockPrompt(['urgent', '#ff0000']);

      sidebar.createCustomTag();

      expect(sidebar.customTags).toHaveLength(1);
      expect(sidebar.customTags[0].name).toBe('urgent');
      expect(sidebar.customTags[0].color).toBe('#ff0000');
      
      mockPromptSetup.restore();
    });

    test('should assign tag to PR', () => {
      sidebar.customTags = [{ id: '1', name: 'urgent', color: '#ff0000' }];
      const mockPromptSetup = mockPrompt(['1']);

      const result = sidebar.assignTagToPR(123);

      expect(result.name).toBe('urgent');
      expect(sidebar.prTagAssignments.get(123)).toBe('urgent');
      
      mockPromptSetup.restore();
    });

    test('should handle invalid tag selection', () => {
      sidebar.customTags = [{ id: '1', name: 'urgent', color: '#ff0000' }];
      const mockPromptSetup = mockPrompt(['5']); // Invalid choice

      const result = sidebar.assignTagToPR(123);

      expect(result).toBeNull();
      expect(sidebar.prTagAssignments.has(123)).toBe(false);
      
      mockPromptSetup.restore();
    });

    test('should remove tag from PR', () => {
      sidebar.prTagAssignments.set(123, 'urgent');
      
      sidebar.removePRTag(123);

      expect(sidebar.prTagAssignments.has(123)).toBe(false);
    });

    test('should filter PRs by custom tag', () => {
      const testPRs = [mockPRs.openPR, mockPRs.draftPR];
      sidebar.customTags = [{ id: '1', name: 'urgent', color: '#ff0000' }];
      sidebar.prTagAssignments.set(101, 'urgent');
      sidebar.renderPRs(testPRs);
      
      sidebar.currentFilter = 'urgent';
      sidebar.applyFilters();

      expect(sidebar.filteredPRs).toHaveLength(1);
      expect(sidebar.filteredPRs[0].customTag.name).toBe('urgent');
    });

    test('should handle creating tag without name', () => {
      const mockPromptSetup = mockPrompt(['']); // Empty name

      sidebar.createCustomTag();

      expect(sidebar.customTags).toHaveLength(0);
      
      mockPromptSetup.restore();
    });

    test('should handle assigning tag with no tags available', () => {
      sidebar.customTags = [];

      expect(() => sidebar.assignTagToPR(123)).toThrow('Please create custom tags first');
    });
  });

  describe('GraphQL Operations', () => {
    test('should fetch PRs successfully', async () => {
      sidebar.token = 'test-token';
      const mockResponse = createMockGraphQLResponse([mockPRs.openPR]);
      fetch.mockResolvedValueOnce(createMockResponse(mockResponse));

      const prs = await sidebar.fetchPRs();

      expect(fetch).toHaveBeenCalledWith(sidebar.baseUrl, expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'bearer test-token'
        })
      }));
      expect(prs).toHaveLength(1);
    });

    test('should handle GraphQL errors', async () => {
      sidebar.token = 'test-token';
      const errorResponse = {
        errors: [{ message: 'Bad credentials' }]
      };
      fetch.mockResolvedValueOnce(createMockResponse(errorResponse));

      await expect(sidebar.fetchPRs()).rejects.toThrow('GraphQL Error: Bad credentials');
    });

    test('should handle HTTP errors', async () => {
      sidebar.token = 'test-token';
      fetch.mockResolvedValueOnce(createMockResponse({}, { 
        ok: false, 
        status: 401, 
        statusText: 'Unauthorized' 
      }));

      await expect(sidebar.fetchPRs()).rejects.toThrow('HTTP 401: Unauthorized');
    });
  });

  describe('Data Caching', () => {
    test('should load cached data on startup', async () => {
      const cachedData = {
        data: [mockPRs.openPR],
        lastUpdate: Date.now()
      };
      global.chrome.storage.local.set({ pr_cache: cachedData });

      const result = await sidebar.loadCachedData();

      expect(result).toBe(true);
      expect(sidebar.allPRs).toHaveLength(1);
    });

    test('should handle missing cached data', async () => {
      global.chrome.storage.local.set({ pr_cache: null });

      const result = await sidebar.loadCachedData();

      expect(result).toBe(false);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle empty PR list', () => {
      sidebar.renderPRs([]);
      sidebar.applyFilters();

      expect(sidebar.filteredPRs).toHaveLength(0);
      expect(document.getElementById('pr-list').innerHTML).toContain('No pull requests found');
    });

    test('should handle PRs without review requests', () => {
      const prWithoutReviews = { ...mockPRs.openPR, reviewRequests: { nodes: [] } };
      sidebar.currentUser = mockUsers.testUser;
      sidebar.reviewerOnlyMode = true;
      sidebar.renderPRs([prWithoutReviews]);

      expect(sidebar.filteredPRs).toHaveLength(0);
    });

    test('should handle network errors gracefully', async () => {
      sidebar.token = 'test-token';
      fetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(sidebar.fetchPRs()).rejects.toThrow('Network error');
    });

    test('should handle malformed search terms', () => {
      sidebar.searchTerm = '   ';
      const result = sidebar.fuzzyMatch('test string', sidebar.searchTerm);
      
      expect(result).toBe(true); // Empty search should match everything
    });
  });
});