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

# Helper function to wait for npm package propagation with exponential backoff
# Waits up to ~60 seconds for a package to be available on npm
# Uses exponential backoff: 1, 2, 4, 8, 16, 32 seconds (much faster than constant 5-second intervals)
wait_for_npm_package() {
	local package_name=$1
	local version=$2
	local max_attempts=10
	local attempt=1
	local poll_interval=1

	echo "Waiting for $package_name@$version to propagate to npm registry..."

	while [ $attempt -le $max_attempts ]; do
		if npm view "$package_name@$version" > /dev/null 2>&1; then
			echo "✅ $package_name@$version is now available on npm (attempt $attempt)"
			return 0
		fi

		if [ $attempt -lt $max_attempts ]; then
			echo "  (attempt $attempt/$max_attempts) Waiting ${poll_interval}s before checking again..."
			sleep $poll_interval

			# Exponential backoff: 1, 2, 4, 8, 16, 32... capped at 30 seconds
			poll_interval=$((poll_interval * 2))
			if [ $poll_interval -gt 30 ]; then
				poll_interval=30
			fi
		fi

		attempt=$((attempt + 1))
	done

	echo "❌ Error: $package_name@$version did not propagate within timeout"
	echo ""
	echo "This can happen if npm is experiencing delays or high load."
	echo "Try running the publish script again after waiting a few minutes."
	return 1
}

# Helper function to build a package with retry logic for dependency resolution
# Packages that depend on other packages may fail if dependencies haven't propagated yet
build_with_retry() {
	local package_path=$1
	local package_name=$2
	local version=$3
	local max_retries=3
	local retry=1

	while [ $retry -le $max_retries ]; do
		echo "Building $package_name (attempt $retry/$max_retries)..."

		if deno run --allow-read --allow-write --allow-net --allow-env --allow-run scripts/build-npm.ts "$package_path/build.config.ts"; then
			echo "✅ Built $package_name successfully"
			return 0
		fi

		if [ $retry -lt $max_retries ]; then
			echo "⚠️  Build failed, waiting 30s for dependencies to propagate..."
			sleep 30
		fi

		retry=$((retry + 1))
	done

	echo "❌ Error: Failed to build $package_name after $max_retries attempts"
	return 1
}

# Helper function to build and publish a package
publish_package() {
	local path=$1
	local name=$2
	local version=$3
	local step=$4
	local total=$5

	echo "Step ${step}/${total}: Building and publishing ${name}..."
	build_with_retry "${path}" "${name}" "${version}" || exit 1

	cd "${path}/npm"
	if npm view "${name}@${version}" > /dev/null 2>&1; then
		echo "✅ ${name}@${version} already published, skipping..."
	else
		npm publish
		echo "✅ ${name} published"
		cd ../../
		wait_for_npm_package "${name}" "${version}" || exit 1
		cd "${path}/npm"
	fi
	cd ../../
	echo ""
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

# Check 3: Validate version source file exists
if [ ! -f "lib/deno.json" ]; then
    echo "❌ Error: lib/deno.json not found"
    echo ""
    echo "This script must be run from the root of the Aiki repository."
    exit 1
fi

# Get version for use in dnt builds
VERSION=$(jq -r '.version' lib/deno.json 2>/dev/null)

# Check 4: Validate version extraction succeeded
if [ -z "$VERSION" ] || [ "$VERSION" = "null" ]; then
    echo "❌ Error: Could not read version from lib/deno.json"
    echo ""
    echo "Please ensure lib/deno.json has a 'version' field:"
    echo '  "version": "0.1.6"'
    exit 1
fi

# Check 5: Validate version format (X.Y.Z)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "❌ Error: Invalid version format: $VERSION"
    echo ""
    echo "Version must be in format X.Y.Z (e.g., 0.1.6)"
    exit 1
fi

export PKG_VERSION="$VERSION"

echo "Building npm packages with dnt (v${VERSION})..."
echo ""

# Publish packages in dependency order
publish_package "lib" "@aikirun/lib" "${VERSION}" "1" "6"
publish_package "types" "@aikirun/types" "${VERSION}" "2" "6"
publish_package "sdk/workflow" "@aikirun/workflow" "${VERSION}" "3" "6"
publish_package "sdk/client" "@aikirun/client" "${VERSION}" "4" "6"
publish_package "sdk/task" "@aikirun/task" "${VERSION}" "5" "6"
publish_package "sdk/worker" "@aikirun/worker" "${VERSION}" "6" "6"
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
