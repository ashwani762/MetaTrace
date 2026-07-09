const { execSync } = require('child_process');
const os = require('os');

if (os.platform() === 'win32') {
    console.log('Running Windows build script...');
    execSync('node build_release.js', { stdio: 'inherit' });
} else {
    console.log('Running Linux build script...');
    execSync('bash build.sh', { stdio: 'inherit' });
}
