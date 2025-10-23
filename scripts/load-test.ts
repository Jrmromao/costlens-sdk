#!/usr/bin/env ts-node

import { CostLens } from '../src/index';
import { LoadTestRunner, printLoadTestResults, LoadTestConfig } from '../tests/load-test-utils';

// Mock fetch for load testing
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ success: true }),
});

async function runLoadTests() {
  console.log('🚀 Starting CostLens SDK Load Tests...\n');

  const promptcraft = new CostLens({
    apiKey: process.env.COSTLENS_API_KEY || 'test-load-key',
    enableCache: true,
    maxRetries: 3,
  });

  try {
    // Quick Load Test (30 seconds)
    console.log('📊 Running Quick Load Test (30s)...');
    const quickResults = await LoadTestRunner.runQuickLoadTest(promptcraft);
    printLoadTestResults(quickResults);

    // Stress Test (60 seconds)
    console.log('💪 Running Stress Test (60s)...');
    const stressResults = await LoadTestRunner.runStressTest(promptcraft);
    printLoadTestResults(stressResults);

    // Custom Load Test
    console.log('⚙️  Running Custom Load Test...');
    const customConfig: LoadTestConfig = {
      concurrentUsers: 25,
      requestsPerUser: 50,
      delayBetweenRequests: 50,
      testDuration: 45000, // 45 seconds
      models: ['gpt-4', 'gpt-3.5-turbo', 'claude-3-opus', 'claude-3-haiku'],
      enableCache: true,
      cacheTTL: 120000, // 2 minutes
    };

    const customRunner = new LoadTestRunner(promptcraft, customConfig);
    const customResults = await customRunner.runLoadTest();
    printLoadTestResults(customResults);

    // Summary
    console.log('📈 Load Test Summary:');
    console.log(`Quick Test: ${quickResults.requestsPerSecond.toFixed(2)} req/s`);
    console.log(`Stress Test: ${stressResults.requestsPerSecond.toFixed(2)} req/s`);
    console.log(`Custom Test: ${customResults.requestsPerSecond.toFixed(2)} req/s`);

  } catch (error) {
    console.error('❌ Load test failed:', error);
    process.exit(1);
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
CostLens SDK Load Testing Script

Usage:
  npm run load-test                    # Run all load tests
  npm run load-test -- --quick        # Run only quick test
  npm run load-test -- --stress       # Run only stress test
  npm run load-test -- --custom       # Run only custom test
  npm run load-test -- --endurance    # Run endurance test (5 minutes)

Environment Variables:
  COSTLENS_API_KEY                    # Your CostLens API key

Examples:
  COSTLENS_API_KEY=your_key npm run load-test
  npm run load-test -- --quick
    `);
    process.exit(0);
  }

  runLoadTests().catch(console.error);
}

export { runLoadTests };
