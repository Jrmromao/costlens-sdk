# How to Publish SDK to NPM

## Prerequisites

1. **NPM Account**
   - Create account at https://www.npmjs.com/signup
   - Verify your email

2. **Login to NPM**
   ```bash
   npm login
   ```
   Enter your username, password, and email

## Publishing Steps

### 1. Test Locally First

```bash
cd sdk
npm run build
npm pack
```

This creates `promptcraft-sdk-0.1.0.tgz` - test it in another project:

```bash
cd /path/to/test-project
npm install /path/to/promptcraft-sdk-0.1.0.tgz
```

### 2. Check Package Contents

```bash
npm publish --dry-run
```

This shows what will be published without actually publishing.

### 3. Publish to NPM

```bash
npm publish
```

That's it! Your package is now live at:
- https://www.npmjs.com/package/promptcraft-sdk

### 4. Install in Projects

```bash
npm install promptcraft-sdk
```

## Version Updates

When you make changes:

```bash
# Patch version (0.1.0 → 0.1.1)
npm version patch

# Minor version (0.1.0 → 0.2.0)
npm version minor

# Major version (0.1.0 → 1.0.0)
npm version major

# Then publish
npm publish
```

## Troubleshooting

**Error: Package name already taken**
- Change name in package.json to something unique
- Try: `promptcraft-analytics-sdk`, `pc-sdk`, etc.

**Error: You must verify your email**
- Check your email and click verification link
- Try `npm login` again

**Error: 402 Payment Required**
- Scoped packages (@org/name) require paid account
- Use unscoped name (promptcraft-sdk) instead

## Current Status

- ✅ Package name: `promptcraft-sdk`
- ✅ Version: `0.1.0`
- ✅ Build: Working
- ✅ TypeScript types: Included
- ⚠️ Not published yet

## Before Publishing Checklist

- [ ] Test SDK locally
- [ ] Update README with real examples
- [ ] Add LICENSE file
- [ ] Create GitHub repo (optional but recommended)
- [ ] Test in real project
- [ ] Publish to NPM
- [ ] Update main app docs with install instructions
