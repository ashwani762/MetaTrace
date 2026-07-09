import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const app = express();
const port = process.env.PORT || 3001;

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
const baseDir = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..');

app.use(express.static(path.join(baseDir, 'public')));

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
  const tmpDir = path.resolve(baseDir, `tmp/${reqId}`);
  
  try {
    await fs.mkdir(tmpDir, { recursive: true });
    
    const cppFile = path.join(tmpDir, 'input.cpp');
    const outFile = path.join(tmpDir, 'input.o');
    await fs.writeFile(cppFile, code);
    
    const stdFlag = standard ? `-std=${standard}` : `-std=c++17`;

    // 1. Generate trace using Visualizer.exe
    const VISUALIZER_BIN = path.resolve(baseDir, 'plugin/Visualizer.exe');
    const cmdTrace = `"${VISUALIZER_BIN}" "${cppFile}" -- ${stdFlag}`;
    console.log(`[DEBUG] Executing: ${cmdTrace}`);
    const traceResult = await execute(cmdTrace, tmpDir, ac.signal);
    console.log(`[DEBUG] Execute finished`);
    
    const traceFile = path.join(tmpDir, 'trace_custom.json');
    let traceDataObj = { nodes: [], events: [], values: {} };
    try {
        const traceData = await fs.readFile(traceFile, 'utf-8');
        console.log(`[DEBUG] Trace file read successfully, length: ${traceData.length}`);
        traceDataObj = JSON.parse(traceData);
    } catch (e) {
        console.error("No custom trace generated:", e);
    }

    console.log(`[DEBUG] Sending JSON response`);
    res.json({
        nodes: traceDataObj.nodes,
        events: traceDataObj.events,
        values: traceDataObj.values,
        output: traceResult.stdout,
        stderr: traceResult.stderr
    });
    console.log(`[DEBUG] JSON response sent`);

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
  res.sendFile(path.join(baseDir, 'public', 'index.html'));
});

const server = app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
});

setupLSP(server, baseDir);
