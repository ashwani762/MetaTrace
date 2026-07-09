const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const frontendDir = path.join(rootDir, 'frontend');
const backendDir = path.join(rootDir, 'backend');
const releaseDir = path.join(rootDir, 'release');

console.log('\n=======================================');
console.log('0. Generating Version Information...');
console.log('=======================================');
execSync('node scripts/generate_version.js', { cwd: rootDir, stdio: 'inherit' });

console.log('\n=======================================');
console.log('1. Building C++ Visualizer Plugin...');
console.log('=======================================');
const pluginDir = path.join(backendDir, 'plugin');
try {
    // Build Visualizer assuming CMake is already configured by the user
    execSync('cmake --build . --config Release', { cwd: pluginDir, stdio: 'inherit' });
} catch (e) {
    console.error('\n[!] Failed to build the C++ Visualizer Plugin.');
    console.error('[!] Ensure you have configured CMake with your LLVM_PATH before running npm run build.');
    console.error('[!] See backend/plugin/README.md for instructions.\n');
    process.exit(1);
}

console.log('\n=======================================');
console.log('2. Compiling Frontend...');
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
// Run pkg to compile server.js into MetaTrace.exe using package.json config
execSync('npx pkg . --target node18-win-x64 --output MetaTrace.exe', { cwd: backendDir, stdio: 'inherit' });

console.log('Adding logo to executable...');
execSync('npx resedit-cli --in MetaTrace.exe --out MetaTrace.exe --icon 1,../logo.ico', { cwd: backendDir, stdio: 'inherit' });

console.log('\n=======================================');
console.log('4. Creating Release Directory...');
console.log('=======================================');
if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
}

console.log('Copying artifacts to release folder...');
// Copy MetaTrace binary
fs.copyFileSync(path.join(backendDir, 'MetaTrace.exe'), path.join(releaseDir, 'MetaTrace.exe'));

console.log('\n=======================================');
console.log('SUCCESS! Release is ready in: ' + releaseDir);
console.log('=======================================');
