#!/bin/bash
# Publish Aiki packages to npm in dependency order
# This script will automatically sync versions and build npm packages using dnt before publishing
# Browser authentication will happen automatically via npm
# Usage: deno task publish-npm

set -e

echo "Pre-publication workflow..."
echo ""

# Check 0: Verify jq is installed
if ! command -v jq &> /dev/null; then
    echo "❌ Error: jq is required but not installed"
    echo ""
    echo "Install it with:"
    echo "  macOS: brew install jq"
    echo "  Linux: apt-get install jq"
    echo "  Or visit: https://stedolan.github.io/jq/download/"
    exit 1
fi
echo "✅ jq is installed"
echo ""

# Check 1: No uncommitted changes before syncing versions
echo "Checking for uncommitted changes (pre-sync)..."
if [ -n "$(git status --porcelain)" ]; then
    echo "❌ Error: Uncommitted changes detected"
    echo ""
    echo "Please commit all changes before publishing:"
    git status
    echo ""
    echo "Run: git add . && git commit -m \"Bump version to <version>\""
    exit 1
fi
echo "✅ No uncommitted changes"
echo ""

# Step 1: Sync versions across all packages
echo "Syncing package versions..."
deno task sync-version
echo ""

# Check 2: Verify no uncommitted changes after syncing
echo "Checking for uncommitted changes (post-sync)..."
if [ -n "$(git status --porcelain)" ]; then
    echo "❌ Error: Uncommitted changes from version sync"
    echo ""
    echo "Version sync has updated the following files:"
    git status
    echo ""
    echo "Please commit these changes:"
    echo "Run: git add . && git commit -m \"Sync versions to <version>\""
    echo ""
    echo "Then run this script again to publish."
    exit 1
fi
echo "✅ All versions synced and committed"
echo ""

# Get version for use in dnt builds
VERSION=$(jq -r '.version' lib/deno.json)
export PKG_VERSION="$VERSION"

echo "Building npm packages with dnt (v${VERSION})..."
echo ""

echo "Step 1/6: Building and publishing @aiki/lib..."
deno run --allow-read --allow-write --allow-net scripts/build-npm.ts lib/build.config.ts
cd lib/npm
npm publish
cd ../..
echo "✅ @aiki/lib published"
echo ""

echo "Step 2/6: Building and publishing @aiki/types..."
deno run --allow-read --allow-write --allow-net scripts/build-npm.ts types/build.config.ts
cd types/npm
npm publish
cd ../..
echo "✅ @aiki/types published"
echo ""

echo "Step 3/6: Building and publishing @aiki/workflow..."
deno run --allow-read --allow-write --allow-net scripts/build-npm.ts sdk/workflow/build.config.ts
cd sdk/workflow/npm
npm publish
cd ../../..
echo "✅ @aiki/workflow published"
echo ""

echo "Step 4/6: Building and publishing @aiki/client..."
deno run --allow-read --allow-write --allow-net scripts/build-npm.ts sdk/client/build.config.ts
cd sdk/client/npm
npm publish
cd ../../..
echo "✅ @aiki/client published"
echo ""

echo "Step 5/6: Building and publishing @aiki/task..."
deno run --allow-read --allow-write --allow-net scripts/build-npm.ts sdk/task/build.config.ts
cd sdk/task/npm
npm publish
cd ../../..
echo "✅ @aiki/task published"
echo ""

echo "Step 6/6: Building and publishing @aiki/worker..."
deno run --allow-read --allow-write --allow-net scripts/build-npm.ts sdk/worker/build.config.ts
cd sdk/worker/npm
npm publish
cd ../../..
echo "✅ @aiki/worker published"
echo ""

echo "🎉 All packages built and published successfully to npm!"
echo ""
echo "Published packages (v${VERSION}):"
echo "  - npm:@aiki/lib@${VERSION}"
echo "  - npm:@aiki/types@${VERSION}"
echo "  - npm:@aiki/workflow@${VERSION}"
echo "  - npm:@aiki/client@${VERSION}"
echo "  - npm:@aiki/task@${VERSION}"
echo "  - npm:@aiki/worker@${VERSION}"
echo ""
echo "View packages on npm at: https://www.npmjs.com/org/aiki"
echo ""
echo "Next step: deno task post-publish"
