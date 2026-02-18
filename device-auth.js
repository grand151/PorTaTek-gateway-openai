const https = require('https');
const querystring = require('querystring');

/**
 * GitHub Device Flow Authentication Manager
 * 
 * Implements OAuth 2.0 Device Authorization Grant (RFC 8628)
 * Allows authentication on devices without a web browser (CLI, IoT, headless)
 * 
 * Flow:
 * 1. Client requests device code + user code
 * 2. Device displays user code to user
 * 3. User visits github.com/login/device and enters user code
 * 4. Client polls for access token
 * 5. Once authorized, device gets access token
 */
class GitHubDeviceAuthManager {
  constructor(clientId, clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    
    // GitHub Device Flow endpoints
    this.deviceCodeEndpoint = 'https://github.com/login/device/code';
    this.accessTokenEndpoint = 'https://github.com/login/oauth/access_token';
    this.userEndpoint = 'https://api.github.com/user';
    
    // Device Flow timing (per GitHub docs)
    this.pollInterval = 5000; // 5 seconds between polls
    this.expirationTime = 900000; // 15 minutes (device code expiry)
    
    // Rate limiting: after 15 min of no auth, device code expires
    this.activeDeviceFlows = new Map(); // Maps device_code -> {expiresAt, codeExpired}
  }

  /**
   * Step 1: Request device code and user code from GitHub
   * Returns {device_code, user_code, verification_uri, expires_in, interval}
   */
  async requestDeviceCode(scope = 'read:user user:email') {
    return new Promise((resolve, reject) => {
      const body = querystring.stringify({
        client_id: this.clientId,
        scope: scope
      });

      const options = {
        hostname: 'github.com',
        port: 443,
        path: '/login/device/code',
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'PortaTek-Gateway-OAuth'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(data);
              
              // Track active device flow
              this.activeDeviceFlows.set(response.device_code, {
                expiresAt: Date.now() + response.expires_in * 1000,
                codeExpired: false
              });

              resolve(response);
            } catch (err) {
              reject(new Error('Failed to parse device code response: ' + err.message));
            }
          } else {
            reject(new Error(`GitHub device code request failed: ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * Step 2: Poll for access token
   * Returns {access_token, token_type, scope} when authorized
   * Throws 'authorization_pending' while waiting
   * Throws 'slow_down' if polling too fast
   * Throws 'expired_token' if device code expired
   */
  async pollAccessToken(deviceCode, userCode) {
    return new Promise((resolve, reject) => {
      // Check if device code has expired
      const flow = this.activeDeviceFlows.get(deviceCode);
      if (!flow) {
        return reject(new Error('Invalid or expired device code'));
      }
      if (Date.now() > flow.expiresAt) {
        flow.codeExpired = true;
        return reject(new Error('Device code expired. Please request a new one.'));
      }

      const body = querystring.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      });

      const options = {
        hostname: 'github.com',
        port: 443,
        path: '/login/oauth/access_token',
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'PortaTek-Gateway-OAuth'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(data);

              if (response.error) {
                // Handle GitHub-specific device flow errors
                if (response.error === 'authorization_pending') {
                  reject(new Error('authorization_pending'));
                } else if (response.error === 'slow_down') {
                  reject(new Error('slow_down'));
                } else if (response.error === 'expired_token') {
                  flow.codeExpired = true;
                  reject(new Error('Device code expired. Please request a new one.'));
                } else if (response.error === 'access_denied') {
                  reject(new Error('Authorization denied by user'));
                } else {
                  reject(new Error(`Device flow error: ${response.error}`));
                }
              } else if (response.access_token) {
                // Successfully authorized!
                this.activeDeviceFlows.delete(deviceCode);
                resolve(response);
              } else {
                reject(new Error('No access token in response'));
              }
            } catch (err) {
              reject(new Error('Failed to parse access token response: ' + err.message));
            }
          } else {
            reject(new Error(`Token request failed: ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * Fetch user profile from GitHub API
   * Requires valid access token
   */
  async getUserProfile(accessToken) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        port: 443,
        path: '/user',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'PortaTek-Gateway-OAuth'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(new Error('Failed to parse user profile: ' + err.message));
            }
          } else {
            reject(new Error(`Failed to fetch user profile: ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Cleanup: Remove expired device codes from memory
   * Call periodically to prevent memory leaks
   */
  cleanupExpiredCodes() {
    const now = Date.now();
    for (const [deviceCode, flow] of this.activeDeviceFlows.entries()) {
      if (now > flow.expiresAt) {
        this.activeDeviceFlows.delete(deviceCode);
      }
    }
  }

  /**
   * Get device flow status (useful for CLI feedback)
   */
  getFlowStatus(deviceCode) {
    const flow = this.activeDeviceFlows.get(deviceCode);
    if (!flow) return { status: 'invalid' };
    
    const timeRemaining = Math.max(0, flow.expiresAt - Date.now());
    return {
      status: flow.codeExpired ? 'expired' : 'active',
      expiresIn: Math.ceil(timeRemaining / 1000),
      secondsRemaining: Math.ceil(timeRemaining / 1000)
    };
  }
}

module.exports = GitHubDeviceAuthManager;
