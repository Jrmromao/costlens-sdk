# Publishing @promptcraft/sdk to NPM

## Prerequisites

1. **NPM Account**
   - Create account at [npmjs.com](https://www.npmjs.com/signup)
   - Verify email

2. **NPM Login**
   ```bash
   npm login
   ```
   Enter username, password, and email

3. **Check Package Name**
   ```bash
   npm search @promptcraft/sdk
   ```
   If taken, choose different name in `package.json`

## Publishing Steps

### 1. Prepare Package

```bash
cd sdk

# Install dependencies
npm install

# Build TypeScript
npm run build

# Test build
ls dist/
# Should see: index.js, index.d.ts
```

### 2. Test Locally

```bash
# In sdk directory
npm link

# In test project
npm link @promptcraft/sdk

# Test import
node -e "const { PromptCraft } = require('@promptcraft/sdk'); console.log('Works!');"
```

### 3. Publish to NPM

```bash
cd sdk

# First time: Publish as public
npm publish --access public

# Updates: Bump version first
npm version patch  # 1.0.0 → 1.0.1
npm version minor  # 1.0.0 → 1.1.0
npm version major  # 1.0.0 → 2.0.0

# Then publish
npm publish
```

### 4. Verify Publication

```bash
# Check on NPM
open https://www.npmjs.com/package/@promptcraft/sdk

# Test installation
mkdir test-install
cd test-install
npm init -y
npm install @promptcraft/sdk
```

## Versioning

Follow [Semantic Versioning](https://semver.org/):

- **Patch** (1.0.x): Bug fixes
- **Minor** (1.x.0): New features (backward compatible)
- **Major** (x.0.0): Breaking changes

## Updating

```bash
# Make changes to src/index.ts

# Build
npm run build

# Test
npm link
# Test in another project

# Bump version
npm version patch

# Publish
npm publish
```

## Troubleshooting

### "Package name already exists"

Change name in `package.json`:
```json
{
  "name": "@yourname/promptcraft-sdk"
}
```

### "You must be logged in"

```bash
npm login
```

### "403 Forbidden"

Package name might be taken or you don't have permission:
```bash
npm owner ls @promptcraft/sdk
```

### Build fails

```bash
# Check TypeScript
npx tsc --noEmit

# Clean and rebuild
rm -rf dist node_modules
npm install
npm run build
```

## Best Practices

1. **Always test before publishing**
   ```bash
   npm run build
   npm link
   # Test in real project
   ```

2. **Update README for each version**
   - Document new features
   - Update examples
   - Add migration guides for breaking changes

3. **Use .npmignore**
   Create `.npmignore`:
   ```
   src/
   tsconfig.json
   *.test.ts
   .git/
   ```

4. **Add badges to README**
   ```markdown
   ![npm version](https://img.shields.io/npm/v/@promptcraft/sdk)
   ![downloads](https://img.shields.io/npm/dm/@promptcraft/sdk)
   ```

## Automation (Optional)

Create GitHub Action for auto-publishing:

```yaml
# .github/workflows/publish.yml
name: Publish to NPM

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      - run: npm install
      - run: npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Support

Questions? Email support@promptcraft.app
