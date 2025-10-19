# CostLens SDK

[![npm version](https://img.shields.io/npm/v/costlens)](https://www.npmjs.com/package/costlens)
[![npm downloads](https://img.shields.io/npm/dm/costlens)](https://www.npmjs.com/package/costlens)

Smart AI cost optimization with quality-aware routing. Automatically routes expensive models (GPT-4, Claude Opus) to cheaper alternatives while maintaining quality. Save 70-95% on OpenAI & Anthropic API costs.

## Installation

```bash
npm install costlens
```

## Quick Start

```typescript
import { CostLens } from 'costlens';

const costlens = new CostLens({
  apiKey: 'your-costlens-api-key',
  enableSmartRouting: true
});

// OpenAI with smart routing
const openai = costlens.openai({
  apiKey: 'your-openai-key'
});

const response = await openai.chat.completions.create({
  model: 'gpt-4', // May be routed to gpt-3.5-turbo for cost savings
  messages: [{ role: 'user', content: 'Hello!' }]
});
```

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
