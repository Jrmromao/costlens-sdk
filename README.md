# CostLens SDK v2.0

[![npm version](https://img.shields.io/npm/v/costlens)](https://www.npmjs.com/package/costlens)
[![npm downloads](https://img.shields.io/npm/dm/costlens)](https://www.npmjs.com/package/costlens)

Smart AI cost optimization with **multi-provider routing**, **model enforcement**, and **quality validation**. Automatically routes requests across providers while maintaining quality and preventing downgrades. Save 70-95% on AI API costs.

## 🚀 New in v2.0

- **Multi-Provider Configuration**: Route requests across OpenAI, Anthropic, Google, and DeepSeek
- **Model Enforcement**: Prevent unwanted model downgrades
- **Quality Validation**: Ensure response quality meets your standards
- **Routing Strategies**: Choose between balanced, quality-first, or cost-first routing
- **API Key Management**: Securely manage provider API keys
- **Enhanced Batch Processing**: Process multiple requests efficiently

## Installation

```bash
npm install costlens
```

## Quick Start

```typescript
import { CostLens } from 'costlens';

const costlens = new CostLens({
  apiKey: 'your-costlens-api-key',
  smartRouting: true,
});

// OpenAI with smart routing
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: 'your-openai-key' });
const ai = costlens.wrapOpenAI(openai);

const response = await ai.chat.completions.create({
  model: 'gpt-4', // May be routed to gpt-3.5-turbo for cost savings
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### Advanced configuration

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
- **Multi-Provider**: OpenAI and Anthropic support
- **Zero Config**: Works out of the box with sensible defaults

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
