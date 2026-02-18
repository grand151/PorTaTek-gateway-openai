# GitHub Device Flow Authentication

Device Flow (RFC 8628) enables authentication on devices with limited input capabilities or no web browser. Users authorize on a separate device (phone/computer) and the original device receives a token.

## When to Use Device Flow

✅ **Use Device Flow for:**
- CLI applications and tools
- IoT devices and smart devices  
- Server applications with headless deployments
- Embedded systems
- Applications running in restricted environments (SSH sessions, containers)
- Scenarios where opening a browser is inconvenient

❌ **Don't use Device Flow for:**
- Web applications (use standard OAuth)
- Mobile apps with browsers (use standard OAuth)
- Desktop apps with UI capabilities (use standard OAuth)

## Architecture

```
Device         GitHub              Your Gateway
  ↓              ↓                      ↓
  │ POST /device/request               │
  └─────────────────────────────────────→
                                   Returns user_code
  │             ← Shows user_code on screen
  
  User opens github.com/login/device
  Enters user_code manually
  GitHub remembers authorization
  
  │ POST /device/poll (device_code)     │
  └─────────────────────────────────────→
  │ ← 202 Accepted (still authorizing)  │
  │ (wait 5 seconds)
  
  │ POST /device/poll (device_code)     │
  └─────────────────────────────────────→
  │ ← 200 OK + JWT access token         │
  
Device now has JWT and can make API calls
```

## Endpoints

### 1. Request Device Code
```
POST /auth/device/request
Content-Type: application/json

Request body:
{}

Response (200 OK):
{
  "device_code": "3584d83530557fdd4d6bea6882d02d25ed6476f8",
  "user_code": "WDJB-MJHT",
  "verification_uri": "https://github.com/login/device",
  "expires_in": 900,
  "interval": 5
}
```

**Explanation:**
- `device_code`: Token to use in polling requests (keep secret)
- `user_code`: Code for user to enter at github.com/login/device (8 characters, uppercase)
- `verification_uri`: URL where user authorizes
- `expires_in`: Seconds until device code expires (900 = 15 minutes)
- `interval`: Seconds to wait between poll attempts (minimum 5)

### 2. Poll for Access Token
```
POST /auth/device/poll
Content-Type: application/json

Request body:
{
  "device_code": "3584d83530557fdd4d6bea6882d02d25ed6476f8",
  "user_code": "WDJB-MJHT"
}

Response (202 Accepted - still waiting):
{
  "message": "authorization_pending",
  "expiresIn": 850
}

Response (200 OK - authorized):
{
  "token": "eyJhbGc...",
  "user": {
    "id": "github_12345",
    "login": "octocat",
    "email": "octocat@github.com",
    "isAdmin": false
  },
  "expiresIn": 604800
}

Response (429 Too Many Requests - rate limited):
{
  "error": "slow_down",
  "message": "Polling too frequently. Increase interval by 5 seconds",
  "interval": 10
}
```

**Status Codes:**
- `200 OK`: Authorization succeeded, token issued
- `202 Accepted`: Authorization pending, keep polling
- `400 Bad Request`: Invalid device code or user code
- `401 Unauthorized`: Device code expired
- `429 Too Many Requests`: Polling too fast, increase interval

### 3. Check Authorization Status
```
GET /auth/device/status?device_code=3584d83530557fdd4d6bea6882d02d25ed6476f8

Response (200 OK):
{
  "device_code": "3584d83530557fdd4d6bea6882d02d25ed6476f8",
  "status": "active",
  "authorized": false,
  "expiresIn": 840
}
```

### 4. Admin Cleanup (Protected Route)
```
POST /auth/device/cleanup
Authorization: Bearer {jwt_token}  (requires admin flag)

Response (200 OK):
{
  "message": "Cleaned up 5 expired device codes",
  "remaining": 3
}
```

## Client Implementation Example (CLI)

```bash
#!/bin/bash

# Step 1: Request device code
RESPONSE=$(curl -s -X POST http://localhost:3000/auth/device/request \
  -H "Content-Type: application/json" \
  -d '{}')

DEVICE_CODE=$(echo $RESPONSE | jq -r '.device_code')
USER_CODE=$(echo $RESPONSE | jq -r '.user_code')
INTERVAL=$(echo $RESPONSE | jq -r '.interval')

echo "Please visit: https://github.com/login/device"
echo "Enter this code: $USER_CODE"

# Step 2: Poll until authorized
while true; do
  POLL=$(curl -s -X POST http://localhost:3000/auth/device/poll \
    -H "Content-Type: application/json" \
    -d "{\"device_code\": \"$DEVICE_CODE\", \"user_code\": \"$USER_CODE\"}")
  
  STATUS=$(echo $POLL | jq -r '.token // .error // "pending"')
  
  if [[ $STATUS != "pending" ]] && [[ $STATUS != "authorization_pending" ]]; then
    # Got token
    TOKEN=$(echo $POLL | jq -r '.token')
    echo "✅ Authorized!"
    echo "Token: $TOKEN"
    # Save token securely in ~/.gateway/token
    echo $TOKEN > ~/.gateway/token
    exit 0
  fi
  
  echo "⏳ Waiting for authorization..."
  sleep $INTERVAL
done
```

## Python Client Example

