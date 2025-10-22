#!/bin/bash

# CostLens SDK Deployment Script
# This script helps deploy the SDK to npm with proper checks

set -e

echo "🚀 CostLens SDK Deployment Script"
echo "================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the SDK root directory."
    exit 1
fi

# Get package info
PACKAGE_NAME=$(node -p "require('./package.json').name")
PACKAGE_VERSION=$(node -p "require('./package.json').version")

echo "📦 Package: $PACKAGE_NAME"
echo "🏷️  Version: $PACKAGE_VERSION"
echo ""

# Check if package already exists on npm
echo "🔍 Checking if package already exists on npm..."
if npm view $PACKAGE_NAME@$PACKAGE_VERSION version > /dev/null 2>&1; then
    echo "⚠️  Package $PACKAGE_NAME@$PACKAGE_VERSION already exists on npm"
    echo "   You may need to bump the version first."
    echo ""
    read -p "Do you want to continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Deployment cancelled"
        exit 1
    fi
else
    echo "✅ Package $PACKAGE_NAME@$PACKAGE_VERSION does not exist on npm"
fi

# Install dependencies
echo ""
echo "📥 Installing dependencies..."
npm ci

# Run tests
echo ""
echo "🧪 Running tests..."
npm test

# Build the project
echo ""
echo "🔨 Building project..."
npm run build

# Check if build was successful
if [ ! -d "dist" ]; then
    echo "❌ Error: Build failed - dist directory not found"
    exit 1
fi

echo "✅ Build successful"

# Check if logged into npm
echo ""
echo "🔐 Checking npm authentication..."
if ! npm whoami > /dev/null 2>&1; then
    echo "❌ Error: Not logged into npm. Please run 'npm login' first."
    exit 1
fi

NPM_USER=$(npm whoami)
echo "✅ Logged in as: $NPM_USER"

# Publish to npm
echo ""
echo "📤 Publishing to npm..."
npm publish --provenance --access public

echo ""
echo "🎉 Successfully published $PACKAGE_NAME@$PACKAGE_VERSION to npm!"
echo "🔗 https://www.npmjs.com/package/$PACKAGE_NAME"
