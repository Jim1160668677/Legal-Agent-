/**
 * 用户模型
 */
export interface User {
  userId: string;
  username: string;
  nickname?: string;
  email?: string;
  phone?: string;
  avatar?: string;
  role: 'user' | 'lawyer' | 'admin';
  createdAt: number;
  lastLoginAt?: number;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}
