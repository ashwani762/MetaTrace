import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import extract from 'extract-zip';

export async function downloadClangd(
    destDir: string, 
    onProgress: (msg: string) => void
): Promise<string> {
    const isWindows = process.platform === 'win32';
    const clangdExeName = isWindows ? 'clangd.exe' : 'clangd';
    const finalClangdPath = path.join(destDir, clangdExeName);

    if (fs.existsSync(finalClangdPath)) {
        return finalClangdPath;
    }

    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    // Use official releases from llvm/llvm-project or clangd/clangd
    // Example: https://github.com/clangd/clangd/releases/download/18.1.3/clangd-windows-18.1.3.zip
    const version = '18.1.3';
    const platformStr = isWindows ? 'windows' : 'linux';
    const zipName = `clangd-${platformStr}-${version}.zip`;
    const url = `https://github.com/clangd/clangd/releases/download/${version}/${zipName}`;
    
    const zipPath = path.join(destDir, zipName);

    onProgress(`Downloading clangd for ${process.platform}...`);

    await new Promise<void>((resolve, reject) => {
        const downloadFile = (downloadUrl: string) => {
            https.get(downloadUrl, (response) => {
                // Handle redirects
                if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    return downloadFile(response.headers.location);
                }
                
                if (response.statusCode !== 200) {
                    return reject(new Error(`Failed to download: ${response.statusCode} - ${response.statusMessage}`));
                }

                const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
                let downloadedBytes = 0;

                const fileStream = fs.createWriteStream(zipPath);
                response.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    if (totalBytes > 0) {
                        const percent = Math.round((downloadedBytes / totalBytes) * 100);
                        if (percent % 10 === 0) { // Throttle progress updates somewhat
                            onProgress(`Downloading clangd... ${percent}%`);
                        }
                    }
                });

                response.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve();
                });

                fileStream.on('error', (err) => {
                    fs.unlink(zipPath, () => reject(err));
                });
            }).on('error', reject);
        };
        downloadFile(url);
    });

    onProgress(`Extracting clangd...`);
    try {
        await extract(zipPath, { dir: destDir });
        
        // The zip extracts to a folder like `clangd_18.1.3/bin/clangd`
        const extractedFolderName = `clangd_${version}`;
        const extractedBinPath = path.join(destDir, extractedFolderName, 'bin', clangdExeName);
        
        if (fs.existsSync(extractedBinPath)) {
            fs.copyFileSync(extractedBinPath, finalClangdPath);
            if (!isWindows) {
                fs.chmodSync(finalClangdPath, '755');
            }
        } else {
            throw new Error(`Could not find ${clangdExeName} inside extracted zip.`);
        }

        // Cleanup
        fs.unlinkSync(zipPath);
        fs.rmSync(path.join(destDir, extractedFolderName), { recursive: true, force: true });
        try { fs.rmSync(path.join(destDir, 'lib'), { recursive: true, force: true }); } catch (e) {}

        onProgress(`Clangd setup complete.`);
    } catch (err) {
        throw new Error(`Failed to extract clangd: ${err}`);
    }

    return finalClangdPath;
}
