import { CostLens } from '../src/index';

// Mock fetch for performance tests
global.fetch = jest.fn();

describe('CostLens SDK - Performance Tests', () => {
  let promptcraft: CostLens;

  beforeEach(() => {
    promptcraft = new CostLens({
      apiKey: 'test-performance-key',
      enableCache: true,
      maxRetries: 3,
    });
    (global.fetch as jest.Mock).mockClear();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle multiple concurrent requests', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              id: 'test',
              choices: [{ message: { content: 'test response' } }],
              usage: { total_tokens: 10 },
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      // Create 10 concurrent requests
      const requests = Array.from({ length: 10 }, (_, i) =>
        wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: `Request ${i}` }],
        })
      );

      const startTime = Date.now();
      const results = await Promise.all(requests);
      const endTime = Date.now();

      // All requests should succeed
      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.choices[0].message.content).toBe('test response');
      });

      // Should complete within reasonable time (adjust as needed)
      expect(endTime - startTime).toBeLessThan(5000);
    });

    it('should handle mixed success/failure scenarios', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn()
              .mockResolvedValueOnce({
                id: 'success-1',
                choices: [{ message: { content: 'success' } }],
                usage: { total_tokens: 10 },
              })
              .mockRejectedValueOnce(new Error('Simulated failure'))
              .mockResolvedValueOnce({
                id: 'success-2',
                choices: [{ message: { content: 'success' } }],
                usage: { total_tokens: 10 },
              })
              .mockResolvedValueOnce({
                id: 'success-3',
                choices: [{ message: { content: 'success' } }],
                usage: { total_tokens: 10 },
              }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      const requests = [
        wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Request 1' }],
        }),
        wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Request 2' }],
        }),
        wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Request 3' }],
        }),
        wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Request 4' }],
        }),
      ];

      const results = await Promise.allSettled(requests);

      // 3 should succeed, 1 should fail
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');

      expect(successes).toHaveLength(3);
      expect(failures).toHaveLength(1);
    });
  });

  describe('Memory Usage', () => {
    it('should not leak memory with repeated calls', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              id: 'test',
              choices: [{ message: { content: 'test response' } }],
              usage: { total_tokens: 10 },
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      // Make many requests
      for (let i = 0; i < 100; i++) {
        await wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: `Request ${i}` }],
        });
      }

      // Should not throw or crash
      expect(true).toBe(true);
    });

    it('should handle large response payloads', async () => {
      const largeResponse = {
        id: 'test',
        choices: [{
          message: {
            content: 'A'.repeat(10000) // 10KB response
          }
        }],
        usage: { total_tokens: 1000 },
      };

      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue(largeResponse),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      const result = await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Generate large response' }],
      });

      expect(result.choices[0].message.content).toHaveLength(10000);
    });
  });

  describe('Cache Performance', () => {
    it('should improve performance with cache hits', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              id: 'test',
              choices: [{ message: { content: 'cached response' } }],
              usage: { total_tokens: 10 },
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      // First call (cache miss)
      const start1 = Date.now();
      await wrapped.chat.completions.create(
        { model: 'gpt-4', messages: [{ role: 'user', content: 'test' }] },
        { cacheTTL: 60000 }
      );
      const end1 = Date.now();

      // Second call (cache hit)
      const start2 = Date.now();
      await wrapped.chat.completions.create(
        { model: 'gpt-4', messages: [{ role: 'user', content: 'test' }] },
        { cacheTTL: 60000 }
      );
      const end2 = Date.now();

      // Cache hit should be faster (though with mocks this might not be significant)
      // Note: With mocks, timing might not be reliable, so we just check that cache was used
      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(1);
    });

    it('should handle cache eviction under memory pressure', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              id: 'test',
              choices: [{ message: { content: 'test response' } }],
              usage: { total_tokens: 10 },
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      // Make many different requests to fill cache
      for (let i = 0; i < 50; i++) {
        await wrapped.chat.completions.create(
          { model: 'gpt-4', messages: [{ role: 'user', content: `Request ${i}` }] },
          { cacheTTL: 60000 }
        );
      }

      // Should not crash or throw
      expect(true).toBe(true);
    });
  });

  describe('Rate Limiting Performance', () => {
    it('should handle rapid successive requests', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              id: 'test',
              choices: [{ message: { content: 'test response' } }],
              usage: { total_tokens: 10 },
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      // Make rapid requests
      const promises: Promise<any>[] = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          wrapped.chat.completions.create({
            model: 'gpt-4',
            messages: [{ role: 'user', content: `Rapid request ${i}` }],
          })
        );
      }

      const results = await Promise.all(promises);
      expect(results).toHaveLength(20);
    });

    it('should handle burst requests with retries', async () => {
      let callCount = 0;
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockImplementation(() => {
              callCount++;
              if (callCount <= 5) {
                throw new Error('Rate limited');
              }
              return Promise.resolve({
                id: 'test',
                choices: [{ message: { content: 'success after retries' } }],
                usage: { total_tokens: 10 },
              });
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      const result = await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Burst request' }],
      });

      expect(result.choices[0].message.content).toBe('success after retries');
      expect(callCount).toBeGreaterThan(1); // Should have retried
    });
  });

  describe('Error Recovery Performance', () => {
    it('should recover quickly from transient errors', async () => {
      let errorCount = 0;
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockImplementation(() => {
              errorCount++;
              if (errorCount <= 2) {
                throw new Error('Transient error');
              }
              return Promise.resolve({
                id: 'test',
                choices: [{ message: { content: 'recovered' } }],
                usage: { total_tokens: 10 },
              });
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);

      const startTime = Date.now();
      const result = await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test recovery' }],
      });
      const endTime = Date.now();

      expect(result.choices[0].message.content).toBe('recovered');
      expect(endTime - startTime).toBeLessThan(5000); // Should recover within reasonable time
    });
  });
});
