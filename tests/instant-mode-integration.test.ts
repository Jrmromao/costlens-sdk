import { CostLens } from '../src/index';

describe('CostLens SDK - Instant Mode Integration', () => {
  beforeEach(() => {
    // Mock fetch
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should detect instant mode when no API key provided', () => {
    const costlens = new CostLens({
      baseUrl: 'https://api.costlens.dev'
      // No apiKey provided
    });

    expect(costlens.getMode()).toBe('instant');
  });

  it('should detect cloud mode when API key provided', () => {
    const costlens = new CostLens({
      apiKey: 'cl_test_key',
      baseUrl: 'https://api.costlens.dev'
    });

    expect(costlens.getMode()).toBe('cloud');
  });

  it('should call instant endpoint in instant mode', async () => {
    const mockResponse = {
      success: true,
      run: {
        id: 'run_123',
        userId: null,
        provider: 'openai',
        model: 'gpt-4',
        sessionId: 'session_123',
        isInstantMode: true
      },
      sessionId: 'session_123',
      analyticsUrl: '/analytics/instant?sessionId=session_123',
      upgradePrompt: {
        message: 'Upgrade for unlimited tracking',
        upgradeUrl: 'https://costlens.dev/upgrade',
        showAt: false
      }
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse)
    });

    const costlens = new CostLens({
      baseUrl: 'https://api.costlens.dev'
      // No apiKey - instant mode
    });

    // Simulate tracking a run
    await (costlens as any).trackRun({
      provider: 'openai',
      model: 'gpt-4',
      input: 'test',
      output: 'response',
      tokensUsed: 10,
      latency: 100,
      success: true
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.costlens.dev/api/integrations/run/instant',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
          // No Authorization header in instant mode
        }
      })
    );

    expect(costlens.getSessionId()).toBe('session_123');
    expect(costlens.getAnalyticsUrl()).toBe('https://costlens.dev/analytics/instant?sessionId=session_123');
  });

  it('should call cloud endpoint in cloud mode', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true })
    });

    const costlens = new CostLens({
      apiKey: 'cl_test_key',
      baseUrl: 'https://api.costlens.dev'
    });

    // Simulate tracking a run
    await (costlens as any).trackRun({
      provider: 'openai',
      model: 'gpt-4',
      input: 'test',
      output: 'response',
      tokensUsed: 10,
      latency: 100,
      success: true
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.costlens.dev/api/integrations/run',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Authorization': 'Bearer cl_test_key'
        })
      })
    );
  });

  it('should handle rate limits gracefully in instant mode', async () => {
    const mockErrorResponse = {
      success: false,
      error: 'Rate limit exceeded',
      upgradeUrl: 'https://costlens.dev/upgrade'
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve(mockErrorResponse)
    });

    const costlens = new CostLens({
      baseUrl: 'https://api.costlens.dev',
      logLevel: 'silent' // Suppress console output for test
    });

    // Should not throw error, just skip tracking
    await expect((costlens as any).trackRun({
      provider: 'openai',
      model: 'gpt-4',
      input: 'test',
      output: 'response',
      tokensUsed: 10,
      latency: 100,
      success: true
    })).resolves.toBeUndefined();
  });

  it('should return null analytics URL in cloud mode', () => {
    const costlens = new CostLens({
      apiKey: 'cl_test_key',
      baseUrl: 'https://api.costlens.dev'
    });

    expect(costlens.getAnalyticsUrl()).toBeNull();
  });
});
