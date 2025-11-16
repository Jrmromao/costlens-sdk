# CostLens SDK v1.3.1

[![npm version](https://img.shields.io/npm/v/costlens)](https://www.npmjs.com/package/costlens)
[![npm downloads](https://img.shields.io/npm/dm/costlens)](https://www.npmjs.com/package/costlens)

Smart AI cost optimization for **OpenAI and Anthropic**. Automatically routes expensive models to cheaper alternatives while maintaining quality. Save **up to 95%** on AI API costs with zero code changes.

## ✨ NEW: Instant Mode

**No API key required!** CostLens now works instantly with cost optimization and smart routing - perfect for getting started or deploying anywhere.

```typescript
import { CostLens } from 'costlens';
import OpenAI from 'openai';

// ✨ Instant mode - no API key needed!
const costlens = new CostLens();
const openai = new OpenAI({ apiKey: 'your-openai-key' });
const ai = costlens.wrapOpenAI(openai);

const response = await ai.chat.completions.create({
  model: 'gpt-4', // Automatically routes to gpt-3.5-turbo (97% savings!)
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

## 🚀 Key Features

- **✨ Instant Mode**: Works immediately without any setup or API keys
- **Smart Model Routing**: GPT-4 → GPT-3.5, Claude Opus → Claude Haiku
- **Quality Protection**: Prevents routing when quality would degrade
- **Zero Code Changes**: Drop-in wrapper for existing OpenAI/Anthropic code
- **Cost Analytics**: Track usage, costs, and savings in real-time (cloud mode)
- **Caching**: Avoid duplicate API calls with intelligent caching
- **Fallback Support**: Automatic fallback to alternative models
- **Error Handling**: Robust retry logic and circuit breakers

## Installation

```bash
npm install costlens
```

## Quick Start

### Instant Mode (No API Key Required)

Perfect for development, testing, or any environment where you want immediate cost optimization:

```typescript
import { CostLens } from 'costlens';
import OpenAI from 'openai';

// Works instantly - no configuration needed!
const costlens = new CostLens();
const openai = new OpenAI({ apiKey: 'your-openai-key' });
const ai = costlens.wrapOpenAI(openai);

// Smart routing works immediately
const response = await ai.chat.completions.create({
  model: 'gpt-4', // Routes to gpt-3.5-turbo for simple tasks
  messages: [{ role: 'user', content: 'What is 2+2?' }],
});

// Check potential savings
const savings = await costlens.calculateSavings('gpt-4', [
  { role: 'user', content: 'What is 2+2?' }
]);
console.log(`Save ${savings.savingsPercentage.toFixed(1)}% with ${savings.recommendedModel}`);
```

### Cloud Mode (Full Features)

For production applications that need tracking, analytics, and advanced features:

```typescript
import { CostLens } from 'costlens';
import OpenAI from 'openai';

const costlens = new CostLens({
  apiKey: 'your-costlens-api-key', // Get from https://costlens.dev
  smartRouting: true,
});

const openai = new OpenAI({ apiKey: 'your-openai-key' });
const ai = costlens.wrapOpenAI(openai);

const response = await ai.chat.completions.create({
  model: 'gpt-4', // May be routed to gpt-3.5-turbo for 95% cost savings
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### Anthropic Integration

Works with both instant and cloud modes:

```typescript
import { CostLens } from 'costlens';
import Anthropic from '@anthropic-ai/sdk';

const costlens = new CostLens({
  apiKey: 'your-costlens-api-key',
  smartRouting: true,
});

const anthropic = new Anthropic({ apiKey: 'your-anthropic-key' });
const ai = costlens.wrapAnthropic(anthropic);

const response = await ai.messages.create({
  model: 'claude-3-opus-20240229', // May be routed to claude-3-haiku for 98% savings
  messages: [{ role: 'user', content: 'Hello!' }],
  max_tokens: 100,
});
```

### Advanced Configuration

```ts
const costlens = new CostLens({
  apiKey: process.env.COSTLENS_API_KEY!,
  smartRouting: true,
  autoFallback: true,
  autoOptimize: false,
  maxRetries: 3,
  costLimit: 0.05,
  routingPolicy: (requestedModel, messages) => {
    // Example: pin analysis tasks to gpt-4o
    const text = (messages || [])
      .map((m) => m.content)
      .join(' ')
      .toLowerCase();
    if (/analy(z|s)e|evaluate|compare/.test(text) && requestedModel === 'gpt-4') {
      return 'gpt-4o';
    }
    return null; // fall back to built-in logic
  },
  qualityValidator: (responseText, messagesJson) => {
    // Example: simple policy to require closing punctuation
    let score = 0.5;
    if (/[.!?]$/.test(responseText.trim())) score += 0.2;
    if (responseText.length > 50) score += 0.2;
    return Math.min(1, score);
  },
});

// Including request/correlation IDs in tracking
await ai.chat.completions.create(
  {
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hi' }],
  },
  {
    promptId: 'msg-1',
    requestId: 'req_abc123',
    correlationId: 'corr_session_42',
  }
);
```

## Configuration

- The SDK is hosted by CostLens; no custom API URL is required. The default `baseUrl` is `https://api.costlens.dev` and is used for smart routing, tracking, caching, and prompt optimization.
- Overriding `baseUrl` is generally unnecessary and only for internal/proxy scenarios:

- An API key enables routing/analytics. Without it, these features are disabled gracefully.

## Features

- **Smart Model Routing**: Automatically routes expensive models to cheaper alternatives
- **Quality Detection**: Maintains quality by analyzing prompt complexity
- **Cost Tracking**: Real-time cost monitoring and analytics
- **Multi-Provider**: OpenAI, Anthropic, Google, and DeepSeek support
- **Model Enforcement**: Prevent silent model downgrades
- **Quality Validation**: Ensure responses meet quality thresholds
- **Predictive Analytics**: 30-day cost forecasts and optimization recommendations
- **Context-Aware Routing**: Intelligent routing based on task type and complexity
- **Zero Config**: Works out of the box with sensible defaults

## Advanced Features

### Multi-Provider Configuration

Configure and route across multiple AI providers with weighted distribution:

```typescript
import { CostLens } from 'costlens';

const costlens = new CostLens({
  apiKey: process.env.COSTLENS_API_KEY!,
  routingStrategy: 'balanced', // or 'quality-first', 'cost-first', 'custom'
});

// Configure providers with weights and quality thresholds
await costlens.configureProviders([
  {
    provider: 'openai',
    model: 'gpt-4',
    weight: 50, // 50% of requests
    minQuality: 0.9, // Minimum quality score
    enforceModel: true, // Prevent downgrades
    routingStrategy: 'quality-first',
    enabled: true,
  },
  {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet',
    weight: 30, // 30% of requests
    minQuality: 0.85,
    enforceModel: false,
    routingStrategy: 'cost-first',
    enabled: true,
  },
]);

// Get current provider configuration
const config = await costlens.getProviderConfig();
console.log('Active providers:', config);
```

### Model Enforcement

Prevent providers from silently downgrading your models:

```typescript
// Enable model enforcement globally
await costlens.enableModelEnforcement(true);

// Use in your requests
const response = await ai.chat.completions.create(
  {
    model: 'gpt-4', // This will be enforced
    messages: [{ role: 'user', content: 'Complex analysis...' }],
  },
  {
    enforceModel: true, // Additional request-level enforcement
  }
);

// Validate model consistency
const isValid = costlens.validateModelConsistency('gpt-4', response.model);
if (!isValid) {
  console.warn('Model downgrade detected!');
}
```

### Quality Validation

Ensure responses meet your quality standards:

```typescript
// Configure quality validation
await costlens.configureQualityValidation({
  threshold: 0.85, // Minimum quality score (0-1)
  enabled: true,
  metrics: ['coherence', 'completeness', 'relevance'],
});

// Validate a response
const qualityScore = await costlens.validateResponseQuality(response.text);
console.log('Quality:', qualityScore);
// {
//   overall: 0.92,
//   coherence: 0.95,
//   completeness: 0.90,
//   relevance: 0.91,
//   passed: true
// }

if (!qualityScore.passed) {
  // Handle low-quality response
  console.warn('Response quality below threshold');
}
```

### API Key Management

Securely manage provider API keys:

```typescript
// Create a provider API key (encrypted)
await costlens.createProviderApiKey('openai', process.env.OPENAI_API_KEY!);

// List all configured API keys
const apiKeys = await costlens.listProviderApiKeys();
console.log(
  'Configured providers:',
  apiKeys.map((k) => k.provider)
);
// [
//   { id: 'key_123', provider: 'openai', createdAt: '2025-01-15', lastUsedAt: '2025-01-20' },
//   { id: 'key_456', provider: 'anthropic', createdAt: '2025-01-16' }
// ]
```

### Predictive Cost Analytics

Get 30-day cost forecasts and optimization recommendations:

```typescript
// Get cost forecast
const forecast = await costlens.getCostForecast();
console.log('30-day forecast:', forecast.forecast);

// Check for cost alerts
const alerts = await costlens.checkCostAlerts();
alerts.alerts.forEach((alert) => {
  if (alert.severity === 'critical') {
    console.error(`⚠️ ${alert.message}`);
  }
});

// Get optimization recommendations
const recommendations = await costlens.getOptimizationRecommendations();
console.log(`Potential savings: $${recommendations.potentialSavings}`);
recommendations.recommendations.forEach((rec) => {
  console.log(`${rec.type}: ${rec.description} ($${rec.estimatedSavings} saved)`);
});
```

### Context-Aware Routing

Intelligent routing based on prompt complexity and requirements:

```typescript
// Get routing decision for a specific prompt
const routing = await costlens.routeWithContext(
  'Summarize this quarterly report in 3 bullet points',
  {
    maxCost: 0.01, // Maximum cost per request
    minQuality: 0.8, // Minimum quality threshold
    maxLatency: 2000, // Maximum latency in ms
    urgency: 'low', // 'low' | 'medium' | 'high'
  }
);

console.log(`Selected: ${routing.selectedModel} (${routing.provider})`);
console.log(`Expected cost: $${routing.expectedCost}`);
console.log('Context factors:', routing.contextFactors);
```

### Enhanced Batch Processing

Process multiple requests efficiently:

```typescript
// Process multiple requests in a single batch
const batchResults = await costlens.trackBatch([
  {
    model: 'gpt-4',
    prompt: 'Analyze this data...',
    options: { enforceModel: true, qualityThreshold: 0.9 },
  },
  {
    model: 'gpt-3.5-turbo',
    prompt: 'Simple translation...',
    options: { maxCost: 0.005 },
  },
]);

batchResults.forEach((result, index) => {
  if (result.success) {
    console.log(`Request ${index + 1}: ✅`, result.routingDecision);
  } else {
    console.error(`Request ${index + 1}: ❌`, result.error);
  }
});
```

### Getting Routing Decisions

Preview routing decisions before making requests:

```typescript
// Get routing decision for a prompt
const decision = await costlens.getRoutingDecision('What is the weather today?', {
  enforceModel: false,
  qualityThreshold: 0.75,
  maxCost: 0.01,
  strategy: 'cost-first',
});

console.log(`Recommended: ${decision.selectedModel}`);
console.log(`Confidence: ${decision.confidence}`);
console.log(`Estimated cost: $${decision.estimatedCost}`);
```

## Documentation

Visit [costlens.dev](https://costlens.dev) for full documentation.

## License

MIT

## Zero-to-Prod (Quick Win)

1. Environment

```bash
export COSTLENS_API_KEY=your-costlens-key
export OPENAI_API_KEY=your-openai-key
export ANTHROPIC_API_KEY=your-anthropic-key # optional
```

2. Next.js API Route (pages/api/chat.ts)

```ts
import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import { CostLens } from 'costlens';

const costlens = new CostLens({
  apiKey: process.env.COSTLENS_API_KEY || '',
  smartRouting: true,
  autoFallback: true,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ai = costlens.wrapOpenAI(openai);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { prompt } = req.body || {};
  const completion = await ai.chat.completions.create(
    {
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt || 'Hello!' }],
    },
    {
      promptId: 'chat-api',
    }
  );
  res.status(200).json({ text: completion.choices[0]?.message?.content || '' });
}
```

3. Express Minimal Server

```ts
import express from 'express';
import OpenAI from 'openai';
import { CostLens } from 'costlens';

const app = express();
app.use(express.json());

const costlens = new CostLens({
  apiKey: process.env.COSTLENS_API_KEY || '',
  smartRouting: true,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ai = costlens.wrapOpenAI(openai);

app.post('/chat', async (req, res) => {
  const { prompt } = req.body || {};
  const out = await ai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt || 'Hello!' }],
  });
  res.json({ text: out.choices[0]?.message?.content || '' });
});

app.listen(3000, () => console.log('http://localhost:3000'));
```
# Trigger build
