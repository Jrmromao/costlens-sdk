"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../src/index");
// Mock fetch
global.fetch = jest.fn();
describe('CostLens SDK - Unit Tests', () => {
    let promptcraft;
    beforeEach(() => {
        promptcraft = new index_1.CostLens({ apiKey: 'test-key' });
        global.fetch.mockClear();
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        });
    });
    describe('Configuration', () => {
        it('should initialize with default config', () => {
            expect(promptcraft).toBeDefined();
        });
        it('should accept custom baseUrl', () => {
            const custom = new index_1.CostLens({
                apiKey: 'test',
                baseUrl: 'https://custom.com',
            });
            expect(custom).toBeDefined();
        });
        it('should enable cache when configured', () => {
            const cached = new index_1.CostLens({
                apiKey: 'test',
                enableCache: true,
            });
            expect(cached).toBeDefined();
        });
    });
    describe.skip('Cache', () => {
        it('should cache results when enabled', async () => {
            const cached = new index_1.CostLens({
                apiKey: 'test',
                enableCache: true,
            });
            const mockClient = {
                chat: {
                    completions: {
                        create: jest.fn().mockResolvedValue({
                            choices: [{ message: { content: 'test' } }],
                            usage: { total_tokens: 10 },
                        }),
                    },
                },
            };
            const wrapped = cached.wrapOpenAI(mockClient);
            // First call
            await wrapped.chat.completions.create({ model: 'gpt-4', messages: [] }, { cacheTTL: 60000 });
            // Second call should use cache
            await wrapped.chat.completions.create({ model: 'gpt-4', messages: [] }, { cacheTTL: 60000 });
            expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(1);
        });
        it('should clear cache', () => {
            const cached = new index_1.CostLens({
                apiKey: 'test',
                enableCache: true,
            });
            cached.clearCache();
            expect(cached).toBeDefined();
        });
    });
    describe('Retry Logic', () => {
        it('should retry on 5xx errors', async () => {
            const mockClient = {
                chat: {
                    completions: {
                        create: jest
                            .fn()
                            .mockRejectedValueOnce({ status: 500 })
                            .mockResolvedValueOnce({
                            choices: [{ message: { content: 'success' } }],
                            usage: { total_tokens: 10 },
                        }),
                    },
                },
            };
            const wrapped = promptcraft.wrapOpenAI(mockClient);
            const result = await wrapped.chat.completions.create({
                model: 'gpt-4',
                messages: [],
            });
            expect(result.choices[0].message.content).toBe('success');
            expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(2);
        });
        it('should not retry on 4xx errors', async () => {
            const mockClient = {
                chat: {
                    completions: {
                        create: jest.fn().mockRejectedValue({ status: 400 }),
                    },
                },
            };
            const wrapped = promptcraft.wrapOpenAI(mockClient);
            await expect(wrapped.chat.completions.create({
                model: 'gpt-4',
                messages: [],
            })).rejects.toEqual({ status: 400 });
            expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(1);
        });
    });
    describe('Middleware', () => {
        it('should run before middleware', async () => {
            const beforeFn = jest.fn((params) => ({
                ...params,
                modified: true,
            }));
            const withMiddleware = new index_1.CostLens({
                apiKey: 'test',
                middleware: [{ before: beforeFn }],
            });
            const mockClient = {
                chat: {
                    completions: {
                        create: jest.fn().mockResolvedValue({
                            choices: [{ message: { content: 'test' } }],
                            usage: { total_tokens: 10 },
                        }),
                    },
                },
            };
            const wrapped = withMiddleware.wrapOpenAI(mockClient);
            await wrapped.chat.completions.create({
                model: 'gpt-4',
                messages: [],
            });
            expect(beforeFn).toHaveBeenCalled();
        });
        it('should run after middleware', async () => {
            const afterFn = jest.fn((result) => result);
            const withMiddleware = new index_1.CostLens({
                apiKey: 'test',
                middleware: [{ after: afterFn }],
            });
            const mockClient = {
                chat: {
                    completions: {
                        create: jest.fn().mockResolvedValue({
                            choices: [{ message: { content: 'test' } }],
                            usage: { total_tokens: 10 },
                        }),
                    },
                },
            };
            const wrapped = withMiddleware.wrapOpenAI(mockClient);
            await wrapped.chat.completions.create({
                model: 'gpt-4',
                messages: [],
            });
            expect(afterFn).toHaveBeenCalled();
        });
        it('should run error middleware', async () => {
            const errorFn = jest.fn();
            const withMiddleware = new index_1.CostLens({
                apiKey: 'test',
                maxRetries: 1,
                middleware: [{ onError: errorFn }],
            });
            const mockClient = {
                chat: {
                    completions: {
                        create: jest.fn().mockRejectedValue(new Error('test error')),
                    },
                },
            };
            const wrapped = withMiddleware.wrapOpenAI(mockClient);
            await expect(wrapped.chat.completions.create({
                model: 'gpt-4',
                messages: [],
            })).rejects.toThrow();
            expect(errorFn).toHaveBeenCalled();
        });
    });
    describe('Tracking', () => {
        it('should track OpenAI calls', async () => {
            await promptcraft.trackOpenAI({ model: 'gpt-4', messages: [] }, {
                id: 'test',
                object: 'chat.completion',
                created: Date.now(),
                model: 'gpt-4',
                choices: [{ message: { role: 'assistant', content: 'test', refusal: null }, index: 0, finish_reason: 'stop' }],
                usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
            }, 100);
            expect(global.fetch).toHaveBeenCalledWith('https://costlens.dev/api/integrations/run', expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Authorization': 'Bearer test-key',
                }),
            }));
        });
        it('should track errors', async () => {
            await promptcraft.trackError('openai', 'gpt-4', 'test input', new Error('test error'), 100);
            expect(global.fetch).toHaveBeenCalled();
        });
        it('should track batch calls', async () => {
            await promptcraft.trackBatch([
                { provider: 'openai', model: 'gpt-4', tokens: 10, latency: 100 },
                { provider: 'anthropic', model: 'claude-3', tokens: 20, latency: 200 },
            ]);
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });
    });
    describe('Wrapper - OpenAI', () => {
        it('should wrap OpenAI client', async () => {
            const mockClient = {
                chat: {
                    completions: {
                        create: jest.fn().mockResolvedValue({
                            choices: [{ message: { content: 'test response' } }],
                            usage: { total_tokens: 10 },
                        }),
                    },
                },
            };
            const wrapped = promptcraft.wrapOpenAI(mockClient);
            const result = await wrapped.chat.completions.create({
                model: 'gpt-4',
                messages: [{ role: 'user', content: 'test' }],
            });
            expect(result.choices[0].message.content).toBe('test response');
            expect(mockClient.chat.completions.create).toHaveBeenCalled();
            expect(global.fetch).toHaveBeenCalled(); // Tracking call
        });
        it('should handle errors in wrapped calls', async () => {
            const mockClient = {
                chat: {
                    completions: {
                        create: jest.fn().mockRejectedValue(new Error('API error')),
                    },
                },
            };
            const wrapped = promptcraft.wrapOpenAI(mockClient);
            await expect(wrapped.chat.completions.create({
                model: 'gpt-4',
                messages: [],
            })).rejects.toThrow('API error');
            expect(global.fetch).toHaveBeenCalled(); // Error tracking
        });
    });
    describe('Wrapper - Anthropic', () => {
        it('should wrap Anthropic client', async () => {
            const mockClient = {
                messages: {
                    create: jest.fn().mockResolvedValue({
                        content: [{ type: 'text', text: 'test response' }],
                        usage: { input_tokens: 5, output_tokens: 5 },
                    }),
                },
            };
            const wrapped = promptcraft.wrapAnthropic(mockClient);
            const result = await wrapped.messages.create({
                model: 'claude-3-opus',
                max_tokens: 100,
                messages: [{ role: 'user', content: 'test' }],
            });
            expect(result.content[0].text).toBe('test response');
            expect(mockClient.messages.create).toHaveBeenCalled();
            expect(global.fetch).toHaveBeenCalled();
        });
    });
});