```python
import requests
import json
import time

GATEWAY_URL = "http://localhost:3000"

def authenticate_device():
    # Step 1: Request device code
    response = requests.post(
        f"{GATEWAY_URL}/auth/device/request",
        json={}
    )
    response.raise_for_status()
    
    data = response.json()
    device_code = data["device_code"]
    user_code = data["user_code"]
    interval = data["interval"]
    
    print(f"Visit: https://github.com/login/device")
    print(f"Enter code: {user_code}")
    
    # Step 2: Poll for token
    while True:
        response = requests.post(
            f"{GATEWAY_URL}/auth/device/poll",
            json={"device_code": device_code, "user_code": user_code}
        )
        
        if response.status_code == 200:
            data = response.json()
            token = data["token"]
            print(f"✅ Authorized!")
            return token
        
        elif response.status_code == 202:
            print("⏳ Waiting for authorization...")
            time.sleep(interval)
        
        elif response.status_code == 429:
            # Rate limited, increase interval
            interval = response.json().get("interval", interval + 5)
            print(f"Slower polling required, waiting {interval}s")
            time.sleep(interval)
        
        else:
            raise Exception(f"Error: {response.json()}")

if __name__ == "__main__":
    token = authenticate_device()
    # Save token for future API calls
    with open("~/.gateway/token", "w") as f:
        f.write(token)
```

## Node.js Client Example

```javascript
const axios = require('axios');

const GATEWAY_URL = 'http://localhost:3000';

async function authenticateDevice() {
  try {
    // Step 1: Request device code
    const initResponse = await axios.post(`${GATEWAY_URL}/auth/device/request`, {});
    
    const { device_code, user_code, interval, expires_in } = initResponse.data;
    
    console.log(`Visit: https://github.com/login/device`);
    console.log(`Enter code: ${user_code}`);
    console.log(`Valid for: ${expires_in} seconds`);
    
    // Step 2: Poll for token
    let pollInterval = interval;
    while (true) {
      try {
        const pollResponse = await axios.post(`${GATEWAY_URL}/auth/device/poll`, {
          device_code,
          user_code
        });
        
        // Authorized!
        const { token, user } = pollResponse.data;
        console.log(`✅ Authorized as: ${user.login}`);
        return token;
        
      } catch (error) {
        if (error.response?.status === 202) {
          // Still pending
          console.log('⏳ Waiting for authorization...');
          await sleep(pollInterval * 1000);
          
        } else if (error.response?.status === 429) {
          // Rate limited - increase interval
          pollInterval = error.response.data.interval;
          console.log(`Rate limited, waiting ${pollInterval}s`);
          await sleep(pollInterval * 1000);
          
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    console.error('Auth error:', error.response?.data || error.message);
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Usage
authenticateDevice()
  .then(token => {
    console.log('Saving token...');
    // Use token for authenticated requests
  })
  .catch(error => console.error('Failed:', error));
```

## Configuration

Set these environment variables:

```bash
# GitHub OAuth credentials (required for Device Flow)
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
JWT_SECRET=your_jwt_secret_key

# Optional
GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback
NODE_ENV=production  # Enables HTTPS-only cookies
```

## Error Handling

| Error | HTTP | Meaning | Action |
|-------|------|---------|--------|
| `authorization_pending` | 202 | User hasn't authorized yet | Keep polling |
| `slow_down` | 429 | Polling too fast | Increase interval by 5s |
| `expired_token` | 401 | Device code expired | Request new code |
| Invalid device code | 400 | Code not recognized | Check code format |
| Invalid user code | 400 | User code doesn't match | Verify code entry |

## Security

✅ **Security Features:**
- Device codes are generated with cryptographic randomness
- Device codes expire after 15 minutes
- User codes are short (8 chars) for easy entry but with uniqueness
- Polling results in JWT tokens (not raw access tokens stored)
- All device flows tracked and auto-cleaned
- Admin-only cleanup endpoint for manual management

⚠️ **Best Practices:**
- Never expose `device_code` to users (keep it in your client)
- Only show `user_code` on screen
- Always use HTTPS in production (set NODE_ENV=production)
- Implement proper error handling for network failures
- Store JWT tokens securely on client
- Implement token refresh before expiration (7 days)

## Testing

Run the test suite:
```bash
npm test -- test-device-flow.js
```

Test coverage:
- Device flow initialization
- Device code generation
- Polling mechanism
- Error states (authorization_pending, slow_down, expired)
- Code cleanup and expiration
- Edge cases and timeouts

## Comparison: Device Flow vs Standard OAuth

| Feature | Standard OAuth | Device Flow |
|---------|---|---|
| **Browser Required** | Yes | No |
| **Best For** | Web/Desktop apps | CLI, IoT, Headless |
| **User Experience** | Seamless redirect | Manual code entry |
| **Polling** | None | 5-second intervals |
| **Implementation** | Simple | Medium complexity |
| **Mobile Support** | Yes | Limited |
| **Security** | PKCE recommended | Built-in polling auth |

## Troubleshooting

### User code not working
- Verify user entered exact code shown (case-sensitive for some implementations)
- Check code hasn't expired (15 minute limit)
- Request new code if more than 15 minutes have passed

### Polling getting 429 errors
- Client polling too fast
- GitHub rate limiting is kicking in
- Increase interval (GitHub will send new `interval` value)
- Implement exponential backoff

### Device code expired
- 15-minute window was exceeded
- Request new device code and user code
- User needs to authorize again

### Token invalid after authorization
- JWT may have expired (7-day lifetime)
- Implement token refresh by requesting new device code
- Check JWT_SECRET matches across gateway and client

## See Also

- [RFC 8628 - OAuth 2.0 Device Authorization Grant](https://tools.ietf.org/html/rfc8628)
- [GitHub Device Flow Documentation](https://docs.github.com/en/developers/apps/building-oauth-apps/authorizing-oauth-apps#device-flow)
- Standard OAuth routes: `/login`, `/auth/github/callback`, `/auth/me`, `/logout`
