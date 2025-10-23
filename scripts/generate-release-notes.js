#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Generate comprehensive release notes for CostLens SDK
 * Usage: node scripts/generate-release-notes.js [version] [previous-tag]
 */

const VERSION = process.argv[2] || require('../package.json').version;
const PREV_TAG = process.argv[3] || getPreviousTag();

console.log(`📝 Generating release notes for v${VERSION}`);
console.log(`📊 Comparing with ${PREV_TAG}`);

function getPreviousTag() {
  try {
    return execSync('git describe --tags --abbrev=0 HEAD~1', { encoding: 'utf8' }).trim();
  } catch {
    try {
      return execSync('git rev-list --max-parents=0 HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'HEAD~10';
    }
  }
}

function getCommits() {
  try {
    const range = PREV_TAG === 'HEAD~10' ? 'HEAD~10..HEAD' : `${PREV_TAG}..HEAD`;
    const commits = execSync(`git log ${range} --pretty=format:"%h|%s|%an|%ad" --date=short`, { encoding: 'utf8' });
    return commits.trim().split('\n').filter(Boolean);
  } catch (error) {
    console.error('Error getting commits:', error.message);
    return [];
  }
}

function categorizeCommits(commits) {
  const categories = {
    features: [],
    fixes: [],
    breaking: [],
    docs: [],
    tests: [],
    refactor: [],
    perf: [],
    chore: [],
    other: []
  };

  commits.forEach(commit => {
    const [, message] = commit.split('|', 2);
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('breaking change') || lowerMessage.includes('!:')) {
      categories.breaking.push(commit);
    } else if (lowerMessage.match(/^(feat|feature)(\(.+\))?!?:/)) {
      categories.features.push(commit);
    } else if (lowerMessage.match(/^(fix|patch)(\(.+\))?!?:/)) {
      categories.fixes.push(commit);
    } else if (lowerMessage.match(/^(docs?|doc):/)) {
      categories.docs.push(commit);
    } else if (lowerMessage.match(/^(test|tests):/)) {
      categories.tests.push(commit);
    } else if (lowerMessage.match(/^(refactor|refactoring):/)) {
      categories.refactor.push(commit);
    } else if (lowerMessage.match(/^(perf|performance):/)) {
      categories.perf.push(commit);
    } else if (lowerMessage.match(/^(chore|maintenance):/)) {
      categories.chore.push(commit);
    } else {
      categories.other.push(commit);
    }
  });

  return categories;
}

function formatCommit(commit) {
  const [hash, message, author, date] = commit.split('|');
  const shortHash = hash.substring(0, 7);
  const cleanMessage = message.replace(/^(feat|fix|docs?|test|refactor|perf|chore)(\(.+\))?!?:\s*/, '');
  return `- ${cleanMessage} (${shortHash})`;
}

