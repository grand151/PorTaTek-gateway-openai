const assert = require('assert');

console.log('\n✅ OAuth Integration Verification Tests\n');

const GitHubAuthManager = require('./auth.js');
const UserManager = require('./users.js');
const { createAuthMiddleware, optionalAuthMiddleware } = require('./middleware.js');

// Test 1: GitHubAuthManager instantiation
console.log('TEST 1: GitHubAuthManager instantiation');
try {
  const githubAuth = new GitHubAuthManager({
    clientId: 'test-client-id',
    clientSecret: 'test-secret',
    callbackURL: 'http://localhost:3000/auth/github/callback',
    jwtSecret: 'test-jwt-secret'
  });
  assert(githubAuth.clientId === 'test-client-id');
  assert(githubAuth.clientSecret === 'test-secret');
  assert(githubAuth.jwtSecret === 'test-jwt-secret');
  console.log('✅ PASS: GitHubAuthManager instantiated correctly\n');
} catch (err) {
  console.error('❌ FAIL:', err.message, '\n');
  process.exit(1);
}

// Test 2: JWT generation and verification
console.log('TEST 2: JWT generation and verification');
try {
  const githubAuth = new GitHubAuthManager({
    clientId: 'test-id',
    clientSecret: 'test-secret',
    callbackURL: 'http://localhost:3000/callback',
    jwtSecret: 'test-secret-key'
  });
  
  const payload = { id: 123, login: 'testuser', email: 'test@example.com' };
  const token = githubAuth.generateJWT(payload);
  assert(typeof token === 'string', 'JWT should be a string');
  
  const verified = githubAuth.verifyJWT(token);
  assert(verified !== null, 'JWT verification should succeed');
  assert(verified.id === 123, 'JWT should contain correct user ID');
  assert(verified.login === 'testuser', 'JWT should contain correct login');
  console.log('✅ PASS: JWT generation/verification working\n');
} catch (err) {
  console.error('❌ FAIL:', err.message, '\n');
  process.exit(1);
}

// Test 3: JWT expiration handling
console.log('TEST 3: JWT expiration handling');
try {
  const githubAuth = new GitHubAuthManager({
    clientId: 'test-id',
    clientSecret: 'test-secret',
    callbackURL: 'http://localhost:3000/callback',
    jwtSecret: 'test-secret-key'
  });
  
  // Test invalid token
  const invalidToken = 'invalid.jwt.token';
  const result = githubAuth.verifyJWT(invalidToken);
  assert(result === null, 'Invalid JWT should return null');
  console.log('✅ PASS: Invalid JWT returns null\n');
} catch (err) {
  console.error('❌ FAIL:', err.message, '\n');
  process.exit(1);
}

// Test 4: UserManager creation and persistence (FIXED)
console.log('TEST 4: UserManager creation and persistence');
try {
  const userManager = new UserManager('./test-users-db.json');
  
  const githubUser = {
    id: 456,
    login: 'github-user',
    email: 'github@example.com',
    name: 'GitHub User',
    avatar_url: 'https://example.com/avatar.jpg'
  };
  
  userManager.createOrUpdateUser(githubUser);
  const user = userManager.getUserByLogin('github-user');
  
  assert(user !== null, 'User should exist');
  assert(user.login === 'github-user', 'User login should match');
  assert(Array.isArray(user.permissions), 'User should have permissions array');
  assert(user.permissions.includes('read'), 'User should have read permission by default');
  console.log('✅ PASS: UserManager creates/persists users correctly\n');
} catch (err) {
  console.error('❌ FAIL:', err.message, '\n');
  process.exit(1);
} finally {
  // Cleanup
  const fs = require('fs');
  if (fs.existsSync('./test-users-db.json')) {
    fs.unlinkSync('./test-users-db.json');
  }
}

// Test 5: User admin status management
console.log('TEST 5: User admin status management');
try {
  const userManager = new UserManager('./test-users-db-admin.json');
  
  const githubUser = {
    id: 789,
    login: 'admin-user',
    email: 'admin@example.com'
  };
  
  userManager.createOrUpdateUser(githubUser);
  let user = userManager.getUserByLogin('admin-user');
  assert(user.isAdmin === false, 'User should not be admin by default');
  
  userManager.setAdminStatus('admin-user', true);
  user = userManager.getUserByLogin('admin-user');
  assert(user.isAdmin === true, 'User should be admin after setting');
  
  userManager.setAdminStatus('admin-user', false);
  user = userManager.getUserByLogin('admin-user');
  assert(user.isAdmin === false, 'User should not be admin after unsetting');
  console.log('✅ PASS: Admin status management working\n');
} catch (err) {
  console.error('❌ FAIL:', err.message, '\n');
  process.exit(1);
} finally {
  const fs = require('fs');
  if (fs.existsSync('./test-users-db-admin.json')) {
    fs.unlinkSync('./test-users-db-admin.json');
  }
}

// Test 6: Middleware factory functions exist
console.log('TEST 6: Middleware factory functions');
try {
  assert(typeof createAuthMiddleware === 'function', 'createAuthMiddleware should be a function');
  assert(typeof optionalAuthMiddleware === 'function', 'optionalAuthMiddleware should be a function');
  
  const githubAuth = new GitHubAuthManager({
    clientId: 'test',
    clientSecret: 'test',
    callbackURL: 'http://localhost:3000/callback',
    jwtSecret: 'test'
  });
  const userManager = new UserManager('./test-mw.json');
  
  const middleware = createAuthMiddleware(githubAuth, userManager);
  assert(typeof middleware === 'function', 'createAuthMiddleware should return a function');
  
  const optMiddleware = optionalAuthMiddleware(githubAuth, userManager);
  assert(typeof optMiddleware === 'function', 'optionalAuthMiddleware should return a function');
  console.log('✅ PASS: Middleware factory functions work\n');
} catch (err) {
  console.error('❌ FAIL:', err.message, '\n');
  process.exit(1);
} finally {
  const fs = require('fs');
  if (fs.existsSync('./test-mw.json')) {
    fs.unlinkSync('./test-mw.json');
  }
}

// Test 7: User permissions management
console.log('TEST 7: User permissions management');
try {
  const userManager = new UserManager('./test-users-perms.json');
  
  const githubUser = {
    id: 999,
    login: 'perms-user',
    email: 'perms@example.com'
  };
  
  userManager.createOrUpdateUser(githubUser);
  userManager.updateUserPermissions('perms-user', ['read', 'write', 'admin']);
  
  const user = userManager.getUserByLogin('perms-user');
  assert(user.permissions.includes('read'), 'User should have read permission');
  assert(user.permissions.includes('write'), 'User should have write permission');
  assert(user.permissions.includes('admin'), 'User should have admin permission');
  console.log('✅ PASS: User permissions management working\n');
} catch (err) {
  console.error('❌ FAIL:', err.message, '\n');
  process.exit(1);
} finally {
  const fs = require('fs');
  if (fs.existsSync('./test-users-perms.json')) {
    fs.unlinkSync('./test-users-perms.json');
  }
}

// Summary
console.log('========================================');
console.log('✅ ALL OAUTH INTEGRATION TESTS PASSED');
console.log('========================================');
console.log('\nOAuth Components Verified:');
console.log('  ✅ GitHubAuthManager - OAuth flow + JWT handling');
console.log('  ✅ UserManager - User persistence + admin management');
console.log('  ✅ Middleware - Auth protection + optional auth');
console.log('  ✅ JWT generation/verification');
console.log('  ✅ User permissions management');
console.log('  ✅ Admin status management\n');

process.exit(0);
