function createAuthMiddleware(githubAuth, userManager) {
  return async (req, res, next) => {
    try {
      const token = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return res.status(401).json({
          error: 'Unauthorized: Missing authentication token'
        });
      }

      const decoded = githubAuth.verifyJWT(token);
      if (!decoded) {
        res.clearCookie('auth_token');
        return res.status(401).json({
          error: 'Unauthorized: Invalid or expired token'
        });
      }

      const user = userManager.getUserById(decoded.userId);
      if (!user) {
        return res.status(401).json({
          error: 'Unauthorized: User not found'
        });
      }

      req.user = user;
      req.authToken = token;
      next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      res.status(500).json({
        error: 'Internal server error during authentication'
      });
    }
  };
}

function optionalAuthMiddleware(githubAuth, userManager) {
  return async (req, res, next) => {
    try {
      const token = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');

      if (token) {
        const decoded = githubAuth.verifyJWT(token);
        if (decoded) {
          const user = userManager.getUserById(decoded.userId);
          if (user) {
            req.user = user;
            req.authToken = token;
            req.authenticated = true;
          }
        }
      }
      
      req.authenticated = !!req.user;
      next();
    } catch (error) {
      console.error('Optional auth middleware error:', error);
      next();
    }
  };
}

module.exports = {
  createAuthMiddleware,
  optionalAuthMiddleware
};
