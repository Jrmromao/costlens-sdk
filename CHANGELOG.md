# Changelog

All notable changes to the CostLens SDK will be documented in this file.

## [1.3.0] - 2024-11-09

### ✨ Added - Instant Mode
- **NEW: Zero-config instant mode** - CostLens now works without any API key required
- **Instant cost optimization** - Smart routing and cost calculations work immediately
- **Perfect for development** - No setup barriers for trying CostLens
- **Deploy anywhere** - Works in any environment without external dependencies

### 🚀 Features
- `new CostLens()` - Initialize without API key for instant mode
- `calculateSavings()` - Works in both instant and cloud modes
- Smart routing still functions (GPT-4 → GPT-3.5 for simple tasks)
- Graceful degradation from cloud to instant mode

### 🔧 Technical Changes
- Made `apiKey` parameter optional in `CostLensConfig`
- Tracking silently skipped when no API key provided (no errors)
- Removed noisy console logs for better developer experience
- Maintained full backward compatibility with existing code

### 📚 Documentation
- Updated README with instant mode examples
- Added comprehensive test coverage for instant mode
- Clear distinction between instant mode vs cloud mode features

### 🎯 Use Cases
- **Development & Testing**: Try CostLens instantly without signup
- **CI/CD Pipelines**: Deploy without managing API keys
- **Edge Deployments**: Run cost optimization anywhere
- **Open Source Projects**: Include cost optimization without barriers

## [1.2.0] - Previous Release
- Smart model routing
- Quality protection
- Cost analytics
- Caching system
- Multi-provider support
