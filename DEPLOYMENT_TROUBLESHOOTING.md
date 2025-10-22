# CostLens SDK Deployment Troubleshooting

## Common Issues and Solutions

### 1. GitHub Actions Error: `Cannot read properties of undefined (reading 'tag_name')`

**Problem**: The GitHub workflow fails when trying to access release information.

**Solution**: ✅ **FIXED** - Updated the workflow to handle cases where release data is not available.

**Files Changed**:
- `.github/workflows/publish.yml` - Added null checks for release data

### 2. Package Already Exists on npm

**Problem**: Trying to publish a version that already exists.

**Solution**: 
- Use the version bump workflow: `Actions > Version Bump`
- Or manually update `package.json` version
- Or use the deployment script: `./deploy.sh`

### 3. NPM Authentication Issues

**Problem**: Not logged into npm or missing NPM_TOKEN.

**Solution**:
```bash
# Login to npm
npm login

# Or set up NPM_TOKEN in GitHub Secrets
# Go to: Repository Settings > Secrets and variables > Actions
# Add: NPM_TOKEN with your npm token
```

### 4. Build Failures

**Problem**: TypeScript compilation errors.

**Solution**:
```bash
# Install dependencies
npm ci

# Build the project
npm run build

# Check for TypeScript errors
npx tsc --noEmit
```

### 5. Test Failures

**Problem**: Tests are failing before deployment.

**Solution**:
```bash
# Run tests locally
npm test

# Run tests with coverage
npm run test:coverage
```

## Deployment Methods

### Method 1: GitHub Actions (Recommended)

1. **Automatic on Release**:
   - Create a new release on GitHub
   - The workflow will automatically publish to npm

2. **Manual Deployment**:
   - Go to Actions > Publish to npm
   - Click "Run workflow"
   - Select branch and click "Run workflow"

### Method 2: Local Deployment

```bash
# Make sure you're in the SDK directory
cd /Users/joaofilipe/Desktop/Workspace/costlens-sdk

# Run the deployment script
./deploy.sh
```

### Method 3: Manual npm publish

```bash
# Install dependencies
npm ci

# Run tests
npm test

# Build
npm run build

# Publish
npm publish --provenance --access public
```

## Pre-deployment Checklist

- [ ] All tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Version is updated in `package.json`
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] README.md is up to date
- [ ] CHANGELOG.md is updated (if exists)

## Post-deployment Verification

1. Check npm package: https://www.npmjs.com/package/costlens
2. Test installation: `npm install costlens@latest`
3. Verify functionality in a test project

## Rollback Procedure

If deployment goes wrong:

1. **Unpublish** (within 72 hours):
   ```bash
   npm unpublish costlens@1.0.7
   ```

2. **Fix issues** and redeploy

3. **Update version** in `package.json` before republishing

## Support

If you encounter issues not covered here:

1. Check GitHub Actions logs
2. Check npm logs: `npm view costlens`
3. Verify all secrets are set correctly
4. Ensure you have proper permissions
