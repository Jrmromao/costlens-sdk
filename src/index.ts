import type OpenAI from 'openai';
import type Anthropic from '@anthropic-ai/sdk';
import { SmartCall } from './smartCall';
import { QualityDetector } from './qualityDetector';

interface CostLensConfig {
  apiKey?: string; // Made optional for instant mode
  baseUrl?: string;
  enableCache?: boolean;
  maxRetries?: number;
  middleware?: Middleware[];
  autoFallback?: boolean;
  smartRouting?: boolean;
  autoOptimize?: boolean;
  costLimit?: number;
  logLevel?: 'silent' | 'error' | 'warn' | 'info';
  routingPolicy?: (
    requestedModel: string,
    messages: any[]
  ) => Promise<string | null> | string | null;
  qualityValidator?: (responseText: string, messagesJson: string) => Promise<number> | number; // return 0..1 quality score

  // NEW: Multi-provider configuration
  providers?: ProviderConfig[];
  routingStrategy?: 'balanced' | 'quality-first' | 'cost-first' | 'custom';
  enforceModel?: boolean;
  qualityThreshold?: number;
  enableQualityValidation?: boolean;
  enableBatchProcessing?: boolean;
  enableCircuitBreaker?: boolean;
}

interface WrapperOptions {
  promptId?: string;
  cacheTTL?: number;
  fallbackModels?: string[];
  maxCost?: number;
  userId?: string;
  requestId?: string;
  correlationId?: string;
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
  requestId?: string;
  correlationId?: string;
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
  lastAccessed?: number;
}

// NEW: Multi-provider interfaces
interface ProviderConfig {
  provider: string;
  model?: string;
  weight: number;
  minQuality: number;
  enforceModel: boolean;
  routingStrategy: string;
  apiKeyEncrypted?: string;
  enabled: boolean;
}

interface QualityValidator {
  threshold: number;
  enabled: boolean;
  metrics: string[];
}

interface QualityScore {
  overall: number;
  coherence: number;
  completeness: number;
  relevance: number;
  passed: boolean;
}

interface RoutingDecision {
  selectedModel: string;
  provider: string;
  originalModel: string;
  confidence: number;
  reasoning: string;
  estimatedCost: number;
  qualityScore: number;
}

interface RoutingOptions {
  enforceModel?: boolean;
  qualityThreshold?: number;
  maxCost?: number;
  strategy?: string;
}

interface ProviderApiKey {
  id: string;
  provider: string;
  createdAt: string;
  lastUsedAt?: string;
}

interface BatchRequest {
  provider?: string;
  model: string;
  prompt?: string;
  tokens?: number;
  latency?: number;
  options?: RoutingOptions;
}

interface BatchResult {
  success: boolean;
  result?: any;
  error?: string;
  routingDecision?: RoutingDecision;
}

export class CostLens {
  private config: CostLensConfig;
  private cache: Map<string, CacheEntry> = new Map();
  private optimizationCache: Map<string, string> = new Map();
  private rateLimitQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;
  private apiFailureCount = 0;
  private lastApiFailure = 0;
  private circuitBreakerThreshold = 5; // Fail 5 times in a row
  private circuitBreakerTimeout = 60000; // 1 minute
  private _routingDisabledLogged = false;

  constructor(config: CostLensConfig = {}) {
    this.config = {
      baseUrl: 'https://api.costlens.dev',
      enableCache: true,
      maxRetries: 3,
      middleware: [],
      autoFallback: true,
      smartRouting: true, // ON by default
      logLevel: 'warn', // Default to warn level
      ...config,
    };

    // No noisy logs - just work silently
  }

  private log(level: 'info' | 'warn' | 'error', message: string, ...args: any[]): void {
    const logLevel = this.config.logLevel || 'warn';

    if (logLevel === 'silent') return;

    const levels = { error: 0, warn: 1, info: 2 };
    const currentLevel = levels[logLevel];
    const messageLevel = levels[level];

    if (messageLevel <= currentLevel) {
      const prefix = '[CostLens]';
      if (level === 'error') {
        console.error(prefix, message, ...args);
      } else if (level === 'warn') {
        console.warn(prefix, message, ...args);
      } else {
        console.log(prefix, message, ...args);
      }
    }
  }

