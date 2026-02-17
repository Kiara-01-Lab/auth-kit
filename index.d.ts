// Type definitions for AuthKit
// Project: https://github.com/Kiara-02-Lab-OW/auth.api

import { EventEmitter } from 'events';
import { Request, Response, NextFunction, RequestHandler } from 'express';

// ============================================================================
// CONFIG
// ============================================================================

export interface PasswordPolicy {
  minLength?: number;
  requireUppercase?: boolean;
  requireNumbers?: boolean;
}

export interface AuthKitConfig {
  /** Storage adapter — defaults to MemoryAdapter */
  adapter?: StorageAdapter;
  /** 'memory' | 'file' — shorthand if not passing adapter directly */
  storage?: 'memory' | 'file';
  /** Path to SQLite file (implies storage: 'file') */
  filename?: string;
  /** Session token TTL — e.g. '7d', '24h', '30m' — defaults to '7d' */
  tokenExpiry?: string | number;
  /** Password requirements */
  passwordPolicy?: PasswordPolicy;
  /** Role → permission mappings. Use '*' for superuser */
  roles?: Record<string, string[]>;
}

// ============================================================================
// ENTITIES
// ============================================================================

export interface User {
  id: string;
  email: string;
  username?: string | null;
  roles: string[];
  metadata: Record<string, any>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at?: string | null;
  /** password_hash is NEVER returned from public methods */
}

export interface TokenRecord {
  id: string;
  user_id: string;
  token_type: 'session';
  expires_at: string | null;
  created_at: string;
  last_used_at?: string | null;
}

export interface APIKeyRecord {
  id: string;
  user_id: string;
  name?: string | null;
  expires_at?: string | null;
  created_at: string;
  last_used_at?: string | null;
}

export interface LoginResult {
  user: User;
  token: string;
  expiresAt: string;
}

export interface RefreshResult {
  token: string;
  expiresAt: string;
}

export interface CreateAPIKeyResult {
  /** Plaintext key — shown only once. Store it securely. */
  key: string;
  record: APIKeyRecord;
}

export interface UserQuery {
  role?: string;
  keyword?: string;
}

// ============================================================================
// STORAGE ADAPTER INTERFACE
// ============================================================================

export interface StorageAdapter {
  init(): Promise<StorageAdapter>;
  close(): Promise<void>;

  // Users
  createUser(data: any): Promise<any>;
  getUser(id: string): Promise<any>;
  getUserByEmail(email: string): Promise<any>;
  listUsers(query?: UserQuery): Promise<any[]>;
  updateUser(id: string, updates: any): Promise<any>;
  deleteUser(id: string): Promise<void>;

  // Tokens
  createToken(data: any): Promise<any>;
  getToken(tokenHash: string): Promise<any>;
  deleteToken(tokenHash: string): Promise<void>;
  deleteUserTokens(userId: string): Promise<void>;
  updateTokenLastUsed(tokenHash: string): Promise<void>;

  // API Keys
  createAPIKey(data: any): Promise<any>;
  getAPIKey(keyHash: string): Promise<any>;
  listAPIKeys(userId: string): Promise<any[]>;
  deleteAPIKey(id: string): Promise<void>;
  updateAPIKeyLastUsed(keyHash: string): Promise<void>;
}

// ============================================================================
// ADAPTERS
// ============================================================================

export class MemoryAdapter implements StorageAdapter {
  init(): Promise<MemoryAdapter>;
  close(): Promise<void>;
  createUser(data: any): Promise<any>;
  getUser(id: string): Promise<any>;
  getUserByEmail(email: string): Promise<any>;
  listUsers(query?: UserQuery): Promise<any[]>;
  updateUser(id: string, updates: any): Promise<any>;
  deleteUser(id: string): Promise<void>;
  createToken(data: any): Promise<any>;
  getToken(tokenHash: string): Promise<any>;
  deleteToken(tokenHash: string): Promise<void>;
  deleteUserTokens(userId: string): Promise<void>;
  updateTokenLastUsed(tokenHash: string): Promise<void>;
  createAPIKey(data: any): Promise<any>;
  getAPIKey(keyHash: string): Promise<any>;
  listAPIKeys(userId: string): Promise<any[]>;
  deleteAPIKey(id: string): Promise<void>;
  updateAPIKeyLastUsed(keyHash: string): Promise<void>;
}

