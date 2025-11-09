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

# Helper function to wait for npm package propagation
# Waits up to 1 minute (12 attempts × 5 seconds) for a package to be available on npm
wait_for_npm_package() {
	local package_name=$1
	local version=$2
	local max_attempts=12
	local attempt=1
	local poll_interval=5

	echo "Waiting for $package_name@$version to propagate to npm registry..."

	while [ $attempt -le $max_attempts ]; do
		if npm view "$package_name@$version" > /dev/null 2>&1; then
			echo "✅ $package_name@$version is now available on npm"
			return 0
		fi

		if [ $attempt -lt $max_attempts ]; then
			echo "  (attempt $attempt/$max_attempts) Waiting ${poll_interval}s before checking again..."
			sleep $poll_interval
		fi

		attempt=$((attempt + 1))
	done

	echo "❌ Error: $package_name@$version did not propagate within 1 minute (60 seconds)"
	echo ""
	echo "This can happen if npm is experiencing delays or high load."
	echo "Try running the publish script again after waiting a few minutes."
	return 1
}

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

echo "Step 1/6: Building and publishing @aikirun/lib..."
deno run --allow-read --allow-write --allow-net --allow-env --allow-run scripts/build-npm.ts lib/build.config.ts
cd lib/npm
if npm view "@aikirun/lib@${VERSION}" > /dev/null 2>&1; then
    echo "✅ @aikirun/lib@${VERSION} already published, skipping..."
else
    npm publish
    echo "✅ @aikirun/lib published"
    cd ../..
    wait_for_npm_package "@aikirun/lib" "${VERSION}" || exit 1
    cd lib/npm
fi
cd ../..
echo ""

echo "Step 2/6: Building and publishing @aikirun/types..."
deno run --allow-read --allow-write --allow-net --allow-env --allow-run scripts/build-npm.ts types/build.config.ts
cd types/npm
if npm view "@aikirun/types@${VERSION}" > /dev/null 2>&1; then
    echo "✅ @aikirun/types@${VERSION} already published, skipping..."
else
    npm publish
    echo "✅ @aikirun/types published"
    cd ../..
    wait_for_npm_package "@aikirun/types" "${VERSION}" || exit 1
    cd types/npm
fi
cd ../..
echo ""

echo "Step 3/6: Building and publishing @aikirun/workflow..."
deno run --allow-read --allow-write --allow-net --allow-env --allow-run scripts/build-npm.ts sdk/workflow/build.config.ts
cd sdk/workflow/npm
if npm view "@aikirun/workflow@${VERSION}" > /dev/null 2>&1; then
    echo "✅ @aikirun/workflow@${VERSION} already published, skipping..."
else
    npm publish
    echo "✅ @aikirun/workflow published"
    cd ../../..
    wait_for_npm_package "@aikirun/workflow" "${VERSION}" || exit 1
    cd sdk/workflow/npm
fi
cd ../../..
echo ""

echo "Step 4/6: Building and publishing @aikirun/client..."
deno run --allow-read --allow-write --allow-net --allow-env --allow-run scripts/build-npm.ts sdk/client/build.config.ts
cd sdk/client/npm
if npm view "@aikirun/client@${VERSION}" > /dev/null 2>&1; then
    echo "✅ @aikirun/client@${VERSION} already published, skipping..."
else
    npm publish
    echo "✅ @aikirun/client published"
    cd ../../..
    wait_for_npm_package "@aikirun/client" "${VERSION}" || exit 1
    cd sdk/client/npm
fi
cd ../../..
echo ""

echo "Step 5/6: Building and publishing @aikirun/task..."
deno run --allow-read --allow-write --allow-net --allow-env --allow-run scripts/build-npm.ts sdk/task/build.config.ts
cd sdk/task/npm
if npm view "@aikirun/task@${VERSION}" > /dev/null 2>&1; then
    echo "✅ @aikirun/task@${VERSION} already published, skipping..."
else
    npm publish
    echo "✅ @aikirun/task published"
    cd ../../..
    wait_for_npm_package "@aikirun/task" "${VERSION}" || exit 1
    cd sdk/task/npm
fi
cd ../../..
echo ""

echo "Step 6/6: Building and publishing @aikirun/worker..."
deno run --allow-read --allow-write --allow-net --allow-env --allow-run scripts/build-npm.ts sdk/worker/build.config.ts
cd sdk/worker/npm
if npm view "@aikirun/worker@${VERSION}" > /dev/null 2>&1; then
    echo "✅ @aikirun/worker@${VERSION} already published, skipping..."
else
    npm publish
    echo "✅ @aikirun/worker published"
    cd ../../..
    wait_for_npm_package "@aikirun/worker" "${VERSION}" || exit 1
    cd sdk/worker/npm
fi
cd ../../..
echo ""

echo "🎉 All packages built and published successfully to npm!"
echo ""
echo "Published packages (v${VERSION}):"
echo "  - npm:@aikirun/lib@${VERSION}"
echo "  - npm:@aikirun/types@${VERSION}"
echo "  - npm:@aikirun/workflow@${VERSION}"
echo "  - npm:@aikirun/client@${VERSION}"
echo "  - npm:@aikirun/task@${VERSION}"
echo "  - npm:@aikirun/worker@${VERSION}"
echo ""
echo "View packages on npm at: https://www.npmjs.com/org/aiki"
echo ""
echo "Next step: deno task post-publish"
