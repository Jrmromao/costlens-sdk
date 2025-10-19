export class OpenAIRouter {
  static route(requestedModel: string, messages: any[]): string {
    const complexity = this.analyzeComplexity(messages);
    
    // Simple tasks: GPT-4 → GPT-3.5-turbo (98% savings)
    if (complexity < 0.3 && requestedModel.includes('gpt-4')) {
      return 'gpt-3.5-turbo';
    }
    
    // Medium tasks: GPT-4 → GPT-4o (86% savings)  
    if (complexity < 0.7 && requestedModel === 'gpt-4') {
      return 'gpt-4o';
    }
    
    // Keep premium for complex tasks
    return requestedModel;
  }
  
  private static analyzeComplexity(messages: any[]): number {
    const text = messages.map(m => m.content).join(' ').toLowerCase();
    
    let complexity = 0.3;
    
    // Simple indicators
    if (/simple|basic|quick|summarize|list/.test(text)) complexity -= 0.4;
    
    // Complex indicators  
    if (/analyze|complex|detailed|reasoning/.test(text)) complexity += 0.5;
    if (text.length > 1000) complexity += 0.3;
    
    return Math.max(0, Math.min(1, complexity));
  }
}
