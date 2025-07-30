/**
 * Test utility functions and helpers
 */

import { jest } from '@jest/globals';

/**
 * Creates a mock DOM element with common properties and methods
 */
export const createMockElement = (overrides = {}) => ({
  id: '',
  className: '',
  classList: {
    add: jest.fn(),
    remove: jest.fn(),
    contains: jest.fn(() => false),
    toggle: jest.fn()
  },
  style: {},
  innerHTML: '',
  textContent: '',
  value: '',
  dataset: {},
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  click: jest.fn(),
  focus: jest.fn(),
  blur: jest.fn(),
  appendChild: jest.fn(),
  removeChild: jest.fn(),
  querySelector: jest.fn(),
  querySelectorAll: jest.fn(() => []),
  getAttribute: jest.fn(),
  setAttribute: jest.fn(),
  removeAttribute: jest.fn(),
  contains: jest.fn(() => false),
  ...overrides
});

/**
 * Creates a mock Chrome storage implementation
 */
export const createMockChromeStorage = (initialData = {}) => {
  let storage = { ...initialData };
  
  return {
    get: jest.fn((keys) => {
      if (typeof keys === 'string') {
        return Promise.resolve({ [keys]: storage[keys] || null });
      }
      if (Array.isArray(keys)) {
        const result = {};
        keys.forEach(key => {
          result[key] = storage[key] || null;
        });
        return Promise.resolve(result);
      }
      return Promise.resolve(storage);
    }),
    set: jest.fn((items) => {
      storage = { ...storage, ...items };
      return Promise.resolve();
    }),
    remove: jest.fn((keys) => {
      if (typeof keys === 'string') {
        delete storage[keys];
      } else if (Array.isArray(keys)) {
        keys.forEach(key => delete storage[key]);
      }
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      storage = {};
      return Promise.resolve();
    }),
    _getStorage: () => storage,
    _setStorage: (newStorage) => { storage = newStorage; }
  };
};

/**
 * Creates a mock fetch response
 */
export const createMockResponse = (data, options = {}) => {
  const {
    ok = true,
    status = 200,
    statusText = 'OK',
    headers = {}
  } = options;

  return Promise.resolve({
    ok,
    status,
    statusText,
    headers: new Map(Object.entries(headers)),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data))
  });
};

/**
 * Waits for a specified amount of time
 */
export const wait = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Waits for a condition to become true
 */
export const waitFor = async (condition, timeout = 5000, interval = 100) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await wait(interval);
  }
  throw new Error(`Condition not met within ${timeout}ms`);
};

/**
 * Simulates user interaction events
 */
export const fireEvent = {
  click: (element) => {
    if (element.click) element.click();
    if (element.addEventListener.mock) {
      const clickHandler = element.addEventListener.mock.calls
        .find(call => call[0] === 'click')?.[1];
      if (clickHandler) clickHandler(new Event('click'));
    }
  },
  
  input: (element, value) => {
    element.value = value;
    if (element.addEventListener.mock) {
      const inputHandler = element.addEventListener.mock.calls
        .find(call => call[0] === 'input')?.[1];
      if (inputHandler) inputHandler({ target: element });
    }
  },
  
  change: (element, checked = true) => {
    element.checked = checked;
    if (element.addEventListener.mock) {
      const changeHandler = element.addEventListener.mock.calls
        .find(call => call[0] === 'change')?.[1];
      if (changeHandler) changeHandler({ target: element });
    }
  },

  dragStart: (element, data) => {
    const event = {
      preventDefault: jest.fn(),
      dataTransfer: {
        setData: jest.fn(),
        getData: jest.fn(() => data)
      }
    };
    if (element.addEventListener.mock) {
      const dragStartHandler = element.addEventListener.mock.calls
        .find(call => call[0] === 'dragstart')?.[1];
      if (dragStartHandler) dragStartHandler(event);
    }
  },

  drop: (element, data) => {
    const event = {
      preventDefault: jest.fn(),
      dataTransfer: {
        getData: jest.fn(() => data)
      }
    };
    if (element.addEventListener.mock) {
      const dropHandler = element.addEventListener.mock.calls
        .find(call => call[0] === 'drop')?.[1];
      if (dropHandler) dropHandler(event);
    }
  }
};

/**
 * Creates a spy on console methods that can be restored
 */
export const spyOnConsole = (method = 'error') => {
  const originalMethod = console[method];
  const spy = jest.spyOn(console, method).mockImplementation(() => {});
  
  return {
    spy,
    restore: () => {
      console[method] = originalMethod;
    }
  };
};

/**
 * Mock Date.now() for consistent time-based testing
 */
export const mockDateNow = (timestamp) => {
  const original = Date.now;
  Date.now = jest.fn(() => timestamp);
  
  return {
    restore: () => {
      Date.now = original;
    }
  };
};

/**
 * Creates a mock for window.prompt with predefined responses
 */
export const mockPrompt = (responses = []) => {
  let callIndex = 0;
  const originalPrompt = window.prompt;
  
  window.prompt = jest.fn((message) => {
    if (callIndex < responses.length) {
      return responses[callIndex++];
    }
    return null;
  });
  
  return {
    restore: () => {
      window.prompt = originalPrompt;
    }
  };
};

/**
 * Creates a mock for window.confirm
 */
export const mockConfirm = (returnValue = true) => {
  const originalConfirm = window.confirm;
  window.confirm = jest.fn(() => returnValue);
  
  return {
    restore: () => {
      window.confirm = originalConfirm;
    }
  };
};

/**
 * Utility to test async error handling
 */
export const expectAsyncError = async (asyncFn, expectedError) => {
  try {
    await asyncFn();
    throw new Error('Expected function to throw an error');
  } catch (error) {
    if (expectedError) {
      expect(error.message).toContain(expectedError);
    }
  }
};

/**
 * Creates a mock implementation for setTimeout/setInterval
 */
export const mockTimers = () => {
  jest.useFakeTimers();
  
  return {
    advanceBy: (ms) => jest.advanceTimersByTime(ms),
    runAll: () => jest.runAllTimers(),
    runPending: () => jest.runOnlyPendingTimers(),
    restore: () => jest.useRealTimers()
  };
};

/**
 * Utility for testing Chrome extension message passing
 */
export const mockMessagePassing = () => {
  const listeners = new Map();
  
  const addListener = jest.fn((callback) => {
    const id = Math.random().toString();
    listeners.set(id, callback);
    return id;
  });
  
  const sendMessage = jest.fn((message) => {
    return new Promise((resolve) => {
      // Simulate async message passing
      setTimeout(() => {
        listeners.forEach(listener => {
          const response = listener(message, {}, resolve);
          if (response !== true) {
            resolve(response);
          }
        });
      }, 0);
    });
  });
  
  return {
    addListener,
    sendMessage,
    getListeners: () => Array.from(listeners.values())
  };
};