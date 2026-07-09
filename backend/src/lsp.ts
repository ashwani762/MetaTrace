import { WebSocketServer, WebSocket } from 'ws';
import { spawn } from 'child_process';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

export function setupLSP(server: http.Server, baseDir: string) {
    const wss = new WebSocketServer({ server, path: '/lsp' });

    wss.on('connection', (ws: WebSocket) => {
        console.log('Client connected to LSP');
        
        let clangdPath = path.join(baseDir, 'plugin', 'clangd.exe');
        if (!fs.existsSync(clangdPath)) {
            // Fallback to system PATH for development if not bundled
            clangdPath = 'clangd'; 
        }
        
        const clangd = spawn(clangdPath, [
            '--log=error',
            '--background-index'
        ]);

        ws.on('message', (message: string) => {
            const msgStr = message.toString();
            const header = `Content-Length: ${Buffer.byteLength(msgStr, 'utf8')}\r\n\r\n`;
            clangd.stdin.write(header + msgStr);
        });

        let buffer = Buffer.alloc(0);

        clangd.stdout.on('data', (data: Buffer) => {
            buffer = Buffer.concat([buffer, data]);

            while (true) {
                const headerEnd = buffer.indexOf('\r\n\r\n');
                if (headerEnd === -1) break;

                const headerStr = buffer.toString('utf8', 0, headerEnd);
                const match = headerStr.match(/Content-Length: (\d+)/i);
                if (!match) {
                    console.error('Invalid LSP Header:', headerStr);
                    buffer = Buffer.alloc(0);
                    break;
                }

                const contentLength = parseInt(match[1], 10);
                const messageStart = headerEnd + 4;

                if (buffer.length < messageStart + contentLength) {
                    break;
                }

                const messagePayloadStr = buffer.toString('utf8', messageStart, messageStart + contentLength);
                ws.send(messagePayloadStr);

                buffer = buffer.subarray(messageStart + contentLength);
            }
        });

        clangd.stderr.on('data', (data: Buffer) => {
            console.error(`clangd stderr: ${data.toString()}`);
        });

        ws.on('close', () => {
            console.log('Client disconnected from LSP');
            clangd.kill();
        });

        clangd.on('exit', () => {
            ws.close();
        });
    });
}