export class SQLiteAdapter implements StorageAdapter {
  constructor(dbPath?: string);
  init(): Promise<SQLiteAdapter>;
  close(): Promise<void>;
  createUser(data: any): Promise<any>;
  getUser(id: string): Promise<any>;
  getUserByEmail(email: string): Promise<any>;
  listUsers(query?: UserQuery): Promise<any[]>;
  updateUser(id: string, updates: any): Promise<any>;
  deleteUser(id: string): Promise<void>;
  createToken(data: any): Promise<any>;
  getToken(tokenHash: string): Promise<any>;
  deleteToken(tokenHash: string): Promise<void>;
  deleteUserTokens(userId: string): Promise<void>;
  updateTokenLastUsed(tokenHash: string): Promise<void>;
  createAPIKey(data: any): Promise<any>;
  getAPIKey(keyHash: string): Promise<any>;
  listAPIKeys(userId: string): Promise<any[]>;
  deleteAPIKey(id: string): Promise<void>;
  updateAPIKeyLastUsed(keyHash: string): Promise<void>;
}

// ============================================================================
// AUTHKIT
// ============================================================================

export class AuthKit extends EventEmitter {
  constructor(config?: AuthKitConfig);

  /** Factory method — use this instead of new */
  static create(config?: AuthKitConfig): Promise<AuthKit>;

  // Users
  createUser(data: { email: string; password: string; username?: string; roles?: string[]; metadata?: Record<string, any> }): Promise<User>;
  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  listUsers(query?: UserQuery): Promise<User[]>;
  updateUser(id: string, updates: Partial<Omit<User, 'id' | 'password_hash'>>): Promise<User>;
  deleteUser(id: string): Promise<void>;

  // Authentication
  login(email: string, password: string): Promise<LoginResult>;
  logout(token: string): Promise<void>;
  verifyToken(token: string): Promise<User | null>;
  refreshToken(token: string): Promise<RefreshResult>;
  changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void>;
  resetPassword(userId: string, newPassword: string): Promise<void>;

  // API Keys
  createAPIKey(userId: string, options?: { name?: string; expiresAt?: string }): Promise<CreateAPIKeyResult>;
  revokeAPIKey(id: string): Promise<void>;
  listAPIKeys(userId: string): Promise<APIKeyRecord[]>;

  // RBAC
  assignRole(userId: string, role: string): Promise<User>;
  removeRole(userId: string, role: string): Promise<User>;
  hasRole(user: User, role: string): boolean;
  hasPermission(user: User, permission: string): boolean;

  // Express middleware
  expressMiddleware(): RequestHandler;
  requireAuth(): RequestHandler;
  requireRole(role: string): RequestHandler;
  requirePermission(permission: string): RequestHandler;

  close(): Promise<void>;

  // Events
  on(event: 'user:created', listener: (user: User) => void): this;
  on(event: 'user:updated', listener: (user: User) => void): this;
  on(event: 'user:deleted', listener: (data: { id: string }) => void): this;
  on(event: 'user:login', listener: (data: { user: User }) => void): this;
  on(event: 'user:logout', listener: (data: { user_id: string }) => void): this;
  on(event: 'user:failed_login', listener: (data: { email: string }) => void): this;
  on(event: 'user:password_changed', listener: (data: { user_id: string }) => void): this;
  on(event: 'user:password_reset', listener: (data: { user_id: string }) => void): this;
  on(event: 'token:expired', listener: (data: { user_id: string }) => void): this;
  on(event: 'apikey:created', listener: (data: { user_id: string; name?: string }) => void): this;
  on(event: 'apikey:revoked', listener: (data: { id: string }) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
}
