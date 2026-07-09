import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export const PLUGIN_BIN = path.resolve(__dirname, '../../plugin/Visualizer.exe');
export const TEST_TMP_DIR = path.resolve(__dirname, '../tmp');

export function setupTestEnvironment(): string {
    const tmpDir = path.resolve(__dirname, '../tmp', Math.random().toString(36).substring(7));
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }
    return tmpDir;
}

export function teardownTestEnvironment(tmpDir: string) {
    if (fs.existsSync(tmpDir)) {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
        } catch(e) {}
    }
}

export function runVisualizer(code: string, tmpDir: string): any {
    const testId = Math.random().toString(36).substring(7);
    const cppFile = path.join(tmpDir, `test_${testId}.cpp`);
    const traceFile = path.join(tmpDir, `trace_custom.json`);
    
    // Clear old trace if exists
    if (fs.existsSync(traceFile)) {
        fs.rmSync(traceFile);
    }
    
    fs.writeFileSync(cppFile, code);
    
    // Run Visualizer.exe (the trace is generated in the current working directory of the process)
    try {
        execSync(`"${PLUGIN_BIN}" "${cppFile}" -- -std=c++17`, { cwd: tmpDir });
    } catch (e: any) {
        console.error("Execution failed:", e.stdout?.toString(), e.stderr?.toString());
        // Visualizer might return non-zero if there are compiler errors, but still generate trace
    }
    
    if (fs.existsSync(traceFile)) {
        return JSON.parse(fs.readFileSync(traceFile, 'utf-8'));
    }
    return null;
}
