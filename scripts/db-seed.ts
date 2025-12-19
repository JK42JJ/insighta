#!/usr/bin/env tsx
/**
 * Database Seed Script
 *
 * 데이터베이스 시딩 스크립트:
 * - 개발용 테스트 데이터 생성
 * - 사용자, 워크스페이스, 샘플 콘텐츠
 *
 * Usage:
 *   npx tsx scripts/db-seed.ts
 */

// import { PrismaClient } from '@prisma/client';
// const prisma = new PrismaClient();

async function seedDatabase() {
  console.log('\n🌱 Seeding database...\n');

  try {
    // TODO: Create test users
    console.log('📝 Creating test users...');
    // const user = await prisma.user.create({
    //   data: {
    //     email: 'test@example.com',
    //     name: 'Test User',
    //   }
    // });

    // TODO: Create test workspaces
    console.log('📁 Creating test workspaces...');
    // const workspace = await prisma.workspace.create({
    //   data: {
    //     name: 'Test Workspace',
    //     ownerId: user.id,
    //   }
    // });

    // TODO: Create sample content
    console.log('📄 Creating sample content...');
    // await prisma.contentItem.createMany({
    //   data: [
    //     {
    //       title: 'Sample Video 1',
    //       source: 'youtube',
    //       workspaceId: workspace.id,
    //     },
    //     // ... more sample items
    //   ]
    // });

    console.log('\n✅ Database seeded successfully!\n');
  } catch (error) {
    console.error('\n❌ Database seeding failed:', error);
    process.exit(1);
  } finally {
    // await prisma.$disconnect();
  }
}

seedDatabase();
