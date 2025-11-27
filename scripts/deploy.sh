#!/bin/bash

# Complete deployment script
# Bumps version, commits, pushes to GitHub, and restarts the game

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting deployment process...${NC}"

# Step 1: Bump version
echo -e "\n${YELLOW}📦 Step 1: Bumping version...${NC}"
VERSION_TYPE="${1:-patch}"
cd "$PROJECT_ROOT"
node scripts/bump-version.js "$VERSION_TYPE"
NEW_VERSION=$(cat VERSION | tr -d '\n')
echo -e "${GREEN}✅ Version bumped to ${NEW_VERSION}${NC}"

# Step 2: Check for changes
echo -e "\n${YELLOW}📝 Step 2: Checking for changes...${NC}"
if [ -z "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}⚠️  No changes to commit${NC}"
    exit 0
fi

# Step 3: Add all changes
echo -e "\n${YELLOW}📦 Step 3: Staging changes...${NC}"
git add -A
echo -e "${GREEN}✅ Changes staged${NC}"

# Step 4: Commit
echo -e "\n${YELLOW}💾 Step 4: Committing changes...${NC}"
COMMIT_MSG="${2:-chore: bump version to ${NEW_VERSION}}"
git commit -m "$COMMIT_MSG"
echo -e "${GREEN}✅ Changes committed${NC}"

# Step 5: Push to GitHub
echo -e "\n${YELLOW}☁️  Step 5: Pushing to GitHub...${NC}"
git push origin main
echo -e "${GREEN}✅ Changes pushed to GitHub${NC}"

# Step 6: Smart restart (only what changed)
echo -e "\n${YELLOW}🔄 Step 6: Smart restarting (only what changed)...${NC}"
"$SCRIPT_DIR/smart-restart.sh"

echo -e "\n${GREEN}✅ Deployment complete!${NC}"
echo -e "${BLUE}📊 Version: ${NEW_VERSION}${NC}"
echo -e "${BLUE}🌐 Repository: https://github.com/mnowrouzi/dwi-bs${NC}"
echo -e "${BLUE}🎮 Game ready for testing!${NC}"

