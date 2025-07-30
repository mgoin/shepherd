/**
 * Jest setup file for Chrome Extension testing
 * Configures global mocks and test environment
 */

import 'jest-fetch-mock';
import { jest } from '@jest/globals';

// Enable fetch mocking
global.fetch = require('jest-fetch-mock');

// Mock Chrome APIs
global.chrome = {
  runtime: {
    onInstalled: {
      addListener: jest.fn()
    },
    onStartup: {
      addListener: jest.fn()
    },
    onMessage: {
      addListener: jest.fn()
    },
    sendMessage: jest.fn((message) => Promise.resolve({ success: true })),
    getURL: jest.fn((path) => `chrome-extension://test-id/${path}`)
  },
  action: {
    onClicked: {
      addListener: jest.fn()
    }
  },
  sidePanel: {
    open: jest.fn()
  },
  storage: {
    local: {
      get: jest.fn((keys) => {
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: null });
        }
        return Promise.resolve(Object.fromEntries(keys.map(key => [key, null])));
      }),
      set: jest.fn(() => Promise.resolve()),
      remove: jest.fn(() => Promise.resolve()),
      clear: jest.fn(() => Promise.resolve())
    }
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
    onAlarm: {
      addListener: jest.fn()
    }
  },
  notifications: {
    create: jest.fn()
  },
  tabs: {
    create: jest.fn()
  },
  identity: {
    clearAllCachedAuthTokens: jest.fn((callback) => callback())
  }
};

// Mock DOM elements that the extension expects
global.document = {
  ...global.document,
  getElementById: jest.fn((id) => {
    const mockElement = {
      style: {},
      innerHTML: '',
      textContent: '',
      value: '',
      classList: {
        add: jest.fn(),
        remove: jest.fn(),
        contains: jest.fn()
      },
      addEventListener: jest.fn(),
      click: jest.fn(),
      dataset: {}
    };
    return mockElement;
  }),
  querySelectorAll: jest.fn(() => []),
  createElement: jest.fn(() => ({
    style: {},
    innerHTML: '',
    appendChild: jest.fn(),
    addEventListener: jest.fn()
  })),
  body: {
    appendChild: jest.fn(),
    removeChild: jest.fn()
  },
  addEventListener: jest.fn(),
  visibilityState: 'visible'
};

// Mock navigator for clipboard operations
global.navigator = {
  ...global.navigator,
  clipboard: {
    writeText: jest.fn(() => Promise.resolve())
  }
};

// Mock window globals
global.window = {
  ...global.window,
  prompt: jest.fn(),
  alert: jest.fn(),
  confirm: jest.fn(() => true),
  setInterval: jest.fn(),
  clearInterval: jest.fn(),
  setTimeout: jest.fn(),
  clearTimeout: jest.fn()
};

// Mock console methods to reduce noise in tests
global.console = {
  ...global.console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn()
};

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
  fetch.resetMocks();
});

// Global test utilities
global.createMockPR = (overrides = {}) => ({
  id: 'test-id',
  number: 123,
  title: 'Test PR',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  createdAt: '2023-01-01T00:00:00Z',
  updatedAt: '2023-01-01T12:00:00Z',
  author: { login: 'testuser' },
  headRefName: 'feature-branch',
  reviewRequests: { nodes: [] },
  commits: {
    nodes: [{
      commit: {
        author: { date: '2023-01-01T10:00:00Z' },
        statusCheckRollup: { state: 'SUCCESS' }
      }
    }]
  },
  reviewDecision: null,
  reviews: { totalCount: 0, nodes: [] },
  timelineItems: { nodes: [] },
  labels: { nodes: [] },
  ...overrides
});

global.createMockGraphQLResponse = (prs = []) => ({
  data: {
    repository: {
      pullRequests: {
        nodes: prs
      }
    },
    viewer: {
      login: 'testuser'
    },
    rateLimit: {
      limit: 5000,
      remaining: 4999,
      resetAt: new Date(Date.now() + 3600000).toISOString()
    }
  }
});

// Mock fetch responses for common endpoints
global.mockGitHubAPIResponses = () => {
  fetch.mockImplementation((url) => {
    if (url.includes('/user')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ login: 'testuser', id: 123 })
      });
    }
    if (url.includes('/graphql')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(createMockGraphQLResponse([createMockPR()]))
      });
    }
    if (url.includes('device/code')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          device_code: 'test-device-code',
          user_code: 'TEST-CODE',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5
        })
      });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });
  });
};