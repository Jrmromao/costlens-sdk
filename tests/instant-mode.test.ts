import CostLens from '../src/index';

describe('CostLens Instant Mode', () => {
  describe('Initialization', () => {
    it('should initialize without API key (instant mode)', () => {
      const costlens = new CostLens();
      expect(costlens).toBeInstanceOf(CostLens);
    });

    it('should initialize with empty config (instant mode)', () => {
      const costlens = new CostLens({});
      expect(costlens).toBeInstanceOf(CostLens);
    });

    it('should initialize with API key (cloud mode)', () => {
      const costlens = new CostLens({ apiKey: 'cl_test_key' });
      expect(costlens).toBeInstanceOf(CostLens);
    });
  });

  describe('Cost Calculations', () => {
    let costlens: CostLens;

    beforeEach(() => {
      costlens = new CostLens(); // Instant mode
    });

    it('should calculate savings without API key', async () => {
      const messages = [{ role: 'user', content: 'What is 2+2?' }];
      const savings = await costlens.calculateSavings('gpt-4', messages);

      expect(savings).toHaveProperty('currentCost');
      expect(savings).toHaveProperty('optimizedCost');
      expect(savings).toHaveProperty('savings');
      expect(savings).toHaveProperty('savingsPercentage');
      expect(savings).toHaveProperty('recommendedModel');

      expect(typeof savings.currentCost).toBe('number');
      expect(typeof savings.optimizedCost).toBe('number');
      expect(typeof savings.savings).toBe('number');
      expect(typeof savings.savingsPercentage).toBe('number');
      expect(typeof savings.recommendedModel).toBe('string');

      expect(savings.currentCost).toBeGreaterThan(0);
      expect(savings.optimizedCost).toBeGreaterThanOrEqual(0);
      expect(savings.savings).toBeGreaterThanOrEqual(0);
    });

    it('should route simple tasks to cheaper models', async () => {
      const simpleMessages = [{ role: 'user', content: 'Hi' }];
      const savings = await costlens.calculateSavings('gpt-4', simpleMessages);

      expect(savings.recommendedModel).toBe('gpt-3.5-turbo');
      expect(savings.savingsPercentage).toBeGreaterThan(90); // Should be significant savings
    });

    it('should handle complex tasks appropriately', async () => {
      const complexMessages = [{ 
        role: 'user', 
        content: 'Write a comprehensive analysis of quantum computing implications for cryptography, including detailed mathematical proofs and implementation strategies for post-quantum cryptographic algorithms.' 
      }];
      const savings = await costlens.calculateSavings('gpt-4', complexMessages);

      // Complex tasks may route to gpt-4o (cheaper than gpt-4 but still capable)
      expect(['gpt-4', 'gpt-4o']).toContain(savings.recommendedModel);
      expect(savings.savingsPercentage).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Analytics', () => {
    it('should return default analytics in instant mode', () => {
      const costlens = new CostLens();
      const analytics = costlens.getCostAnalytics();

      expect(analytics).toEqual({
        cacheHitRate: 0,
        totalSavings: 0,
        averageLatency: 0,
        errorRate: 0,
      });
    });
  });

  describe('Smart Call', () => {
    it('should throw error for SmartCall without API key', () => {
      const costlens = new CostLens();
      const mockClient = {};

      expect(() => {
        costlens.smartCall(mockClient);
      }).toThrow('SmartCall requires an API key');
    });

    it('should work with API key', () => {
      const costlens = new CostLens({ apiKey: 'cl_test_key' });
      const mockClient = {};

      // Should not throw
      expect(() => {
        costlens.smartCall(mockClient);
      }).not.toThrow();
    });
  });

  describe('Comparison: Instant vs Cloud Mode', () => {
    it('should produce same routing decisions in both modes', async () => {
      const instantMode = new CostLens();
      const cloudMode = new CostLens({ apiKey: 'cl_test_key' });

      const messages = [{ role: 'user', content: 'What is the capital of France?' }];

      const instantSavings = await instantMode.calculateSavings('gpt-4', messages);
      const cloudSavings = await cloudMode.calculateSavings('gpt-4', messages);

      expect(instantSavings.recommendedModel).toBe(cloudSavings.recommendedModel);
      expect(instantSavings.savingsPercentage).toBeCloseTo(cloudSavings.savingsPercentage, 1);
    });
  });

  describe('Error Handling', () => {
    it('should handle empty messages gracefully', async () => {
      const costlens = new CostLens();
      const savings = await costlens.calculateSavings('gpt-4', []);

      expect(savings).toHaveProperty('currentCost');
      expect(savings).toHaveProperty('recommendedModel');
    });

    it('should handle unknown models gracefully', async () => {
      const costlens = new CostLens();
      const messages = [{ role: 'user', content: 'Hello' }];
      
      // Should not throw for unknown model
      await expect(costlens.calculateSavings('unknown-model', messages)).resolves.toBeDefined();
    });
  });

  describe('Integration', () => {
    it('should work with OpenAI wrapper without API key', () => {
      const costlens = new CostLens();
      
      // Mock OpenAI client
      const mockOpenAI = {
        chat: {
          completions: {
            create: jest.fn()
          }
        }
      };

      // Should not throw when wrapping
      expect(() => {
        costlens.wrapOpenAI(mockOpenAI);
      }).not.toThrow();
    });

    it('should work with Anthropic wrapper without API key', () => {
      const costlens = new CostLens();
      
      // Mock Anthropic client
      const mockAnthropic = {
        messages: {
          create: jest.fn()
        }
      };

      // Should not throw when wrapping
      expect(() => {
        costlens.wrapAnthropic(mockAnthropic);
      }).not.toThrow();
    });
  });
});
