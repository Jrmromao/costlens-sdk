# CI/CD Setup Guide

## 🚀 Automated Workflows

### 1. CI (Continuous Integration)
**Trigger:** Every push and PR to main/develop
**Actions:**
- Run tests on Node 18.x and 20.x
- Build the package
- Check TypeScript types
- Verify code formatting

**File:** `.github/workflows/ci.yml`

### 2. CD (Continuous Deployment)
**Trigger:** When you create a GitHub Release
**Actions:**
- Run tests
- Build package
- Publish to npm automatically
- Add release notes

**File:** `.github/workflows/publish.yml`

### 3. Version Bump
**Trigger:** Manual (workflow_dispatch)
**Actions:**
- Bump version (patch/minor/major)
- Create git tag
- Push changes
- Create GitHub Release (triggers CD)

**File:** `.github/workflows/version-bump.yml`

## 📋 Setup Steps

### 1. Create GitHub Repository
```bash
cd /Users/joaofilipe/Desktop/Workspace/prompt-craft/sdk
git init
git add .
git commit -m "Initial commit with CI/CD"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/promptcraft-sdk.git
git push -u origin main
```

### 2. Add npm Token to GitHub Secrets

1. Get npm token:
   ```bash
   npm login
   npm token create --read-only=false
   ```

2. Add to GitHub:
   - Go to: `https://github.com/YOUR_USERNAME/promptcraft-sdk/settings/secrets/actions`
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: Your npm token
   - Click "Add secret"

### 3. Enable GitHub Actions
- Go to: `https://github.com/YOUR_USERNAME/promptcraft-sdk/actions`
- Click "I understand my workflows, go ahead and enable them"

## 🔄 Release Workflow

### Option A: Automated (Recommended)

1. **Bump version:**
   - Go to Actions tab
   - Select "Version Bump" workflow
   - Click "Run workflow"
   - Choose: patch (1.0.1), minor (1.1.0), or major (2.0.0)
   - Click "Run workflow"

2. **Automatic:**
   - Version bumped in package.json
   - Git tag created
   - GitHub Release created
   - npm publish triggered automatically
   - Package live on npm! 🎉

### Option B: Manual

1. **Bump version locally:**
   ```bash
   npm version patch  # or minor, or major
   git push --follow-tags
   ```

2. **Create GitHub Release:**
   - Go to: `https://github.com/YOUR_USERNAME/promptcraft-sdk/releases/new`
   - Select the tag you just pushed
   - Write release notes
   - Click "Publish release"

3. **Automatic:**
   - CD workflow triggers
   - Package published to npm

## 🧪 Testing CI/CD

### Test CI:
```bash
# Make a change
echo "// test" >> src/index.ts
git add .
git commit -m "test: CI workflow"
git push

# Check: https://github.com/YOUR_USERNAME/promptcraft-sdk/actions
```

### Test CD:
```bash
# Create a test release
npm version patch
git push --follow-tags

# Create release on GitHub
# Watch it auto-publish to npm!
```

## 📊 Workflow Status Badges

Add to README.md:
```markdown
![CI](https://github.com/YOUR_USERNAME/promptcraft-sdk/workflows/CI/badge.svg)
![npm version](https://img.shields.io/npm/v/promptcraft-sdk.svg)
![npm downloads](https://img.shields.io/npm/dm/promptcraft-sdk.svg)
```

## 🔒 Security Best Practices

1. **Enable 2FA** on npm account
2. **Use provenance** (already configured in publish.yml)
3. **Rotate npm tokens** every 90 days
4. **Review dependencies** regularly
5. **Enable Dependabot** for security updates

## 🎯 What Happens on Each Push

```
Push to main/develop
    ↓
CI Workflow Runs
    ↓
Tests (Node 18 & 20)
    ↓
Build Check
    ↓
Type Check
    ↓
Format Check
    ↓
✅ All Green = Ready to Release
```

## 🚀 What Happens on Release

```
Create GitHub Release
    ↓
CD Workflow Triggers
    ↓
Run Tests
    ↓
Build Package
    ↓
Publish to npm
    ↓
✅ Live on npmjs.com!
```

## 📝 Version Guidelines

- **Patch (1.0.x):** Bug fixes
- **Minor (1.x.0):** New features (backward compatible)
- **Major (x.0.0):** Breaking changes

## 🛠️ Troubleshooting

### CI Fails
- Check test output in Actions tab
- Run tests locally: `npm test`
- Fix issues and push again

### CD Fails
- Check npm token is valid
- Verify token has publish permissions
- Check package.json version is unique

### Version Bump Fails
- Ensure you have push permissions
- Check git is configured correctly
- Verify no uncommitted changes

## ✅ Current Status

- ✅ CI workflow configured
- ✅ CD workflow configured
- ✅ Version bump workflow configured
- ✅ Prettier configured
- ⏳ Needs: GitHub repo + npm token

**Ready to automate!** 🤖
