const axios = require('axios');
const jwt = require('jsonwebtoken');

class GitHubAuthManager {
  constructor(config) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.callbackURL = config.callbackURL;
    this.jwtSecret = config.jwtSecret;
  }

  async handleCallback(code) {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('GitHub OAuth credentials not configured');
    }

    try {
      const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: code,
        redirect_uri: this.callbackURL
      }, {
        headers: {
          Accept: 'application/json'
        }
      });

      if (tokenResponse.data.error) {
        throw new Error(`GitHub OAuth error: ${tokenResponse.data.error_description}`);
      }

      const accessToken = tokenResponse.data.access_token;

      const userResponse = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `token ${accessToken}`,
          Accept: 'application/vnd.github.v3+json'
        }
      });

      return {
        accessToken,
        user: {
          id: userResponse.data.id,
          login: userResponse.data.login,
          name: userResponse.data.name,
          email: userResponse.data.email,
          avatar_url: userResponse.data.avatar_url,
          bio: userResponse.data.bio,
          public_repos: userResponse.data.public_repos
        }
      };
    } catch (error) {
      console.error('GitHub OAuth callback error:', error.message);
      throw error;
    }
  }

  generateJWT(payload) {
    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: '7d'
    });
  }

  verifyJWT(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      return null;
    }
  }

  async getAccessToken(accessToken) {
    try {
      const response = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `token ${accessToken}`,
          Accept: 'application/vnd.github.v3+json'
        }
      });
      return response.data;
    } catch (error) {
      console.error('Failed to get access token info:', error.message);
      return null;
    }
  }
}

module.exports = GitHubAuthManager;
