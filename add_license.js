const fs = require('fs');
const path = require('path');

const MIT_HEADER_JS = `// Copyright (c) 2024 MetaTrace Contributors
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

`;

const MIT_HEADER_VUE = `<!--
  Copyright (c) 2024 MetaTrace Contributors
  
  This software is released under the MIT License.
  https://opensource.org/licenses/MIT
-->
`;

const extensions = ['.js', '.ts', '.vue', '.cpp', '.h', '.html'];
const ignoreDirs = ['node_modules', 'dist', 'release', 'build', '.git'];

function prependLicense(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (!ignoreDirs.includes(file)) {
                prependLicense(fullPath);
            }
        } else {
            const ext = path.extname(file);
            if (extensions.includes(ext)) {
                let content = fs.readFileSync(fullPath, 'utf-8');
                
                // Check if already has license
                if (content.includes('Copyright (c)') || content.includes('MIT License')) {
                    continue;
                }

                let header = '';
                if (ext === '.vue' || ext === '.html') {
                    // Prepend HTML-style header
                    // But wait, Vue files might need the header at the very top.
                    header = MIT_HEADER_VUE;
                } else {
                    // Prepend JS-style header
                    header = MIT_HEADER_JS;
                }

                fs.writeFileSync(fullPath, header + content, 'utf-8');
                console.log(`Added license to ${fullPath}`);
            }
        }
    }
}

prependLicense(path.join(__dirname, 'frontend'));
prependLicense(path.join(__dirname, 'backend'));
prependLicense(path.join(__dirname, 'plugin')); // if it exists
