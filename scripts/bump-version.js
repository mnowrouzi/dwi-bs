#!/usr/bin/env node

// Version bumping script
// Usage: node scripts/bump-version.js [major|minor|patch]

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

function getVersion() {
  const versionFile = join(rootDir, 'VERSION');
  return readFileSync(versionFile, 'utf-8').trim();
}

function setVersion(version) {
  const versionFile = join(rootDir, 'VERSION');
  writeFileSync(versionFile, version + '\n', 'utf-8');
  
  // Update package.json files
  const serverPkg = JSON.parse(readFileSync(join(rootDir, 'server/package.json'), 'utf-8'));
  serverPkg.version = version;
  writeFileSync(join(rootDir, 'server/package.json'), JSON.stringify(serverPkg, null, 2) + '\n');
  
  const clientPkg = JSON.parse(readFileSync(join(rootDir, 'client/package.json'), 'utf-8'));
  clientPkg.version = version;
  writeFileSync(join(rootDir, 'client/package.json'), JSON.stringify(clientPkg, null, 2) + '\n');
  
  // Update client/src/version.js
  const clientVersionFile = join(rootDir, 'client/src/version.js');
  const versionJsContent = `// Version file - auto-updated by bump-version script
// This file is generated from package.json version
export const VERSION = '${version}';

`;
  writeFileSync(clientVersionFile, versionJsContent, 'utf-8');
}

function bumpVersion(type = 'patch') {
  const current = getVersion();
  const [major, minor, patch] = current.split('.').map(Number);
  
  let newVersion;
  switch (type) {
    case 'major':
      newVersion = `${major + 1}.0.0`;
      break;
    case 'minor':
      newVersion = `${major}.${minor + 1}.0`;
      break;
    case 'patch':
    default:
      newVersion = `${major}.${minor}.${patch + 1}`;
      break;
  }
  
  setVersion(newVersion);
  console.log(`Version bumped: ${current} -> ${newVersion}`);
  return newVersion;
}

// Main
const type = process.argv[2] || 'patch';
if (!['major', 'minor', 'patch'].includes(type)) {
  console.error('Invalid version type. Use: major, minor, or patch');
  process.exit(1);
}

const newVersion = bumpVersion(type);
console.log(`\nUpdated to version ${newVersion}`);
console.log('Don\'t forget to commit the version changes!');

