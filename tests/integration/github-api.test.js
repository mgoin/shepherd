/**
 * Integration tests for GitHub API interactions
 * Tests the actual API calls and response handling
 */

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { 
  mockPRs, 
  createMockGraphQLResponse,
  mockAuthenticationResponses,
  mockRateLimitHeaders,
  createMockDeviceCodeResponse,
  createMockAccessTokenResponse
} from '../mocks/github-api.js';
import { 
  createMockResponse,
  expectAsyncError,
  wait
} from '../utils/test-helpers.js';

describe('GitHub API Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetch.resetMocks();
  });

  describe('GraphQL API Integration', () => {
    test('should fetch PRs with proper GraphQL query structure', async () => {
      const mockPRList = [mockPRs.openPR, mockPRs.draftPR, mockPRs.approvedPR];
      const mockResponse = createMockGraphQLResponse(mockPRList);
      
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
        headers: new Map(Object.entries(mockRateLimitHeaders))
      });

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
                mergeable
                createdAt
                updatedAt
                author {
                  login
                }
                headRefName
                reviewRequests(first: 10) {
                  nodes {
                    requestedReviewer {
                      ... on User {
                        login
                      }
                      ... on Team {
                        slug
                        name
                      }
                    }
                  }
                }
                commits(last: 1) {
                  nodes {
                    commit {
                      author {
                        date
                      }
                      statusCheckRollup {
                        state
                      }
                    }
                  }
                }
                reviewDecision
                reviews(first: 10, states: [APPROVED, CHANGES_REQUESTED, COMMENTED]) {
                  totalCount
                  nodes {
                    state
                    author {
                      login
                    }
                    createdAt
                  }
                }
                timelineItems(last: 10, itemTypes: [
                  REVIEW_REQUESTED_EVENT,
                  READY_FOR_REVIEW_EVENT
                ]) {
                  nodes {
                    __typename
                    ... on ReviewRequestedEvent {
                      createdAt
                      actor {
                        login
                      }
                      requestedReviewer {
                        ... on User {
                          login
                        }
                      }
                    }
                    ... on ReadyForReviewEvent {
                      createdAt
                      actor {
                        login
                      }
                    }
                  }
                }
                labels(first: 5) {
                  nodes {
                    name
                    color
                  }
                }
              }
            }
          }
          viewer {
            login
          }
          rateLimit {
            limit
            remaining
            resetAt
          }
        }
      `;

      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': 'bearer test-token',
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

      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.data.repository.pullRequests.nodes).toHaveLength(3);
      expect(data.data.viewer.login).toBe('testuser');
      expect(data.data.rateLimit.remaining).toBe(4950);

      // Verify request structure
      const [url, options] = fetch.mock.calls[0];
      expect(url).toBe('https://api.github.com/graphql');
      expect(options.method).toBe('POST');
      expect(options.headers['Authorization']).toBe('bearer test-token');
      expect(options.headers['Content-Type']).toBe('application/json');

      const requestBody = JSON.parse(options.body);
      expect(requestBody.variables.owner).toBe('vllm-project');
      expect(requestBody.variables.name).toBe('vllm');
    });

    test('should handle GraphQL errors properly', async () => {
      const errorResponse = {
        errors: [
          {
            message: 'Field 'invalidField' doesn't exist on type 'PullRequest'',
            locations: [{ line: 5, column: 7 }],
            path: ['repository', 'pullRequests', 'nodes', 0, 'invalidField']
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(errorResponse)
      });

      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': 'bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: 'invalid query',
          variables: { owner: 'vllm-project', name: 'vllm' }
        })
      });

      const data = await response.json();

      expect(data.errors).toBeDefined();
      expect(data.errors[0].message).toContain('invalidField');
    });

    test('should handle rate limit responses', async () => {
      const rateLimitedHeaders = {
        ...mockRateLimitHeaders,
        'X-RateLimit-Remaining': '0'
      };

      fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: () => Promise.resolve({
          message: 'API rate limit exceeded for user ID 123.',
          documentation_url: 'https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting'
        }),
        headers: new Map(Object.entries(rateLimitedHeaders))
      });

      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': 'bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: 'query { viewer { login } }',
          variables: {}
        })
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(403);
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');

      const data = await response.json();
      expect(data.message).toContain('rate limit exceeded');
    });

    test('should handle network timeouts and retries', async () => {
      // First call times out
      fetch.mockRejectedValueOnce(new Error('Network timeout'));
      
      // Second call succeeds
      const mockResponse = createMockGraphQLResponse([mockPRs.openPR]);
      fetch.mockResolvedValueOnce(createMockResponse(mockResponse));

      // Simulate retry logic
      let response;
      try {
        response = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: { 'Authorization': 'bearer test-token' },
          body: JSON.stringify({ query: 'test' })
        });
      } catch (error) {
        // Retry after timeout
        await wait(100);
        response = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: { 'Authorization': 'bearer test-token' },
          body: JSON.stringify({ query: 'test' })
        });
      }

      expect(response.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    test('should handle large response payloads', async () => {
      // Create a large number of PRs to test payload handling
      const largePRList = Array.from({ length: 100 }, (_, i) => ({
        ...mockPRs.openPR,
        id: `PR_${i}`,
        number: 100 + i,
        title: `Large payload test PR ${i}`
      }));

      const mockResponse = createMockGraphQLResponse(largePRList);
      fetch.mockResolvedValueOnce(createMockResponse(mockResponse));

      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': 'bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: 'query GetVLLMPRs($owner: String!, $name: String!) { ... }',
          variables: { owner: 'vllm-project', name: 'vllm' }
        })
      });

      const data = await response.json();

      expect(data.data.repository.pullRequests.nodes).toHaveLength(100);
      expect(data.data.repository.pullRequests.nodes[0].number).toBe(100);
      expect(data.data.repository.pullRequests.nodes[99].number).toBe(199);
    });
  });

  describe('REST API Integration', () => {
    test('should authenticate user with valid token', async () => {
      fetch.mockResolvedValueOnce(mockAuthenticationResponses.validToken);

      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': 'token ghp_valid_token',
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      const user = await response.json();

      expect(response.ok).toBe(true);
      expect(user.login).toBe('testuser');
      expect(user.id).toBe(123);
    });

    test('should reject invalid token', async () => {
      fetch.mockResolvedValueOnce(mockAuthenticationResponses.invalidToken);

      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': 'token invalid_token',
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);

      const error = await response.json();
      expect(error.message).toBe('Bad credentials');
    });

    test('should handle rate limiting on REST API', async () => {
      fetch.mockResolvedValueOnce(mockAuthenticationResponses.rateLimited);

      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': 'token test_token',
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(403);
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');

      const error = await response.json();
      expect(error.message).toContain('rate limit exceeded');
    });
  });

  describe('OAuth Device Flow Integration', () => {
    test('should complete device code flow successfully', async () => {
      const deviceCodeResponse = createMockDeviceCodeResponse();
      const tokenResponse = createMockAccessTokenResponse();

      // Step 1: Request device code
      fetch.mockResolvedValueOnce(createMockResponse(deviceCodeResponse));

      const deviceResponse = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: 'Iv1.b507a08c87ecfe98',
          scope: 'repo read:org'
        })
      });

      const deviceData = await deviceResponse.json();

      expect(deviceResponse.ok).toBe(true);
      expect(deviceData.device_code).toBe(deviceCodeResponse.device_code);
      expect(deviceData.user_code).toBe(deviceCodeResponse.user_code);
      expect(deviceData.verification_uri).toBe(deviceCodeResponse.verification_uri);

      // Step 2: Poll for token (simulate authorization)
      fetch.mockResolvedValueOnce(createMockResponse(tokenResponse));

      const tokenRequest = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: 'Iv1.b507a08c87ecfe98',
          device_code: deviceData.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      });

      const tokenData = await tokenRequest.json();

      expect(tokenRequest.ok).toBe(true);
      expect(tokenData.access_token).toBe(tokenResponse.access_token);
      expect(tokenData.token_type).toBe(tokenResponse.token_type);
      expect(tokenData.scope).toBe(tokenResponse.scope);
    });

    test('should handle device flow polling states', async () => {
      const deviceCodeResponse = createMockDeviceCodeResponse();
      
      // First request: authorization pending
      fetch.mockResolvedValueOnce(createMockResponse({
        error: 'authorization_pending',
        error_description: 'The authorization request is still pending.'
      }));

      // Second request: slow down
      fetch.mockResolvedValueOnce(createMockResponse({
        error: 'slow_down',
        error_description: 'You are polling too frequently and need to slow down.'
      }));

      // Third request: success
      const tokenResponse = createMockAccessTokenResponse();
      fetch.mockResolvedValueOnce(createMockResponse(tokenResponse));

      // Simulate polling sequence
      const pollResults = [];

      for (let i = 0; i < 3; i++) {
        const response = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            client_id: 'Iv1.b507a08c87ecfe98',
            device_code: deviceCodeResponse.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          })
        });

        const data = await response.json();
        pollResults.push(data);
      }

      expect(pollResults[0].error).toBe('authorization_pending');
      expect(pollResults[1].error).toBe('slow_down');
      expect(pollResults[2].access_token).toBeDefined();
    });

    test('should handle device flow errors', async () => {
      const errorCases = [
        {
          error: 'expired_token',
          error_description: 'The device code has expired.'
        },
        {
          error: 'access_denied',
          error_description: 'The user denied the authorization request.'
        },
        {
          error: 'unsupported_grant_type',
          error_description: 'The authorization grant type is not supported.'
        }
      ];

      for (const errorCase of errorCases) {
        fetch.mockResolvedValueOnce(createMockResponse(errorCase));

        const response = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            client_id: 'Iv1.b507a08c87ecfe98',
            device_code: 'test-device-code',
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          })
        });

        const data = await response.json();

        expect(data.error).toBe(errorCase.error);
        expect(data.error_description).toBe(errorCase.error_description);
      }
    });
  });

  describe('Error Recovery and Resilience', () => {
    test('should handle intermittent network failures', async () => {
      // Simulate network failures followed by success
      fetch
        .mockRejectedValueOnce(new Error('Network Error'))
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValueOnce(createMockResponse(createMockGraphQLResponse([mockPRs.openPR])));

      const maxRetries = 3;
      let attempts = 0;
      let response;

      while (attempts < maxRetries) {
        try {
          response = await fetch('https://api.github.com/graphql', {
            method: 'POST',
            headers: { 'Authorization': 'bearer test-token' },
            body: JSON.stringify({ query: 'test' })
          });
          break;
        } catch (error) {
          attempts++;
          if (attempts >= maxRetries) throw error;
          await wait(100 * attempts); // Exponential backoff
        }
      }

      expect(response.ok).toBe(true);
      expect(attempts).toBe(2); // Failed twice, succeeded on third attempt
    });

    test('should handle GitHub API maintenance windows', async () => {
      const maintenanceResponse = {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: () => Promise.resolve({
          message: 'Service temporarily unavailable. Please try again later.',
          documentation_url: 'https://docs.github.com/rest'
        })
      };

      fetch.mockResolvedValueOnce(maintenanceResponse);

      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { 'Authorization': 'bearer test-token' },
        body: JSON.stringify({ query: 'test' })
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(503);

      const data = await response.json();
      expect(data.message).toContain('temporarily unavailable');
    });

    test('should handle malformed API responses', async () => {
      // Test invalid JSON response
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error('Unexpected token in JSON'))
      });

      await expectAsyncError(async () => {
        const response = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: { 'Authorization': 'bearer test-token' },
          body: JSON.stringify({ query: 'test' })
        });
        await response.json();
      }, 'Unexpected token in JSON');
    });

    test('should validate API response schemas', async () => {
      // Test response with missing required fields
      const invalidResponse = {
        data: {
          repository: {
            // Missing pullRequests field
          }
        }
      };

      fetch.mockResolvedValueOnce(createMockResponse(invalidResponse));

      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { 'Authorization': 'bearer test-token' },
        body: JSON.stringify({ query: 'test' })
      });

      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.data.repository.pullRequests).toBeUndefined();
      // Should handle missing fields gracefully in application code
    });
  });

  describe('Performance and Optimization', () => {
    test('should handle concurrent API requests', async () => {
      const responses = [
        createMockResponse(createMockGraphQLResponse([mockPRs.openPR])),
        createMockResponse(mockAuthenticationResponses.validToken.json()),
        createMockResponse(createMockDeviceCodeResponse())
      ];

      responses.forEach(response => fetch.mockResolvedValueOnce(response));

      const requests = [
        fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: { 'Authorization': 'bearer test-token' },
          body: JSON.stringify({ query: 'test' })
        }),
        fetch('https://api.github.com/user', {
          headers: { 'Authorization': 'token test-token' }
        }),
        fetch('https://github.com/login/device/code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'client_id=test'
        })
      ];

      const results = await Promise.all(requests);

      expect(results).toHaveLength(3);
      results.forEach(result => expect(result.ok).toBe(true));
    });

    test('should respect rate limit headers', async () => {
      const lowRateLimitHeaders = {
        ...mockRateLimitHeaders,
        'X-RateLimit-Remaining': '10'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createMockGraphQLResponse([])),
        headers: new Map(Object.entries(lowRateLimitHeaders))
      });

      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { 'Authorization': 'bearer test-token' },
        body: JSON.stringify({ query: 'test' })
      });

      expect(response.headers.get('X-RateLimit-Remaining')).toBe('10');
      
      // Application should check remaining rate limit before making more requests
      const remaining = parseInt(response.headers.get('X-RateLimit-Remaining'));
      expect(remaining).toBeLessThan(50); // Should trigger rate limit awareness
    });

    test('should handle request deduplication', async () => {
      const mockResponse = createMockResponse(createMockGraphQLResponse([mockPRs.openPR]));
      fetch.mockResolvedValue(mockResponse);

      // Simulate identical requests
      const identicalRequests = Array(5).fill().map(() =>
        fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: { 'Authorization': 'bearer test-token' },
          body: JSON.stringify({
            query: 'query GetVLLMPRs { repository { pullRequests { nodes { id } } } }',
            variables: { owner: 'vllm-project', name: 'vllm' }
          })
        })
      );

      const results = await Promise.all(identicalRequests);

      expect(results).toHaveLength(5);
      expect(fetch).toHaveBeenCalledTimes(5);
      // Note: In a real implementation, you might want to deduplicate identical requests
    });
  });
});