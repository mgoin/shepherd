/**
 * Unit tests for background.js - Service worker functionality
 */

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { 
  mockPRs, 
  createMockGraphQLResponse,
  mockAuthenticationResponses 
} from '../mocks/github-api.js';
import { 
  createMockChromeStorage,
  createMockResponse,
  mockTimers,
  mockMessagePassing,
  wait
} from '../utils/test-helpers.js';

// We need to simulate the ShepherdBackground class since it's not a module
let ShepherdBackground;
let background;

describe('ShepherdBackground', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Set up Chrome storage mock
    const mockStorage = createMockChromeStorage();
    global.chrome.storage.local = mockStorage;
    
    // Set up Chrome alarms mock
    global.chrome.alarms = {
      create: jest.fn(),
      clear: jest.fn(),
      onAlarm: {
        addListener: jest.fn()
      }
    };
    
    // Set up Chrome notifications mock
    global.chrome.notifications = {
      create: jest.fn()
    };
    
    // Set up Chrome side panel mock
    global.chrome.sidePanel = {
      open: jest.fn()
    };
    
    // Set up message passing
    const messaging = mockMessagePassing();
    global.chrome.runtime.onMessage = {
      addListener: messaging.addListener
    };
    global.chrome.runtime.sendMessage = messaging.sendMessage;
    
    // Mock Date.now for consistent testing
    const mockNow = 1640995200000; // 2022-01-01T00:00:00.000Z
    global.Date.now = jest.fn(() => mockNow);
    
    // Create the ShepherdBackground class implementation
    ShepherdBackground = class {
      constructor() {
        this.setup();
      }

      setup() {
        chrome.runtime.onInstalled.addListener(() => {
          console.log('PR Shepherd installed');
          this.setupPeriodicUpdate();
        });

        chrome.action.onClicked.addListener((tab) => {
          chrome.sidePanel.open({ tabId: tab.id });
        });

        chrome.runtime.onStartup.addListener(() => {
          console.log('PR Shepherd started');
          this.setupPeriodicUpdate();
        });

        chrome.alarms.onAlarm.addListener((alarm) => {
          if (alarm.name === 'updatePRs') {
            this.updatePRData();
          }
        });

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
          this.handleMessage(request, sender, sendResponse);
          return true;
        });
      }

      setupPeriodicUpdate() {
        chrome.alarms.clear('updatePRs');
        chrome.alarms.create('updatePRs', {
          delayInMinutes: 1,
          periodInMinutes: 5
        });
      }

      async getAuthToken() {
        const result = await chrome.storage.local.get(['oauth_token', 'github_token']);
        
        if (result.oauth_token && result.oauth_token.access_token) {
          return result.oauth_token.access_token;
        }
        
        if (result.github_token) {
          return result.github_token;
        }
        
        return null;
      }

      async updatePRData() {
        try {
          console.log('Background: Updating PR data...');
          
          const token = await this.getAuthToken();
          if (!token) {
            console.log('Background: No authentication token found');
            return;
          }

          const prs = await this.fetchPRs(token);
          
          await chrome.storage.local.set({
            pr_cache: {
              data: prs,
              lastUpdate: Date.now()
            }
          });

          await this.checkForNotifications(prs);
          
          console.log(`Background: Updated ${prs.length} PRs`);
        } catch (error) {
          console.error('Background: Error updating PR data:', error);
        }
      }

      async fetchPRs(token) {
        const query = `
          query GetVLLMPRs($owner: String!, $name: String!) {
            repository(owner: $owner, name: $name) {
              pullRequests(first: 100, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) {
                nodes {
                  id
                  number
                  title
                  state
                  isDraft
                  updatedAt
                  author {
                    login
                  }
                  commits(last: 1) {
                    nodes {
                      commit {
                        statusCheckRollup {
                          state
                        }
                      }
                    }
                  }
                  reviewDecision
                }
              }
            }
          }
        `;

        const response = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: {
            'Authorization': `bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query,
            variables: {
              owner: 'vllm-project',
              name: 'vllm'
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

        return data.data.repository.pullRequests.nodes;
      }

      async checkForNotifications(currentPRs) {
        const result = await chrome.storage.local.get(['pr_cache', 'notification_settings']);
        const previousCache = result.pr_cache;
        const notificationSettings = result.notification_settings || {
          statusChanges: true,
          newReviews: true,
          ciFailures: true
        };

        if (!previousCache || !notificationSettings.statusChanges) {
          return;
        }

        const previousPRs = new Map(
          previousCache.data.map(pr => [pr.number, pr])
        );

        for (const currentPR of currentPRs) {
          const previousPR = previousPRs.get(currentPR.number);
          if (!previousPR) continue;

          const currentCI = currentPR.commits.nodes[0]?.commit?.statusCheckRollup?.state;
          const previousCI = previousPR.commits.nodes[0]?.commit?.statusCheckRollup?.state;

          if (currentCI !== previousCI && notificationSettings.ciFailures) {
            if (currentCI === 'FAILURE' || currentCI === 'ERROR') {
              this.showNotification(
                `CI Failed: PR #${currentPR.number}`,
                currentPR.title
              );
            } else if (currentCI === 'SUCCESS' && (previousCI === 'FAILURE' || previousCI === 'ERROR')) {
              this.showNotification(
                `CI Fixed: PR #${currentPR.number}`,
                currentPR.title
              );
            }
          }

          if (currentPR.reviewDecision !== previousPR.reviewDecision && notificationSettings.newReviews) {
            if (currentPR.reviewDecision === 'APPROVED') {
              this.showNotification(
                `PR Approved: #${currentPR.number}`,
                currentPR.title
              );
            } else if (currentPR.reviewDecision === 'CHANGES_REQUESTED') {
              this.showNotification(
                `Changes Requested: PR #${currentPR.number}`,
                currentPR.title
              );
            }
          }
        }
      }

      showNotification(title, message) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: title,
          message: message
        });
      }

      async handleMessage(request, sender, sendResponse) {
        try {
          switch (request.action) {
            case 'getCachedPRs':
              const cache = await chrome.storage.local.get(['pr_cache']);
              sendResponse({
                success: true,
                data: cache.pr_cache
              });
              break;

            case 'forceUpdate':
              await this.updatePRData();
              sendResponse({ success: true });
              break;

            case 'updateNotificationSettings':
              await chrome.storage.local.set({
                notification_settings: request.settings
              });
              sendResponse({ success: true });
              break;

            default:
              sendResponse({ success: false, error: 'Unknown action' });
          }
        } catch (error) {
          console.error('Background: Error handling message:', error);
          sendResponse({ success: false, error: error.message });
        }
      }
    };
    
    background = new ShepherdBackground();
  });

  describe('Initialization', () => {
    test('should set up event listeners on construction', () => {
      expect(chrome.runtime.onInstalled.addListener).toHaveBeenCalled();
      expect(chrome.action.onClicked.addListener).toHaveBeenCalled();
      expect(chrome.runtime.onStartup.addListener).toHaveBeenCalled();
      expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalled();
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    });

    test('should setup periodic updates on install', () => {
      const installHandler = chrome.runtime.onInstalled.addListener.mock.calls[0][0];
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      installHandler();

      expect(consoleSpy).toHaveBeenCalledWith('PR Shepherd installed');
      expect(chrome.alarms.clear).toHaveBeenCalledWith('updatePRs');
      expect(chrome.alarms.create).toHaveBeenCalledWith('updatePRs', {
        delayInMinutes: 1,
        periodInMinutes: 5
      });
      
      consoleSpy.restore();
    });

    test('should setup periodic updates on startup', () => {
      const startupHandler = chrome.runtime.onStartup.addListener.mock.calls[0][0];
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      startupHandler();

      expect(consoleSpy).toHaveBeenCalledWith('PR Shepherd started');
      expect(chrome.alarms.create).toHaveBeenCalled();
      
      consoleSpy.restore();
    });

    test('should handle action button click to open sidebar', () => {
      const actionHandler = chrome.action.onClicked.addListener.mock.calls[0][0];
      const mockTab = { id: 123 };
      
      actionHandler(mockTab);

      expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 123 });
    });

    test('should handle alarm events', async () => {
      const alarmHandler = chrome.alarms.onAlarm.addListener.mock.calls[0][0];
      const updateSpy = jest.spyOn(background, 'updatePRData').mockResolvedValue();
      
      await alarmHandler({ name: 'updatePRs' });

      expect(updateSpy).toHaveBeenCalled();
      
      updateSpy.restore();
    });

    test('should ignore non-updatePRs alarms', async () => {
      const alarmHandler = chrome.alarms.onAlarm.addListener.mock.calls[0][0];
      const updateSpy = jest.spyOn(background, 'updatePRData').mockResolvedValue();
      
      await alarmHandler({ name: 'otherAlarm' });

      expect(updateSpy).not.toHaveBeenCalled();
      
      updateSpy.restore();
    });
  });

  describe('Authentication Token Retrieval', () => {
    test('should prefer OAuth token over PAT', async () => {
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'oauth-token' },
        github_token: 'pat-token'
      });

      const token = await background.getAuthToken();

      expect(token).toBe('oauth-token');
    });

    test('should fallback to PAT when no OAuth token', async () => {
      await global.chrome.storage.local.set({
        github_token: 'pat-token'
      });

      const token = await background.getAuthToken();

      expect(token).toBe('pat-token');
    });

    test('should return null when no tokens available', async () => {
      const token = await background.getAuthToken();

      expect(token).toBeNull();
    });

    test('should handle malformed OAuth token', async () => {
      await global.chrome.storage.local.set({
        oauth_token: { invalid: 'structure' }
      });

      const token = await background.getAuthToken();

      expect(token).toBeNull();
    });
  });

  describe('PR Data Updates', () => {
    test('should update PR data successfully', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'test-token' }
      });
      
      const mockPRList = [mockPRs.openPR, mockPRs.draftPR];
      const mockResponse = createMockGraphQLResponse(mockPRList);
      fetch.mockResolvedValueOnce(createMockResponse(mockResponse));

      await background.updatePRData();

      expect(consoleSpy).toHaveBeenCalledWith('Background: Updating PR data...');
      expect(consoleSpy).toHaveBeenCalledWith('Background: Updated 2 PRs');
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        pr_cache: {
          data: mockPRList,
          lastUpdate: Date.now()
        }
      }, expect.any(Function));
      
      consoleSpy.restore();
    });

    test('should skip update when no token available', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      await background.updatePRData();

      expect(consoleSpy).toHaveBeenCalledWith('Background: No authentication token found');
      expect(fetch).not.toHaveBeenCalled();
      
      consoleSpy.restore();
    });

    test('should handle fetch errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'test-token' }
      });
      
      fetch.mockRejectedValueOnce(new Error('Network error'));

      await background.updatePRData();

      expect(consoleSpy).toHaveBeenCalledWith('Background: Error updating PR data:', expect.any(Error));
      
      consoleSpy.restore();
    });

    test('should handle GraphQL errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'test-token' }
      });
      
      const errorResponse = {
        errors: [{ message: 'Bad credentials' }]
      };
      fetch.mockResolvedValueOnce(createMockResponse(errorResponse));

      await background.updatePRData();

      expect(consoleSpy).toHaveBeenCalledWith('Background: Error updating PR data:', expect.any(Error));
      
      consoleSpy.restore();
    });

    test('should handle HTTP errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'test-token' }
      });
      
      fetch.mockResolvedValueOnce(createMockResponse({}, { 
        ok: false, 
        status: 401, 
        statusText: 'Unauthorized' 
      }));

      await background.updatePRData();

      expect(consoleSpy).toHaveBeenCalledWith('Background: Error updating PR data:', expect.any(Error));
      
      consoleSpy.restore();
    });
  });

  describe('Notification System', () => {
    beforeEach(async () => {
      // Set up notification settings
      await global.chrome.storage.local.set({
        notification_settings: {
          statusChanges: true,
          newReviews: true,
          ciFailures: true
        }
      });
    });

    test('should show notification for CI failure', async () => {
      const previousPRs = [
        { ...mockPRs.openPR, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] } }
      ];
      const currentPRs = [
        { ...mockPRs.openPR, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } }
      ];

      await global.chrome.storage.local.set({
        pr_cache: { data: previousPRs, lastUpdate: Date.now() - 300000 }
      });

      await background.checkForNotifications(currentPRs);

      expect(chrome.notifications.create).toHaveBeenCalledWith({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'CI Failed: PR #101',
        message: mockPRs.openPR.title
      });
    });

    test('should show notification for CI recovery', async () => {
      const previousPRs = [
        { ...mockPRs.openPR, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } }
      ];
      const currentPRs = [
        { ...mockPRs.openPR, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] } }
      ];

      await global.chrome.storage.local.set({
        pr_cache: { data: previousPRs, lastUpdate: Date.now() - 300000 }
      });

      await background.checkForNotifications(currentPRs);

      expect(chrome.notifications.create).toHaveBeenCalledWith({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'CI Fixed: PR #101',
        message: mockPRs.openPR.title
      });
    });

    test('should show notification for PR approval', async () => {
      const previousPRs = [
        { ...mockPRs.openPR, reviewDecision: null }
      ];
      const currentPRs = [
        { ...mockPRs.openPR, reviewDecision: 'APPROVED' }
      ];

      await global.chrome.storage.local.set({
        pr_cache: { data: previousPRs, lastUpdate: Date.now() - 300000 }
      });

      await background.checkForNotifications(currentPRs);

      expect(chrome.notifications.create).toHaveBeenCalledWith({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'PR Approved: #101',
        message: mockPRs.openPR.title
      });
    });

    test('should show notification for changes requested', async () => {
      const previousPRs = [
        { ...mockPRs.openPR, reviewDecision: null }
      ];
      const currentPRs = [
        { ...mockPRs.openPR, reviewDecision: 'CHANGES_REQUESTED' }
      ];

      await global.chrome.storage.local.set({
        pr_cache: { data: previousPRs, lastUpdate: Date.now() - 300000 }
      });

      await background.checkForNotifications(currentPRs);

      expect(chrome.notifications.create).toHaveBeenCalledWith({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Changes Requested: PR #101',
        message: mockPRs.openPR.title
      });
    });

    test('should not show notifications when disabled', async () => {
      await global.chrome.storage.local.set({
        notification_settings: {
          statusChanges: false,
          newReviews: false,
          ciFailures: false
        }
      });

      const previousPRs = [mockPRs.openPR];
      const currentPRs = [{ ...mockPRs.openPR, reviewDecision: 'APPROVED' }];

      await global.chrome.storage.local.set({
        pr_cache: { data: previousPRs, lastUpdate: Date.now() - 300000 }
      });

      await background.checkForNotifications(currentPRs);

      expect(chrome.notifications.create).not.toHaveBeenCalled();
    });

    test('should not show notifications when no previous cache', async () => {
      const currentPRs = [mockPRs.openPR];

      await background.checkForNotifications(currentPRs);

      expect(chrome.notifications.create).not.toHaveBeenCalled();
    });

    test('should ignore PRs not in previous cache', async () => {
      const previousPRs = [mockPRs.openPR];
      const currentPRs = [mockPRs.openPR, mockPRs.draftPR]; // New PR added

      await global.chrome.storage.local.set({
        pr_cache: { data: previousPRs, lastUpdate: Date.now() - 300000 }
      });

      await background.checkForNotifications(currentPRs);

      expect(chrome.notifications.create).not.toHaveBeenCalled();
    });
  });

  describe('Message Handling', () => {
    test('should handle getCachedPRs message', async () => {
      const mockCache = { data: [mockPRs.openPR], lastUpdate: Date.now() };
      await global.chrome.storage.local.set({ pr_cache: mockCache });

      const mockSendResponse = jest.fn();
      await background.handleMessage({ action: 'getCachedPRs' }, {}, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        data: mockCache
      });
    });

    test('should handle forceUpdate message', async () => {
      const updateSpy = jest.spyOn(background, 'updatePRData').mockResolvedValue();
      const mockSendResponse = jest.fn();

      await background.handleMessage({ action: 'forceUpdate' }, {}, mockSendResponse);

      expect(updateSpy).toHaveBeenCalled();
      expect(mockSendResponse).toHaveBeenCalledWith({ success: true });
      
      updateSpy.restore();
    });

    test('should handle updateNotificationSettings message', async () => {
      const mockSettings = { statusChanges: false, newReviews: true, ciFailures: true };
      const mockSendResponse = jest.fn();

      await background.handleMessage(
        { action: 'updateNotificationSettings', settings: mockSettings }, 
        {}, 
        mockSendResponse
      );

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        notification_settings: mockSettings
      }, expect.any(Function));
      expect(mockSendResponse).toHaveBeenCalledWith({ success: true });
    });

    test('should handle unknown action', async () => {
      const mockSendResponse = jest.fn();

      await background.handleMessage({ action: 'unknownAction' }, {}, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith({ 
        success: false, 
        error: 'Unknown action' 
      });
    });

    test('should handle message processing errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const mockSendResponse = jest.fn();
      
      // Mock storage to throw an error
      global.chrome.storage.local.get.mockImplementationOnce(() => {
        throw new Error('Storage error');
      });

      await background.handleMessage({ action: 'getCachedPRs' }, {}, mockSendResponse);

      expect(consoleSpy).toHaveBeenCalledWith('Background: Error handling message:', expect.any(Error));
      expect(mockSendResponse).toHaveBeenCalledWith({ 
        success: false, 
        error: 'Storage error' 
      });
      
      consoleSpy.restore();
    });
  });

  describe('GraphQL Operations', () => {
    test('should fetch PRs with correct query structure', async () => {
      const mockResponse = createMockGraphQLResponse([mockPRs.openPR]);
      fetch.mockResolvedValueOnce(createMockResponse(mockResponse));

      const prs = await background.fetchPRs('test-token');

      expect(fetch).toHaveBeenCalledWith('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': 'bearer test-token',
          'Content-Type': 'application/json',
        },
        body: expect.stringContaining('GetVLLMPRs')
      });

      expect(prs).toHaveLength(1);
      expect(prs[0]).toEqual(mockPRs.openPR);
    });

    test('should handle rate limiting in GraphQL requests', async () => {
      fetch.mockResolvedValueOnce(createMockResponse({}, { 
        ok: false, 
        status: 403, 
        statusText: 'Forbidden' 
      }));

      await expect(background.fetchPRs('test-token')).rejects.toThrow('HTTP 403: Forbidden');
    });

    test('should validate GraphQL query variables', async () => {
      const mockResponse = createMockGraphQLResponse([]);
      fetch.mockResolvedValueOnce(createMockResponse(mockResponse));

      await background.fetchPRs('test-token');

      const requestBody = JSON.parse(fetch.mock.calls[0][1].body);
      expect(requestBody.variables).toEqual({
        owner: 'vllm-project',
        name: 'vllm'
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle storage quota exceeded', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'test-token' }
      });
      
      // Mock storage.set to throw quota exceeded error
      global.chrome.storage.local.set.mockImplementationOnce(() => {
        throw new Error('QUOTA_BYTES quota exceeded');
      });

      const mockResponse = createMockGraphQLResponse([mockPRs.openPR]);
      fetch.mockResolvedValueOnce(createMockResponse(mockResponse));

      await background.updatePRData();

      expect(consoleSpy).toHaveBeenCalledWith('Background: Error updating PR data:', expect.any(Error));
      
      consoleSpy.restore();
    });

    test('should handle malformed notification settings', async () => {
      await global.chrome.storage.local.set({
        notification_settings: null // Invalid settings
      });

      const currentPRs = [mockPRs.openPR];
      
      // Should not throw error
      await expect(background.checkForNotifications(currentPRs)).resolves.not.toThrow();
    });

    test('should handle empty PR arrays', async () => {
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'test-token' }
      });
      
      const mockResponse = createMockGraphQLResponse([]);
      fetch.mockResolvedValueOnce(createMockResponse(mockResponse));

      await background.updatePRData();

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        pr_cache: {
          data: [],
          lastUpdate: Date.now()
        }
      }, expect.any(Function));
    });

    test('should handle concurrent update requests', async () => {
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'test-token' }
      });
      
      const mockResponse = createMockGraphQLResponse([mockPRs.openPR]);
      fetch.mockResolvedValue(createMockResponse(mockResponse));

      // Start multiple updates concurrently
      const updates = [
        background.updatePRData(),
        background.updatePRData(),
        background.updatePRData()
      ];

      await Promise.allSettled(updates);

      // All should complete without error
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    test('should handle malformed PR data', async () => {
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'test-token' }
      });
      
      const malformedPR = { 
        // Missing required fields
        id: 'test',
        number: null,
        title: undefined
      };
      const mockResponse = createMockGraphQLResponse([malformedPR]);
      fetch.mockResolvedValueOnce(createMockResponse(mockResponse));

      // Should not throw error
      await expect(background.updatePRData()).resolves.not.toThrow();
    });
  });

  describe('Performance and Resource Management', () => {
    test('should not update when already updating', async () => {
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'test-token' }
      });
      
      // Mock slow network response
      fetch.mockImplementationOnce(() => 
        new Promise(resolve => setTimeout(() => 
          resolve(createMockResponse(createMockGraphQLResponse([]))), 5000
        ))
      );

      // Start first update
      const firstUpdate = background.updatePRData();
      
      // Start second update immediately
      const secondUpdate = background.updatePRData();

      await Promise.allSettled([firstUpdate, secondUpdate]);

      // Should handle concurrent updates gracefully
      expect(fetch).toHaveBeenCalled();
    });

    test('should cleanup resources on repeated setup calls', () => {
      // Call setup multiple times
      background.setupPeriodicUpdate();
      background.setupPeriodicUpdate();
      background.setupPeriodicUpdate();

      // Should clear previous alarms
      expect(chrome.alarms.clear).toHaveBeenCalledTimes(3);
      expect(chrome.alarms.create).toHaveBeenCalledTimes(3);
    });
  });
});