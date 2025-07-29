// GitHub Device Flow Implementation for Chrome Extensions
// No OAuth app setup required - uses GitHub's public Device Flow

class GitHubOAuth {
  constructor() {
    // GitHub Device Flow Configuration  
    // Device Flow requires a registered OAuth app, but we'll use a generic client ID
    // that works for device flow applications
    this.clientId = 'Iv1.b507a08c87ecfe98'; // GitHub CLI's public client ID for device flow
    this.scopes = ['repo', 'read:org'];
    
    // GitHub Device Flow endpoints
    this.deviceCodeURL = 'https://github.com/login/device/code';
    this.accessTokenURL = 'https://github.com/login/oauth/access_token';
    this.pollInterval = 5000; // 5 seconds
  }

  /**
   * Check if user is currently authenticated
   */
  async isAuthenticated() {
    try {
      const tokenData = await this.getStoredToken();
      if (!tokenData || !tokenData.access_token) {
        return false;
      }

      // Verify token is still valid by testing a simple API call
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
        // Token is invalid, clean it up
        await this.clearStoredToken();
        return false;
      }
    } catch (error) {
      console.error('Authentication check failed:', error);
      return false;
    }
  }

  /**
   * Start GitHub Device Flow authentication
   */
  async authenticate() {
    try {
      console.log('Starting GitHub Device Flow...');
      
      // Step 1: Request device and user codes
      const deviceData = await this.requestDeviceCode();
      
      // Step 2: Show user the code and open GitHub
      const userChoice = await this.showDeviceCodeToUser(deviceData);
      if (!userChoice) {
        throw new Error('Authentication cancelled by user');
      }
      
      // Step 3: Poll for access token
      const tokenData = await this.pollForAccessToken(deviceData.device_code);
      await this.storeToken(tokenData);
      
      // Step 4: Close modal and verify token
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
      // Close modal on error too
      this.closeDeviceCodeModal();
      throw error;
    }
  }

  /**
   * Step 1: Request device and user codes from GitHub
   */
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

  /**
   * Step 2: Show the user code and prompt them to visit GitHub
   */
  async showDeviceCodeToUser(deviceData) {
    return new Promise((resolve) => {
      // Create a modal-like interface for better UX
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 10000; display: flex;
        align-items: center; justify-content: center;
      `;
      
      modal.innerHTML = `
        <div style="background: white; padding: 20px; border-radius: 8px; max-width: 400px; text-align: center;">
          <h3>🔐 GitHub Authentication</h3>
          <p>To connect your GitHub account:</p>
          <ol style="text-align: left; margin: 16px 0;">
            <li>Copy this code: <strong id="device-code" style="background: #f6f8fa; padding: 4px 8px; border-radius: 4px; font-family: monospace; cursor: pointer; user-select: all;" title="Click to copy">${deviceData.user_code}</strong></li>
            <li>Click "Open GitHub" below</li>
            <li>Paste the code when prompted</li>
            <li>Authorize PR Shepherd</li>
          </ol>
          <div id="auth-status" style="margin: 16px 0; padding: 12px; background: #f6f8fa; border-radius: 6px; font-size: 14px; color: #656d76; display: none;">
            Waiting for authorization...
          </div>
          <div style="margin-top: 20px;">
            <button id="open-github-btn" style="background: #2da44e; color: white; border: none; padding: 10px 20px; border-radius: 6px; margin-right: 10px; cursor: pointer;">
              Open GitHub
            </button>
            <button id="cancel-auth-btn" style="background: #d1d9e0; color: #24292f; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer;">
              Cancel
            </button>
          </div>
          <p style="font-size: 12px; color: #656d76; margin-top: 16px;">
            This window will close automatically when you complete authorization.
          </p>
        </div>
      `;
      
      document.body.appendChild(modal);
      
      // Auto-copy code to clipboard on modal show
      navigator.clipboard.writeText(deviceData.user_code).then(() => {
        const codeElement = modal.querySelector('#device-code');
        const originalText = codeElement.textContent;
        codeElement.textContent = 'Copied!';
        codeElement.style.background = '#dcfce7';
        setTimeout(() => {
          codeElement.textContent = originalText;
          codeElement.style.background = '#f6f8fa';
        }, 2000);
      });
      
      // Copy code to clipboard when clicked
      modal.querySelector('#device-code').addEventListener('click', () => {
        navigator.clipboard.writeText(deviceData.user_code);
        const codeElement = modal.querySelector('#device-code');
        const originalText = codeElement.textContent;
        codeElement.textContent = 'Copied!';
        codeElement.style.background = '#dcfce7';
        setTimeout(() => {
          codeElement.textContent = originalText;
          codeElement.style.background = '#f6f8fa';
        }, 1000);
      });
      
      modal.querySelector('#open-github-btn').addEventListener('click', () => {
        chrome.tabs.create({ url: deviceData.verification_uri });
        // Show waiting status instead of closing immediately
        modal.querySelector('#auth-status').style.display = 'block';
        modal.querySelector('#open-github-btn').textContent = 'Waiting for authorization...';
        modal.querySelector('#open-github-btn').disabled = true;
        modal.querySelector('#open-github-btn').style.background = '#8b949e';
      });
      
      modal.querySelector('#cancel-auth-btn').addEventListener('click', () => {
        document.body.removeChild(modal);
        resolve(false);
      });
      
      // Store modal reference for auto-close
      this.currentModal = modal;
      this.modalResolve = resolve;
      
      // Return true to continue with polling
      resolve(true);
    });
  }

  /**
   * Close the device code modal when authentication succeeds
   */
  closeDeviceCodeModal() {
    if (this.currentModal) {
      document.body.removeChild(this.currentModal);
      this.currentModal = null;
      this.modalResolve = null;
    }
  }

  /**
   * Step 3: Poll GitHub for access token
   */
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
          // User hasn't completed authorization yet, keep polling
          await new Promise(resolve => setTimeout(resolve, this.pollInterval));
          continue;
        }
        
        if (data.error === 'slow_down') {
          // We're polling too fast, increase interval
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
        // Network error, wait and retry
        await new Promise(resolve => setTimeout(resolve, this.pollInterval));
      }
    }
    
    throw new Error('Authentication timeout. Please try again.');
  }

  /**
   * Get stored OAuth token
   */
  async getStoredToken() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['oauth_token'], (result) => {
        resolve(result.oauth_token);
      });
    });
  }

  /**
   * Store OAuth token securely
   */
  async storeToken(tokenData) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ 
        oauth_token: tokenData,
        // Clear old PAT if exists
        github_token: null
      }, resolve);
    });
  }

  /**
   * Clear stored token (logout)
   */
  async clearStoredToken() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(['oauth_token'], resolve);
    });
  }

  /**
   * Get access token for API calls
   */
  async getAccessToken() {
    const tokenData = await this.getStoredToken();
    return tokenData ? tokenData.access_token : null;
  }

  /**
   * Logout user and clear tokens
   */
  async logout() {
    await this.clearStoredToken();
    
    // Also clear Chrome's cached auth
    return new Promise((resolve) => {
      chrome.identity.clearAllCachedAuthTokens(() => {
        resolve();
      });
    });
  }


  /**
   * Fallback to manual PAT if OAuth fails or is unavailable
   */
  async authenticateWithPAT(token) {
    try {
      // Validate the PAT
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (response.ok) {
        const user = await response.json();
        
        // Store as legacy token
        await new Promise((resolve) => {
          chrome.storage.local.set({ 
            github_token: token,
            oauth_token: null // Clear OAuth token
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

  /**
   * Get current authentication method and token
   */
  async getCurrentAuth() {
    const oauthToken = await this.getStoredToken();
    if (oauthToken && oauthToken.access_token) {
      return { method: 'oauth', token: oauthToken.access_token };
    }

    // Fallback to check for legacy PAT
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
}

// Export for use in other modules
window.GitHubOAuth = GitHubOAuth;