import type OpenAI from 'openai';
import type Anthropic from '@anthropic-ai/sdk';
import { SmartCall } from './smartCall';
import { QualityDetector } from './qualityDetector';

interface CostLensConfig {
  apiKey: string;
  baseUrl?: string;
  enableCache?: boolean;
  maxRetries?: number;
  middleware?: Middleware[];
  autoFallback?: boolean;
  smartRouting?: boolean;
  autoOptimize?: boolean;
  costLimit?: number;
}

interface WrapperOptions {
  promptId?: string;
  cacheTTL?: number;
  fallbackModels?: string[];
  maxCost?: number;
  userId?: string;
}

interface TrackRunData {
  provider: string;
  promptId?: string;
  model: string;
  requestedModel?: string;
  input: string;
  output: string;
  tokensUsed: number;
  inputTokens?: number;
  outputTokens?: number;
  latency: number;
  success: boolean;
  savings?: number;
  error?: string;
}

interface Middleware {
  before?: (params: any) => Promise<any>;
  after?: (result: any) => Promise<any>;
  onError?: (error: Error, context?: ErrorContext) => Promise<void>;
}

interface ErrorContext {
  provider: string;
  model: string;
  input: string;
  latency: number;
  attempt: number;
  maxRetries: number;
  userId?: string;
  promptId?: string;
  metadata?: Record<string, any>;
}

interface CacheEntry {
  result: any;
  timestamp: number;
  ttl: number;
}

export class CostLens {
  private config: CostLensConfig;
  private cache: Map<string, CacheEntry> = new Map();
  private optimizationCache: Map<string, string> = new Map();
  private rateLimitQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;

  constructor(config: CostLensConfig) {
    // Validate API key but don't throw - just warn
    if (!config.apiKey || config.apiKey.trim() === '') {
      console.warn('[CostLens] Warning: No API key provided. Tracking and optimization features will be disabled, but your app will continue to work.');
    }

    this.config = {
      baseUrl: 'https://costlens.dev',
      enableCache: false,
      maxRetries: 3,
      middleware: [],
      autoFallback: false,
      smartRouting: true,  // ON by default
      ...config,
    };
  }

  private estimateComplexity(messages: any[]): 'simple' | 'medium' | 'complex' {
    const totalLength = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    const hasSystemPrompt = messages.some(m => m.role === 'system');
    const messageCount = messages.length;

    if (totalLength < 100 && !hasSystemPrompt && messageCount <= 2) return 'simple';
    if (totalLength < 500 && messageCount <= 5) return 'medium';
    return 'complex';
  }

  private async selectOptimalModel(requestedModel: string, messages: any[]): Promise<string> {
    if (!this.config.smartRouting) return requestedModel;

    // Don't route vision models
    if (requestedModel.includes('vision')) return requestedModel;

    // PRIORITY 1: OpenAI routing (works for 90% of users)
    if (requestedModel.includes('gpt')) {
      const complexity = this.estimateComplexity(messages);
      
      // Simple tasks: GPT-4 → GPT-3.5-turbo (98% savings)
      if (complexity === 'simple' && requestedModel.includes('gpt-4')) {
        return 'gpt-3.5-turbo';
      }
      
      // Medium tasks: GPT-4 → GPT-4o (86% savings)
      if (complexity === 'medium' && requestedModel === 'gpt-4') {
        return 'gpt-4o';
      }
    }

    // PRIORITY 1.5: Anthropic routing (for Claude users)
    if (requestedModel.includes('claude')) {
      const complexity = this.estimateComplexity(messages);
      
      // Simple tasks: Claude Opus → Claude Haiku (98% savings)
      if (complexity === 'simple' && requestedModel.includes('claude-3-opus')) {
        return 'claude-3-haiku';
      }
      
      // Medium tasks: Claude Opus → Claude 3.5 Sonnet (93% savings)
      if (complexity === 'medium' && requestedModel.includes('claude-3-opus')) {
        return 'claude-3.5-sonnet';
      }
      
      // Simple tasks: Claude Sonnet → Claude Haiku (92% savings)
      if (complexity === 'simple' && requestedModel.includes('claude-3-sonnet')) {
        return 'claude-3-haiku';
      }
    }

    // PRIORITY 2: Cross-provider routing (for power users with multiple keys)
    const routingDecision = QualityDetector.shouldRoute(requestedModel, messages, 0.8);
    if (routingDecision.shouldRoute && routingDecision.confidence > 0.8) {
      return routingDecision.targetModel;
    }

    return requestedModel;
  }

