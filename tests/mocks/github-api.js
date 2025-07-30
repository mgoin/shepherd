/**
 * Mock data and utilities for GitHub API responses
 */

export const mockUsers = {
  testUser: {
    login: 'testuser',
    id: 123,
    name: 'Test User',
    email: 'test@example.com',
    avatar_url: 'https://github.com/testuser.png'
  },
  reviewer: {
    login: 'reviewer',
    id: 456,
    name: 'Code Reviewer'
  },
  author: {
    login: 'prauthor',
    id: 789,
    name: 'PR Author'
  }
};

export const mockTeams = {
  coreTeam: {
    slug: 'core-team',
    name: 'Core Team'
  },
  reviewTeam: {
    slug: 'review-team',
    name: 'Review Team'
  }
};

export const mockLabels = [
  { name: 'bug', color: 'ff0000' },
  { name: 'enhancement', color: '00ff00' },
  { name: 'documentation', color: '0000ff' },
  { name: 'ready-for-review', color: 'ffff00' }
];

export const mockPRs = {
  // Standard open PR
  openPR: {
    id: 'PR_1',
    number: 101,
    title: 'Add new feature for better performance',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    createdAt: '2023-12-01T10:00:00Z',
    updatedAt: '2023-12-01T15:30:00Z',
    author: mockUsers.author,
    headRefName: 'feature/performance-improvement',
    reviewRequests: {
      nodes: [
        {
          requestedReviewer: mockUsers.testUser
        }
      ]
    },
    commits: {
      nodes: [{
        commit: {
          author: { date: '2023-12-01T14:00:00Z' },
          statusCheckRollup: { state: 'SUCCESS' }
        }
      }]
    },
    reviewDecision: null,
    reviews: {
      totalCount: 1,
      nodes: [
        {
          state: 'COMMENTED',
          author: mockUsers.reviewer,
          createdAt: '2023-12-01T12:00:00Z'
        }
      ]
    },
    timelineItems: {
      nodes: [
        {
          __typename: 'ReviewRequestedEvent',
          createdAt: '2023-12-01T11:00:00Z',
          actor: mockUsers.author,
          requestedReviewer: mockUsers.testUser
        }
      ]
    },
    labels: {
      nodes: [mockLabels[1]] // enhancement
    }
  },

  // Draft PR
  draftPR: {
    id: 'PR_2',
    number: 102,
    title: 'WIP: Experimental feature',
    state: 'OPEN',
    isDraft: true,
    mergeable: 'MERGEABLE',
    createdAt: '2023-12-02T09:00:00Z',
    updatedAt: '2023-12-02T16:45:00Z',
    author: mockUsers.author,
    headRefName: 'wip/experimental',
    reviewRequests: { nodes: [] },
    commits: {
      nodes: [{
        commit: {
          author: { date: '2023-12-02T16:00:00Z' },
          statusCheckRollup: { state: 'PENDING' }
        }
      }]
    },
    reviewDecision: null,
    reviews: { totalCount: 0, nodes: [] },
    timelineItems: { nodes: [] },
    labels: { nodes: [] }
  },

  // Approved PR
  approvedPR: {
    id: 'PR_3',
    number: 103,
    title: 'Fix critical bug in authentication',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    createdAt: '2023-12-03T08:00:00Z',
    updatedAt: '2023-12-03T17:20:00Z',
    author: mockUsers.author,
    headRefName: 'fix/auth-bug',
    reviewRequests: { nodes: [] },
    commits: {
      nodes: [{
        commit: {
          author: { date: '2023-12-03T16:00:00Z' },
          statusCheckRollup: { state: 'SUCCESS' }
        }
      }]
    },
    reviewDecision: 'APPROVED',
    reviews: {
      totalCount: 2,
      nodes: [
        {
          state: 'APPROVED',
          author: mockUsers.reviewer,
          createdAt: '2023-12-03T15:00:00Z'
        },
        {
          state: 'APPROVED',
          author: mockUsers.testUser,
          createdAt: '2023-12-03T16:30:00Z'
        }
      ]
    },
    timelineItems: { nodes: [] },
    labels: {
      nodes: [mockLabels[0]] // bug
    }
  },

  // PR with changes requested
  changesRequestedPR: {
    id: 'PR_4',
    number: 104,
    title: 'Update documentation for API changes',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    createdAt: '2023-12-04T10:00:00Z',
    updatedAt: '2023-12-04T14:30:00Z',
    author: mockUsers.author,
    headRefName: 'docs/api-updates',
    reviewRequests: { nodes: [] },
    commits: {
      nodes: [{
        commit: {
          author: { date: '2023-12-04T13:00:00Z' },
          statusCheckRollup: { state: 'FAILURE' }
        }
      }]
    },
    reviewDecision: 'CHANGES_REQUESTED',
    reviews: {
      totalCount: 1,
      nodes: [
        {
          state: 'CHANGES_REQUESTED',
          author: mockUsers.reviewer,
          createdAt: '2023-12-04T13:30:00Z'
        }
      ]
    },
    timelineItems: { nodes: [] },
    labels: {
      nodes: [mockLabels[2]] // documentation
    }
  },

  // PR with team review request
  teamReviewPR: {
    id: 'PR_5',
    number: 105,
    title: 'Major refactoring of core module',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    createdAt: '2023-12-05T11:00:00Z',
    updatedAt: '2023-12-05T18:15:00Z',
    author: mockUsers.author,
    headRefName: 'refactor/core-module',
    reviewRequests: {
      nodes: [
        {
          requestedReviewer: mockTeams.coreTeam
        },
        {
          requestedReviewer: mockTeams.reviewTeam
        }
      ]
    },
    commits: {
      nodes: [{
        commit: {
          author: { date: '2023-12-05T17:00:00Z' },
          statusCheckRollup: { state: 'SUCCESS' }
        }
      }]
    },
    reviewDecision: null,
    reviews: { totalCount: 0, nodes: [] },
    timelineItems: {
      nodes: [
        {
          __typename: 'ReviewRequestedEvent',
          createdAt: '2023-12-05T12:00:00Z',
          actor: mockUsers.author,
          requestedReviewer: mockTeams.coreTeam
        }
      ]
    },
    labels: { nodes: [] }
  }
};

