export class QualityDetector {
  static analyzeResponse(
    response: string,
    originalPrompt: string
  ): {
    qualityScore: number;
    metrics: {
      completeness: number;
      coherence: number;
      relevance: number;
      accuracy: number;
    };
  } {
    const completeness = this.measureCompleteness(response, originalPrompt);
    const coherence = this.measureCoherence(response);
    const relevance = this.measureRelevance(response, originalPrompt);
    const accuracy = this.measureAccuracy(response);

    const qualityScore = (completeness + coherence + relevance + accuracy) / 4;

    return {
      qualityScore,
      metrics: { completeness, coherence, relevance, accuracy },
    };
  }

  private static measureCompleteness(response: string, prompt: string): number {
    if (!response || response.length < 10) return 0;

    let score = 0.3; // Base score

    // Length appropriateness (more sophisticated)
    const promptLength = prompt.length;
    const responseLength = response.length;
    const lengthRatio = responseLength / Math.max(promptLength, 1);

    if (lengthRatio > 0.5 && lengthRatio < 3.0) score += 0.3; // Good length ratio
    if (responseLength > 100) score += 0.2; // Substantial response
    if (responseLength > 500) score += 0.1; // Detailed response

    // Question answering completeness
    if (prompt.includes('?')) {
      const questionWords = ['what', 'how', 'why', 'when', 'where', 'which', 'who'];
      const hasQuestionWords = questionWords.some((word) => prompt.toLowerCase().includes(word));
      if (hasQuestionWords && responseLength > 50) score += 0.2;
    }

    // Ends properly
    if (/[.!?]$/.test(response.trim())) score += 0.1;

    // Not truncated or incomplete
    if (
      !response.endsWith('...') &&
      !response.includes('[incomplete]') &&
      !response.includes('[truncated]')
    )
      score += 0.1;

    return Math.min(1, score);
  }

  private static measureCoherence(response: string): number {
    if (!response) return 0;

    let score = 0.5;

    // Has proper sentences
    const sentences = response.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    if (sentences.length >= 2) score += 0.2;

    // No repetition
    const words = response.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words);
    const repetitionRatio = uniqueWords.size / words.length;
    if (repetitionRatio > 0.7) score += 0.2;

    // Proper grammar indicators
    if (!/\b(the the|and and|is is)\b/.test(response)) score += 0.1;

