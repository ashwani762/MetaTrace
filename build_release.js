const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const frontendDir = path.join(rootDir, 'frontend');
const backendDir = path.join(rootDir, 'backend');
const releaseDir = path.join(rootDir, 'release');

console.log('\n=======================================');
console.log('1. Building C++ Visualizer Plugin...');
console.log('=======================================');
const pluginDir = path.join(backendDir, 'plugin');
// Build Visualizer using build.bat which sets up MSVC env and runs cmake + ninja
execSync('build.bat', { cwd: pluginDir, stdio: 'inherit' });

console.log('\n=======================================');
console.log('2. Building Frontend...');
console.log('=======================================');
execSync('npm install', { cwd: frontendDir, stdio: 'inherit' });
execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });

console.log('\n=======================================');
console.log('2. Compiling Backend TypeScript...');
console.log('=======================================');
execSync('npm install', { cwd: backendDir, stdio: 'inherit' });
execSync('npm run build', { cwd: backendDir, stdio: 'inherit' });

console.log('Copying frontend dist to backend/public for embedding...');
if (fs.existsSync(path.join(backendDir, 'public'))) {
    fs.rmSync(path.join(backendDir, 'public'), { recursive: true, force: true });
}
fs.cpSync(path.join(frontendDir, 'dist'), path.join(backendDir, 'public'), { recursive: true });

console.log('\n=======================================');
console.log('3. Packaging Backend to Binary using pkg...');
console.log('=======================================');
// Install pkg locally in the backend folder
execSync('npm install pkg --no-save', { cwd: backendDir, stdio: 'inherit' });
// Run pkg to compile server.js into CppTemplateVisualizer.exe
execSync('npx pkg dist/server.js --target node18-win-x64 --output CppTemplateVisualizer.exe', { cwd: backendDir, stdio: 'inherit' });

console.log('Adding logo to executable...');
execSync('npx resedit-cli --in CppTemplateVisualizer.exe --out CppTemplateVisualizer.exe --icon 1,../logo.ico', { cwd: backendDir, stdio: 'inherit' });

console.log('\n=======================================');
console.log('4. Creating Release Directory...');
console.log('=======================================');
if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
}

console.log('Copying artifacts to release folder...');
// Copy CppTemplateVisualizer binary
fs.copyFileSync(path.join(backendDir, 'CppTemplateVisualizer.exe'), path.join(releaseDir, 'CppTemplateVisualizer.exe'));

console.log('\n=======================================');
console.log('SUCCESS! Release is ready in: ' + releaseDir);
console.log('=======================================');
