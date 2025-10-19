# SDK Error Handling

## Graceful Degradation

The CostLens SDK is designed to **never break your application**, even if:
- Your API key is invalid
- Your API key expires
- The PromptCraft service is down
- Network requests fail

## What Happens with Invalid API Keys

### ✅ Your App Continues Working
- All AI calls to OpenAI, Anthropic, etc. work normally
- Your application logic is unaffected
- No exceptions are thrown

### ⚠️ Features Gracefully Disabled
When the API key is invalid, these features are automatically disabled:

1. **Usage Tracking** - Silently fails, logs warning
2. **Smart Routing** - Disabled, uses requested model
3. **Prompt Optimization** - Disabled, uses original prompts
4. **Caching** - Disabled, makes fresh API calls
5. **Cost Analytics** - No data sent to dashboard

## Example Behavior

```typescript
// Invalid API key
const costLens = new CostLens({ 
  apiKey: 'invalid_key_123' 
});

// ✅ This still works perfectly
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const wrapped = costLens.wrapOpenAI(openai);

const response = await wrapped.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }]
});

// Your app works! You just don't get:
// - Usage tracking in dashboard
// - Smart routing to cheaper models
// - Prompt optimization
// - Cost analytics
```

## Console Warnings

You'll see helpful warnings (not errors):

```
[CostLens] Warning: No API key provided. Tracking and optimization features will be disabled, but your app will continue to work.
[CostLens] Invalid API key - tracking disabled. Your app will continue to work.
[CostLens] Invalid API key - smart routing disabled
[CostLens] Invalid API key - optimization disabled
```

## Network Failures

All network requests have timeouts and fail gracefully:

- **Routing check**: 2 second timeout, defaults to enabled
- **Optimization**: 3 second timeout, uses original prompt
- **Tracking**: No timeout, silently fails
- **Cache**: Silently fails, makes fresh API call

## Best Practices

### 1. Always Provide an API Key (Even if Invalid)
```typescript
const costLens = new CostLens({ 
  apiKey: process.env.COSTLENS_API_KEY || 'none'
});
```

### 2. Monitor Console Warnings
Check your logs for `[CostLens]` warnings to detect issues.

### 3. Test Without API Key
Your app should work perfectly even without CostLens:

```typescript
// This is safe
const costLens = new CostLens({ apiKey: '' });
```

### 4. Handle Expired Keys
When your key expires, your app keeps working. Just:
1. Check your dashboard for warnings
2. Rotate your API key
3. Redeploy with new key

## Error Types That DON'T Break Your App

- ❌ `401 Unauthorized` - Invalid API key
- ❌ `403 Forbidden` - Expired or revoked key
- ❌ `429 Too Many Requests` - Rate limit exceeded
- ❌ `500 Internal Server Error` - PromptCraft service down
- ❌ `ECONNREFUSED` - Network failure
- ❌ `ETIMEDOUT` - Request timeout

All of these result in warnings, not exceptions.

## What DOES Break Your App

Only errors from your actual AI provider (OpenAI, Anthropic, etc.):

- ✅ Invalid OpenAI API key → Throws error (expected)
- ✅ OpenAI rate limit → Throws error (expected)
- ✅ Invalid model name → Throws error (expected)

These are **your responsibility** to handle, not CostLens's.

## Summary

**CostLens SDK = Zero Risk**

- Invalid key? App works, features disabled
- Service down? App works, features disabled
- Network error? App works, features disabled

Your application is **always protected**.
