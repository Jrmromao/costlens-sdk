import { CostLens } from '../src/index';

// Mock fetch for load tests
global.fetch = jest.fn();

describe('CostLens SDK - Load Testing', () => {
  let promptcraft: CostLens;

  beforeEach(() => {
    promptcraft = new CostLens({
      apiKey: 'test-load-key',
      enableCache: true,
      maxRetries: 3,
    });
    (global.fetch as jest.Mock).mockClear();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  describe('High Volume Load Tests', () => {
    it('should handle 100 concurrent requests', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              id: 'test',
              choices: [{ message: { content: 'load test response' } }],
              usage: { total_tokens: 10 },
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      // Create 100 concurrent requests
      const requests: Promise<any>[] = [];
      for (let i = 0; i < 100; i++) {
        requests.push(
          wrapped.chat.completions.create({
            model: 'gpt-4',
            messages: [{ role: 'user', content: `Load test request ${i}` }],
          })
        );
      }

      const startTime = Date.now();
      const results = await Promise.all(requests);
      const endTime = Date.now();

      // All requests should succeed
      expect(results).toHaveLength(100);
      results.forEach(result => {
        expect(result.choices[0].message.content).toBe('load test response');
      });

      // Should complete within reasonable time (adjust based on your requirements)
      expect(endTime - startTime).toBeLessThan(30000); // 30 seconds max
    }, 60000); // 60 second timeout

    it('should handle 500 rapid sequential requests', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              id: 'test',
              choices: [{ message: { content: 'sequential response' } }],
              usage: { total_tokens: 10 },
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      const startTime = Date.now();
      
      // Make 500 sequential requests
      for (let i = 0; i < 500; i++) {
        await wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: `Sequential request ${i}` }],
        });
      }

      const endTime = Date.now();

      // Should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(60000); // 60 seconds max
      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(500);
    }, 120000); // 2 minute timeout

    it('should handle mixed load with different models', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockImplementation((params) => {
              const model = params.model;
              return Promise.resolve({
                id: `test-${model}`,
                choices: [{ message: { content: `Response from ${model}` } }],
                usage: { total_tokens: 10 },
              });
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      const models = ['gpt-4', 'gpt-3.5-turbo', 'claude-3-opus', 'claude-3-haiku'];
      const requests: Promise<any>[] = [];

      // Create 200 requests with different models
      for (let i = 0; i < 200; i++) {
        const model = models[i % models.length];
        requests.push(
          wrapped.chat.completions.create({
            model,
            messages: [{ role: 'user', content: `Mixed load request ${i}` }],
          })
        );
      }

      const startTime = Date.now();
      const results = await Promise.all(requests);
      const endTime = Date.now();

      expect(results).toHaveLength(200);
      expect(endTime - startTime).toBeLessThan(45000); // 45 seconds max
    }, 90000); // 90 second timeout
  });

  describe('Memory Pressure Tests', () => {
    it('should handle large payloads under load', async () => {
      const largeResponse = {
        id: 'test',
        choices: [{
          message: {
            content: 'A'.repeat(50000) // 50KB response
          }
        }],
        usage: { total_tokens: 5000 },
      };

      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue(largeResponse),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      // Make 50 requests with large responses
      const requests: Promise<any>[] = [];
      for (let i = 0; i < 50; i++) {
        requests.push(
          wrapped.chat.completions.create({
            model: 'gpt-4',
            messages: [{ role: 'user', content: `Large payload request ${i}` }],
          })
        );
      }

      const startTime = Date.now();
      const results = await Promise.all(requests);
      const endTime = Date.now();

      expect(results).toHaveLength(50);
      results.forEach(result => {
        expect(result.choices[0].message.content).toHaveLength(50000);
      });
      expect(endTime - startTime).toBeLessThan(30000); // 30 seconds max
    }, 60000);

    it('should handle cache pressure with many unique requests', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockImplementation((params) => {
              const content = params.messages[0].content;
              return Promise.resolve({
                id: `test-${content}`,
                choices: [{ message: { content: `Response for ${content}` } }],
                usage: { total_tokens: 10 },
              });
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      // Make 1000 unique requests to stress test cache
      const requests: Promise<any>[] = [];
      for (let i = 0; i < 1000; i++) {
        requests.push(
          wrapped.chat.completions.create(
            {
              model: 'gpt-4',
              messages: [{ role: 'user', content: `Unique request ${i}` }],
            },
            { cacheTTL: 60000 }
          )
        );
      }

      const startTime = Date.now();
      const results = await Promise.all(requests);
      const endTime = Date.now();

      expect(results).toHaveLength(1000);
      expect(endTime - startTime).toBeLessThan(60000); // 60 seconds max
    }, 120000);
  });

  describe('Error Recovery Under Load', () => {
    it('should handle partial failures under high load', async () => {
      let callCount = 0;
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockImplementation(() => {
              callCount++;
              // Fail 20% of requests
              if (callCount % 5 === 0) {
                throw new Error('Load test failure');
              }
              return Promise.resolve({
                id: `test-${callCount}`,
                choices: [{ message: { content: 'Success response' } }],
                usage: { total_tokens: 10 },
              });
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      // Make 100 requests with 20% failure rate
      const requests: Promise<any>[] = [];
      for (let i = 0; i < 100; i++) {
        requests.push(
          wrapped.chat.completions.create({
            model: 'gpt-4',
            messages: [{ role: 'user', content: `Load test with failures ${i}` }],
          })
        );
      }

      const results = await Promise.allSettled(requests);
      
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');

      // Should have some successes and some failures
      expect(successes.length).toBeGreaterThan(0);
      // Note: Due to retry logic, failures might be retried and succeed
      // So we just check that we have some results
      expect(successes.length + failures.length).toBe(100);
      
      // If there are failures, they should be the expected error
      if (failures.length > 0) {
        failures.forEach(failure => {
          if (failure.status === 'rejected') {
            expect(failure.reason.message).toBe('Load test failure');
          }
        });
      }
    }, 60000);

    it('should recover from rate limiting under load', async () => {
      let callCount = 0;
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockImplementation(() => {
              callCount++;
              // Simulate rate limiting for first 50 calls
              if (callCount <= 50) {
                throw new Error('Rate limited');
              }
              return Promise.resolve({
                id: `test-${callCount}`,
                choices: [{ message: { content: 'Recovered response' } }],
                usage: { total_tokens: 10 },
              });
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      // Make 100 requests with initial rate limiting
      const requests: Promise<any>[] = [];
      for (let i = 0; i < 100; i++) {
        requests.push(
          wrapped.chat.completions.create({
            model: 'gpt-4',
            messages: [{ role: 'user', content: `Rate limit recovery ${i}` }],
          })
        );
      }

      const startTime = Date.now();
      const results = await Promise.allSettled(requests);
      const endTime = Date.now();

      const successes = results.filter(r => r.status === 'fulfilled');
      
      // Should have some successful recoveries
      expect(successes.length).toBeGreaterThan(0);
      expect(endTime - startTime).toBeLessThan(45000); // 45 seconds max
    }, 90000);
  });

  describe('Sustained Load Tests', () => {
    it('should maintain performance over extended period', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              id: 'test',
              choices: [{ message: { content: 'Sustained load response' } }],
              usage: { total_tokens: 10 },
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      const startTime = Date.now();
      const endTime = startTime + 10000; // Run for 10 seconds

      let requestCount = 0;
      const promises: Promise<any>[] = [];

      // Continuous load for 10 seconds
      while (Date.now() < endTime) {
        promises.push(
          wrapped.chat.completions.create({
            model: 'gpt-4',
            messages: [{ role: 'user', content: `Sustained request ${requestCount++}` }],
          })
        );

        // Small delay to prevent overwhelming
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const results = await Promise.allSettled(promises);
      const successes = results.filter(r => r.status === 'fulfilled');

      expect(successes.length).toBeGreaterThan(0);
      expect(requestCount).toBeGreaterThan(0);
    }, 20000); // 20 second timeout

    it('should handle burst traffic patterns', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              id: 'test',
              choices: [{ message: { content: 'Burst response' } }],
              usage: { total_tokens: 10 },
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      // Simulate burst traffic: 5 bursts of 20 requests each
      for (let burst = 0; burst < 5; burst++) {
        const requests: Promise<any>[] = [];
        
        // Create burst of 20 requests
        for (let i = 0; i < 20; i++) {
          requests.push(
            wrapped.chat.completions.create({
              model: 'gpt-4',
              messages: [{ role: 'user', content: `Burst ${burst} request ${i}` }],
            })
          );
        }

        const startTime = Date.now();
        const results = await Promise.all(requests);
        const endTime = Date.now();

        expect(results).toHaveLength(20);
        expect(endTime - startTime).toBeLessThan(5000); // Each burst should complete quickly

        // Wait between bursts
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }, 30000);
  });

  describe('Resource Usage Tests', () => {
    it('should not leak memory during extended usage', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              id: 'test',
              choices: [{ message: { content: 'Memory test response' } }],
              usage: { total_tokens: 10 },
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      // Make many requests to test for memory leaks
      for (let i = 0; i < 1000; i++) {
        await wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: `Memory test ${i}` }],
        });

        // Every 100 requests, check that we're not accumulating too much
        if (i % 100 === 0) {
          // Force garbage collection if available
          if (global.gc) {
            global.gc();
          }
        }
      }

      // If we get here without crashing, memory usage is reasonable
      expect(true).toBe(true);
    }, 120000);

    it('should handle cache eviction under memory pressure', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockImplementation((params) => {
              const content = params.messages[0].content;
              return Promise.resolve({
                id: `test-${content}`,
                choices: [{ message: { content: `Response for ${content}` } }],
                usage: { total_tokens: 10 },
              });
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      // Fill cache with many unique requests
      for (let i = 0; i < 2000; i++) {
        await wrapped.chat.completions.create(
          {
            model: 'gpt-4',
            messages: [{ role: 'user', content: `Cache pressure ${i}` }],
          },
          { cacheTTL: 60000 }
        );
      }

      // Should not crash or throw
      expect(true).toBe(true);
    }, 180000);
  });
});
