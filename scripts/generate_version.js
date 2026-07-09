const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const backendSrc = path.join(rootDir, 'backend', 'src');
const backendPlugin = path.join(rootDir, 'backend', 'plugin');

function generateVersion() {
    let versionString = 'Dev';

    const args = process.argv.slice(2);
    const isDev = args.includes('dev');

    if (!isDev) {
        let commitHash = 'unknown';
        try {
            commitHash = execSync('git rev-parse --short HEAD', { cwd: rootDir }).toString().trim();
        } catch (e) {
            console.warn('Could not determine git commit hash, using unknown.');
        }
        
        const timestamp = new Date().toISOString();
        versionString = `${commitHash}-${timestamp}`;
    }

    console.log(`Generating version info: ${versionString}`);

    // Generate version.ts for backend
    if (!fs.existsSync(backendSrc)) {
        fs.mkdirSync(backendSrc, { recursive: true });
    }
    fs.writeFileSync(path.join(backendSrc, 'version.ts'), `export const BUILD_VERSION = "${versionString}";\n`);

    // Generate version.h for plugin
    if (!fs.existsSync(backendPlugin)) {
        fs.mkdirSync(backendPlugin, { recursive: true });
    }
    fs.writeFileSync(path.join(backendPlugin, 'version.h'), `#pragma once\n\n#define BUILD_VERSION "${versionString}"\n`);
}

generateVersion();
