import { CostLens } from '../src/index';

// Mock fetch for integration tests
global.fetch = jest.fn();

describe('CostLens SDK - Integration Tests', () => {
  let promptcraft: CostLens;

  beforeEach(() => {
    promptcraft = new CostLens({
      apiKey: 'test-integration-key',
      enableCache: true,
      maxRetries: 2,
    });
    (global.fetch as jest.Mock).mockClear();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  describe.skip('End-to-End OpenAI Flow', () => {
    it('should handle complete OpenAI request lifecycle', async () => {
      const mockOpenAI = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              id: 'chatcmpl-123',
              object: 'chat.completion',
              created: 1677652288,
              model: 'gpt-4',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: 'Hello! How can I help you today?',
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 9,
                total_tokens: 19,
              },
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockOpenAI);

      const result = await wrapped.chat.completions.create(
        {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello!' }],
        },
        { promptId: 'test-prompt-1' }
      );

      // Verify response
      expect(result.choices[0].message.content).toBe('Hello! How can I help you today?');
      expect(result.usage.total_tokens).toBe(19);

      // Verify tracking was called
      expect(global.fetch).toHaveBeenCalledWith(
        'https://promptcraft.app/api/integrations/run',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('openai'),
        })
      );
    });

    it('should handle streaming responses', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: 'Hello' } }] };
          yield { choices: [{ delta: { content: ' world' } }] };
        },
      };

      const mockOpenAI = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue(mockStream),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockOpenAI);

      const stream = await wrapped.chat.completions.stream({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello!' }],
      });

      let fullContent = '';
      for await (const chunk of stream) {
        fullContent += chunk.choices[0]?.delta?.content || '';
      }

      expect(fullContent).toBe('Hello world');
      expect(global.fetch).toHaveBeenCalled(); // Tracking after stream
    });
  });

  describe('End-to-End Anthropic Flow', () => {
    it('should handle complete Anthropic request lifecycle', async () => {
      const mockAnthropic = {
        messages: {
          create: jest.fn().mockResolvedValue({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'Hello! How can I assist you today?',
              },
            ],
            model: 'claude-3-opus-20240229',
            usage: {
              input_tokens: 10,
              output_tokens: 8,
            },
          }),
        },
      };

      const wrapped = promptcraft.wrapAnthropic(mockAnthropic);

      const result = await wrapped.messages.create(
        {
          model: 'claude-3-opus-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Hello!' }],
        },
        { promptId: 'test-prompt-2' }
      );

      expect(result.content[0].text).toBe('Hello! How can I assist you today?');
      expect(result.usage.input_tokens).toBe(10);
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe.skip('Caching Integration', () => {
    it('should cache and reuse responses', async () => {
      const mockOpenAI = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{ message: { content: 'cached response' } }],
              usage: { total_tokens: 10 },
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockOpenAI);

      const params = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'test' }],
      };

      // First call
      const result1 = await wrapped.chat.completions.create(params, {
        cacheTTL: 60000,
      });

      // Second call with same params
      const result2 = await wrapped.chat.completions.create(params, {
        cacheTTL: 60000,
      });

      expect(result1).toEqual(result2);
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(1);
    });

    it('should expire cache after TTL', async () => {
      jest.useFakeTimers();

      const mockOpenAI = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{ message: { content: 'response' } }],
              usage: { total_tokens: 10 },
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockOpenAI);

      const params = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'test' }],
      };

      // First call
      await wrapped.chat.completions.create(params, { cacheTTL: 1000 });

      // Advance time past TTL
      jest.advanceTimersByTime(2000);

      // Second call should not use cache
      await wrapped.chat.completions.create(params, { cacheTTL: 1000 });

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });

  describe('Retry Integration', () => {
    it('should fail after max retries', async () => {
      const mockOpenAI = {
        chat: {
          completions: {
            create: jest.fn().mockRejectedValue({ status: 500 }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockOpenAI);

      await expect(
        wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [],
        })
      ).rejects.toEqual({ status: 500 });

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(2); // maxRetries: 2
    });
  });

  describe('Middleware Integration', () => {
    it('should apply multiple middleware in order', async () => {
      const calls: string[] = [];

      const pc = new CostLens({
        apiKey: 'test',
        middleware: [
          {
            before: async (params) => {
              calls.push('before1');
              return params;
            },
            after: async (result) => {
              calls.push('after1');
              return result;
            },
          },
          {
            before: async (params) => {
              calls.push('before2');
              return params;
            },
            after: async (result) => {
              calls.push('after2');
              return result;
            },
          },
        ],
      });

      const mockOpenAI = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{ message: { content: 'test' } }],
              usage: { total_tokens: 10 },
            }),
          },
        },
      };

      const wrapped = pc.wrapOpenAI(mockOpenAI);
      await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [],
      });

      expect(calls).toEqual(['before1', 'before2', 'after1', 'after2']);
    });
  });

  describe('Batch Tracking', () => {
    it('should track multiple calls in batch', async () => {
      await promptcraft.trackBatch([
        { provider: 'openai', model: 'gpt-4', tokens: 100, latency: 500 },
        { provider: 'openai', model: 'gpt-3.5-turbo', tokens: 50, latency: 200 },
        { provider: 'anthropic', model: 'claude-3-opus', tokens: 150, latency: 600 },
      ]);

      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe.skip('Error Handling Integration', () => {
    it('should track errors and still throw', async () => {
      const mockOpenAI = {
        chat: {
          completions: {
            create: jest.fn().mockRejectedValue(new Error('Rate limit exceeded')),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockOpenAI);

      await expect(
        wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [],
        })
      ).rejects.toThrow('Rate limit exceeded');

      // Verify error was tracked
      const trackingCall = (global.fetch as jest.Mock).mock.calls.find((call) =>
        call[1].body.includes('"success":false')
      );
      expect(trackingCall).toBeDefined();
    });
  });
});
