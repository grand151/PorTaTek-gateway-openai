/**
 * GitHub Device Flow Routes
 * 
 * REST endpoints for Device Flow authentication:
 * - POST /auth/device/request - Request device code
 * - POST /auth/device/poll - Poll for access token (client-side)
 * - GET /auth/device/status - Check device flow status
 * 
 * Typical flow:
 * 1. CLI calls POST /auth/device/request -> gets user_code to display
 * 2. User enters code at github.com/login/device
 * 3. CLI calls POST /auth/device/poll in loop until authorized
 * 4. Once authorized, CLI receives JWT token
 */

module.exports = function registerDeviceFlowRoutes(app, deviceAuthManager, userManager, authMiddleware, jwtSecret) {
  /**
   * Step 1: Request device code + user code
   * 
   * POST /auth/device/request
   * Body: {scope?: 'read:user user:email'} (optional)
   * 
   * Response:
   * {
   *   device_code: string,        // For polling
   *   user_code: string,          // Display to user
   *   verification_uri: string,   // github.com/login/device
   *   expires_in: number,         // Seconds until expiry (900)
   *   interval: number            // Min seconds between polls (5)
   * }
   */
  app.post('/auth/device/request', async (req, res) => {
    try {
      const scope = req.body?.scope || 'read:user user:email';
      const deviceFlow = await deviceAuthManager.requestDeviceCode(scope);

      res.json({
        device_code: deviceFlow.device_code,
        user_code: deviceFlow.user_code,
        verification_uri: deviceFlow.verification_uri,
        expires_in: deviceFlow.expires_in,
        interval: deviceFlow.interval,
        message: `Please visit ${deviceFlow.verification_uri} and enter code: ${deviceFlow.user_code}`
      });
    } catch (error) {
      console.error('[AUTH] Device code request error:', error.message);
      res.status(400).json({
        error: 'device_request_failed',
        message: error.message
      });
    }
  });

  /**
   * Step 2: Poll for access token
   * 
   * POST /auth/device/poll
   * Body: {device_code: string, user_code?: string}
   * 
   * Responses:
   * - 200 + {jwt, user}: Authorization successful
   * - 202 + {message}: Still waiting (authorization_pending)
   * - 429: Polling too fast (slow_down)
   * - 410: Device code expired
   * - 403: User denied authorization
   */
  app.post('/auth/device/poll', async (req, res) => {
    try {
      const { device_code, user_code } = req.body;

      if (!device_code) {
        return res.status(400).json({
          error: 'missing_device_code',
          message: 'device_code is required'
        });
      }

      const tokenResponse = await deviceAuthManager.pollAccessToken(device_code, user_code);
      
      // Successfully got access token
      const userProfile = await deviceAuthManager.getUserProfile(tokenResponse.access_token);
      
      // Create/update user in database
      const user = userManager.createOrUpdateUser({
        id: `github_${userProfile.id}`,
        login: userProfile.login,
        email: userProfile.email,
        avatar_url: userProfile.avatar_url,
        name: userProfile.name,
        accessToken: tokenResponse.access_token
      });

      // Generate JWT
      const jwt = require('jsonwebtoken').sign(
        { userId: user.id, login: user.login, email: user.email },
        jwtSecret,
        { expiresIn: '7d' }
      );

      // Set secure cookie
      res.cookie('auth_token', jwt, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      res.json({
        jwt,
        user: {
          id: user.id,
          login: user.login,
          email: user.email,
          avatar_url: user.avatar_url,
          name: user.name
        }
      });

    } catch (error) {
      // Handle device flow specific errors
      if (error.message.includes('authorization_pending')) {
        return res.status(202).json({
          error: 'authorization_pending',
          message: 'User has not yet authorized. Continue polling.'
        });
      }

      if (error.message.includes('slow_down')) {
        return res.status(429).json({
          error: 'slow_down',
          message: 'Polling too fast. Increase interval to 10+ seconds.'
        });
      }

      if (error.message.includes('expired')) {
        return res.status(410).json({
          error: 'expired_token',
          message: 'Device code expired. Request a new one.'
        });
      }

      if (error.message.includes('denied')) {
        return res.status(403).json({
          error: 'access_denied',
          message: 'User denied authorization'
        });
      }

      console.error('[AUTH] Device flow poll error:', error.message);
      res.status(400).json({
        error: 'poll_failed',
        message: error.message
      });
    }
  });

  /**
   * Get device flow status
   * 
   * GET /auth/device/status?device_code=abc123
   * 
   * Response:
   * {
   *   status: 'active' | 'expired' | 'invalid',
   *   expiresIn: number  // Seconds remaining
   * }
   */
  app.get('/auth/device/status', (req, res) => {
    const { device_code } = req.query;

    if (!device_code) {
      return res.status(400).json({
        error: 'missing_device_code',
        message: 'device_code query parameter required'
      });
    }

    const status = deviceAuthManager.getFlowStatus(device_code);
    res.json(status);
  });

  /**
   * Cleanup endpoint (optional, can be called periodically)
   * POST /auth/device/cleanup (admin only)
   */
  app.post('/auth/device/cleanup', authMiddleware, (req, res) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Admin access required'
      });
    }

    try {
      deviceAuthManager.cleanupExpiredCodes();
      res.json({ message: 'Device flow cleanup completed' });
    } catch (error) {
      res.status(500).json({
        error: 'cleanup_failed',
        message: error.message
      });
    }
  });

  console.log('[AUTH] ℹ️  Device Flow routes registered');
};
