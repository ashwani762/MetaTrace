// Copyright (c) 2024 MetaTrace Contributors
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

import { WebSocketServer, WebSocket } from 'ws';
import { spawn } from 'child_process';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { downloadClangd } from './clangd_downloader';

export function setupLSP(server: http.Server) {
    const wss = new WebSocketServer({ server, path: '/lsp' });

    wss.on('connection', async (ws: WebSocket) => {
        
        // Helper to send custom progress notifications to the frontend
        const sendProgress = (msg: string) => {
            const notif = {
                jsonrpc: "2.0",
                method: "custom/downloadProgress",
                params: { message: msg }
            };
            const msgStr = JSON.stringify(notif);
            if (ws.readyState === ws.OPEN) {
                ws.send(msgStr);
            }
        };

        const appDataDir = path.join(os.tmpdir(), 'MetaTrace');
        const pluginCacheDir = path.join(appDataDir, 'plugin');

        let messageQueue: string[] = [];
        let isClangdReady = false;
        let clangd: any = null;

        ws.on('message', (message: string) => {
            const msgStr = message.toString();
            const header = `Content-Length: ${Buffer.byteLength(msgStr, 'utf8')}\r\n\r\n`;
            if (isClangdReady && clangd) {
                clangd.stdin.write(header + msgStr);
            } else {
                messageQueue.push(header + msgStr);
            }
        });

        let clangdPath: string;
        try {
            clangdPath = await downloadClangd(pluginCacheDir, sendProgress);
        } catch (err: any) {
            console.error('Failed to download clangd:', err);
            sendProgress(`Error: ${err.message}`);
            ws.close();
            return;
        }

        clangd = spawn(clangdPath, [
            '--log=error',
            '--background-index'
        ]);

        isClangdReady = true;
        for (const queuedMsg of messageQueue) {
            clangd.stdin.write(queuedMsg);
        }
        messageQueue = [];

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
            clangd.kill();
        });

        clangd.on('exit', () => {
            ws.close();
        });
    });
}