function generateReleaseNotes() {
  const commits = getCommits();
  const categories = categorizeCommits(commits);
  
  const totalChanges = Object.values(categories).reduce((sum, arr) => sum + arr.length, 0);
  
  if (totalChanges === 0) {
    console.log('ℹ️ No commits found for release notes');
    return;
  }

  // Determine release type
  let releaseType, emoji;
  if (categories.breaking.length > 0) {
    releaseType = '🚨 **MAJOR RELEASE**';
    emoji = '🚨';
  } else if (categories.features.length > 0) {
    releaseType = '✨ **MINOR RELEASE**';
    emoji = '✨';
  } else {
    releaseType = '🔧 **PATCH RELEASE**';
    emoji = '🔧';
  }

  let releaseNotes = `# ${emoji} CostLens SDK v${VERSION}

${releaseType}

## 📊 Release Summary

| Type | Count | Description |
|------|-------|-------------|
| 🆕 Features | ${categories.features.length} | New functionality and enhancements |
| 🐛 Fixes | ${categories.fixes.length} | Bug fixes and improvements |
| 💥 Breaking | ${categories.breaking.length} | Breaking changes requiring attention |
| 📚 Docs | ${categories.docs.length} | Documentation updates |
| 🧪 Tests | ${categories.tests.length} | Test improvements and additions |
| ♻️ Refactor | ${categories.refactor.length} | Code refactoring and cleanup |
| ⚡ Performance | ${categories.perf.length} | Performance improvements |
| 🔧 Chore | ${categories.chore.length} | Maintenance and housekeeping |
| 📝 Other | ${categories.other.length} | Miscellaneous changes |

## 🎯 What's New

`;

  // Add sections for each category
  if (categories.features.length > 0) {
    releaseNotes += `### ✨ New Features (${categories.features.length})\n\n`;
    releaseNotes += categories.features.map(formatCommit).join('\n') + '\n\n';
  }

  if (categories.fixes.length > 0) {
    releaseNotes += `### 🐛 Bug Fixes (${categories.fixes.length})\n\n`;
    releaseNotes += categories.fixes.map(formatCommit).join('\n') + '\n\n';
  }

  if (categories.breaking.length > 0) {
    releaseNotes += `### 💥 Breaking Changes (${categories.breaking.length})\n\n`;
    releaseNotes += `> ⚠️ **Important**: This release contains breaking changes. Please review the migration guide below.\n\n`;
    releaseNotes += categories.breaking.map(formatCommit).join('\n') + '\n\n';
  }

  if (categories.docs.length > 0) {
    releaseNotes += `### 📚 Documentation Updates (${categories.docs.length})\n\n`;
    releaseNotes += categories.docs.map(formatCommit).join('\n') + '\n\n';
  }

  if (categories.tests.length > 0) {
    releaseNotes += `### 🧪 Test Improvements (${categories.tests.length})\n\n`;
    releaseNotes += categories.tests.map(formatCommit).join('\n') + '\n\n';
  }

  if (categories.refactor.length > 0) {
    releaseNotes += `### ♻️ Code Refactoring (${categories.refactor.length})\n\n`;
    releaseNotes += categories.refactor.map(formatCommit).join('\n') + '\n\n';
  }

  if (categories.perf.length > 0) {
    releaseNotes += `### ⚡ Performance Improvements (${categories.perf.length})\n\n`;
    releaseNotes += categories.perf.map(formatCommit).join('\n') + '\n\n';
  }

  if (categories.chore.length > 0) {
    releaseNotes += `### 🔧 Maintenance (${categories.chore.length})\n\n`;
    releaseNotes += categories.chore.map(formatCommit).join('\n') + '\n\n';
  }

  if (categories.other.length > 0) {
    releaseNotes += `### 📝 Other Changes (${categories.other.length})\n\n`;
    releaseNotes += categories.other.map(formatCommit).join('\n') + '\n\n';
  }

  // Add footer
  releaseNotes += `## 📦 Installation

\`\`\`bash
npm install costlens@${VERSION}
# or
yarn add costlens@${VERSION}
# or
pnpm add costlens@${VERSION}
\`\`\`

## 🔗 Links

- 📖 [Documentation](https://github.com/your-org/costlens-sdk/blob/main/README.md)
- 🐛 [Report Issues](https://github.com/your-org/costlens-sdk/issues)
- 💬 [Discussions](https://github.com/your-org/costlens-sdk/discussions)
- 📋 [Changelog](https://github.com/your-org/costlens-sdk/blob/main/CHANGELOG.md)

## 🙏 Contributors

Thank you to all contributors who made this release possible!

---

**Full Changelog**: https://github.com/your-org/costlens-sdk/compare/${PREV_TAG}...v${VERSION}
`;

  return releaseNotes;
}

// Generate and save release notes
const releaseNotes = generateReleaseNotes();

if (releaseNotes) {
  const outputPath = path.join(__dirname, '..', 'RELEASE_NOTES.md');
  fs.writeFileSync(outputPath, releaseNotes);
  console.log(`✅ Release notes saved to ${outputPath}`);
  console.log(`📊 Generated notes for ${Object.values(categorizeCommits(getCommits())).reduce((sum, arr) => sum + arr.length, 0)} commits`);
} else {
  console.log('❌ No release notes generated');
  process.exit(1);
}
