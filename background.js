// PR Shepherd Background Service Worker

class ShepherdBackground {
  constructor() {
    this.setup();
  }

  setup() {
    // Handle extension installation
    chrome.runtime.onInstalled.addListener(() => {
      console.log('PR Shepherd installed');
      this.setupPeriodicUpdate();
    });

    // Handle action button click to open sidebar
    chrome.action.onClicked.addListener((tab) => {
      chrome.sidePanel.open({ tabId: tab.id });
    });

    // Handle startup
    chrome.runtime.onStartup.addListener(() => {
      console.log('PR Shepherd started');
      this.setupPeriodicUpdate();
    });

    // Listen for alarm events (periodic updates)
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'updatePRs') {
        this.updatePRData();
      }
    });

    // Handle messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Will respond asynchronously
    });
  }

  setupPeriodicUpdate() {
    // Clear existing alarms
    chrome.alarms.clear('updatePRs');
    
    // Set up periodic update every 5 minutes
    chrome.alarms.create('updatePRs', {
      delayInMinutes: 1,
      periodInMinutes: 5
    });
  }

  async updatePRData() {
    try {
      console.log('Background: Updating PR data...');
      
      // Get stored token
      const result = await chrome.storage.local.get(['github_token']);
      if (!result.github_token) {
        console.log('Background: No GitHub token found');
        return;
      }

      // Fetch latest PR data
      const prs = await this.fetchPRs(result.github_token);
      
      // Store in cache with timestamp
      await chrome.storage.local.set({
        pr_cache: {
          data: prs,
          lastUpdate: Date.now()
        }
      });

      // Check for notifications
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
    // Get previous PR data for comparison
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

    // Check for status changes
    for (const currentPR of currentPRs) {
      const previousPR = previousPRs.get(currentPR.number);
      if (!previousPR) continue;

      // Check CI status changes
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

      // Check review status changes
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
}

// Initialize background service
new ShepherdBackground();