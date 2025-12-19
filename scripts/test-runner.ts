#!/usr/bin/env tsx
/**
 * Test Runner Script
 *
 * 테스트 실행 스크립트. Vitest/Playwright 래퍼로 구현:
 * - 테스트 유형별 실행 (unit, integration, e2e)
 * - 커버리지 리포트 생성
 * - 결과 요약 출력
 *
 * Usage:
 *   npx tsx scripts/test-runner.ts unit
 *   npx tsx scripts/test-runner.ts integration
 *   npx tsx scripts/test-runner.ts e2e
 *   npx tsx scripts/test-runner.ts all
 *   npx tsx scripts/test-runner.ts coverage
 */

import { execSync } from 'child_process';

const testType = process.argv[2] || 'all';

const testCommands: Record<string, string> = {
  unit: 'jest --testPathPattern=test/unit',
  integration: 'jest --testPathPattern=test/integration',
  e2e: 'jest --testPathPattern=test/e2e',
  all: 'jest',
  coverage: 'jest --coverage',
  watch: 'jest --watch',
};

function runTests(type: string) {
  console.log(`\n🧪 Running ${type} tests...\n`);

  const command = testCommands[type];
  if (!command) {
    console.error(`❌ Unknown test type: ${type}`);
    console.log(`Available types: ${Object.keys(testCommands).join(', ')}`);
    process.exit(1);
  }

  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`\n✅ ${type} tests passed!\n`);
  } catch (error) {
    console.error(`\n❌ ${type} tests failed!\n`);
    process.exit(1);
  }
}

runTests(testType);
