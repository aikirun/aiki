#!/bin/bash
# Publish Aiki packages to JSR in dependency order
# This script will automatically sync versions before publishing
# Usage: deno task publish-jsr

set -e

echo "Pre-publication workflow..."
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

echo "Publishing Aiki packages to JSR in dependency order..."
echo ""

echo "Step 1/6: Publishing @aikirun/lib..."
cd lib
deno publish
cd ..
echo "✅ @aikirun/lib published"
echo ""

echo "Step 2/6: Publishing @aikirun/types..."
cd types
deno publish
cd ..
echo "✅ @aikirun/types published"
echo ""

echo "Step 3/6: Publishing @aikirun/workflow..."
cd sdk/workflow
deno publish
cd ../..
echo "✅ @aikirun/workflow published"
echo ""

echo "Step 4/6: Publishing @aikirun/client..."
cd sdk/client
deno publish
cd ../..
echo "✅ @aikirun/client published"
echo ""

echo "Step 5/6: Publishing @aikirun/task..."
cd sdk/task
deno publish
cd ../..
echo "✅ @aikirun/task published"
echo ""

echo "Step 6/6: Publishing @aikirun/worker..."
cd sdk/worker
deno publish
cd ../..
echo "✅ @aikirun/worker published"
echo ""

echo "🎉 All packages published successfully to JSR!"
echo ""

# Get version from deno.json for display
if command -v jq &> /dev/null; then
    PUBLISHED_VERSION=$(jq -r '.version' lib/deno.json)
    echo "Published packages (v${PUBLISHED_VERSION}):"
    echo "  - jsr:@aikirun/lib@${PUBLISHED_VERSION}"
    echo "  - jsr:@aikirun/types@${PUBLISHED_VERSION}"
    echo "  - jsr:@aikirun/workflow@${PUBLISHED_VERSION}"
    echo "  - jsr:@aikirun/client@${PUBLISHED_VERSION}"
    echo "  - jsr:@aikirun/task@${PUBLISHED_VERSION}"
    echo "  - jsr:@aikirun/worker@${PUBLISHED_VERSION}"
else
    echo "Published packages:"
    echo "  - jsr:@aikirun/lib"
    echo "  - jsr:@aikirun/types"
    echo "  - jsr:@aikirun/workflow"
    echo "  - jsr:@aikirun/client"
    echo "  - jsr:@aikirun/task"
    echo "  - jsr:@aikirun/worker"
fi
echo ""
echo "View packages on JSR at: https://jsr.io/@aikirun"
echo ""
echo "Next step: deno task post-publish"