export const createMockGraphQLResponse = (prs = [], overrides = {}) => ({
  data: {
    repository: {
      pullRequests: {
        nodes: prs
      }
    },
    viewer: {
      login: mockUsers.testUser.login
    },
    rateLimit: {
      limit: 5000,
      remaining: 4950,
      resetAt: new Date(Date.now() + 3600000).toISOString()
    },
    ...overrides
  }
});

export const createMockDeviceCodeResponse = () => ({
  device_code: 'test-device-code-12345',
  user_code: 'ABCD-1234',
  verification_uri: 'https://github.com/login/device',
  verification_uri_complete: 'https://github.com/login/device?user_code=ABCD-1234',
  expires_in: 900,
  interval: 5
});

export const createMockAccessTokenResponse = () => ({
  access_token: 'gho_test-access-token-12345',
  token_type: 'bearer',
  scope: 'repo read:org'
});

export const createMockOAuthErrorResponse = (error, description) => ({
  error,
  error_description: description
});

export const mockRateLimitHeaders = {
  'X-RateLimit-Limit': '5000',
  'X-RateLimit-Remaining': '4950',
  'X-RateLimit-Reset': Math.floor((Date.now() + 3600000) / 1000).toString(),
  'X-RateLimit-Used': '50'
};

export const mockAuthenticationResponses = {
  validToken: {
    ok: true,
    json: () => Promise.resolve(mockUsers.testUser),
    headers: new Map(Object.entries(mockRateLimitHeaders))
  },
  invalidToken: {
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    json: () => Promise.resolve({
      message: 'Bad credentials',
      documentation_url: 'https://docs.github.com/rest'
    })
  },
  rateLimited: {
    ok: false,
    status: 403,
    statusText: 'Forbidden',
    json: () => Promise.resolve({
      message: 'API rate limit exceeded',
      documentation_url: 'https://docs.github.com/rest'
    }),
    headers: new Map(Object.entries({
      ...mockRateLimitHeaders,
      'X-RateLimit-Remaining': '0'
    }))
  }
};