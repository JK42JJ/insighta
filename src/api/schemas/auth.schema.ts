import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { errorResponseSchema } from './common.schema';

/**
 * Authentication Schemas
 *
 * Zod schemas for runtime validation and Fastify schemas for OpenAPI generation.
 * Covers user registration, login, token refresh, and JWT payload structures.
 */

// ============================================================================
// Zod Validation Schemas (Runtime)
// ============================================================================

/**
 * User Registration Request Schema
 */
export const RegisterRequestSchema = z.object({
  email: z
    .string()
    .email('Invalid email format')
    .toLowerCase()
    .max(255, 'Email must be less than 255 characters'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be less than 128 characters')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
    ),
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters')
    .trim(),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

/**
 * Login Request Schema
 */
export const LoginRequestSchema = z.object({
  email: z.string().email('Invalid email format').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * Token Refresh Request Schema
 */
export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;

/**
 * JWT Payload Schema
 */
export const JWTPayloadSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  iat: z.number().optional(), // Issued at (added by JWT library)
  exp: z.number().optional(), // Expiration time (added by JWT library)
});

export type JWTPayload = z.infer<typeof JWTPayloadSchema>;

// ============================================================================
// Fastify Schemas (OpenAPI Documentation)
// ============================================================================

/**
 * User object schema for responses
 */
const userSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid', description: 'User unique identifier' },
    email: { type: 'string', format: 'email', description: 'User email address' },
    name: { type: 'string', description: 'User display name' },
    createdAt: { type: 'string', format: 'date-time', description: 'Account creation timestamp' },
    updatedAt: { type: 'string', format: 'date-time', description: 'Last update timestamp' },
  },
  required: ['id', 'email', 'name', 'createdAt', 'updatedAt'],
} as const;

/**
 * Authentication tokens schema
 */
const authTokensSchema = {
  type: 'object',
  properties: {
    accessToken: {
      type: 'string',
      description: 'JWT access token (expires in 15 minutes)',
    },
    refreshToken: {
      type: 'string',
      description: 'JWT refresh token (expires in 7 days)',
    },
    expiresIn: {
      type: 'number',
      description: 'Access token expiration time in seconds (900 for 15 minutes)',
    },
  },
  required: ['accessToken', 'refreshToken', 'expiresIn'],
} as const;

/**
 * POST /auth/register
 */
export const registerSchema: FastifySchema = {
  description: 'Register a new user account',
  tags: ['auth'],
  body: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        format: 'email',
        description: 'User email address',
      },
      password: {
        type: 'string',
        format: 'password',
        minLength: 8,
        maxLength: 128,
        description:
          'Password (min 8 chars, must contain uppercase, lowercase, number, and special character)',
      },
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
        description: 'User display name',
      },
    },
    required: ['email', 'password', 'name'],
  },
  response: {
    201: {
      description: 'User successfully registered',
      type: 'object',
      properties: {
        user: userSchema,
        tokens: authTokensSchema,
      },
      required: ['user', 'tokens'],
    },
    400: errorResponseSchema,
    409: {
      description: 'Email already exists',
      ...errorResponseSchema,
    },
    500: errorResponseSchema,
  },
};

/**
 * POST /auth/login
 */
export const loginSchema: FastifySchema = {
  description: 'Authenticate user and obtain access tokens',
  tags: ['auth'],
  body: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        format: 'email',
        description: 'User email address',
      },
      password: {
        type: 'string',
        format: 'password',
        description: 'User password',
      },
    },
    required: ['email', 'password'],
  },
  response: {
    200: {
      description: 'Login successful',
      type: 'object',
      properties: {
        user: userSchema,
        tokens: authTokensSchema,
      },
      required: ['user', 'tokens'],
    },
    400: errorResponseSchema,
    401: {
      description: 'Invalid credentials',
      ...errorResponseSchema,
    },
    500: errorResponseSchema,
  },
};

/**
 * POST /auth/refresh
 */
export const refreshTokenSchema: FastifySchema = {
  description: 'Refresh access token using refresh token',
  tags: ['auth'],
  body: {
    type: 'object',
    properties: {
      refreshToken: {
        type: 'string',
        description: 'Valid refresh token obtained from login or previous refresh',
      },
    },
    required: ['refreshToken'],
  },
  response: {
    200: {
      description: 'Token refreshed successfully',
      type: 'object',
      properties: {
        tokens: authTokensSchema,
      },
      required: ['tokens'],
    },
    400: errorResponseSchema,
    401: {
      description: 'Invalid or expired refresh token',
      ...errorResponseSchema,
    },
    500: errorResponseSchema,
  },
};

/**
 * POST /auth/logout
 */
export const logoutSchema: FastifySchema = {
  description: 'Invalidate refresh token and log out user',
  tags: ['auth'],
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object',
    properties: {
      refreshToken: {
        type: 'string',
        description: 'Refresh token to invalidate',
      },
    },
    required: ['refreshToken'],
  },
  response: {
    200: {
      description: 'Logout successful',
      type: 'object',
      properties: {
        message: {
          type: 'string',
        },
      },
    },
    400: errorResponseSchema,
    401: {
      description: 'Unauthorized - invalid or missing access token',
      ...errorResponseSchema,
    },
    500: errorResponseSchema,
  },
};

/**
 * GET /auth/me
 */
export const getMeSchema: FastifySchema = {
  description: 'Get current authenticated user information',
  tags: ['auth'],
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      description: 'User information retrieved successfully',
      type: 'object',
      properties: {
        user: userSchema,
      },
      required: ['user'],
    },
    401: {
      description: 'Unauthorized - invalid or missing access token',
      ...errorResponseSchema,
    },
    500: errorResponseSchema,
  },
};

// ============================================================================
// Type Exports
// ============================================================================

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RegisterResponse {
  user: User;
  tokens: AuthTokens;
}

export interface LoginResponse {
  user: User;
  tokens: AuthTokens;
}

export interface RefreshTokenResponse {
  tokens: AuthTokens;
}

export interface LogoutResponse {
  message: string;
}

export interface GetMeResponse {
  user: User;
}