    return Math.min(1, score);
  }

  private static measureRelevance(response: string, prompt: string): number {
    if (!response || !prompt) return 0;

    const promptLower = prompt.toLowerCase();
    const responseLower = response.toLowerCase();

    let score = 0.3; // Base score

    // Extract key terms from prompt
    const keyTerms = promptLower.match(/\b\w{4,}\b/g) || [];
    const uniqueTerms = [...new Set(keyTerms)];

    // Check how many key terms appear in response
    const matchedTerms = uniqueTerms.filter((term) => responseLower.includes(term));

    const relevanceRatio = matchedTerms.length / Math.max(uniqueTerms.length, 1);
    score += relevanceRatio * 0.4;

    // Direct question answering
    if (promptLower.includes('?') && responseLower.length > 20) score += 0.2;

    // Doesn't go off-topic
    if (!responseLower.includes('i cannot') && !responseLower.includes("i'm sorry")) score += 0.1;

    return Math.min(1, score);
  }

  private static measureAccuracy(response: string): number {
    if (!response) return 0;

    let score = 0.6; // More conservative base score

    // Red flags for inaccuracy
    const uncertaintyPhrases = [
      /i'm not sure/i,
      /i don't know/i,
      /might be wrong/i,
      /uncertain/i,
      /i think/i,
      /i believe/i,
      /probably/i,
      /maybe/i,
      /perhaps/i,
    ];

    const uncertaintyCount = uncertaintyPhrases.filter((phrase) => phrase.test(response)).length;
    score -= uncertaintyCount * 0.1;

    // Confidence indicators
    const confidencePhrases = [
      /definitely/i,
      /certainly/i,
      /clearly/i,
      /obviously/i,
      /without a doubt/i,
      /absolutely/i,
      /precisely/i,
    ];

    const confidenceCount = confidencePhrases.filter((phrase) => phrase.test(response)).length;
    score += confidenceCount * 0.05;

    // Factual structure and citations
    if (
      /according to|research shows|studies indicate|data shows|evidence suggests/i.test(response)
    ) {
      score += 0.15;
    }

    // Specific numbers and dates (indicates factual content)
    if (/\d{4}|\d+%|\$\d+|\d+\.\d+/.test(response)) {
      score += 0.1;
    }

    // Proper hedging (good for accuracy)
    if (/typically|generally|often|usually|in most cases|commonly/i.test(response)) {
      score += 0.08;
    }

    // Avoids absolute statements (good for accuracy)
    if (!/always|never|all|every|none/i.test(response)) {
      score += 0.05;
    }

    // Length and detail (more detailed responses tend to be more accurate)
    if (response.length > 200) score += 0.05;
    if (response.length > 500) score += 0.05;

    return Math.min(1, Math.max(0, score));
  }

  static shouldRoute(
    requestedModel: string,
    messages: any[],
    qualityThreshold: number = 0.75
  ): { shouldRoute: boolean; targetModel: string; confidence: number; reasoning: string } {
    const complexity = this.estimateComplexity(messages);
    const taskType = this.detectTaskType(messages);
    const isCritical = this.isCritical(messages);

    // Never route high complexity or critical tasks
    if (complexity > 0.8 || isCritical) {
      return {
        shouldRoute: false,
        targetModel: requestedModel,
        confidence: 0.9,
        reasoning: isCritical
          ? 'Critical task requires premium model'
          : 'High complexity task requires premium model',
      };
    }

    // Simple tasks: route to cheaper models
    if (complexity < 0.3) {
      const targetModel = this.getOptimalSimpleModel(requestedModel, taskType);
      return {
        shouldRoute: true,
        targetModel,
        confidence: 0.85,
        reasoning: `Simple task suitable for ${targetModel}`,
      };
    }

    // Medium complexity: conservative routing
    if (complexity < 0.6) {
      const targetModel = this.getOptimalMediumModel(requestedModel, taskType);
      return {
        shouldRoute: targetModel !== requestedModel,
        targetModel,
        confidence: 0.8,
        reasoning:
          targetModel !== requestedModel
            ? `Medium complexity task can use ${targetModel}`
            : 'No suitable alternative found',
      };
    }

    return {
      shouldRoute: false,
      targetModel: requestedModel,
      confidence: 0.7,
      reasoning: 'Complex task requires original model',
    };
  }

  private static getOptimalSimpleModel(requestedModel: string, taskTypes: string[]): string {
    // For coding tasks, prefer Claude Haiku (excellent at code, very cheap)
    if (taskTypes.includes('coding')) {
      return 'claude-3-haiku';
    }

    // For writing tasks, prefer GPT-3.5-turbo
    if (taskTypes.includes('writing')) {
      return 'gpt-3.5-turbo';
    }

    // For math tasks, prefer GPT-3.5-turbo
    if (taskTypes.includes('math')) {
      return 'gpt-3.5-turbo';
    }

    // Default to GPT-3.5-turbo for simple tasks
    return 'gpt-3.5-turbo';
  }

  private static getOptimalMediumModel(requestedModel: string, taskTypes: string[]): string {
    // For coding tasks, prefer Claude 3.5 Sonnet
    if (taskTypes.includes('coding') && requestedModel.includes('gpt-4')) {
      return 'claude-3.5-sonnet';
    }

    // For writing tasks, prefer Claude 3.5 Sonnet
    if (taskTypes.includes('writing') && requestedModel.includes('gpt-4')) {
      return 'claude-3.5-sonnet';
    }

    // For analysis tasks, prefer GPT-4o
    if (taskTypes.includes('analysis') && requestedModel === 'gpt-4') {
      return 'gpt-4o';
    }

    // For Claude Opus, route to Claude 3.5 Sonnet
    if (requestedModel.includes('claude-3-opus')) {
      return 'claude-3.5-sonnet';
    }

    return requestedModel;
  }

  private static estimateComplexity(messages: any[]): number {
    const text = messages
      .map((m) => m.content)
      .join(' ')
      .toLowerCase();

    let complexity = 0.2;

    if (text.length > 1000) complexity += 0.3;
    if (/complex|advanced|detailed|comprehensive/.test(text)) complexity += 0.4;
    if (/analyze|evaluate|compare|critique/.test(text)) complexity += 0.3;
    if (/simple|basic|quick|easy/.test(text)) complexity -= 0.3;

    return Math.max(0, Math.min(1, complexity));
  }

  private static detectTaskType(messages: any[]): string[] {
    const text = messages
      .map((m) => m.content)
      .join(' ')
      .toLowerCase();
    const types = [];

    if (/simple|basic|quick|easy|straightforward/.test(text)) types.push('simple');
    if (/code|programming|function/.test(text)) types.push('coding');
    if (/write|creative|story/.test(text)) types.push('writing');

    return types;
  }

  private static isCritical(messages: any[]): boolean {
    const text = messages
      .map((m) => m.content)
      .join(' ')
      .toLowerCase();
    return /critical|important|medical|legal|financial|safety|production|accurate|precise/.test(
      text
    );
  }
}