  private estimateComplexity(messages: any[]): 'simple' | 'medium' | 'complex' {
    const totalLength = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    const hasSystemPrompt = messages.some((m) => m.role === 'system');
    const messageCount = messages.length;

    if (totalLength < 100 && !hasSystemPrompt && messageCount <= 2) return 'simple';
    if (totalLength < 500 && messageCount <= 5) return 'medium';
    return 'complex';
  }

  private async selectOptimalModel(requestedModel: string, messages: any[]): Promise<string> {
    if (!this.config.smartRouting) return requestedModel;

    // Custom routing policy takes precedence when provided
    if (this.config.routingPolicy) {
      try {
        const routed = await this.config.routingPolicy(requestedModel, messages);
        if (routed && typeof routed === 'string') return routed;
      } catch (e) {
        console.warn('[CostLens] routingPolicy error (non-fatal):', e);
      }
    }

    // Don't route vision models
    if (requestedModel.includes('vision')) return requestedModel;

    const complexity = this.estimateComplexity(messages);
    const taskType = this.detectTaskType(messages);

    // PRIORITY 1: OpenAI routing (works for 90% of users)
    if (requestedModel.includes('gpt')) {
      // Simple tasks: GPT-4 → GPT-3.5-turbo (98% savings)
      if (complexity === 'simple' && requestedModel.includes('gpt-4')) {
        return 'gpt-3.5-turbo';
      }

      // Medium tasks: GPT-4 → GPT-4o (86% savings)
      if (complexity === 'medium' && requestedModel === 'gpt-4') {
        return 'gpt-4o';
      }

      // Coding tasks: GPT-4 → Claude 3.5 Sonnet (better at code, cheaper)
      if (taskType.includes('coding') && requestedModel.includes('gpt-4')) {
        return 'claude-3.5-sonnet';
      }
    }

    // PRIORITY 1.5: Anthropic routing (for Claude users)
    if (requestedModel.includes('claude')) {
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

  private detectTaskType(messages: any[]): string[] {
    const text = messages
      .map((m) => m.content)
      .join(' ')
      .toLowerCase();

    const types = [];

    if (/code|programming|function|debug|algorithm/.test(text)) types.push('coding');
    if (/write|creative|story|article|content/.test(text)) types.push('writing');
    if (/analyze|research|evaluate|compare/.test(text)) types.push('analysis');
    if (/translate|language/.test(text)) types.push('translation');
    if (/math|calculate|solve|equation/.test(text)) types.push('math');
    if (/simple|basic|quick|easy/.test(text)) types.push('simple');

    return types;
  }

  private async checkRoutingEnabled(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/quality/routing`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (response.ok) {
        const data = (await response.json()) as { enabled: boolean };
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
    status: 'current' | 'outdated' | 'unknown';
    message: string;
    lastUpdated: string;
    recommendations: string[];
  } {
    return {
      status: 'unknown',
      message:
        'Pricing accuracy cannot be guaranteed due to rapid changes in AI model pricing. Please verify with official provider documentation.',
      lastUpdated: 'January 2025',
      recommendations: [
        'Check OpenAI pricing page: https://openai.com/pricing',
        'Check Anthropic pricing page: https://www.anthropic.com/pricing',
        'Check Google AI pricing: https://ai.google.dev/pricing',
        'Check DeepSeek pricing: https://api-docs.deepseek.com/quick_start/pricing',
        'Consider implementing dynamic pricing updates via API',
      ],
    };
  }

  private async estimateCost(model: string, messages: any[]): Promise<number> {
    // Use existing token estimation and pricing logic
    const inputTokens = this.estimateTokens(messages, 'input');
    const outputTokens = this.estimateTokens(messages, 'output');
    const totalTokens = inputTokens + outputTokens;

    // Use existing pricing logic (works with or without API key)
    const pricing = this.getModelPricing(model);
    const inputCost = (inputTokens / 1000000) * pricing.input;
    const outputCost = (outputTokens / 1000000) * pricing.output;

    return inputCost + outputCost;
  }

  private estimateTokens(messages: any[], type: 'input' | 'output'): number {
    const content = messages.map((m) => m.content || '').join(' ');

    // More sophisticated token estimation
    let tokens = 0;

    // Base estimation: ~4 characters per token
    tokens += Math.ceil(content.length / 4);

    // Adjust for message overhead (system, user, assistant roles)
    tokens += messages.length * 4; // ~4 tokens per message overhead

    // Adjust for output vs input
    if (type === 'output') {
      // Output is typically 20-50% of input length
      tokens = Math.ceil(tokens * 0.3);
    }

    return Math.max(tokens, 1);
  }

  private getModelPricing(model: string): { input: number; output: number } {
    const pricing: Record<string, { input: number; output: number }> = {
      // OpenAI 2025 (per 1M tokens)
      'gpt-4o': { input: 2.5, output: 10.0 },
      'gpt-4': { input: 30.0, output: 60.0 },
      'gpt-4-turbo': { input: 10.0, output: 30.0 },
      'gpt-3.5-turbo': { input: 0.5, output: 1.5 },

      // Anthropic 2025 (per 1M tokens)
      'claude-3.5-sonnet': { input: 3.0, output: 3.0 },
      'claude-3-opus': { input: 15.0, output: 75.0 },
      'claude-3-sonnet': { input: 3.0, output: 15.0 },
      'claude-3-haiku': { input: 0.25, output: 1.25 },

      // Google Gemini 2025 (per 1M tokens)
      'gemini-1.5-flash': { input: 1.0, output: 1.0 },
      'gemini-1.5-pro': { input: 1.25, output: 5.0 },

      // DeepSeek 2025 (per 1M tokens)
      'deepseek-v3': { input: 0.28, output: 0.42 },
      'deepseek-r1': { input: 0.28, output: 0.42 },
      'deepseek-chat': { input: 0.28, output: 0.42 },
      'deepseek-reasoner': { input: 0.28, output: 0.42 },
    };

    // Find matching model
    for (const [key, value] of Object.entries(pricing)) {
      if (model.includes(key)) {
        return value;
      }
    }

    // Default fallback
    return { input: 1.0, output: 1.0 };
  }

  private async trackRun(data: TrackRunData): Promise<void> {
    try {
      // Skip tracking if no API key (instant mode)
      if (!this.config.apiKey) {
        return;
      }

      // Existing cloud tracking logic
      // Circuit breaker: skip tracking if API is down
      if (this.isApiDown()) {
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

      const response = await fetch(`${this.config.baseUrl}/integrations/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(data),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Track API failures for circuit breaker
        this.recordApiFailure();

        if (response.status === 401 || response.status === 403) {
          console.warn(
            '[CostLens] Invalid API key - tracking disabled. Your app will continue to work.'
          );
        } else {
          console.warn('[CostLens] Tracking failed:', response.statusText);
        }
      } else {
        // Reset failure count on success
        this.resetApiFailures();
      }
    } catch (error) {
      this.recordApiFailure();

      // Only log if it's not a timeout (to reduce noise)
      if ((error as Error).name !== 'AbortError') {
        console.warn('[CostLens] Tracking error (non-fatal):', error);
      }
    }
  }

