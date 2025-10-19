import type OpenAI from 'openai';

interface SmartCallOptions {
  prompt: string;
  quality?: 'low' | 'medium' | 'high';
  maxCost?: number;
  systemPrompt?: string;
}

interface ModelCandidate {
  name: string;
  cost: number;
  quality: number;
  response: string;
}

export class SmartCall {
  private client: any;
  private apiKey: string;

  constructor(client: any, apiKey: string) {
    this.client = client;
    this.apiKey = apiKey;
  }

  async call(options: SmartCallOptions): Promise<OpenAI.Chat.ChatCompletion> {
    const { prompt, quality = 'high', maxCost, systemPrompt } = options;

    // Define model candidates with cost per 1K tokens (avg input+output)
    const models = [
      { name: 'gpt-3.5-turbo', cost: 0.001 },
      { name: 'gpt-4-turbo', cost: 0.02 },
      { name: 'gpt-4', cost: 0.045 },
    ];

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    // Test all models in parallel
    const candidates = await Promise.all(
      models.map(async (model) => {
        try {
          const response = await this.client.chat.completions.create({
            model: model.name,
            messages,
            temperature: 0.7,
          });

          const content = response.choices[0]?.message?.content || '';
          const qualityScore = this.scoreQuality(content, quality);

          return {
            name: model.name,
            cost: model.cost,
            quality: qualityScore,
            response: content,
            fullResponse: response,
          };
        } catch (error) {
          return null;
        }
      })
    );

    // Filter out failed requests
    const validCandidates = candidates.filter((c): c is NonNullable<typeof c> => c !== null);

    if (validCandidates.length === 0) {
      throw new Error('All models failed');
    }

    // Filter by quality threshold
    const qualityThreshold = quality === 'high' ? 0.8 : quality === 'medium' ? 0.6 : 0.4;
    const qualifiedCandidates = validCandidates.filter((c) => c.quality >= qualityThreshold);

    if (qualifiedCandidates.length === 0) {
      // Fall back to best quality if none meet threshold
      const best = validCandidates.sort((a, b) => b.quality - a.quality)[0];
      return best.fullResponse;
    }

    // Filter by cost if specified
    let finalCandidates = qualifiedCandidates;
    if (maxCost) {
      finalCandidates = qualifiedCandidates.filter((c) => c.cost <= maxCost);
      if (finalCandidates.length === 0) {
        throw new Error(`No models found under cost limit $${maxCost}`);
      }
    }

    // Select cheapest model that meets quality threshold
    const selected = finalCandidates.sort((a, b) => a.cost - b.cost)[0];

    console.log(`[PromptCraft SmartCall] Selected ${selected.name} (cost: $${selected.cost}, quality: ${(selected.quality * 100).toFixed(0)}%)`);

    return selected.fullResponse;
  }

  private scoreQuality(content: string, targetQuality: string): number {
    // Simple quality scoring based on response characteristics
    let score = 0.5; // Base score

    // Length check (not too short, not too long)
    if (content.length > 50 && content.length < 2000) score += 0.2;

    // Coherence check (has proper sentences)
    const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    if (sentences.length >= 2) score += 0.1;

    // Structure check (has paragraphs or formatting)
    if (content.includes('\n') || content.includes('- ')) score += 0.1;

    // Completeness check (doesn't end abruptly)
    if (content.trim().match(/[.!?]$/)) score += 0.1;

    return Math.min(score, 1.0);
  }
}
