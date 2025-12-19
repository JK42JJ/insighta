import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { db as prisma } from '../../modules/database/client';
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  RefreshTokenRequestSchema,
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  logoutSchema,
  getMeSchema,
  RegisterRequest,
  LoginRequest,
  RefreshTokenRequest,
  RegisterResponse,
  LoginResponse,
  RefreshTokenResponse,
  LogoutResponse,
  GetMeResponse,
} from '../schemas/auth.schema';
import { createErrorResponse, ErrorCode } from '../schemas/common.schema';
import { createJWTPayload, verifyRefreshToken } from '../plugins/auth';

/**
 * Authentication Routes
 *
 * Endpoints:
 * - POST /auth/register - Register new user
 * - POST /auth/login - Authenticate user
 * - POST /auth/refresh - Refresh access token
 * - POST /auth/logout - Invalidate refresh token
 * - GET /auth/me - Get current user
 */

const BCRYPT_ROUNDS = 10;

/**
 * Register authentication routes
 */
export async function authRoutes(fastify: FastifyInstance) {
  /**
   * POST /auth/register
   * Register a new user account
   */
  fastify.post<{ Body: RegisterRequest; Reply: RegisterResponse }>(
    '/register',
    {
      schema: registerSchema,
    },
    async (request: FastifyRequest<{ Body: RegisterRequest }>, reply: FastifyReply) => {
      try {
        // Validate request body
        const validatedData = RegisterRequestSchema.parse(request.body);
        const { email, password, name } = validatedData;

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
          where: { email },
        });

        if (existingUser) {
          return reply.code(409).send(
            createErrorResponse(
              ErrorCode.RESOURCE_ALREADY_EXISTS,
              'An account with this email already exists',
              request.url
            )
          );
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        // Create user
        const user = await prisma.user.create({
          data: {
            email,
            passwordHash,
            name,
          },
        });

        // Generate tokens
        const jwtPayload = createJWTPayload(user);
        const tokens = await fastify.generateTokens(jwtPayload);

        // Prepare response
        const response: RegisterResponse = {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          },
          tokens,
        };

        return reply.code(201).send(response);
      } catch (error) {
        if (error instanceof Error && error.name === 'ZodError') {
          return reply.code(400).send(
            createErrorResponse(
              ErrorCode.VALIDATION_ERROR,
              'Request validation failed',
              request.url,
              { errors: error }
            )
          );
        }

        fastify.log.error({ err: error }, 'Registration error');
        return reply.code(500).send(
          createErrorResponse(
            ErrorCode.INTERNAL_SERVER_ERROR,
            'An error occurred during registration',
            request.url
          )
        );
      }
    }
  );

  /**
   * POST /auth/login
   * Authenticate user and obtain tokens
   */
  fastify.post<{ Body: LoginRequest; Reply: LoginResponse }>(
    '/login',
    {
      schema: loginSchema,
    },
    async (request: FastifyRequest<{ Body: LoginRequest }>, reply: FastifyReply) => {
      try {
        // Validate request body
        const validatedData = LoginRequestSchema.parse(request.body);
        const { email, password } = validatedData;

        // Find user by email
        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user) {
          return reply.code(401).send(
            createErrorResponse(
              ErrorCode.INVALID_CREDENTIALS,
              'Invalid email or password',
              request.url
            )
          );
        }

        // Verify password
        const passwordMatch = await bcrypt.compare(password, user.passwordHash);

        if (!passwordMatch) {
          return reply.code(401).send(
            createErrorResponse(
              ErrorCode.INVALID_CREDENTIALS,
              'Invalid email or password',
              request.url
            )
          );
        }

        // Generate tokens
        const jwtPayload = createJWTPayload(user);
        const tokens = await fastify.generateTokens(jwtPayload);

        // Prepare response
        const response: LoginResponse = {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          },
          tokens,
        };

        return reply.code(200).send(response);
      } catch (error) {
        if (error instanceof Error && error.name === 'ZodError') {
          return reply.code(400).send(
            createErrorResponse(
              ErrorCode.VALIDATION_ERROR,
              'Request validation failed',
              request.url,
              { errors: error }
            )
          );
        }

        fastify.log.error({ err: error }, 'Login error');
        return reply.code(500).send(
          createErrorResponse(
            ErrorCode.INTERNAL_SERVER_ERROR,
            'An error occurred during login',
            request.url
          )
        );
      }
    }
  );

  /**
   * POST /auth/refresh
   * Refresh access token using refresh token
   */
  fastify.post<{ Body: RefreshTokenRequest; Reply: RefreshTokenResponse }>(
    '/refresh',
    {
      schema: refreshTokenSchema,
    },
    async (request: FastifyRequest<{ Body: RefreshTokenRequest }>, reply: FastifyReply) => {
      try {
        // Validate request body
        const validatedData = RefreshTokenRequestSchema.parse(request.body);
        const { refreshToken } = validatedData;

        // Verify refresh token
        let payload;
        try {
          payload = await verifyRefreshToken(fastify, refreshToken);
        } catch (error) {
          const err = error as Error;
          if (err.message === 'REFRESH_TOKEN_EXPIRED') {
            return reply.code(401).send(
              createErrorResponse(
                ErrorCode.TOKEN_EXPIRED,
                'Refresh token has expired. Please log in again.',
                request.url
              )
            );
          } else {
            return reply.code(401).send(
              createErrorResponse(
                ErrorCode.INVALID_TOKEN,
                'Invalid refresh token',
                request.url
              )
            );
          }
        }

        // Verify user still exists
        const user = await prisma.user.findUnique({
          where: { id: payload.userId },
        });

        if (!user) {
          return reply.code(401).send(
            createErrorResponse(
              ErrorCode.UNAUTHORIZED,
              'User not found',
              request.url
            )
          );
        }

        // Generate new tokens
        const jwtPayload = createJWTPayload(user);
        const tokens = await fastify.generateTokens(jwtPayload);

        // Prepare response
        const response: RefreshTokenResponse = {
          tokens,
        };

        return reply.code(200).send(response);
      } catch (error) {
        if (error instanceof Error && error.name === 'ZodError') {
          return reply.code(400).send(
            createErrorResponse(
              ErrorCode.VALIDATION_ERROR,
              'Request validation failed',
              request.url,
              { errors: error }
            )
          );
        }

        fastify.log.error({ err: error }, 'Token refresh error');
        return reply.code(500).send(
          createErrorResponse(
            ErrorCode.INTERNAL_SERVER_ERROR,
            'An error occurred during token refresh',
            request.url
          )
        );
      }
    }
  );

  /**
   * POST /auth/logout
   * Invalidate refresh token (client-side token deletion)
   */
  fastify.post<{ Body: RefreshTokenRequest; Reply: LogoutResponse }>(
    '/logout',
    {
      schema: logoutSchema,
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest<{ Body: RefreshTokenRequest }>, reply: FastifyReply) => {
      try {
        // Note: In a production system, you would typically:
        // 1. Add the refresh token to a blacklist/revocation list in Redis or database
        // 2. Set token expiration time in the blacklist
        // 3. Check blacklist during token refresh
        //
        // For now, we'll just return success and rely on client-side token deletion

        const response: LogoutResponse = {
          message: 'Logged out successfully',
        };

        return reply.code(200).send(response);
      } catch (error) {
        fastify.log.error({ err: error }, 'Logout error');
        return reply.code(500).send(
          createErrorResponse(
            ErrorCode.INTERNAL_SERVER_ERROR,
            'An error occurred during logout',
            request.url
          )
        );
      }
    }
  );

  /**
   * GET /auth/me
   * Get current authenticated user information
   */
  fastify.get<{ Reply: GetMeResponse }>(
    '/me',
    {
      schema: getMeSchema,
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      // Fetch fresh user data from database
      const user = await prisma.user.findUnique({
        where: { id: request.user.userId },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Prepare response
      const response: GetMeResponse = {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      };

      return reply.code(200).send(response);
    }
  );

  fastify.log.info('Authentication routes registered');
}
