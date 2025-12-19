/**
 * Error Utilities Unit Tests
 *
 * Tests for custom error classes and error handling utilities
 */

import {
  AppError,
  YouTubeAPIError,
  QuotaExceededError,
  AuthenticationError,
  InvalidCredentialsError,
  DatabaseError,
  RecordNotFoundError,
  ValidationError,
  InvalidPlaylistError,
  SyncError,
  ConcurrentSyncError,
  isOperationalError,
  getErrorMessage,
  getErrorDetails,
  isRetryableError,
} from '../../../src/utils/errors';

describe('Error Classes', () => {
  describe('AppError', () => {
    test('should create basic app error', () => {
      const error = new AppError('Test error', 'TEST_ERROR');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(true);
      expect(error.name).toBe('AppError');
    });

    test('should create app error with custom properties', () => {
      const error = new AppError('Test error', 'TEST_ERROR', 400, false, { key: 'value' });

      expect(error.statusCode).toBe(400);
      expect(error.isOperational).toBe(false);
      expect(error.details).toEqual({ key: 'value' });
    });

    test('should capture stack trace', () => {
      const error = new AppError('Test error', 'TEST_ERROR');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('Error');
    });
  });

  describe('YouTubeAPIError', () => {
    test('should create YouTube API error', () => {
      const error = new YouTubeAPIError('API failed');

      expect(error.message).toBe('API failed');
      expect(error.code).toBe('YOUTUBE_API_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error instanceof AppError).toBe(true);
    });

    test('should create YouTube API error with custom status', () => {
      const error = new YouTubeAPIError('API failed', 503, { reason: 'unavailable' });

      expect(error.statusCode).toBe(503);
      expect(error.details).toEqual({ reason: 'unavailable' });
    });
  });

  describe('QuotaExceededError', () => {
    test('should create quota exceeded error', () => {
      const error = new QuotaExceededError({ used: 10000, limit: 10000 });

      expect(error.message).toBe('YouTube API quota exceeded');
      expect(error.code).toBe('QUOTA_EXCEEDED');
      expect(error.statusCode).toBe(429);
      expect(error.details).toEqual({ used: 10000, limit: 10000 });
    });

    test('should extend YouTubeAPIError', () => {
      const error = new QuotaExceededError();

      expect(error instanceof YouTubeAPIError).toBe(true);
      expect(error instanceof AppError).toBe(true);
    });
  });

  describe('AuthenticationError', () => {
    test('should create authentication error with default message', () => {
      const error = new AuthenticationError();

      expect(error.message).toBe('YouTube API authentication failed');
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.statusCode).toBe(401);
    });

    test('should create authentication error with custom message', () => {
      const error = new AuthenticationError('Invalid token', { token: 'expired' });

      expect(error.message).toBe('Invalid token');
      expect(error.details).toEqual({ token: 'expired' });
    });
  });

  describe('InvalidCredentialsError', () => {
    test('should create invalid credentials error', () => {
      const error = new InvalidCredentialsError({ reason: 'expired' });

      expect(error.message).toBe('Invalid or expired credentials');
      expect(error.code).toBe('INVALID_CREDENTIALS');
      expect(error.statusCode).toBe(401);
      expect(error.details).toEqual({ reason: 'expired' });
    });

    test('should extend AuthenticationError', () => {
      const error = new InvalidCredentialsError();

      expect(error instanceof AuthenticationError).toBe(true);
      expect(error instanceof YouTubeAPIError).toBe(true);
    });
  });

  describe('DatabaseError', () => {
    test('should create database error', () => {
      const error = new DatabaseError('Connection failed', { host: 'localhost' });

      expect(error.message).toBe('Connection failed');
      expect(error.code).toBe('DATABASE_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.details).toEqual({ host: 'localhost' });
    });
  });

  describe('RecordNotFoundError', () => {
    test('should create record not found error', () => {
      const error = new RecordNotFoundError('User', 'user-123');

      expect(error.message).toBe('User not found: user-123');
      expect(error.code).toBe('RECORD_NOT_FOUND');
      expect(error.statusCode).toBe(404);
      expect(error.details).toEqual({ entity: 'User', id: 'user-123' });
    });

    test('should merge additional details', () => {
      const error = new RecordNotFoundError('Video', 'video-1', { reason: 'deleted' });

      expect(error.details).toEqual({
        entity: 'Video',
        id: 'video-1',
        reason: 'deleted',
      });
    });
  });

  describe('ValidationError', () => {
    test('should create validation error', () => {
      const error = new ValidationError('Invalid input', { field: 'email' });

      expect(error.message).toBe('Invalid input');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ field: 'email' });
    });
  });

  describe('InvalidPlaylistError', () => {
    test('should create invalid playlist error', () => {
      const error = new InvalidPlaylistError('PLtest123', { reason: 'not_found' });

      expect(error.message).toBe('Invalid playlist: PLtest123');
      expect(error.code).toBe('INVALID_PLAYLIST');
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({
        playlistId: 'PLtest123',
        reason: 'not_found',
      });
    });

    test('should extend ValidationError', () => {
      const error = new InvalidPlaylistError('PLtest');

      expect(error instanceof ValidationError).toBe(true);
      expect(error instanceof AppError).toBe(true);
    });
  });

  describe('SyncError', () => {
    test('should create sync error', () => {
      const error = new SyncError('Sync failed', { playlistId: 'playlist-1' });

      expect(error.message).toBe('Sync failed');
      expect(error.code).toBe('SYNC_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.details).toEqual({ playlistId: 'playlist-1' });
    });
  });

  describe('ConcurrentSyncError', () => {
    test('should create concurrent sync error', () => {
      const error = new ConcurrentSyncError('playlist-1');

      expect(error.message).toBe('Playlist already being synced: playlist-1');
      expect(error.code).toBe('CONCURRENT_SYNC');
      expect(error.statusCode).toBe(409);
      expect(error.details).toEqual({ playlistId: 'playlist-1' });
    });

    test('should extend SyncError', () => {
      const error = new ConcurrentSyncError('playlist-1');

      expect(error instanceof SyncError).toBe(true);
      expect(error instanceof AppError).toBe(true);
    });
  });
});

