const fs = require('fs');
const path = require('path');

class UserManager {
  constructor(dbPath = './users-db.json') {
    this.dbPath = dbPath;
    this.users = this.loadUsers();
  }

  loadUsers() {
    if (!fs.existsSync(this.dbPath)) {
      return {};
    }
    try {
      const data = fs.readFileSync(this.dbPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load users database:', error.message);
      return {};
    }
  }

  saveUsers() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.users, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save users database:', error.message);
    }
  }

  async createOrUpdateUser(githubUser) {
    const userId = `github_${githubUser.id}`;
    
    const user = {
      id: userId,
      githubId: githubUser.id,
      login: githubUser.login,
      name: githubUser.name,
      email: githubUser.email,
      avatar_url: githubUser.avatar_url,
      bio: githubUser.bio,
      public_repos: githubUser.public_repos,
      createdAt: this.users[userId]?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
      isAdmin: this.users[userId]?.isAdmin || false,
      permissions: this.users[userId]?.permissions || ['read']
    };

    this.users[userId] = user;
    this.saveUsers();
    
    return user;
  }

  getUserById(userId) {
    return this.users[userId] || null;
  }

  getUserByLogin(login) {
    return Object.values(this.users).find(u => u.login === login) || null;
  }

  getAllUsers() {
    return Object.values(this.users);
  }

  deleteUser(userId) {
    delete this.users[userId];
    this.saveUsers();
  }

  setAdminStatus(userId, isAdmin) {
    if (this.users[userId]) {
      this.users[userId].isAdmin = isAdmin;
      this.saveUsers();
      return this.users[userId];
    }
    return null;
  }

  updateUserPermissions(userId, permissions) {
    if (this.users[userId]) {
      this.users[userId].permissions = permissions;
      this.saveUsers();
      return this.users[userId];
    }
    return null;
  }
}

module.exports = UserManager;
