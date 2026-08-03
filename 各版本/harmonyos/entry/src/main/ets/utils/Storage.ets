﻿/**
 * 本地存储工具
 */
import { user_prefs } from '@kit.ArkUI';
import {
  TOKEN_STORAGE_KEY,
  REFRESH_TOKEN_STORAGE_KEY,
  USER_INFO_STORAGE_KEY
} from './Constants';
import { User } from '../models/User';

let prefs: user_prefs.UserPreferences | null = null;

export async function initStorage(): Promise<void> {
  if (!prefs) {
    prefs = await user_prefs.getPreferences('legal_agent_prefs');
  }
}

export async function saveAccessToken(token: string): Promise<void> {
  await initStorage();
  await prefs?.put(TOKEN_STORAGE_KEY, token);
  await prefs?.flush();
}

export async function getAccessToken(): Promise<string | null> {
  await initStorage();
  return (await prefs?.get(TOKEN_STORAGE_KEY, '')) ?? null;
}

export async function saveRefreshToken(token: string): Promise<void> {
  await initStorage();
  await prefs?.put(REFRESH_TOKEN_STORAGE_KEY, token);
  await prefs?.flush();
}

export async function getRefreshToken(): Promise<string | null> {
  await initStorage();
  return (await prefs?.get(REFRESH_TOKEN_STORAGE_KEY, '')) ?? null;
}

export async function saveUserInfo(user: User): Promise<void> {
  await initStorage();
  await prefs?.put(USER_INFO_STORAGE_KEY, JSON.stringify(user));
  await prefs?.flush();
}

export async function getUserInfo(): Promise<User | null> {
  await initStorage();
  const data = await prefs?.get(USER_INFO_STORAGE_KEY, '');
  if (data) {
    try {
      return JSON.parse(data) as User;
    } catch (_e) {
      return null;
    }
  }
  return null;
}

export async function clearAuth(): Promise<void> {
  await initStorage();
  await prefs?.delete(TOKEN_STORAGE_KEY);
  await prefs?.delete(REFRESH_TOKEN_STORAGE_KEY);
  await prefs?.delete(USER_INFO_STORAGE_KEY);
  await prefs?.flush();
}

export async function isLoggedIn(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null && token.length > 0;
}

export async function save<T>(key: string, value: T): Promise<void> {
  await initStorage();
  await prefs?.put(key, JSON.stringify(value));
  await prefs?.flush();
}

export async function get<T>(key: string, defaultValue: T): Promise<T> {
  await initStorage();
  const data = await prefs?.get(key, '');
  if (data) {
    try {
      return JSON.parse(data) as T;
    } catch (_e) {
      return defaultValue;
    }
  }
  return defaultValue;
}

export async function remove(key: string): Promise<void> {
  await initStorage();
  await prefs?.delete(key);
  await prefs?.flush();
}