  private getCacheKey(provider: string, params: any): string {
    // Create more stable cache keys by normalizing parameters
    const normalized = {
      model: params.model,
      messages: params.messages?.map((m: any) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content.trim() : m.content,
      })),
      temperature: params.temperature || 0.7,
      max_tokens: params.max_tokens,
    };

    return `${provider}:${JSON.stringify(normalized)}`;
  }

  private getFromCache(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Update access time for LRU
    entry.lastAccessed = Date.now();
    return entry.result;
  }

  private setCache(key: string, result: any, ttl: number = 3600000): void {
    // Implement LRU cache with size limit
    const maxCacheSize = 1000;

    if (this.cache.size >= maxCacheSize) {
      // Remove oldest entries
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => (a[1].lastAccessed || 0) - (b[1].lastAccessed || 0));

      // Remove 20% of oldest entries
      const toRemove = Math.floor(maxCacheSize * 0.2);
      for (let i = 0; i < toRemove; i++) {
        this.cache.delete(entries[i][0]);
      }
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      ttl,
      lastAccessed: Date.now(),
    });
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
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, i) * 1000));
      }
    }

    throw lastError;
  }

  private async runMiddleware(
    type: 'before' | 'after' | 'onError',
    data: any,
    errorContext?: ErrorContext
  ): Promise<any> {
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
                  self.log('info', `Smart routing: ${originalModel} → ${params.model}`);
                }
              } else {
                // Only log once per session to avoid spam
                if (!self._routingDisabledLogged) {
                  self.log('info', 'Smart routing disabled due to quality concerns');
                  self._routingDisabledLogged = true;
                }
              }
            }

            // Cost limit check
            if (options?.maxCost || self.config.costLimit) {
              const estimatedCost = await self.estimateCost(params.model, params.messages);
              const limit = options?.maxCost || self.config.costLimit || Infinity;
              if (estimatedCost > limit) {
                throw new Error(
                  `Estimated cost $${estimatedCost.toFixed(4)} exceeds limit $${limit}`
                );
              }
            }

            // Check in-memory cache first (works in tests and server-side)
            if (self.config.enableCache || options?.cacheTTL) {
              const localKey = self.getCacheKey('openai', {
                model: params.model,
                messages: params.messages,
              });
              const localCached = self.getFromCache(localKey);
              if (localCached) {
                self.log('info', 'Cache hit (memory) - $0 cost!');
                return localCached;
              }
            }

            // Check remote cache (server-side only)
            if (
              self.config.enableCache &&
              typeof process !== 'undefined' &&
              process.versions &&
              process.versions.node
            ) {
              try {
                const cacheResponse = await fetch(`${self.config.baseUrl}/api/cache/get`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${self.config.apiKey}`,
                  },
                  body: JSON.stringify({
                    provider: 'openai',
                    model: params.model,
                    messages: params.messages,
                  }),
                });

                if (cacheResponse.ok) {
                  const cached = (await cacheResponse.json()) as {
                    hit: boolean;
                    savedCost: number;
                    response: any;
                  };
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
            const fallbackModels =
              options?.fallbackModels ||
              (self.config.autoFallback ? self.getDefaultFallbacks(params.model) : []);

            // First try the original model with retries
            let lastError: any;
            let result: any;
            let usedModel = params.model;

            try {
              result = await self.retryWithBackoff(async () => {
                return await client.chat.completions.create({
                  ...params,
                  model: params.model,
                });
              });
            } catch (error) {
              lastError = error;

              // Only try fallback models for 5xx errors or network errors, not 4xx client errors
              const shouldTryFallback = !(error as any)?.status || (error as any).status >= 500;

              if (self.config.autoFallback && fallbackModels.length > 0 && shouldTryFallback) {
                const maxFallbacks = Math.min(fallbackModels.length, self.config.maxRetries || 3);

                for (let i = 0; i < maxFallbacks; i++) {
                  const fallbackModel = fallbackModels[i];

                  try {
                    result = await client.chat.completions.create({
                      ...params,
                      model: fallbackModel,
                    });
                    usedModel = fallbackModel;
                    break; // Success, exit fallback loop
                  } catch (fallbackError) {
                    lastError = fallbackError;
                    console.log(
                      `[CostLens] Fallback: ${fallbackModel} failed, trying ${fallbackModels[i + 1] || 'no more models'}...`
                    );
                  }
                }
              }
            }

            // If we have a result, process it
            if (result) {
              // Run after middleware
              const processedResult = await self.runMiddleware('after', result);

              // Automatic quality validation for routed responses
              if (originalModel !== usedModel) {
                const responseText = processedResult.choices[0]?.message?.content || '';
                const messagesJson = JSON.stringify(params.messages);
                const score = self.config.qualityValidator
                  ? await self.config.qualityValidator(responseText, messagesJson)
                  : QualityDetector.analyzeResponse(responseText, messagesJson).qualityScore;

                // If quality is too low, retry with original model
                if (score < 0.7) {
                  console.log(
                    `[CostLens] Quality too low (${score.toFixed(2)}), retrying with ${originalModel}`
                  );
                  const fallbackResult = await client.chat.completions.create({
                    ...params,
                    model: originalModel,
                  });
                  return await self.runMiddleware('after', fallbackResult);
                }

                console.log(`[CostLens] Quality validated: ${score.toFixed(2)} score`);
              }

              // Save to cache (in-memory and remote when available)
              if (self.config.enableCache || options?.cacheTTL) {
                // In-memory cache
                try {
                  const localKey = self.getCacheKey('openai', {
                    model: usedModel,
                    messages: params.messages,
                  });
                  const ttlMs = options?.cacheTTL ?? 3600000;
                  self.setCache(localKey, processedResult, ttlMs);
                } catch {}

                // Remote cache (server-side only)
                if (
                  self.config.enableCache &&
                  typeof process !== 'undefined' &&
                  process.versions &&
                  process.versions.node
                ) {
                  try {
                    await fetch(`${self.config.baseUrl}/api/cache/set`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${self.config.apiKey}`,
                      },
                      body: JSON.stringify({
                        provider: 'openai',
                        model: usedModel,
                        messages: params.messages,
                        response: processedResult,
                        tokens: processedResult.usage?.total_tokens || 0,
                        cost: await self.estimateCost(usedModel, params.messages),
                        ttl: options?.cacheTTL || 3600,
                      }),
                    });
                  } catch (error) {
                    console.warn('[CostLens] Cache save failed:', error);
                  }
                }
              }

              // Track with fallback info
              const inputTokens = processedResult.usage?.prompt_tokens || 0;
              const outputTokens = processedResult.usage?.completion_tokens || 0;

              // Calculate savings if we routed to cheaper model
              let savings = 0;
              if (originalModel !== usedModel) {
                const requestedCost = await self.estimateCost(originalModel, params.messages);
                const actualCost = await self.estimateCost(usedModel, params.messages);
                savings = requestedCost - actualCost;
              }

              await self.trackRun({
                provider: 'openai',
                promptId: options?.promptId,
                model: usedModel,
                requestedModel: originalModel,
                input: JSON.stringify(params.messages),
                output: processedResult.choices[0]?.message?.content || '',
                tokensUsed: processedResult.usage?.total_tokens || 0,
                inputTokens,
                outputTokens,
                latency: Date.now() - start,
                success: true,
                savings,
                requestId: options?.requestId,
                correlationId: options?.correlationId,
              });

              if (originalModel !== usedModel) {
                console.log(`[CostLens] Fallback success: ${originalModel} → ${usedModel}`);
              }

              return processedResult;
            } else {
              // No result, run error middleware, track the error and throw
              const errorContext: ErrorContext = {
                provider: 'openai',
                model: params.model,
                input: JSON.stringify(params.messages),
                latency: Date.now() - start,
                attempt: 1,
                maxRetries: 1,
                userId: options?.userId,
                promptId: options?.promptId,
                metadata: { originalModel: params.model },
              };
              await self.runMiddleware('onError', lastError, errorContext);
              await self.trackError(
                'openai',
                params.model,
                JSON.stringify(params.messages),
                lastError as Error,
                Date.now() - start
              );
              throw lastError;
            }
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
                },
              };

              return wrappedStream;
            } catch (error) {
              await self.trackError(
                'openai',
                params.model,
                JSON.stringify(params.messages),
                error as Error,
                Date.now() - start
              );
              throw error;
            }
          },
        },
      },
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
              self.log('info', `Smart routing: ${originalModel} → ${params.model}`);
            }
          }

          if (options?.maxCost || self.config.costLimit) {
            const estimatedCost = await self.estimateCost(params.model, params.messages);
            const limit = options?.maxCost || self.config.costLimit || Infinity;
            if (estimatedCost > limit) {
              throw new Error(
                `Estimated cost $${estimatedCost.toFixed(4)} exceeds limit $${limit}`
              );
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
          const fallbackModels =
            options?.fallbackModels ||
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
                output:
                  processedResult.content[0]?.type === 'text'
                    ? processedResult.content[0].text
                    : '',
                tokensUsed:
                  (processedResult.usage?.input_tokens || 0) +
                  (processedResult.usage?.output_tokens || 0),
                latency: Date.now() - start,
                success: true,
                requestId: options?.requestId,
                correlationId: options?.correlationId,
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
                  metadata: { originalModel, fallbackChain: modelsToTry },
                };
                await self.runMiddleware('onError', error, errorContext);
                await self.trackError(
                  'anthropic',
                  currentModel,
                  JSON.stringify(params.messages),
                  error as Error,
                  Date.now() - start
                );
                throw error;
              }

              console.log(
                `[CostLens] Fallback: ${currentModel} failed, trying ${modelsToTry[i + 1]}...`
              );
            }
          }

          throw lastError;
        },
      },
    };
  }

  // Batch tracking for multiple calls with optimization
  private batchQueue: TrackRunData[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;

  // Clear cache
  clearCache(): void {
    this.cache.clear();
  }

  // Calculate potential savings for a request
  async calculateSavings(
    requestedModel: string,
    messages: any[]
  ): Promise<{
    currentCost: number;
    optimizedCost: number;
    savings: number;
    savingsPercentage: number;
    recommendedModel: string;
  }> {
    const currentCost = await this.estimateCost(requestedModel, messages);
    const recommendedModel = await this.selectOptimalModel(requestedModel, messages);
    const optimizedCost = await this.estimateCost(recommendedModel, messages);

    const savings = currentCost - optimizedCost;
    const savingsPercentage = currentCost > 0 ? (savings / currentCost) * 100 : 0;

    return {
      currentCost,
      optimizedCost,
      savings,
      savingsPercentage,
      recommendedModel,
    };
  }

  // Get cost analytics for dashboard
  getCostAnalytics(): {
    cacheHitRate: number;
    totalSavings: number;
    averageLatency: number;
    errorRate: number;
  } {
    // Return basic defaults if no API key (instant mode)
    if (!this.config.apiKey) {
      return {
        cacheHitRate: 0,
        totalSavings: 0,
        averageLatency: 0,
        errorRate: 0,
      };
    }

    // Cloud mode - integrate with your existing monitoring system
    return {
      cacheHitRate: 0.75, // Placeholder - integrate with your monitoring
      totalSavings: 0, // Placeholder - integrate with your monitoring
      averageLatency: 0, // Placeholder - integrate with your monitoring
      errorRate: 0.02, // Placeholder - integrate with your monitoring
    };
  }

  // Smart Call: Automatically select cheapest model meeting quality threshold
  smartCall(client: any) {
    if (!this.config.apiKey) {
      throw new Error('SmartCall requires an API key. Please provide one to use cloud features.');
    }
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
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ prompt: content }),
      });

      if (response.ok) {
        const data = (await response.json()) as { optimized: string; tokenReduction: number };
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

  async trackGemini(params: any, result: any, latency: number, promptId?: string): Promise<void> {
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

  async trackGrok(params: any, result: any, latency: number, promptId?: string): Promise<void> {
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

  async trackDeepSeek(params: any, result: any, latency: number, promptId?: string): Promise<void> {
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

  // NEW: Multi-provider configuration methods
  async configureProviders(config: ProviderConfig[]): Promise<void> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/providers/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        throw new Error(`Failed to configure providers: ${response.statusText}`);
      }

      const result = (await response.json()) as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Failed to configure providers');
      }
    } catch (error) {
      console.error('[CostLens] Provider configuration failed:', error);
      throw error;
    }
  }

  async getProviderConfig(): Promise<ProviderConfig[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/providers/config`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get provider config: ${response.statusText}`);
      }

      const result = (await response.json()) as { configs?: any[] };
      return result.configs || [];
    } catch (error) {
      console.error('[CostLens] Failed to get provider config:', error);
      throw error;
    }
  }

  // NEW: Model enforcement methods
  async enableModelEnforcement(enabled: boolean): Promise<void> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/routing/enforcement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ enforceModel: enabled }),
      });

      if (!response.ok) {
        throw new Error(`Failed to set model enforcement: ${response.statusText}`);
      }

      const result = (await response.json()) as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Failed to set model enforcement');
      }
    } catch (error) {
      console.error('[CostLens] Model enforcement configuration failed:', error);
      throw error;
    }
  }

  validateModelConsistency(requestedModel: string, actualModel: string): boolean {
    // Simple model hierarchy validation
    const modelHierarchy = {
      'gpt-4': ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      'gpt-4o': ['gpt-4-turbo', 'gpt-3.5-turbo'],
      'gpt-4-turbo': ['gpt-3.5-turbo'],
      'claude-3-opus': ['claude-3.5-sonnet', 'claude-3-sonnet', 'claude-3-haiku'],
      'claude-3.5-sonnet': ['claude-3-sonnet', 'claude-3-haiku'],
      'claude-3-sonnet': ['claude-3-haiku'],
    };

    const allowedDowngrades = modelHierarchy[requestedModel as keyof typeof modelHierarchy] || [];

    // Allow same model or upgrades
    if (requestedModel === actualModel) return true;

    // Check if actual model is an allowed downgrade
    return allowedDowngrades.includes(actualModel);
  }

  // NEW: Quality validation methods
  async configureQualityValidation(validator: QualityValidator): Promise<void> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/routing/quality`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ qualityValidator: validator }),
      });

      if (!response.ok) {
        throw new Error(`Failed to configure quality validation: ${response.statusText}`);
      }

      const result = (await response.json()) as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Failed to configure quality validation');
      }
    } catch (error) {
      console.error('[CostLens] Quality validation configuration failed:', error);
      throw error;
    }
  }

  async validateResponseQuality(response: string): Promise<QualityScore> {
    try {
      const responseData = await fetch(`${this.config.baseUrl}/api/routing/quality`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ response }),
      });

      if (!responseData.ok) {
        throw new Error(`Failed to validate response quality: ${responseData.statusText}`);
      }

      const result = (await responseData.json()) as { qualityScore: QualityScore };
      return result.qualityScore;
    } catch (error) {
      console.error('[CostLens] Response quality validation failed:', error);
      throw error;
    }
  }

  // NEW: API key management methods
  async createProviderApiKey(provider: string, apiKey: string): Promise<void> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/api-keys/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ provider, apiKey }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create provider API key: ${response.statusText}`);
      }

      const result = (await response.json()) as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Failed to create provider API key');
      }
    } catch (error) {
      console.error('[CostLens] Provider API key creation failed:', error);
      throw error;
    }
  }

  async listProviderApiKeys(): Promise<ProviderApiKey[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/api-keys/providers`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to list provider API keys: ${response.statusText}`);
      }

      const result = (await response.json()) as { apiKeys?: ProviderApiKey[] };
      return result.apiKeys || [];
    } catch (error) {
      console.error('[CostLens] Failed to list provider API keys:', error);
      throw error;
    }
  }

  // NEW: Enhanced routing methods
  async getRoutingDecision(prompt: string, options?: RoutingOptions): Promise<RoutingDecision> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/quality/routing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ prompt, options }),
      });

      if (!response.ok) {
        throw new Error(`Failed to get routing decision: ${response.statusText}`);
      }

      const result = (await response.json()) as { routingDecision: RoutingDecision };
      return result.routingDecision;
    } catch (error) {
      console.error('[CostLens] Routing decision failed:', error);
      throw error;
    }
  }

  // NEW: Predictive cost forecasting
  async getCostForecast(): Promise<{
    forecast: Array<{
      date: string;
      predictedCost: number;
      confidence: number;
      factors: {
        requestVolume: number;
        avgCostPerRequest: number;
        seasonalAdjustment: number;
      };
    }>;
  }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/cost/predictive?type=forecast`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get cost forecast: ${response.statusText}`);
      }

      const result = (await response.json()) as { forecast: any[] };
      return result;
    } catch (error) {
      console.error('[CostLens] Cost forecast failed:', error);
      throw error;
    }
  }

  // NEW: Cost alerts and monitoring
  async checkCostAlerts(): Promise<{
    alerts: Array<{
      id: string;
      type: 'budget_exceeded' | 'unusual_spike' | 'runaway_cost';
      severity: 'low' | 'medium' | 'high' | 'critical';
      message: string;
      currentSpend: number;
      threshold: number;
      createdAt: string;
      resolved: boolean;
    }>;
  }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/cost/predictive?type=alerts`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to check cost alerts: ${response.statusText}`);
      }

      const result = (await response.json()) as { alerts: any[] };
      return result;
    } catch (error) {
      console.error('[CostLens] Cost alerts check failed:', error);
      throw error;
    }
  }

  // NEW: Optimization recommendations
  async getOptimizationRecommendations(): Promise<{
    potentialSavings: number;
    recommendations: Array<{
      type: 'model_downgrade' | 'provider_switch' | 'prompt_optimization' | 'batch_processing';
      description: string;
      estimatedSavings: number;
      confidence: number;
    }>;
  }> {
    try {
      const response = await fetch(
        `${this.config.baseUrl}/api/cost/predictive?type=recommendations`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get optimization recommendations: ${response.statusText}`);
      }

      const result = (await response.json()) as {
        potentialSavings: number;
        recommendations: any[];
      };
      return result;
    } catch (error) {
      console.error('[CostLens] Optimization recommendations failed:', error);
      throw error;
    }
  }

  // NEW: Context-aware routing
  async routeWithContext(
    prompt: string,
    preferences?: {
      maxCost?: number;
      minQuality?: number;
      maxLatency?: number;
      urgency?: 'low' | 'medium' | 'high';
    }
  ): Promise<{
    selectedModel: string;
    provider: string;
    reasoning: string;
    confidence: number;
    expectedCost: number;
    expectedQuality: number;
    expectedLatency: number;
    contextFactors: {
      promptComplexity: string;
      taskType: string;
      qualityRequirement: string;
      urgency: string;
    };
  }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/routing/context-aware`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ prompt, preferences }),
      });

      if (!response.ok) {
        throw new Error(`Failed to get context-aware routing: ${response.statusText}`);
      }

      const result = (await response.json()) as { success: boolean; routingDecision: any };
      if (!result.success) {
        throw new Error('Context-aware routing failed');
      }

      return result.routingDecision;
    } catch (error) {
      console.error('[CostLens] Context-aware routing failed:', error);
      throw error;
    }
  }

  // NEW: Enhanced batch processing
  async trackBatch(requests: BatchRequest[]): Promise<BatchResult[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/integrations/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ requests }),
      });

      if (!response.ok) {
        throw new Error(`Failed to process batch: ${response.statusText}`);
      }

      const result = (await response.json()) as { results?: BatchResult[] };
      return result.results || [];
    } catch (error) {
      console.error('[CostLens] Batch processing failed:', error);
      throw error;
    }
  }

  // NEW: Configuration validation
  validateProviderConfig(config: Partial<ProviderConfig>): boolean {
    if (!config.provider || typeof config.provider !== 'string') return false;
    if (config.weight !== undefined && (config.weight < 0 || config.weight > 100)) return false;
    if (config.minQuality !== undefined && (config.minQuality < 0 || config.minQuality > 1))
      return false;
    if (
      config.routingStrategy &&
      !['balanced', 'quality-first', 'cost-first', 'custom'].includes(config.routingStrategy)
    )
      return false;

    return true;
  }

  // Circuit breaker methods
  private isApiDown(): boolean {
    const now = Date.now();
    return (
      this.apiFailureCount >= this.circuitBreakerThreshold &&
      now - this.lastApiFailure < this.circuitBreakerTimeout
    );
  }

  private recordApiFailure(): void {
    this.apiFailureCount++;
    this.lastApiFailure = Date.now();
  }

  private resetApiFailures(): void {
    this.apiFailureCount = 0;
  }
}

export default CostLens;
