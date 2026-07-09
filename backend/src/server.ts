import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { exec } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { BUILD_VERSION } from './version';

let port = process.env.PORT ? parseInt(process.env.PORT, 10) : 80;
let host = '127.0.0.1';
let isDebug = false;

for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--help' || arg === '-h') {
        console.log(`
Usage: MetaTrace.exe [options]

Options:
  --port, -p    Port to listen on (default: 80)
  --host        Host to bind to (default: 127.0.0.1)
  --expose      Bind to 0.0.0.0 to expose to the network
  --debug, -d   Enable debug logging
  --help, -h    Show this help message
        `);
        process.exit(0);
    } else if (arg === '--port' || arg === '-p') {
        port = parseInt(process.argv[++i], 10) || port;
    } else if (arg === '--host') {
        host = process.argv[++i] || host;
    } else if (arg === '--expose') {
        host = '0.0.0.0';
    } else if (arg === '--debug' || arg === '-d') {
        isDebug = true;
    }
}

const app = express();
app.use(cors());
app.use(bodyParser.json());


interface TraceEvent {
    name: string;
    ph: string;
    ts: number;
    dur: number;
    pid: number;
    tid: number;
    args?: { detail?: string };
}

function execute(cmd: string, cwd?: string, signal?: AbortSignal): Promise<{stdout: string, stderr: string}> {
    return new Promise((resolve, reject) => {
        exec(cmd, { maxBuffer: 1024 * 1024 * 100, cwd, signal }, (error: any, stdout, stderr) => {
            if (error && (error.name === 'AbortError' || error.code === 'ABORT_ERR')) {
                return reject(error);
            }
            // We ignore other errors because code might have compile errors but still generate trace
            resolve({ stdout, stderr }); 
        });
    });
}



const isPkg = typeof (process as any).pkg !== 'undefined';
// For serving static files from within pkg snapshot or local dir
const staticDir = path.join(__dirname, '..', 'public');
const appDataDir = path.join(os.tmpdir(), 'MetaTrace');
if (!fsSync.existsSync(appDataDir)) {
    fsSync.mkdirSync(appDataDir, { recursive: true });
}

// Extract Visualizer if in pkg
export let VISUALIZER_BIN = path.join(__dirname, '..', 'plugin', process.platform === 'win32' ? 'Visualizer.exe' : 'Visualizer');

if (isPkg) {
    const pluginCacheDir = path.join(appDataDir, 'plugin');
    if (!fsSync.existsSync(pluginCacheDir)) {
        fsSync.mkdirSync(pluginCacheDir, { recursive: true });
    }
    const extractPath = path.join(pluginCacheDir, process.platform === 'win32' ? 'Visualizer.exe' : 'Visualizer');
    const versionPath = path.join(pluginCacheDir, 'version.txt');
    
    let needsExtract = true;
    if (fsSync.existsSync(extractPath) && fsSync.existsSync(versionPath)) {
        const cachedVersion = fsSync.readFileSync(versionPath, 'utf8').trim();
        if (cachedVersion === BUILD_VERSION) {
            needsExtract = false;
        }
    }

    if (needsExtract) {
        console.log(`[INFO] Extracting Visualizer (version ${BUILD_VERSION}) to ${extractPath}...`);
        fsSync.writeFileSync(extractPath, fsSync.readFileSync(VISUALIZER_BIN));
        fsSync.writeFileSync(versionPath, BUILD_VERSION);
        if (process.platform !== 'win32') {
            fsSync.chmodSync(extractPath, '755');
        }
    }
    VISUALIZER_BIN = extractPath;
}

app.use(express.static(staticDir));

app.post('/api/compile', async (req, res) => {
  const { code, standard } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      ac.abort();
    }
  });

  const reqId = crypto.randomUUID();
  const tmpDir = path.resolve(appDataDir, `tmp/${reqId}`);
  
  try {
    await fs.mkdir(tmpDir, { recursive: true });
    
    const cppFile = path.join(tmpDir, 'input.cpp');
    const outFile = path.join(tmpDir, 'input.o');
    await fs.writeFile(cppFile, code);
    
    const stdFlag = standard ? `-std=${standard}` : `-std=c++17`;

    // 1. Generate trace using Visualizer.exe
    const cmdTrace = `"${VISUALIZER_BIN}" "${cppFile}" -- ${stdFlag}`;
    if (isDebug) console.log(`[DEBUG] Executing: ${cmdTrace}`);
    const traceResult = await execute(cmdTrace, tmpDir, ac.signal);
    if (isDebug) console.log(`[DEBUG] Execute finished`);
    
    const traceFile = path.join(tmpDir, 'trace_custom.json');
    let traceDataObj = { nodes: [], events: [], values: {} };
    try {
        const traceData = await fs.readFile(traceFile, 'utf-8');
        if (isDebug) console.log(`[DEBUG] Trace file read successfully, length: ${traceData.length}`);
        traceDataObj = JSON.parse(traceData);
    } catch (e) {
        console.error("No custom trace generated:", e);
    }

    if (isDebug) console.log(`[DEBUG] Sending JSON response`);
    res.json({
        nodes: traceDataObj.nodes,
        events: traceDataObj.events,
        values: traceDataObj.values,
        output: traceResult.stdout,
        stderr: traceResult.stderr
    });
    if (isDebug) console.log(`[DEBUG] JSON response sent`);

    // Cleanup
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  } catch (error: any) {
    if (error.code === 'ABORT_ERR' || error.name === 'AbortError') {
      console.log(`[INFO] Compilation aborted by client.`);
      fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return;
    }
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Server error', details: error });
    }
  }
});

import { setupLSP } from './lsp';

// Ensure the server serves index.html for any unhandled routes to support SPA
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

const server = app.listen(port, host, () => {
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}${port === 80 ? '' : ':' + port}`;
  const banner = `
=============================================================
  __  __      _      _                    
 |  \\/  | ___| |_ __| | _ __ __ _  ___ ___ 
 | |\\/| |/ _ \\ __/ _\` || '__/ _\` |/ __/ _ \\
 | |  | |  __/ || (_| || | | (_| | (_|  __/
 |_|  |_|\\___|\\__\\__,_||_|  \\__,_|\\___\\___|
 
  🚀 MetaTrace is running!
=============================================================
  Network UI:   ${url}
  
  Options used:
    --port    ${port}
    --host    ${host}
    
  (Use --help or -h for more options)
=============================================================
  `;
  console.log(banner);
});

setupLSP(server);
