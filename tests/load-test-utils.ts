import { CostLens } from '../src/index';

export interface LoadTestConfig {
  concurrentUsers: number;
  requestsPerUser: number;
  delayBetweenRequests: number;
  testDuration: number; // in milliseconds
  models: string[];
  enableCache: boolean;
  cacheTTL?: number;
}

export interface LoadTestResult {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  requestsPerSecond: number;
  errors: Array<{ error: string; count: number }>;
  startTime: number;
  endTime: number;
  duration: number;
}

export class LoadTestRunner {
  private promptcraft: CostLens;
  private config: LoadTestConfig;
  private results: LoadTestResult;

  constructor(promptcraft: CostLens, config: LoadTestConfig) {
    this.promptcraft = promptcraft;
    this.config = config;
    this.results = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      requestsPerSecond: 0,
      errors: [],
      startTime: 0,
      endTime: 0,
      duration: 0,
    };
  }

  async runLoadTest(): Promise<LoadTestResult> {
    console.log(`Starting load test with ${this.config.concurrentUsers} users...`);
    
    this.results.startTime = Date.now();
    
    // Create user simulation tasks
    const userTasks = Array.from({ length: this.config.concurrentUsers }, (_, userIndex) =>
      this.simulateUser(userIndex)
    );

    // Wait for all users to complete or timeout
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => resolve(), this.config.testDuration);
    });

    await Promise.race([
      Promise.all(userTasks),
      timeoutPromise
    ]);

    this.results.endTime = Date.now();
    this.results.duration = this.results.endTime - this.results.startTime;
    this.results.requestsPerSecond = this.results.totalRequests / (this.results.duration / 1000);

    return this.results;
  }

  private async simulateUser(userIndex: number): Promise<void> {
    const mockClient = {
      chat: {
        completions: {
          create: jest.fn().mockImplementation(async (params) => {
            // Simulate realistic response time (50-500ms)
            const responseTime = Math.random() * 450 + 50;
            await new Promise(resolve => setTimeout(resolve, responseTime));
            
            // Simulate occasional failures (5% failure rate)
            if (Math.random() < 0.05) {
              throw new Error('Simulated API failure');
            }

            return {
              id: `test-${userIndex}-${Date.now()}`,
              choices: [{ message: { content: `Response from user ${userIndex}` } }],
              usage: { total_tokens: Math.floor(Math.random() * 100) + 10 },
            };
          }),
        },
      },
    };

    const wrapped = this.promptcraft.wrapOpenAI(mockClient);

    for (let requestIndex = 0; requestIndex < this.config.requestsPerUser; requestIndex++) {
      try {
        const startTime = Date.now();
        const model = this.config.models[Math.floor(Math.random() * this.config.models.length)];
        
        const options = this.config.enableCache ? { cacheTTL: this.config.cacheTTL } : undefined;
        
        await wrapped.chat.completions.create(
          {
            model,
            messages: [{ 
              role: 'user', 
              content: `User ${userIndex} request ${requestIndex}` 
            }],
          },
          options
        );

        const endTime = Date.now();
        const responseTime = endTime - startTime;

        this.results.totalRequests++;
        this.results.successfulRequests++;
        this.results.averageResponseTime = 
          (this.results.averageResponseTime * (this.results.successfulRequests - 1) + responseTime) / 
          this.results.successfulRequests;
        this.results.minResponseTime = Math.min(this.results.minResponseTime, responseTime);
        this.results.maxResponseTime = Math.max(this.results.maxResponseTime, responseTime);

      } catch (error) {
        this.results.totalRequests++;
        this.results.failedRequests++;
        
        const errorMessage = (error as Error).message;
        const existingError = this.results.errors.find(e => e.error === errorMessage);
        if (existingError) {
          existingError.count++;
        } else {
          this.results.errors.push({ error: errorMessage, count: 1 });
        }
      }

      // Delay between requests
      if (this.config.delayBetweenRequests > 0) {
        await new Promise(resolve => setTimeout(resolve, this.config.delayBetweenRequests));
      }
    }
  }

  static async runQuickLoadTest(promptcraft: CostLens): Promise<LoadTestResult> {
    const config: LoadTestConfig = {
      concurrentUsers: 10,
      requestsPerUser: 20,
      delayBetweenRequests: 100,
      testDuration: 30000, // 30 seconds
      models: ['gpt-4', 'gpt-3.5-turbo'],
      enableCache: true,
      cacheTTL: 60000,
    };

    const runner = new LoadTestRunner(promptcraft, config);
    return await runner.runLoadTest();
  }

  static async runStressTest(promptcraft: CostLens): Promise<LoadTestResult> {
    const config: LoadTestConfig = {
      concurrentUsers: 50,
      requestsPerUser: 100,
      delayBetweenRequests: 0,
      testDuration: 60000, // 60 seconds
      models: ['gpt-4', 'gpt-3.5-turbo', 'claude-3-opus'],
      enableCache: false, // Disable cache for stress test
    };

    const runner = new LoadTestRunner(promptcraft, config);
    return await runner.runLoadTest();
  }

  static async runEnduranceTest(promptcraft: CostLens): Promise<LoadTestResult> {
    const config: LoadTestConfig = {
      concurrentUsers: 5,
      requestsPerUser: 1000,
      delayBetweenRequests: 200,
      testDuration: 300000, // 5 minutes
      models: ['gpt-4'],
      enableCache: true,
      cacheTTL: 300000, // 5 minutes
    };

    const runner = new LoadTestRunner(promptcraft, config);
    return await runner.runLoadTest();
  }
}

export function printLoadTestResults(results: LoadTestResult): void {
  console.log('\n=== Load Test Results ===');
  console.log(`Total Requests: ${results.totalRequests}`);
  console.log(`Successful: ${results.successfulRequests}`);
  console.log(`Failed: ${results.failedRequests}`);
  console.log(`Success Rate: ${((results.successfulRequests / results.totalRequests) * 100).toFixed(2)}%`);
  console.log(`Average Response Time: ${results.averageResponseTime.toFixed(2)}ms`);
  console.log(`Min Response Time: ${results.minResponseTime}ms`);
  console.log(`Max Response Time: ${results.maxResponseTime}ms`);
  console.log(`Requests Per Second: ${results.requestsPerSecond.toFixed(2)}`);
  console.log(`Test Duration: ${(results.duration / 1000).toFixed(2)}s`);
  
  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.forEach(error => {
      console.log(`  ${error.error}: ${error.count} occurrences`);
    });
  }
  console.log('========================\n');
}