  private async checkRoutingEnabled(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/quality/routing`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      });

      if (response.ok) {
        const data = await response.json() as { enabled: boolean };
        return data.enabled;
      }
      
      // Invalid API key - disable routing but don't break
      if (response.status === 401 || response.status === 403) {
        console.warn('[CostLens] Invalid API key - smart routing disabled');
        return false;
      }
    } catch (error) {
      // Network error - fail gracefully
      console.warn('[CostLens] Routing check failed (non-fatal):', error);
    }

    return true; // Default to enabled if check fails
  }

  private getDefaultFallbacks(model: string): string[] {
    const fallbacks: Record<string, string[]> = {
      // 2025 Models (prioritize new models)
      'gpt-4o': ['gpt-4-turbo', 'claude-3.5-sonnet', 'gpt-3.5-turbo'],
      'claude-3.5-sonnet': ['gpt-4o', 'claude-3-sonnet', 'gpt-3.5-turbo'],
      'gemini-1.5-flash': ['gemini-1.5-pro', 'gpt-3.5-turbo', 'claude-3-haiku'],
      
      // Legacy Models
      'gpt-4': ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      'gpt-4-turbo': ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo'],
      'gpt-3.5-turbo': ['gpt-4o', 'gemini-1.5-flash', 'claude-3-haiku'],
      'claude-3-opus': ['claude-3.5-sonnet', 'claude-3-sonnet', 'gpt-4o'],
      'claude-3-sonnet': ['claude-3.5-sonnet', 'claude-3-haiku', 'gpt-3.5-turbo'],
      'claude-3-haiku': ['gpt-3.5-turbo', 'gemini-1.5-flash', 'claude-3-sonnet'],
      'gemini-1.5-pro': ['gemini-1.5-flash', 'gpt-4o', 'gpt-3.5-turbo'],
      'deepseek-v3': ['deepseek-chat', 'deepseek-reasoner', 'gemini-1.5-flash', 'gpt-3.5-turbo'],
      'deepseek-r1': ['deepseek-chat', 'deepseek-reasoner', 'gemini-1.5-flash', 'gpt-3.5-turbo'],
      'deepseek-chat': ['deepseek-reasoner', 'deepseek-v3', 'gemini-1.5-flash', 'gpt-3.5-turbo'],
      'deepseek-reasoner': ['deepseek-chat', 'deepseek-v3', 'gemini-1.5-flash', 'gpt-3.5-turbo'],
    };

    for (const [key, value] of Object.entries(fallbacks)) {
      if (model.includes(key)) return value;
    }

    return [];
  }

  /**
   * Validate pricing accuracy - call this to check if pricing is up-to-date
   * @returns Object with pricing validation status and recommendations
   */
  validatePricing(): { 
    status: 'current' | 'outdated' | 'unknown', 
    message: string, 
    lastUpdated: string,
    recommendations: string[]
  } {
    return {
      status: 'unknown',
      message: 'Pricing accuracy cannot be guaranteed due to rapid changes in AI model pricing. Please verify with official provider documentation.',
      lastUpdated: 'January 2025',
      recommendations: [
        'Check OpenAI pricing page: https://openai.com/pricing',
        'Check Anthropic pricing page: https://www.anthropic.com/pricing',
        'Check Google AI pricing: https://ai.google.dev/pricing',
        'Check DeepSeek pricing: https://api-docs.deepseek.com/quick_start/pricing',
        'Consider implementing dynamic pricing updates via API'
      ]
    };
  }

  private async estimateCost(model: string, messages: any[]): Promise<number> {
    const estimatedTokens = messages.reduce((sum, m) => sum + (m.content?.length || 0) / 4, 0) * 1.5;
    
    try {
      // Try to get pricing from database first
      const response = await fetch(`${this.config.baseUrl}/api/pricing/scrape`);
      if (response.ok) {
        const data = await response.json() as { success: boolean; data?: any[] };
        if (data.success && data.data) {
          const pricingData = data.data.find((p: any) => 
            p.model.toLowerCase().includes(model.toLowerCase()) ||
            model.toLowerCase().includes(p.model.toLowerCase())
          );
          
          if (pricingData) {
            return (estimatedTokens / 1000000) * pricingData.averageCost;
          }
        }
      }
    } catch (error) {
      console.warn(`[CostLens] Failed to fetch dynamic pricing for ${model}, using fallback`);
    }

    // Fallback to static pricing
    const staticPricing: Record<string, number> = {
      // OpenAI 2025 (per 1M tokens, input + output average)
      'gpt-4o': 6.25,              // $2.50 input + $10 output = $6.25 avg
      'gpt-4': 45.00,              // $30 input + $60 output = $45 avg (legacy)
      'gpt-4-turbo': 20.00,        // $10 input + $30 output = $20 avg
      'gpt-3.5-turbo': 1.00,       // $0.5 input + $1.5 output = $1 avg
      
      // Anthropic 2025 (per 1M tokens, input + output average)
      'claude-3.5-sonnet': 3.00,   // $3 input + $3 output = $3 avg (25% price cut!)
      'claude-3-opus': 45.00,      // $15 input + $75 output = $45 avg (legacy)
      'claude-3-sonnet': 9.00,     // $3 input + $15 output = $9 avg (legacy)
      'claude-3-haiku': 0.75,      // $0.25 input + $1.25 output = $0.75 avg
      
      // Google Gemini 2025 (per 1M tokens, input + output average)
      'gemini-1.5-flash': 1.00,    // $1 input + $1 output = $1 avg (new 2025 pricing!)
      'gemini-1.5-pro': 3.125,     // $1.25 input + $5 output = $3.125 avg
      
      // DeepSeek V3.2-Exp 2025 (per 1M tokens, input + output average)
      // Official pricing from DeepSeek API docs (September 2025)
      'deepseek-v3': 0.35,         // $0.28 input + $0.42 output = $0.35 avg (cache miss)
      'deepseek-r1': 0.35,         // $0.28 input + $0.42 output = $0.35 avg (cache miss)
      'deepseek-chat': 0.35,       // $0.28 input + $0.42 output = $0.35 avg (cache miss)
      'deepseek-reasoner': 0.35,   // $0.28 input + $0.42 output = $0.35 avg (cache miss)
    };

    const rate = Object.entries(staticPricing).find(([key]) => model.includes(key))?.[1] || 1.00;
    return (estimatedTokens / 1000000) * rate; // Convert to per-1M tokens
  }

  private async trackRun(data: TrackRunData): Promise<void> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/integrations/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        // Don't throw on tracking errors - just log
        if (response.status === 401 || response.status === 403) {
          console.warn('[CostLens] Invalid API key - tracking disabled. Your app will continue to work.');
        } else {
          console.warn('[CostLens] Tracking failed:', response.statusText);
        }
      }
    } catch (error) {
      // Never throw on tracking errors - silently fail
      console.warn('[CostLens] Tracking error (non-fatal):', error);
    }
  }

  private getCacheKey(provider: string, params: any): string {
    return `${provider}:${JSON.stringify(params)}`;
  }

  private getFromCache(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.result;
  }

  private setCache(key: string, result: any, ttl: number = 3600000): void {
    this.cache.set(key, { result, timestamp: Date.now(), ttl });
  }

  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    retries: number = this.config.maxRetries || 3
  ): Promise<T> {
    let lastError: any;
    
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        
        // Don't retry on client errors (4xx)
        if (error?.status >= 400 && error?.status < 500) {
          throw error;
        }
        
        // Last attempt - throw error
        if (i === retries - 1) {
          throw error;
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
      }
    }
    
    throw lastError;
  }

  private async runMiddleware(type: 'before' | 'after' | 'onError', data: any, errorContext?: ErrorContext): Promise<any> {
    let result = data;
    for (const mw of this.config.middleware || []) {
      if (mw[type]) {
        try {
          if (type === 'onError' && errorContext) {
            result = await mw[type]!(data, errorContext);
          } else {
            result = await mw[type]!(data);
          }
        } catch (middlewareError) {
          // Don't let middleware errors break the main flow
          console.warn('[CostLens] Middleware error (non-fatal):', middlewareError);
        }
      }
    }
    return result;
  }

  // Wrapper: Auto-track OpenAI calls with advanced features
  wrapOpenAI(client: any) {
    const self = this;
    return {
      chat: {
        completions: {
          async create(params: any, options?: WrapperOptions) {
            // Auto-optimize prompts
            if (self.config.autoOptimize && params.messages) {
              for (const message of params.messages) {
                if (message.content && typeof message.content === 'string') {
                  message.content = await self.optimizePromptContent(message.content);
                }
              }
            }

            // Smart routing - select optimal model (check if enabled first)
            const originalModel = params.model;
            if (self.config.smartRouting) {
              const routingEnabled = await self.checkRoutingEnabled();
              if (routingEnabled) {
                params.model = await self.selectOptimalModel(params.model, params.messages);
                if (params.model !== originalModel) {
                  console.log(`[CostLens] Smart routing: ${originalModel} → ${params.model}`);
                }
              } else {
                console.log('[CostLens] Smart routing disabled due to quality concerns');
              }
            }

            // Cost limit check
            if (options?.maxCost || self.config.costLimit) {
              const estimatedCost = await self.estimateCost(params.model, params.messages);
              const limit = options?.maxCost || self.config.costLimit || Infinity;
              if (estimatedCost > limit) {
                throw new Error(`Estimated cost $${estimatedCost.toFixed(4)} exceeds limit $${limit}`);
              }
            }

            // Check cache (server-side only)
            if (self.config.enableCache && typeof process !== 'undefined' && process.versions && process.versions.node) {
              try {
                const cacheResponse = await fetch(`${self.config.baseUrl}/api/cache/get`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${self.config.apiKey}`,
                  },
                  body: JSON.stringify({
                    provider: 'openai',
                    model: params.model,
                    messages: params.messages,
                  }),
                });

                if (cacheResponse.ok) {
                  const cached = await cacheResponse.json() as { hit: boolean; savedCost: number; response: any };
                  if (cached.hit) {
                    console.log(`[CostLens] Cache hit - saved $${cached.savedCost.toFixed(4)}!`);
                    return cached.response;
                  }
                }
              } catch (error) {
                console.warn('[CostLens] Cache check failed:', error);
              }
            }

            // Run before middleware
            params = await self.runMiddleware('before', params);

            const start = Date.now();
            const fallbackModels = options?.fallbackModels || 
              (self.config.autoFallback ? self.getDefaultFallbacks(params.model) : []);

            // Try main model + fallbacks
            const modelsToTry = [params.model, ...fallbackModels];
            let lastError: any;

            for (let i = 0; i < modelsToTry.length; i++) {
              const currentModel = modelsToTry[i];
              const isOriginal = i === 0;

              try {
                const result = await self.retryWithBackoff(async () => {
                  return await client.chat.completions.create({
                    ...params,
                    model: currentModel,
                  });
                });

                // Run after middleware
                const processedResult = await self.runMiddleware('after', result);

                // Automatic quality validation for routed responses
                if (originalModel !== currentModel) {
                  const quality = QualityDetector.analyzeResponse(
                    processedResult.choices[0]?.message?.content || '',
                    JSON.stringify(params.messages)
                  );
                  
                  // If quality is too low, retry with original model
                  if (quality.qualityScore < 0.7) {
                    console.log(`[CostLens] Quality too low (${quality.qualityScore.toFixed(2)}), retrying with ${originalModel}`);
                    const fallbackResult = await client.chat.completions.create({
                      ...params,
                      model: originalModel,
                    });
                    return await self.runMiddleware('after', fallbackResult);
                  }
                  
                  console.log(`[CostLens] Quality validated: ${quality.qualityScore.toFixed(2)} score`);
                }

                // Save to cache (server-side only)
                if (self.config.enableCache && typeof process !== 'undefined' && process.versions && process.versions.node) {
                  try {
                    await fetch(`${self.config.baseUrl}/api/cache/set`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${self.config.apiKey}`,
                      },
                      body: JSON.stringify({
                        provider: 'openai',
                        model: currentModel,
                        messages: params.messages,
                        response: processedResult,
                        tokens: processedResult.usage?.total_tokens || 0,
                        cost: await self.estimateCost(currentModel, params.messages),
                        ttl: options?.cacheTTL || 3600,
                      }),
                    });
                  } catch (error) {
                    console.warn('[CostLens] Cache save failed:', error);
                  }
                }

                // Track with fallback info
                const inputTokens = processedResult.usage?.prompt_tokens || 0;
                const outputTokens = processedResult.usage?.completion_tokens || 0;
                
                // Calculate savings if we routed to cheaper model
                let savings = 0;
                if (originalModel !== currentModel) {
                  const requestedCost = await self.estimateCost(originalModel, params.messages);
                  const actualCost = await self.estimateCost(currentModel, params.messages);
                  savings = requestedCost - actualCost;
                }
                
                await self.trackRun({
                  provider: 'openai',
                  promptId: options?.promptId,
                  model: currentModel,
                  requestedModel: originalModel,
                  input: JSON.stringify(params.messages),
                  output: processedResult.choices[0]?.message?.content || '',
                  tokensUsed: processedResult.usage?.total_tokens || 0,
                  inputTokens,
                  outputTokens,
                  latency: Date.now() - start,
                  success: true,
                  savings,
                });

                if (!isOriginal) {
                  console.log(`[CostLens] Fallback success: ${originalModel} → ${currentModel}`);
                }

                return processedResult;
              } catch (error) {
                lastError = error;
                
                // If this is the last model, throw
                if (i === modelsToTry.length - 1) {
                  const errorContext: ErrorContext = {
                    provider: 'openai',
                    model: currentModel,
                    input: JSON.stringify(params.messages),
                    latency: Date.now() - start,
                    attempt: i + 1,
                    maxRetries: modelsToTry.length,
                    userId: options?.userId,
                    promptId: options?.promptId,
                    metadata: { originalModel, fallbackChain: modelsToTry }
                  };
                  await self.runMiddleware('onError', error, errorContext);
                  await self.trackError('openai', currentModel, JSON.stringify(params.messages), error as Error, Date.now() - start);
                  throw error;
                }

                // Otherwise, try next fallback
                console.log(`[CostLens] Fallback: ${currentModel} failed, trying ${modelsToTry[i + 1]}...`);
              }
            }

            throw lastError;
          },

          // Streaming support
          async stream(params: any, options?: { promptId?: string }) {
            const start = Date.now();
            let fullContent = '';
            let tokensUsed = 0;

            try {
              const stream = await client.chat.completions.create({
                ...params,
                stream: true,
              });

              // Wrap the stream to collect data
              const wrappedStream = {
                async *[Symbol.asyncIterator]() {
                  for await (const chunk of stream) {
                    const content = chunk.choices[0]?.delta?.content || '';
                    fullContent += content;
                    yield chunk;
                  }

                  // Track after stream completes
                  await self.trackRun({
                    provider: 'openai',
                    promptId: options?.promptId,
                    model: params.model,
                    input: JSON.stringify(params.messages),
                    output: fullContent,
                    tokensUsed: Math.ceil(fullContent.length / 4), // Rough estimate
                    latency: Date.now() - start,
                    success: true,
                  });
                }
              };

              return wrappedStream;
            } catch (error) {
              await self.trackError('openai', params.model, JSON.stringify(params.messages), error as Error, Date.now() - start);
              throw error;
            }
          }
        }
      }
    };
  }

  // Wrapper: Auto-track Anthropic calls
  wrapAnthropic(client: any) {
    const self = this;
    return {
      messages: {
        async create(params: any, options?: WrapperOptions) {
          const originalModel = params.model;
          if (self.config.smartRouting) {
            params.model = await self.selectOptimalModel(params.model, params.messages);
            if (params.model !== originalModel) {
              console.log(`[CostLens] Smart routing: ${originalModel} → ${params.model}`);
            }
          }

          if (options?.maxCost || self.config.costLimit) {
            const estimatedCost = await self.estimateCost(params.model, params.messages);
            const limit = options?.maxCost || self.config.costLimit || Infinity;
            if (estimatedCost > limit) {
              throw new Error(`Estimated cost $${estimatedCost.toFixed(4)} exceeds limit $${limit}`);
            }
          }

          if (self.config.enableCache) {
            const cacheKey = self.getCacheKey('anthropic', params);
            const cached = self.getFromCache(cacheKey);
            if (cached) {
              console.log('[CostLens] Cache hit - $0 cost!');
              return cached;
            }
          }

          params = await self.runMiddleware('before', params);

          const start = Date.now();
          const fallbackModels = options?.fallbackModels || 
            (self.config.autoFallback ? self.getDefaultFallbacks(params.model) : []);

          const modelsToTry = [params.model, ...fallbackModels];
          let lastError: any;

          for (let i = 0; i < modelsToTry.length; i++) {
            const currentModel = modelsToTry[i];
            const isOriginal = i === 0;

            try {
              const result = await self.retryWithBackoff(async () => {
                return await client.messages.create({
                  ...params,
                  model: currentModel,
                });
              });

              const processedResult = await self.runMiddleware('after', result);

              if (self.config.enableCache && options?.cacheTTL) {
                const cacheKey = self.getCacheKey('anthropic', params);
                self.setCache(cacheKey, processedResult, options.cacheTTL);
              }

              await self.trackRun({
                provider: 'anthropic',
                promptId: options?.promptId,
                model: currentModel,
                input: JSON.stringify(params.messages),
                output: processedResult.content[0]?.type === 'text' ? processedResult.content[0].text : '',
                tokensUsed: (processedResult.usage?.input_tokens || 0) + (processedResult.usage?.output_tokens || 0),
                latency: Date.now() - start,
                success: true,
              });

              if (!isOriginal) {
                console.log(`[CostLens] Fallback success: ${originalModel} → ${currentModel}`);
              }

              return processedResult;
            } catch (error) {
              lastError = error;
              
              if (i === modelsToTry.length - 1) {
                const errorContext: ErrorContext = {
                  provider: 'anthropic',
                  model: currentModel,
                  input: JSON.stringify(params.messages),
                  latency: Date.now() - start,
                  attempt: i + 1,
                  maxRetries: modelsToTry.length,
                  userId: options?.userId,
                  promptId: options?.promptId,
                  metadata: { originalModel, fallbackChain: modelsToTry }
                };
                await self.runMiddleware('onError', error, errorContext);
                await self.trackError('anthropic', currentModel, JSON.stringify(params.messages), error as Error, Date.now() - start);
                throw error;
              }

              console.log(`[CostLens] Fallback: ${currentModel} failed, trying ${modelsToTry[i + 1]}...`);
            }
          }

          throw lastError;
        }
      }
    };
  }

  // Batch tracking for multiple calls
  async trackBatch(calls: Array<{ provider: string; model: string; tokens: number; latency: number }>) {
    const promises = calls.map(call => 
      this.trackRun({
        provider: call.provider,
        model: call.model,
        input: '',
        output: '',
        tokensUsed: call.tokens,
        latency: call.latency,
        success: true,
      })
    );
    await Promise.all(promises);
  }

  // Clear cache
  clearCache(): void {
    this.cache.clear();
  }

  // Smart Call: Automatically select cheapest model meeting quality threshold
  smartCall(client: any) {
    return new SmartCall(client, this.config.apiKey);
  }

  // Optimize prompt for cost efficiency
  private async optimizePromptContent(content: string): Promise<string> {
    // Check cache first
    if (this.optimizationCache.has(content)) {
      return this.optimizationCache.get(content)!;
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/api/prompts/optimize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ prompt: content }),
      });

      if (response.ok) {
        const data = await response.json() as { optimized: string; tokenReduction: number };
        const optimized = data.optimized;
        
        // Cache the optimization
        this.optimizationCache.set(content, optimized);
        
        console.log(`[CostLens] Optimized prompt: ${data.tokenReduction}% reduction`);
        return optimized;
      }
      
      // Invalid API key - use original prompt
      if (response.status === 401 || response.status === 403) {
        console.warn('[CostLens] Invalid API key - optimization disabled');
      }
    } catch (error) {
      // Network error - fail gracefully, use original prompt
      console.warn('[CostLens] Optimization failed (non-fatal), using original prompt');
    }

    return content;
  }

  async trackOpenAI(
    params: OpenAI.Chat.ChatCompletionCreateParams,
    result: OpenAI.Chat.ChatCompletion,
    latency: number,
    promptId?: string
  ): Promise<void> {
    await this.trackRun({
      provider: 'openai',
      promptId,
      model: params.model,
      input: JSON.stringify(params.messages),
      output: result.choices[0]?.message?.content || '',
      tokensUsed: result.usage?.total_tokens || 0,
      latency,
      success: true,
    });
  }

  async trackAnthropic(
    params: Anthropic.MessageCreateParams,
    result: Anthropic.Message,
    latency: number,
    promptId?: string
  ): Promise<void> {
    await this.trackRun({
      provider: 'anthropic',
      promptId,
      model: params.model,
      input: JSON.stringify(params.messages),
      output: result.content[0]?.type === 'text' ? result.content[0].text : '',
      tokensUsed: (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0),
      latency,
      success: true,
    });
  }

  async trackGemini(
    params: any,
    result: any,
    latency: number,
    promptId?: string
  ): Promise<void> {
    await this.trackRun({
      provider: 'gemini',
      promptId,
      model: params.model || 'gemini-pro',
      input: JSON.stringify(params.contents || params.prompt),
      output: result.candidates?.[0]?.content?.parts?.[0]?.text || '',
      tokensUsed: result.usageMetadata?.totalTokenCount || 0,
      latency,
      success: true,
    });
  }

  async trackGrok(
    params: any,
    result: any,
    latency: number,
    promptId?: string
  ): Promise<void> {
    await this.trackRun({
      provider: 'grok',
      promptId,
      model: params.model || 'grok-beta',
      input: JSON.stringify(params.messages),
      output: result.choices?.[0]?.message?.content || '',
      tokensUsed: result.usage?.total_tokens || 0,
      latency,
      success: true,
    });
  }

  async trackDeepSeek(
    params: any,
    result: any,
    latency: number,
    promptId?: string
  ): Promise<void> {
    await this.trackRun({
      provider: 'deepseek',
      promptId,
      model: params.model || 'deepseek-v3',
      input: JSON.stringify(params.messages),
      output: result.choices?.[0]?.message?.content || '',
      tokensUsed: result.usage?.total_tokens || 0,
      latency,
      success: true,
    });
  }

  async trackError(
    provider: string,
    model: string,
    input: string,
    error: Error,
    latency: number
  ): Promise<void> {
    await this.trackRun({
      provider,
      model,
      input,
      output: '',
      tokensUsed: 0,
      latency,
      success: false,
      error: error.message,
    });
  }
}

export default CostLens;
export { CostLens as PromptCraft };