describe('Error Utility Functions', () => {
  describe('isOperationalError', () => {
    test('should return true for operational AppError', () => {
      const error = new AppError('Test', 'TEST', 500, true);

      expect(isOperationalError(error)).toBe(true);
    });

    test('should return false for non-operational AppError', () => {
      const error = new AppError('Test', 'TEST', 500, false);

      expect(isOperationalError(error)).toBe(false);
    });

    test('should return false for standard Error', () => {
      const error = new Error('Test');

      expect(isOperationalError(error)).toBe(false);
    });

    test('should return true for custom error classes', () => {
      const error1 = new YouTubeAPIError('Test');
      const error2 = new DatabaseError('Test');
      const error3 = new ValidationError('Test');

      expect(isOperationalError(error1)).toBe(true);
      expect(isOperationalError(error2)).toBe(true);
      expect(isOperationalError(error3)).toBe(true);
    });
  });

  describe('getErrorMessage', () => {
    test('should extract message from Error', () => {
      const error = new Error('Test error');

      expect(getErrorMessage(error)).toBe('Test error');
    });

    test('should extract message from AppError', () => {
      const error = new AppError('App error', 'TEST');

      expect(getErrorMessage(error)).toBe('App error');
    });

    test('should return string error as-is', () => {
      expect(getErrorMessage('String error')).toBe('String error');
    });

    test('should handle unknown error types', () => {
      expect(getErrorMessage(null)).toBe('Unknown error occurred');
      expect(getErrorMessage(undefined)).toBe('Unknown error occurred');
      expect(getErrorMessage(123)).toBe('Unknown error occurred');
      expect(getErrorMessage({})).toBe('Unknown error occurred');
    });
  });

  describe('getErrorDetails', () => {
    test('should extract details from AppError', () => {
      const error = new AppError('Test', 'TEST', 500, true, { key: 'value' });

      expect(getErrorDetails(error)).toEqual({ key: 'value' });
    });

    test('should extract standard Error properties', () => {
      const error = new Error('Test error');

      const details = getErrorDetails(error);

      expect(details['name']).toBe('Error');
      expect(details['message']).toBe('Test error');
      expect(details['stack']).toBeDefined();
    });

    test('should return empty object for AppError without details', () => {
      const error = new AppError('Test', 'TEST');

      expect(getErrorDetails(error)).toEqual({});
    });

    test('should handle unknown error types', () => {
      expect(getErrorDetails(null)).toEqual({});
      expect(getErrorDetails(undefined)).toEqual({});
      expect(getErrorDetails('string')).toEqual({});
      expect(getErrorDetails(123)).toEqual({});
    });
  });

  describe('isRetryableError', () => {
    test('should not retry QuotaExceededError', () => {
      const error = new QuotaExceededError();

      expect(isRetryableError(error)).toBe(false);
    });

    test('should not retry AuthenticationError', () => {
      const error = new AuthenticationError();

      expect(isRetryableError(error)).toBe(false);
    });

    test('should not retry InvalidCredentialsError', () => {
      const error = new InvalidCredentialsError();

      expect(isRetryableError(error)).toBe(false);
    });

    test('should not retry ValidationError', () => {
      const error = new ValidationError('Invalid');

      expect(isRetryableError(error)).toBe(false);
    });

    test('should not retry InvalidPlaylistError', () => {
      const error = new InvalidPlaylistError('PLtest');

      expect(isRetryableError(error)).toBe(false);
    });

    test('should retry YouTube API server errors (5xx)', () => {
      const error = new YouTubeAPIError('Server error', 500);

      expect(isRetryableError(error)).toBe(true);
    });

    test('should not retry YouTube API client errors (4xx)', () => {
      const error = new YouTubeAPIError('Client error', 400);

      expect(isRetryableError(error)).toBe(false);
    });

    test('should retry unknown errors', () => {
      const error = new Error('Unknown error');

      expect(isRetryableError(error)).toBe(true);
    });

    test('should retry DatabaseError', () => {
      const error = new DatabaseError('Connection failed');

      expect(isRetryableError(error)).toBe(true);
    });

    test('should retry SyncError', () => {
      const error = new SyncError('Sync failed');

      expect(isRetryableError(error)).toBe(true);
    });

    test('should retry non-Error objects', () => {
      expect(isRetryableError('string error')).toBe(true);
      expect(isRetryableError(null)).toBe(true);
      expect(isRetryableError(undefined)).toBe(true);
    });
  });
});
