---
name: testing-patterns
description: 테스트 작성 패턴 및 가이드
---

# Testing Patterns

## Test File Naming
- Unit: `*.test.ts`
- Integration: `*.integration.test.ts`
- E2E: `*.e2e.test.ts`

## Test Structure (AAA Pattern)
```typescript
describe('UserService', () => {
  describe('createUser', () => {
    it('should create user with valid data', async () => {
      // Arrange
      const userData = { email: 'test@example.com' };

      // Act
      const user = await userService.createUser(userData);

      // Assert
      expect(user.email).toBe(userData.email);
    });
  });
});
```

## Mocking with Jest
```typescript
// Mock YouTube API
jest.mock('googleapis', () => ({
  google: {
    youtube: jest.fn(() => ({
      playlists: {
        list: jest.fn().mockResolvedValue({ data: mockPlaylistData }),
      },
      playlistItems: {
        list: jest.fn().mockResolvedValue({ data: mockItemsData }),
      },
    })),
  },
}));

// Mock Prisma client
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => ({
    playlist: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  })),
}));
```

## Integration Test Example
```typescript
// Test database operations
describe('PlaylistService Integration', () => {
  beforeEach(async () => {
    await prisma.playlist.deleteMany();
  });

  it('should create and retrieve playlist', async () => {
    const created = await playlistService.create({
      youtubeId: 'PLtest',
      title: 'Test Playlist',
    });

    const retrieved = await playlistService.findById(created.id);
    expect(retrieved).toEqual(created);
  });
});
```

## Test Coverage Requirements
- Unit tests: 80%+ coverage
- Integration tests: 70%+ coverage
- Critical paths: 100% coverage (auth, sync, quota)

## Running Tests
```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:cov

# Specific test file
npm test -- playlist.test.ts
```
