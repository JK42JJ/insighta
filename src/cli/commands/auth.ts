/**
 * User Authentication Commands for CLI
 *
 * Commands for user registration, login, logout, and profile management
 */

import { Command } from 'commander';
import * as readline from 'readline/promises';
import { createApiClient, ApiClientError } from '../api-client';
import { getTokenStorage, StoredTokens } from '../token-storage';

/**
 * Prompt for password input (hidden)
 */
async function promptPassword(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    // Hide password input
    const stdin = process.stdin as any;
    const originalRawMode = stdin.isRaw;
    stdin.setRawMode?.(true);

    process.stdout.write(prompt);

    let password = '';
    stdin.on('data', (char: Buffer) => {
      const c = char.toString('utf8');

      if (c === '\n' || c === '\r' || c === '\u0004') {
        // Enter or Ctrl+D
        stdin.setRawMode?.(originalRawMode);
        process.stdout.write('\n');
        rl.close();
        resolve(password);
      } else if (c === '\u0003') {
        // Ctrl+C
        process.exit(1);
      } else if (c === '\u007f' || c === '\b') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += c;
        process.stdout.write('*');
      }
    });
  });
}

/**
 * Prompt for text input
 */
async function promptText(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await rl.question(prompt);
  rl.close();
  return answer.trim();
}

/**
 * Register a new user
 */
