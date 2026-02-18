const GitHubDeviceAuthManager = require('./device-auth.js');

let testsRun = 0;
let testsPassed = 0;

function assert(condition, message) {
  testsRun++;
  if (!condition) {
    console.error(`❌ Test ${testsRun} FAILED: ${message}`);
    return;
  }
  testsPassed++;
  console.log(`✅ Test ${testsRun} PASSED: ${message}`);
}

async function runTests() {
  console.log('\n═══════════════════════════════════════════');
  console.log('   GitHub Device Flow Auth Tests');
  console.log('═══════════════════════════════════════════\n');

  // Test 1: Initialize Device Auth Manager
  const deviceAuth = new GitHubDeviceAuthManager('test-client-id', 'test-client-secret');
  assert(deviceAuth !== null, 'Device Auth Manager instantiation');
  assert(deviceAuth.clientId === 'test-client-id', 'Client ID stored correctly');
  assert(deviceAuth.clientSecret === 'test-client-secret', 'Client Secret stored correctly');

  // Test 2: Device Flow state tracking
  assert(deviceAuth.activeDeviceFlows instanceof Map, 'Active flows tracked in Map');
  assert(deviceAuth.pollInterval === 5000, 'Poll interval set to 5 seconds');
  assert(deviceAuth.expirationTime === 900000, 'Device code expiry set to 15 minutes');

  // Test 3: Request Device Code validation
  try {
    await deviceAuth.requestDeviceCode();
    assert(false, 'Should fail with invalid credentials');
  } catch (error) {
    assert(error.message.includes('failed') || error.message.includes('401'), 'Invalid credentials caught');
  }

  // Test 4: Cleanup expired codes
  deviceAuth.activeDeviceFlows.set('test-code-1', {
    expiresAt: Date.now() - 1000, // Expired 1 second ago
    codeExpired: false
  });
  deviceAuth.activeDeviceFlows.set('test-code-2', {
    expiresAt: Date.now() + 1000000, // Expires in ~16 minutes
    codeExpired: false
  });
  assert(deviceAuth.activeDeviceFlows.size === 2, 'Two device flows tracked before cleanup');
  
  deviceAuth.cleanupExpiredCodes();
  assert(deviceAuth.activeDeviceFlows.size === 1, 'Expired codes removed during cleanup');
  assert(deviceAuth.activeDeviceFlows.has('test-code-2'), 'Valid code retained after cleanup');

  // Test 5: Flow status check
  const status = deviceAuth.getFlowStatus('test-code-2');
  assert(status.status === 'active', 'Active flow shows correct status');
  assert(typeof status.expiresIn === 'number', 'Expiry time is numeric');

  // Test 6: Invalid flow status
  const invalidStatus = deviceAuth.getFlowStatus('nonexistent-code');
  assert(invalidStatus.status === 'invalid', 'Invalid flow returns invalid status');

  // Test 7: Poll with invalid code
  try {
    await deviceAuth.pollAccessToken('invalid-code', 'ABC-123');
    assert(false, 'Should reject invalid device code');
  } catch (error) {
    assert(error.message.includes('Invalid') || error.message.includes('expired'), 'Invalid code rejected');
  }

  // Test 8: Manual device flow expiration
  const deviceAuth2 = new GitHubDeviceAuthManager('id', 'secret');
  const expiredCode = {
    expiresAt: Date.now() - 1000,
    codeExpired: false
  };
  deviceAuth2.activeDeviceFlows.set('expired-test', expiredCode);
  
  try {
    await deviceAuth2.pollAccessToken('expired-test', 'ABC-123');
    assert(false, 'Should reject expired device code');
  } catch (error) {
    assert(error.message.includes('expired'), 'Expired device code properly rejected');
  }

  // Test 9: Endpoints configuration
  assert(deviceAuth.deviceCodeEndpoint === 'https://github.com/login/device/code', 'Device code endpoint correct');
  assert(deviceAuth.accessTokenEndpoint === 'https://github.com/login/oauth/access_token', 'Access token endpoint correct');
  assert(deviceAuth.userEndpoint === 'https://api.github.com/user', 'User endpoint correct');

  console.log('\n═══════════════════════════════════════════');
  console.log(`   Results: ${testsPassed}/${testsRun} tests passed`);
  console.log('═══════════════════════════════════════════\n');

  process.exit(testsPassed === testsRun ? 0 : 1);
}

runTests().catch(error => {
  console.error('Test suite error:', error);
  process.exit(1);
});
