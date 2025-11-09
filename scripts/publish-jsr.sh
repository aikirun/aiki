#!/bin/bash
# Publish Aiki packages to JSR in dependency order
# This script will automatically sync versions before publishing
# Usage: JSR_TOKEN=<your-token> deno task publish-jsr

set -e

if [ -z "$JSR_TOKEN" ]; then
    echo "Error: JSR_TOKEN environment variable is not set"
    echo "Usage: JSR_TOKEN=<your-token> ./scripts/publish-jsr.sh"
    exit 1
fi

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

# 1. Publish @aiki/lib (no aiki dependencies)
echo "Step 1/6: Publishing @aiki/lib..."
cd lib
deno publish --token "$JSR_TOKEN"
cd ..
echo "✅ @aiki/lib published"
echo ""

# 2. Publish @aiki/types (depends on @aiki/lib)
echo "Step 2/6: Publishing @aiki/types..."
cd types
deno publish --token "$JSR_TOKEN"
cd ..
echo "✅ @aiki/types published"
echo ""

# 3. Publish @aiki/workflow (depends on @aiki/types, @aiki/lib)
echo "Step 3/6: Publishing @aiki/workflow..."
cd sdk/workflow
deno publish --token "$JSR_TOKEN"
cd ../..
echo "✅ @aiki/workflow published"
echo ""

# 4. Publish @aiki/client (depends on @aiki/types, @aiki/lib)
echo "Step 4/6: Publishing @aiki/client..."
cd sdk/client
deno publish --token "$JSR_TOKEN"
cd ../..
echo "✅ @aiki/client published"
echo ""

# 5. Publish @aiki/task (depends on @aiki/workflow, @aiki/types, @aiki/lib)
echo "Step 5/6: Publishing @aiki/task..."
cd sdk/task
deno publish --token "$JSR_TOKEN"
cd ../..
echo "✅ @aiki/task published"
echo ""

# 6. Publish @aiki/worker (depends on @aiki/client, @aiki/workflow, @aiki/types, @aiki/lib)
echo "Step 6/6: Publishing @aiki/worker..."
cd sdk/worker
deno publish --token "$JSR_TOKEN"
cd ../..
echo "✅ @aiki/worker published"
echo ""

echo "🎉 All packages published successfully to JSR!"
echo ""

# Get version from deno.json for display
if command -v jq &> /dev/null; then
    PUBLISHED_VERSION=$(jq -r '.version' lib/deno.json)
    echo "Published packages (v${PUBLISHED_VERSION}):"
    echo "  - jsr:@aiki/lib@${PUBLISHED_VERSION}"
    echo "  - jsr:@aiki/types@${PUBLISHED_VERSION}"
    echo "  - jsr:@aiki/workflow@${PUBLISHED_VERSION}"
    echo "  - jsr:@aiki/client@${PUBLISHED_VERSION}"
    echo "  - jsr:@aiki/task@${PUBLISHED_VERSION}"
    echo "  - jsr:@aiki/worker@${PUBLISHED_VERSION}"
else
    echo "Published packages:"
    echo "  - jsr:@aiki/lib"
    echo "  - jsr:@aiki/types"
    echo "  - jsr:@aiki/workflow"
    echo "  - jsr:@aiki/client"
    echo "  - jsr:@aiki/task"
    echo "  - jsr:@aiki/worker"
fi
echo ""
echo "View packages on JSR at: https://jsr.io/@aiki"
echo ""
echo "Next step: deno task post-publish"