export async function registerCommand(): Promise<void> {
  try {
    console.log('\n👤 User Registration\n');

    // Check if already logged in
    const tokenStorage = getTokenStorage();
    const existingTokens = await tokenStorage.getValidTokens();

    if (existingTokens) {
      console.log(`⚠️  You are already logged in as ${existingTokens.user.email}`);
      console.log('Please logout first using: yt-sync user-logout\n');
      return;
    }

    // Collect user information
    const name = await promptText('Full Name: ');
    if (!name) {
      console.error('❌ Name is required');
      process.exit(1);
    }

    const email = await promptText('Email: ');
    if (!email) {
      console.error('❌ Email is required');
      process.exit(1);
    }

    const password = await promptPassword('Password: ');
    if (!password) {
      console.error('❌ Password is required');
      process.exit(1);
    }

    const confirmPassword = await promptPassword('Confirm Password: ');
    if (password !== confirmPassword) {
      console.error('❌ Passwords do not match');
      process.exit(1);
    }

    // Register user
    console.log('\n🔄 Creating account...\n');

    const apiClient = createApiClient();
    const response = await apiClient.register({ email, password, name });

    // Save tokens
    const tokens: StoredTokens = {
      accessToken: response.tokens.accessToken,
      refreshToken: response.tokens.refreshToken,
      expiresAt: Date.now() + response.tokens.expiresIn * 1000,
      user: response.user,
    };

    await tokenStorage.saveTokens(tokens);

    console.log('✅ Registration successful!\n');
    console.log(`   Name: ${response.user.name}`);
    console.log(`   Email: ${response.user.email}`);
    console.log(`   User ID: ${response.user.id}\n`);
    console.log('💡 You are now logged in. Try:');
    console.log('   - yt-sync import <playlist-url>');
    console.log('   - yt-sync list\n');
  } catch (error) {
    if (error instanceof ApiClientError) {
      console.error(`\n❌ Registration failed: ${error.message}`);
      if (error.code === 'USER_ALREADY_EXISTS' || error.code === 'DUPLICATE_RESOURCE') {
        console.error('\n💡 This email is already registered. Try logging in instead:');
        console.error('   yt-sync user-login\n');
      }
    } else {
      console.error(`\n❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(1);
  }
}

/**
 * Login existing user
 */
export async function loginCommand(): Promise<void> {
  try {
    console.log('\n🔐 User Login\n');

    // Check if already logged in
    const tokenStorage = getTokenStorage();
    const existingTokens = await tokenStorage.getValidTokens();

    if (existingTokens) {
      console.log(`⚠️  You are already logged in as ${existingTokens.user.email}`);
      console.log('To switch accounts, logout first using: yt-sync user-logout\n');
      return;
    }

    // Collect credentials
    const email = await promptText('Email: ');
    if (!email) {
      console.error('❌ Email is required');
      process.exit(1);
    }

    const password = await promptPassword('Password: ');
    if (!password) {
      console.error('❌ Password is required');
      process.exit(1);
    }

    // Login
    console.log('\n🔄 Authenticating...\n');

    const apiClient = createApiClient();
    const response = await apiClient.login({ email, password });

    // Save tokens
    const tokens: StoredTokens = {
      accessToken: response.tokens.accessToken,
      refreshToken: response.tokens.refreshToken,
      expiresAt: Date.now() + response.tokens.expiresIn * 1000,
      user: response.user,
    };

    await tokenStorage.saveTokens(tokens);

    console.log('✅ Login successful!\n');
    console.log(`   Welcome back, ${response.user.name}!`);
    console.log(`   Email: ${response.user.email}\n`);
    console.log('💡 You can now use all commands:');
    console.log('   - yt-sync import <playlist-url>');
    console.log('   - yt-sync list');
    console.log('   - yt-sync sync --all\n');
  } catch (error) {
    if (error instanceof ApiClientError) {
      console.error(`\n❌ Login failed: ${error.message}`);
      if (error.code === 'INVALID_CREDENTIALS') {
        console.error('\n💡 Incorrect email or password. Please try again.\n');
      }
    } else {
      console.error(`\n❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(1);
  }
}

/**
 * Logout current user
 */
export async function logoutCommand(): Promise<void> {
  try {
    console.log('\n👋 User Logout\n');

    const tokenStorage = getTokenStorage();
    const tokens = await tokenStorage.loadTokens();

    if (!tokens) {
      console.log('⚠️  You are not logged in\n');
      return;
    }

    // Logout from API (invalidate refresh token)
    try {
      const apiClient = createApiClient(tokens.accessToken);
      await apiClient.logout(tokens.refreshToken);
    } catch (error) {
      // Continue even if API logout fails (e.g., token already expired)
      console.log('⚠️  Note: Could not invalidate server session');
    }

    // Clear local tokens
    await tokenStorage.clearTokens();

    console.log('✅ Logged out successfully\n');
    console.log('💡 To login again, use: yt-sync user-login\n');
  } catch (error) {
    console.error(`\n❌ Logout failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

/**
 * Show current user information
 */
export async function whoamiCommand(): Promise<void> {
  try {
    const tokenStorage = getTokenStorage();
    const tokens = await tokenStorage.getValidTokens();

    if (!tokens) {
      console.log('\n⚠️  You are not logged in\n');
      console.log('To login, use: yt-sync user-login');
      console.log('To register, use: yt-sync user-register\n');
      return;
    }

    // Fetch fresh profile from API
    console.log('\n🔍 Fetching user profile...\n');

    const apiClient = createApiClient(tokens.accessToken);
    const response = await apiClient.getProfile();

    console.log('═══════════════════════════════════════════');
    console.log('          👤 USER PROFILE 👤          ');
    console.log('═══════════════════════════════════════════\n');

    console.log(`   Name: ${response.user.name}`);
    console.log(`   Email: ${response.user.email}`);
    console.log(`   User ID: ${response.user.id}`);
    console.log(`   Member Since: ${new Date(response.user.createdAt).toLocaleDateString()}\n`);

    // Show token expiry
    const expiresIn = Math.max(0, tokens.expiresAt - Date.now());
    const expiresInMinutes = Math.floor(expiresIn / (1000 * 60));
    const expiresInHours = Math.floor(expiresInMinutes / 60);

    if (expiresInHours > 0) {
      console.log(`   Session Expires: In ${expiresInHours} hour(s)`);
    } else if (expiresInMinutes > 0) {
      console.log(`   Session Expires: In ${expiresInMinutes} minute(s)`);
    } else {
      console.log(`   Session Expires: Soon (please re-login)`);
    }

    console.log('\n═══════════════════════════════════════════\n');
  } catch (error) {
    if (error instanceof ApiClientError && error.statusCode === 401) {
      console.error('\n❌ Session expired. Please login again:\n');
      console.error('   yt-sync user-login\n');

      // Clear invalid tokens
      const tokenStorage = getTokenStorage();
      await tokenStorage.clearTokens();
    } else {
      console.error(`\n❌ Failed to get profile: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(1);
  }
}

/**
 * Register user authentication commands
 */
export function registerAuthCommands(program: Command): void {
  program
    .command('user-register')
    .description('Register a new user account')
    .action(registerCommand);

  program
    .command('user-login')
    .description('Login to your account')
    .action(loginCommand);

  program
    .command('user-logout')
    .description('Logout and clear session')
    .action(logoutCommand);

  program
    .command('user-whoami')
    .alias('whoami')
    .description('Show current user information')
    .action(whoamiCommand);
}
