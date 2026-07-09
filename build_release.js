const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const frontendDir = path.join(rootDir, 'frontend');
const backendDir = path.join(rootDir, 'backend');
const releaseDir = path.join(rootDir, 'release');

console.log('\n=======================================');
console.log('1. Building Frontend...');
console.log('=======================================');
execSync('npm install', { cwd: frontendDir, stdio: 'inherit' });
execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });

console.log('\n=======================================');
console.log('2. Compiling Backend TypeScript...');
console.log('=======================================');
execSync('npm install', { cwd: backendDir, stdio: 'inherit' });
execSync('npm run build', { cwd: backendDir, stdio: 'inherit' });

console.log('\n=======================================');
console.log('3. Packaging Backend to Binary using pkg...');
console.log('=======================================');
// Install pkg locally in the backend folder
execSync('npm install pkg --no-save', { cwd: backendDir, stdio: 'inherit' });
// Run pkg to compile server.js into server.exe
execSync('npx pkg dist/server.js --target node18-win-x64 --output server.exe', { cwd: backendDir, stdio: 'inherit' });

console.log('\n=======================================');
console.log('4. Creating Release Directory...');
console.log('=======================================');
if (fs.existsSync(releaseDir)) {
    fs.rmSync(releaseDir, { recursive: true, force: true });
}
fs.mkdirSync(releaseDir);

console.log('Copying artifacts to release folder...');
// Copy server binary
fs.copyFileSync(path.join(backendDir, 'server.exe'), path.join(releaseDir, 'server.exe'));

// Copy Visualizer plugin
const pluginDir = path.join(releaseDir, 'plugin');
fs.mkdirSync(pluginDir);
fs.copyFileSync(path.join(backendDir, 'plugin', 'Visualizer.exe'), path.join(pluginDir, 'Visualizer.exe'));

// Copy clangd to the release package to remove external dependencies
// Copy clangd to the release package to remove external dependencies
const externalClangdPath = path.join(rootDir, 'external', 'clangd.exe');
if (fs.existsSync(externalClangdPath)) {
    fs.copyFileSync(externalClangdPath, path.join(pluginDir, 'clangd.exe'));
    console.log(`Copied clangd.exe from external/ to release package.`);
} else {
    console.warn(`WARNING: clangd.exe not found in ${externalClangdPath}.`);
}

// Copy frontend dist to public
fs.cpSync(path.join(frontendDir, 'dist'), path.join(releaseDir, 'public'), { recursive: true });

console.log('\n=======================================');
console.log('SUCCESS! Release is ready in: ' + releaseDir);
console.log('=======================================');
