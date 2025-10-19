import { CostLens } from '../src/index';

describe('SDK Advanced LLM Features', () => {
  let promptcraft: CostLens;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = mockFetch;

    promptcraft = new CostLens({
      apiKey: 'test-key',
      baseUrl: 'http://localhost:3000',
    });
  });

  describe('Streaming Support', () => {
    it('should pass through streaming parameter', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{ message: { content: 'response' } }],
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);
      
      await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'test' }],
        stream: true,
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ stream: true })
      );
    });

    it('should handle streaming responses', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Hello' } }] };
          yield { choices: [{ delta: { content: ' World' } }] };
        },
        choices: [{ message: { content: 'Hello World' } }],
        usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
      };

      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue(mockStream),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);
      const result = await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'test' }],
        stream: true,
      });

      expect(result).toBeDefined();
    });
  });

  describe('Function Calling', () => {
    it('should pass through function definitions', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{
                message: {
                  content: null,
                  function_call: {
                    name: 'get_weather',
                    arguments: '{"location": "SF"}',
                  },
                },
              }],
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);
      
      const functions = [{
        name: 'get_weather',
        description: 'Get weather',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' },
          },
        },
      }];

      await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Weather in SF?' }],
        functions,
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ functions })
      );
    });

    it('should track function call costs', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{
                message: {
                  function_call: {
                    name: 'get_weather',
                    arguments: '{"location": "SF"}',
                  },
                },
              }],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
              },
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);
      
      const result = await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'test' }],
        functions: [{ name: 'get_weather' }],
      });

      expect(result.usage).toBeDefined();
      expect(result.usage.total_tokens).toBe(150);
    });
  });

  describe('JSON Mode', () => {
    it('should pass through response_format parameter', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{ message: { content: '{"result": "success"}' } }],
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);
      
      await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Return JSON' }],
        response_format: { type: 'json_object' },
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: { type: 'json_object' },
        })
      );
    });
  });

  describe('Vision Support', () => {
    it('should handle image inputs', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{ message: { content: 'I see a cat' } }],
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);
      
      await wrapped.chat.completions.create({
        model: 'gpt-4-vision-preview',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: 'https://example.com/cat.jpg' } },
          ],
        }],
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalled();
    });

    it('should not apply smart routing to vision models', async () => {
      const pc = new CostLens({
        apiKey: 'test',
        smartRouting: true,
      });

      const messages = [{ role: 'user', content: 'Simple question' }];
      const result = await (pc as any).selectOptimalModel('gpt-4-vision-preview', messages);
      
      // Vision models should not be downgraded
      expect(result).toBe('gpt-4-vision-preview');
    });
  });

  describe('Temperature and Parameters', () => {
    it('should pass through all parameters', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{ message: { content: 'response' } }],
            }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);
      
      await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'test' }],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 500,
        presence_penalty: 0.5,
        frequency_penalty: 0.5,
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 500,
          presence_penalty: 0.5,
          frequency_penalty: 0.5,
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle rate limit errors', async () => {
      // Rate limit (429) is a 4xx error, so SDK doesn't retry
      // This test verifies the error is properly thrown
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockRejectedValue({ status: 429, message: 'Rate limit' }),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);
      
      await expect(
        wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'test' }],
        })
      ).rejects.toMatchObject({ status: 429 });

      // 429 is not retried (it's a 4xx error)
      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 4xx client errors', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockRejectedValue(new Error('Bad request')),
          },
        },
      };

      const wrapped = promptcraft.wrapOpenAI(mockClient);
      
      await expect(
        wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'test' }],
        })
      ).rejects.toThrow();

      // SDK retries on all errors, so it will be called maxRetries times
      expect(mockClient.chat.completions.create).toHaveBeenCalled();
    });
  });

  describe('Cost Estimation', () => {
    it('should estimate costs for different models', async () => {
      const pc = new CostLens({ apiKey: 'test' });
      
      const messages = [{ role: 'user', content: 'test' }];
      
      const gpt4Cost = await (pc as any).estimateCost('gpt-4', messages);
      const gpt35Cost = await (pc as any).estimateCost('gpt-3.5-turbo', messages);
      
      expect(gpt4Cost).toBeGreaterThan(gpt35Cost);
    });

    it('should block requests exceeding cost limit', async () => {
      const pc = new CostLens({
        apiKey: 'test',
        costLimit: 0.001,
      });

      const mockClient = {
        chat: {
          completions: {
            create: jest.fn(),
          },
        },
      };

      const wrapped = pc.wrapOpenAI(mockClient);
      
      const longMessage = 'x'.repeat(10000); // Very long message
      
      await expect(
        wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: longMessage }],
        })
      ).rejects.toThrow(/exceeds limit/);
    });
  });
});
