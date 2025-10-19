interface QualityMetrics {
  coherence: number;
  relevance: number;
  completeness: number;
  accuracy: number;
}

export class QualityRouter {
  private static qualityThreshold = 0.85; // Minimum quality score
  
  static async selectModel(
    requestedModel: string, 
    messages: any[], 
    userQualityPreference: number = 0.8
  ): Promise<{
    model: string;
    confidence: number;
    reasoning: string;
    costSavings: number;
  }> {
    const complexity = this.analyzeComplexity(messages);
    const taskType = this.detectTaskType(messages);
    
    // High complexity or accuracy-critical tasks: use premium models
    if (complexity > 0.8 || this.isAccuracyCritical(messages)) {
      return {
        model: requestedModel,
        confidence: 0.95,
        reasoning: 'High complexity task requires premium model',
        costSavings: 0
      };
    }
    
    // Medium complexity: smart routing with quality validation
    if (complexity > 0.5) {
      const candidate = this.selectMediumComplexityModel(requestedModel, taskType);
      return {
        model: candidate.model,
        confidence: candidate.confidence,
        reasoning: candidate.reasoning,
        costSavings: candidate.savings
      };
    }
    
    // Simple tasks: aggressive cost optimization
    const cheapModel = this.selectCheapestSuitable(taskType, userQualityPreference);
    return {
      model: cheapModel.model,
      confidence: cheapModel.confidence,
      reasoning: 'Simple task suitable for cost-optimized model',
      costSavings: cheapModel.savings
    };
  }
  
  private static analyzeComplexity(messages: any[]): number {
    const text = messages.map(m => m.content).join(' ').toLowerCase();
    
    let complexity = 0.2; // Base
    
    // Length indicators
    if (text.length > 2000) complexity += 0.3;
    else if (text.length > 500) complexity += 0.2;
    
    // Complexity keywords
    if (/complex|advanced|sophisticated|nuanced|intricate/.test(text)) complexity += 0.4;
    if (/analyze|evaluate|compare|assess|critique/.test(text)) complexity += 0.3;
    if (/multi-step|chain of thought|reasoning/.test(text)) complexity += 0.3;
    if (/code|algorithm|programming|debug/.test(text)) complexity += 0.2;
    
    // Simplicity indicators
    if (/simple|basic|easy|quick|straightforward/.test(text)) complexity -= 0.3;
    if (/yes\/no|true\/false|list|summarize/.test(text)) complexity -= 0.2;
    
    return Math.max(0, Math.min(1, complexity));
  }
  
  private static detectTaskType(messages: any[]): string[] {
    const text = messages.map(m => m.content).join(' ').toLowerCase();
    const types = [];
    
    if (/code|programming|function|debug/.test(text)) types.push('coding');
    if (/write|creative|story|article/.test(text)) types.push('writing');
    if (/math|calculate|solve|equation/.test(text)) types.push('math');
    if (/translate|language/.test(text)) types.push('translation');
    if (/analyze|research|evaluate/.test(text)) types.push('analysis');
    if (/simple|basic|quick/.test(text)) types.push('simple');
    
    return types;
  }
  
  private static isAccuracyCritical(messages: any[]): boolean {
    const text = messages.map(m => m.content).join(' ').toLowerCase();
    return /critical|important|accurate|precise|medical|legal|financial|safety/.test(text);
  }
  
  private static selectMediumComplexityModel(requestedModel: string, taskTypes: string[]) {
    // For coding tasks, prefer Claude 3.5 Sonnet (great at code, cheaper than GPT-4)
    if (taskTypes.includes('coding') && requestedModel.includes('gpt-4')) {
      return {
        model: 'claude-3.5-sonnet',
        confidence: 0.9,
        reasoning: 'Claude 3.5 Sonnet excels at coding tasks',
        savings: 17.25 // $20 -> $3
      };
    }
    
    // For writing, prefer Claude 3.5 Sonnet
    if (taskTypes.includes('writing') && requestedModel.includes('gpt-4')) {
      return {
        model: 'claude-3.5-sonnet',
        confidence: 0.85,
        reasoning: 'Claude 3.5 Sonnet excellent for writing',
        savings: 17.25
      };
    }
    
    // For analysis, use GPT-4o (cheaper than GPT-4, similar quality)
    if (taskTypes.includes('analysis') && requestedModel === 'gpt-4') {
      return {
        model: 'gpt-4o',
        confidence: 0.9,
        reasoning: 'GPT-4o provides similar analysis quality at lower cost',
        savings: 38.75 // $45 -> $6.25
      };
    }
    
    return {
      model: requestedModel,
      confidence: 0.8,
      reasoning: 'No suitable alternative found',
      savings: 0
    };
  }
  
  private static selectCheapestSuitable(taskTypes: string[], qualityPreference: number) {
    // High quality preference: use Gemini Flash (good quality, very cheap)
    if (qualityPreference > 0.8) {
      return {
        model: 'gemini-1.5-flash',
        confidence: 0.8,
        reasoning: 'Gemini Flash provides good quality for simple tasks',
        savings: 19.25 // vs GPT-4 Turbo
      };
    }
    
    // Medium quality: DeepSeek for maximum savings
    return {
      model: 'deepseek-chat',
      confidence: 0.7,
      reasoning: 'DeepSeek suitable for simple tasks with maximum cost savings',
      savings: 19.65 // vs GPT-4 Turbo
    };
  }
}
