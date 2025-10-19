export class QualityDetector {
  static analyzeResponse(response: string, originalPrompt: string): {
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
      metrics: { completeness, coherence, relevance, accuracy }
    };
  }

  private static measureCompleteness(response: string, prompt: string): number {
    if (!response || response.length < 10) return 0;
    
    // Check if response addresses the prompt
    const promptWords = prompt.toLowerCase().split(/\s+/);
    const responseWords = response.toLowerCase().split(/\s+/);
    
    let score = 0.5; // Base score
    
    // Length appropriateness
    if (response.length > 50) score += 0.2;
    if (response.length > 200) score += 0.1;
    
    // Ends properly
    if (/[.!?]$/.test(response.trim())) score += 0.1;
    
    // Not truncated
    if (!response.endsWith('...') && !response.includes('[incomplete]')) score += 0.1;
    
    return Math.min(1, score);
  }

  private static measureCoherence(response: string): number {
    if (!response) return 0;
    
    let score = 0.5;
    
    // Has proper sentences
    const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
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
    const matchedTerms = uniqueTerms.filter(term => 
      responseLower.includes(term)
    );
    
    const relevanceRatio = matchedTerms.length / Math.max(uniqueTerms.length, 1);
    score += relevanceRatio * 0.4;
    
    // Direct question answering
    if (promptLower.includes('?') && responseLower.length > 20) score += 0.2;
    
    // Doesn't go off-topic
    if (!responseLower.includes('i cannot') && !responseLower.includes('i\'m sorry')) score += 0.1;
    
    return Math.min(1, score);
  }

  private static measureAccuracy(response: string): number {
    if (!response) return 0;
    
    let score = 0.7; // Assume accurate unless proven otherwise
    
    // Red flags for inaccuracy
    if (/i'm not sure|i don't know|might be wrong|uncertain/.test(response.toLowerCase())) {
      score -= 0.2;
    }
    
    // Confidence indicators
    if (/definitely|certainly|clearly|obviously/.test(response.toLowerCase())) {
      score += 0.1;
    }
    
    // Factual structure
    if (/according to|research shows|studies indicate/.test(response.toLowerCase())) {
      score += 0.1;
    }
    
    // Hedging (good for accuracy)
    if (/typically|generally|often|usually/.test(response.toLowerCase())) {
      score += 0.1;
    }
    
    return Math.min(1, score);
  }

  static shouldRoute(
    requestedModel: string,
    messages: any[],
    qualityThreshold: number = 0.75
  ): { shouldRoute: boolean; targetModel: string; confidence: number } {
    const complexity = this.estimateComplexity(messages);
    const taskType = this.detectTaskType(messages);
    
    // Never route high complexity or critical tasks
    if (complexity > 0.8 || this.isCritical(messages)) {
      return { shouldRoute: false, targetModel: requestedModel, confidence: 0.9 };
    }
    
    // Simple tasks: route to cheaper models
    if (complexity < 0.3) {
      return {
        shouldRoute: true,
        targetModel: 'gemini-1.5-flash',
        confidence: 0.85
      };
    }
    
    // Medium complexity: conservative routing
    if (complexity < 0.6 && taskType.includes('simple')) {
      const target = requestedModel.includes('gpt-4') ? 'gpt-4o' : 
                    requestedModel.includes('claude-3-opus') ? 'claude-3.5-sonnet' :
                    requestedModel;
      
      return {
        shouldRoute: target !== requestedModel,
        targetModel: target,
        confidence: 0.8
      };
    }
    
    return { shouldRoute: false, targetModel: requestedModel, confidence: 0.7 };
  }

  private static estimateComplexity(messages: any[]): number {
    const text = messages.map(m => m.content).join(' ').toLowerCase();
    
    let complexity = 0.2;
    
    if (text.length > 1000) complexity += 0.3;
    if (/complex|advanced|detailed|comprehensive/.test(text)) complexity += 0.4;
    if (/analyze|evaluate|compare|critique/.test(text)) complexity += 0.3;
    if (/simple|basic|quick|easy/.test(text)) complexity -= 0.3;
    
    return Math.max(0, Math.min(1, complexity));
  }

  private static detectTaskType(messages: any[]): string[] {
    const text = messages.map(m => m.content).join(' ').toLowerCase();
    const types = [];
    
    if (/simple|basic|quick|easy|straightforward/.test(text)) types.push('simple');
    if (/code|programming|function/.test(text)) types.push('coding');
    if (/write|creative|story/.test(text)) types.push('writing');
    
    return types;
  }

  private static isCritical(messages: any[]): boolean {
    const text = messages.map(m => m.content).join(' ').toLowerCase();
    return /critical|important|medical|legal|financial|safety|production|accurate|precise/.test(text);
  }
}
