#!/bin/bash
# Post-publish verification and git tagging
# Run this after all registry publish scripts (./scripts/publish-jsr.sh, ./scripts/publish-npm.sh, etc.)
# Verifies packages are published, then creates and pushes git tag

set -e

PACKAGES=(
    "@aikirun/lib"
    "@aikirun/types"
    "@aikirun/workflow"
    "@aikirun/client"
    "@aikirun/task"
    "@aikirun/worker"
)

# Read version from lib/deno.json
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    echo "Install it with: brew install jq (macOS) or apt-get install jq (Linux)"
    exit 1
fi

VERSION=$(jq -r '.version' lib/deno.json)
TAG="v${VERSION}"

echo "Post-publish verification and tagging"
echo "======================================"
echo "Version: ${VERSION}"
echo ""

# Function to check if a package exists on JSR
check_jsr_package() {
    local package=$1
    local scope=$(echo "$package" | cut -d'/' -f2)
    local name=$(echo "$package" | cut -d'/' -f3)

    echo -n "Checking $package on JSR... "

    # Remove @ from scope for URL
    local scope_name=${scope#@}

    if curl -s "https://jsr.io/${scope_name}/${name}/${VERSION}/meta.json" > /dev/null 2>&1; then
        echo "✅"
        return 0
    else
        echo "❌"
        return 1
    fi
}

# Function to check if a package exists on npm
check_npm_package() {
    local package=$1
    local scope=$(echo "$package" | cut -d'/' -f2)
    local name=$(echo "$package" | cut -d'/' -f3)

    echo -n "Checking $package on npm... "

    # Remove @ from scope and construct package name
    local scope_name=${scope#@}

    if curl -s "https://registry.npmjs.org/${scope}/${name}/${VERSION}" > /dev/null 2>&1; then
        echo "✅"
        return 0
    else
        echo "❌"
        return 1
    fi
}

# Verify all packages are published on JSR
echo "Verifying packages on JSR..."
echo ""

jsr_published=true

for package in "${PACKAGES[@]}"; do
    if ! check_jsr_package "$package"; then
        jsr_published=false
    fi
done

echo ""

# Verify all packages are published on npm
echo "Verifying packages on npm..."
echo ""

npm_published=true

for package in "${PACKAGES[@]}"; do
    if ! check_npm_package "$package"; then
        npm_published=false
    fi
done

echo ""

if [ "$jsr_published" = false ] || [ "$npm_published" = false ]; then
    echo "❌ Not all packages are published yet."
    echo ""
    echo "Please run the publish scripts first:"
    echo "  deno task publish-jsr"
    echo "  deno task publish-npm"
    echo ""
    echo "Then run this script again."
    exit 1
fi

echo "✅ All packages verified on JSR and npm!"
echo ""

# Check for uncommitted changes
echo "Checking git status..."
if [ -n "$(git status --porcelain)" ]; then
    echo "❌ Error: Uncommitted changes detected"
    echo ""
    echo "Please commit all changes before tagging:"
    git status
    exit 1
fi

echo "✅ Git working directory is clean"
echo ""

# Create and push tag
echo "Creating and pushing git tag ${TAG}..."
git tag "$TAG"
git push origin "$TAG"

echo ""
echo "🎉 Release ${TAG} published and tagged successfully!"
echo ""
echo "Published packages on JSR:"
for package in "${PACKAGES[@]}"; do
    scope=$(echo "$package" | cut -d'/' -f2)
    scope_name=${scope#@}
    name=$(echo "$package" | cut -d'/' -f3)
    echo "  - https://jsr.io/${scope_name}/${name}@${VERSION}"
done
echo ""
echo "Published packages on npm:"
for package in "${PACKAGES[@]}"; do
    scope=$(echo "$package" | cut -d'/' -f2)
    name=$(echo "$package" | cut -d'/' -f3)
    echo "  - https://www.npmjs.com/package/${scope}/${name}/v/${VERSION}"
done
echo ""
echo "Git tag: https://github.com/aikirun/aiki/releases/tag/${TAG}"
