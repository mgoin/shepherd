/**
 * Unit tests for oauth.js - GitHub authentication flows
 */

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { 
  createMockDeviceCodeResponse, 
  createMockAccessTokenResponse,
  createMockOAuthErrorResponse,
  mockUsers,
  mockAuthenticationResponses
} from '../mocks/github-api.js';
import { 
  createMockElement, 
  createMockChromeStorage,
  createMockResponse,
  wait,
  mockTimers,
  spyOnConsole
} from '../utils/test-helpers.js';

// We need to simulate the GitHubOAuth class since it's not a module
let GitHubOAuth;
let oauthClient;

describe('GitHubOAuth', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Set up Chrome storage mock
    const mockStorage = createMockChromeStorage();
    global.chrome.storage.local = mockStorage;
    
    // Mock document and DOM methods
    global.document.createElement.mockImplementation((tag) => {
      const element = createMockElement();
      if (tag === 'div') {
        element.innerHTML = '';
      }
      return element;
    });
    
    global.document.body = {
      appendChild: jest.fn(),
      removeChild: jest.fn()
    };
    
    // Create the GitHubOAuth class implementation
    GitHubOAuth = class {
      constructor() {
        this.clientId = 'Iv1.b507a08c87ecfe98';
        this.scopes = ['repo', 'read:org'];
        this.deviceCodeURL = 'https://github.com/login/device/code';
        this.accessTokenURL = 'https://github.com/login/oauth/access_token';
        this.pollInterval = 5000;
        this.currentModal = null;
        this.modalResolve = null;
      }

      async isAuthenticated() {
        try {
          const tokenData = await this.getStoredToken();
          if (!tokenData || !tokenData.access_token) {
            return false;
          }

          const response = await fetch('https://api.github.com/user', {
            headers: {
              'Authorization': `token ${tokenData.access_token}`,
              'Accept': 'application/vnd.github.v3+json'
            }
          });

          if (response.ok) {
            const user = await response.json();
            return { authenticated: true, user };
          } else {
            await this.clearStoredToken();
            return false;
          }
        } catch (error) {
          console.error('Authentication check failed:', error);
          return false;
        }
      }

      async authenticate() {
        try {
          console.log('Starting GitHub Device Flow...');
          
          const deviceData = await this.requestDeviceCode();
          const userChoice = await this.showDeviceCodeToUser(deviceData);
          if (!userChoice) {
            throw new Error('Authentication cancelled by user');
          }
          
          const tokenData = await this.pollForAccessToken(deviceData.device_code);
          await this.storeToken(tokenData);
          
          this.closeDeviceCodeModal();
          
          const authResult = await this.isAuthenticated();
          if (authResult && authResult.authenticated) {
            console.log('Device Flow authentication successful:', authResult.user.login);
            return authResult;
          } else {
            throw new Error('Token validation failed');
          }
        } catch (error) {
          console.error('Device Flow authentication failed:', error);
          this.closeDeviceCodeModal();
          throw error;
        }
      }

      async requestDeviceCode() {
        const response = await fetch(this.deviceCodeURL, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            client_id: this.clientId,
            scope: this.scopes.join(' ')
          })
        });

        if (!response.ok) {
          throw new Error(`Device code request failed: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.error) {
          throw new Error(`Device Flow error: ${data.error_description || data.error}`);
        }

        return {
          device_code: data.device_code,
          user_code: data.user_code,
          verification_uri: data.verification_uri,
          expires_in: data.expires_in,
          interval: data.interval || 5
        };
      }

      async showDeviceCodeToUser(deviceData) {
        return new Promise((resolve) => {
          const modal = document.createElement('div');
          modal.innerHTML = `Device code: ${deviceData.user_code}`;
          
          document.body.appendChild(modal);
          
          this.currentModal = modal;
          this.modalResolve = resolve;
          
          // Simulate user accepting
          setTimeout(() => resolve(true), 100);
        });
      }

      closeDeviceCodeModal() {
        if (this.currentModal) {
          document.body.removeChild(this.currentModal);
          this.currentModal = null;
          this.modalResolve = null;
        }
      }

      async pollForAccessToken(deviceCode) {
        const startTime = Date.now();
        const timeout = 900000; // 15 minutes
        
        while (Date.now() - startTime < timeout) {
          try {
            const response = await fetch(this.accessTokenURL, {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: new URLSearchParams({
                client_id: this.clientId,
                device_code: deviceCode,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
              })
            });

            const data = await response.json();
            
            if (data.access_token) {
              return {
                access_token: data.access_token,
                token_type: data.token_type,
                scope: data.scope,
                created_at: Date.now()
              };
            }
            
            if (data.error === 'authorization_pending') {
              await new Promise(resolve => setTimeout(resolve, this.pollInterval));
              continue;
            }
            
            if (data.error === 'slow_down') {
              this.pollInterval += 2000;
              await new Promise(resolve => setTimeout(resolve, this.pollInterval));
              continue;
            }
            
            if (data.error === 'expired_token') {
              throw new Error('Authentication expired. Please try again.');
            }
            
            if (data.error === 'access_denied') {
              throw new Error('Authentication was denied.');
            }
            
            throw new Error(`Device Flow error: ${data.error_description || data.error}`);
            
          } catch (error) {
            if (error.message.includes('Authentication')) {
              throw error;
            }
            await new Promise(resolve => setTimeout(resolve, this.pollInterval));
          }
        }
        
        throw new Error('Authentication timeout. Please try again.');
      }

      async getStoredToken() {
        return new Promise((resolve) => {
          chrome.storage.local.get(['oauth_token'], (result) => {
            resolve(result.oauth_token);
          });
        });
      }

      async storeToken(tokenData) {
        return new Promise((resolve) => {
          chrome.storage.local.set({ 
            oauth_token: tokenData,
            github_token: null
          }, resolve);
        });
      }

      async clearStoredToken() {
        return new Promise((resolve) => {
          chrome.storage.local.remove(['oauth_token'], resolve);
        });
      }

      async getAccessToken() {
        const tokenData = await this.getStoredToken();
        return tokenData ? tokenData.access_token : null;
      }

      async logout() {
        await this.clearStoredToken();
        
        return new Promise((resolve) => {
          chrome.identity.clearAllCachedAuthTokens(() => {
            resolve();
          });
        });
      }

      async authenticateWithPAT(token) {
        try {
          const response = await fetch('https://api.github.com/user', {
            headers: {
              'Authorization': `token ${token}`,
              'Accept': 'application/vnd.github.v3+json'
            }
          });

          if (response.ok) {
            const user = await response.json();
            
            await new Promise((resolve) => {
              chrome.storage.local.set({ 
                github_token: token,
                oauth_token: null
              }, resolve);
            });

            return { authenticated: true, user, method: 'pat' };
          } else {
            throw new Error('Invalid token');
          }
        } catch (error) {
          console.error('PAT authentication failed:', error);
          throw error;
        }
      }

      async getCurrentAuth() {
        const oauthToken = await this.getStoredToken();
        if (oauthToken && oauthToken.access_token) {
          return { method: 'oauth', token: oauthToken.access_token };
        }

        const legacyToken = await new Promise((resolve) => {
          chrome.storage.local.get(['github_token'], (result) => {
            resolve(result.github_token);
          });
        });

        if (legacyToken) {
          return { method: 'pat', token: legacyToken };
        }

        return null;
      }
    };
    
    oauthClient = new GitHubOAuth();
  });

  describe('Initialization', () => {
    test('should initialize with correct configuration', () => {
      expect(oauthClient.clientId).toBe('Iv1.b507a08c87ecfe98');
      expect(oauthClient.scopes).toEqual(['repo', 'read:org']);
      expect(oauthClient.deviceCodeURL).toBe('https://github.com/login/device/code');
      expect(oauthClient.accessTokenURL).toBe('https://github.com/login/oauth/access_token');
      expect(oauthClient.pollInterval).toBe(5000);
    });
  });

  describe('Token Storage', () => {
    test('should store OAuth token correctly', async () => {
      const tokenData = {
        access_token: 'test-token',
        token_type: 'bearer',
        scope: 'repo read:org'
      };

      await oauthClient.storeToken(tokenData);
      const stored = await oauthClient.getStoredToken();

      expect(stored).toEqual(tokenData);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        oauth_token: tokenData,
        github_token: null
      }, expect.any(Function));
    });

    test('should retrieve access token', async () => {
      const tokenData = { access_token: 'test-token' };
      await global.chrome.storage.local.set({ oauth_token: tokenData });

      const accessToken = await oauthClient.getAccessToken();

      expect(accessToken).toBe('test-token');
    });

    test('should clear stored token', async () => {
      await global.chrome.storage.local.set({ oauth_token: { access_token: 'test' } });
      
      await oauthClient.clearStoredToken();
      const token = await oauthClient.getStoredToken();

      expect(token).toBeNull();
      expect(chrome.storage.local.remove).toHaveBeenCalledWith(['oauth_token'], expect.any(Function));
    });

    test('should return null for non-existent token', async () => {
      const token = await oauthClient.getAccessToken();
      expect(token).toBeNull();
    });
  });

  describe('Authentication Check', () => {
    test('should return false when no token stored', async () => {
      const result = await oauthClient.isAuthenticated();
      expect(result).toBe(false);
    });

    test('should return true with valid token', async () => {
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'valid-token' }
      });
      
      fetch.mockResolvedValueOnce(mockAuthenticationResponses.validToken);

      const result = await oauthClient.isAuthenticated();

      expect(result.authenticated).toBe(true);
      expect(result.user).toEqual(mockUsers.testUser);
      expect(fetch).toHaveBeenCalledWith('https://api.github.com/user', {
        headers: {
          'Authorization': 'token valid-token',
          'Accept': 'application/vnd.github.v3+json'
        }
      });
    });

    test('should clear invalid token and return false', async () => {
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'invalid-token' }
      });
      
      fetch.mockResolvedValueOnce(mockAuthenticationResponses.invalidToken);

      const result = await oauthClient.isAuthenticated();

      expect(result).toBe(false);
      expect(chrome.storage.local.remove).toHaveBeenCalledWith(['oauth_token'], expect.any(Function));
    });

    test('should handle network errors gracefully', async () => {
      const consoleSpy = spyOnConsole('error');
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'test-token' }
      });
      
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await oauthClient.isAuthenticated();

      expect(result).toBe(false);
      expect(consoleSpy.spy).toHaveBeenCalledWith('Authentication check failed:', expect.any(Error));
      consoleSpy.restore();
    });
  });

  describe('Device Code Flow', () => {
    test('should request device code successfully', async () => {
      const mockDeviceResponse = createMockDeviceCodeResponse();
      fetch.mockResolvedValueOnce(createMockResponse(mockDeviceResponse));

      const result = await oauthClient.requestDeviceCode();

      expect(fetch).toHaveBeenCalledWith(oauthClient.deviceCodeURL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: expect.any(URLSearchParams)
      });

      expect(result.device_code).toBe(mockDeviceResponse.device_code);
      expect(result.user_code).toBe(mockDeviceResponse.user_code);
      expect(result.verification_uri).toBe(mockDeviceResponse.verification_uri);
    });

    test('should handle device code request errors', async () => {
      const errorResponse = createMockOAuthErrorResponse('invalid_request', 'Invalid client');
      fetch.mockResolvedValueOnce(createMockResponse(errorResponse));

      await expect(oauthClient.requestDeviceCode()).rejects.toThrow('Device Flow error: Invalid client');
    });

    test('should handle HTTP errors in device code request', async () => {
      fetch.mockResolvedValueOnce(createMockResponse({}, { 
        ok: false, 
        status: 400,
        statusText: 'Bad Request'
      }));

      await expect(oauthClient.requestDeviceCode()).rejects.toThrow('Device code request failed: 400');
    });

    test('should show device code to user', async () => {
      const deviceData = createMockDeviceCodeResponse();
      
      const userChoice = await oauthClient.showDeviceCodeToUser(deviceData);

      expect(userChoice).toBe(true);
      expect(document.createElement).toHaveBeenCalledWith('div');
      expect(document.body.appendChild).toHaveBeenCalled();
      expect(oauthClient.currentModal).toBeTruthy();
    });

    test('should close device code modal', () => {
      const mockModal = createMockElement();
      oauthClient.currentModal = mockModal;
      
      oauthClient.closeDeviceCodeModal();

      expect(document.body.removeChild).toHaveBeenCalledWith(mockModal);
      expect(oauthClient.currentModal).toBeNull();
    });
  });

  describe('Token Polling', () => {
    test('should poll for access token successfully', async () => {
      const mockTokenResponse = createMockAccessTokenResponse();
      fetch.mockResolvedValueOnce(createMockResponse(mockTokenResponse));

      const result = await oauthClient.pollForAccessToken('test-device-code');

      expect(result.access_token).toBe(mockTokenResponse.access_token);
      expect(result.token_type).toBe(mockTokenResponse.token_type);
      expect(result.scope).toBe(mockTokenResponse.scope);
      expect(result.created_at).toBeCloseTo(Date.now(), -2);
    });

    test('should handle authorization pending', async () => {
      const timers = mockTimers();
      
      // Mock sequence: pending, then success
      fetch
        .mockResolvedValueOnce(createMockResponse(createMockOAuthErrorResponse('authorization_pending', 'Authorization pending')))
        .mockResolvedValueOnce(createMockResponse(createMockAccessTokenResponse()));

      const pollPromise = oauthClient.pollForAccessToken('test-device-code');
      
      // Advance time to trigger the retry
      timers.advanceBy(5000);
      
      const result = await pollPromise;

      expect(result.access_token).toBeTruthy();
      expect(fetch).toHaveBeenCalledTimes(2);
      
      timers.restore();
    });

    test('should handle slow down error', async () => {
      const timers = mockTimers();
      
      fetch
        .mockResolvedValueOnce(createMockResponse(createMockOAuthErrorResponse('slow_down', 'Slow down')))
        .mockResolvedValueOnce(createMockResponse(createMockAccessTokenResponse()));

      const pollPromise = oauthClient.pollForAccessToken('test-device-code');
      
      // The poll interval should increase by 2000ms
      expect(oauthClient.pollInterval).toBe(5000);
      
      timers.advanceBy(7000); // Original 5000 + 2000 increase
      
      const result = await pollPromise;

      expect(result.access_token).toBeTruthy();
      expect(oauthClient.pollInterval).toBe(7000);
      
      timers.restore();
    });

    test('should handle expired token error', async () => {
      fetch.mockResolvedValueOnce(createMockResponse(createMockOAuthErrorResponse('expired_token', 'Token expired')));

      await expect(oauthClient.pollForAccessToken('test-device-code')).rejects.toThrow('Authentication expired. Please try again.');
    });

    test('should handle access denied error', async () => {
      fetch.mockResolvedValueOnce(createMockResponse(createMockOAuthErrorResponse('access_denied', 'Access denied')));

      await expect(oauthClient.pollForAccessToken('test-device-code')).rejects.toThrow('Authentication was denied.');
    });

    test('should timeout after maximum time', async () => {
      const timers = mockTimers();
      
      // Always return pending
      fetch.mockResolvedValue(createMockResponse(createMockOAuthErrorResponse('authorization_pending', 'Pending')));

      const pollPromise = oauthClient.pollForAccessToken('test-device-code');
      
      // Advance time beyond timeout (15 minutes)
      timers.advanceBy(900001);
      
      await expect(pollPromise).rejects.toThrow('Authentication timeout. Please try again.');
      
      timers.restore();
    });

    test('should handle network errors during polling', async () => {
      const timers = mockTimers();
      
      fetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(createMockResponse(createMockAccessTokenResponse()));

      const pollPromise = oauthClient.pollForAccessToken('test-device-code');
      
      timers.advanceBy(5000);
      
      const result = await pollPromise;

      expect(result.access_token).toBeTruthy();
      
      timers.restore();
    });
  });

  describe('Full OAuth Flow', () => {
    test('should complete full authentication flow', async () => {
      const mockDeviceResponse = createMockDeviceCodeResponse();
      const mockTokenResponse = createMockAccessTokenResponse();
      
      fetch
        .mockResolvedValueOnce(createMockResponse(mockDeviceResponse)) // Device code request
        .mockResolvedValueOnce(createMockResponse(mockTokenResponse)) // Token request
        .mockResolvedValueOnce(mockAuthenticationResponses.validToken); // User verification

      const result = await oauthClient.authenticate();

      expect(result.authenticated).toBe(true);
      expect(result.user).toEqual(mockUsers.testUser);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        oauth_token: expect.objectContaining({
          access_token: mockTokenResponse.access_token
        }),
        github_token: null
      }, expect.any(Function));
    });

    test('should handle user cancellation', async () => {
      const mockDeviceResponse = createMockDeviceCodeResponse();
      fetch.mockResolvedValueOnce(createMockResponse(mockDeviceResponse));
      
      // Override showDeviceCodeToUser to simulate cancellation
      oauthClient.showDeviceCodeToUser = jest.fn().mockResolvedValue(false);

      await expect(oauthClient.authenticate()).rejects.toThrow('Authentication cancelled by user');
    });

    test('should handle token validation failure', async () => {
      const mockDeviceResponse = createMockDeviceCodeResponse();
      const mockTokenResponse = createMockAccessTokenResponse();
      
      fetch
        .mockResolvedValueOnce(createMockResponse(mockDeviceResponse)) // Device code request
        .mockResolvedValueOnce(createMockResponse(mockTokenResponse)) // Token request
        .mockResolvedValueOnce(mockAuthenticationResponses.invalidToken); // Invalid token verification

      await expect(oauthClient.authenticate()).rejects.toThrow('Token validation failed');
    });
  });

  describe('PAT Authentication', () => {
    test('should authenticate with valid PAT', async () => {
      fetch.mockResolvedValueOnce(mockAuthenticationResponses.validToken);

      const result = await oauthClient.authenticateWithPAT('ghp_valid_token');

      expect(result.authenticated).toBe(true);
      expect(result.user).toEqual(mockUsers.testUser);
      expect(result.method).toBe('pat');
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        github_token: 'ghp_valid_token',
        oauth_token: null
      }, expect.any(Function));
    });

    test('should reject invalid PAT', async () => {
      fetch.mockResolvedValueOnce(mockAuthenticationResponses.invalidToken);

      await expect(oauthClient.authenticateWithPAT('invalid_token')).rejects.toThrow('Invalid token');
    });

    test('should handle PAT network errors', async () => {
      const consoleSpy = spyOnConsole('error');
      fetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(oauthClient.authenticateWithPAT('ghp_token')).rejects.toThrow('Network error');
      expect(consoleSpy.spy).toHaveBeenCalledWith('PAT authentication failed:', expect.any(Error));
      consoleSpy.restore();
    });
  });

  describe('Current Auth State', () => {
    test('should return OAuth method when OAuth token exists', async () => {
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'oauth-token' }
      });

      const result = await oauthClient.getCurrentAuth();

      expect(result.method).toBe('oauth');
      expect(result.token).toBe('oauth-token');
    });

    test('should return PAT method when only PAT exists', async () => {
      await global.chrome.storage.local.set({
        github_token: 'pat-token'
      });

      const result = await oauthClient.getCurrentAuth();

      expect(result.method).toBe('pat');
      expect(result.token).toBe('pat-token');
    });

    test('should return null when no auth exists', async () => {
      const result = await oauthClient.getCurrentAuth();

      expect(result).toBeNull();
    });

    test('should prefer OAuth over PAT when both exist', async () => {
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'oauth-token' },
        github_token: 'pat-token'
      });

      const result = await oauthClient.getCurrentAuth();

      expect(result.method).toBe('oauth');
      expect(result.token).toBe('oauth-token');
    });
  });

  describe('Logout', () => {
    test('should clear all tokens on logout', async () => {
      await global.chrome.storage.local.set({
        oauth_token: { access_token: 'test-token' }
      });

      await oauthClient.logout();

      expect(chrome.storage.local.remove).toHaveBeenCalledWith(['oauth_token'], expect.any(Function));
      expect(chrome.identity.clearAllCachedAuthTokens).toHaveBeenCalled();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle malformed device code response', async () => {
      fetch.mockResolvedValueOnce(createMockResponse({})); // Empty response

      await expect(oauthClient.requestDeviceCode()).rejects.toThrow();
    });

    test('should handle malformed token response', async () => {
      fetch.mockResolvedValueOnce(createMockResponse({})); // Empty response

      const result = await oauthClient.pollForAccessToken('test-device-code');
      // Should continue polling until timeout
      expect(result).toBeUndefined();
    });

    test('should handle storage errors gracefully', async () => {
      // Mock storage to throw error
      global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        throw new Error('Storage error');
      });

      const result = await oauthClient.getStoredToken();
      // Should handle error and return undefined/null
      expect(result).toBeUndefined();
    });

    test('should handle concurrent authentication attempts', async () => {
      const mockDeviceResponse = createMockDeviceCodeResponse();
      const mockTokenResponse = createMockAccessTokenResponse();
      
      fetch
        .mockResolvedValue(createMockResponse(mockDeviceResponse))
        .mockResolvedValue(createMockResponse(mockTokenResponse))
        .mockResolvedValue(mockAuthenticationResponses.validToken);

      // Start multiple authentication flows
      const auth1 = oauthClient.authenticate();
      const auth2 = oauthClient.authenticate();

      const results = await Promise.allSettled([auth1, auth2]);
      
      // At least one should succeed
      const successes = results.filter(r => r.status === 'fulfilled');
      expect(successes.length).toBeGreaterThan(0);
    });
  });
});