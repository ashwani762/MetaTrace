import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';

const PLUGIN_BIN = path.resolve(__dirname, '../plugin/Visualizer.exe');
const TEST_TMP_DIR = path.resolve(__dirname, 'tmp');

beforeAll(() => {
    if (!fs.existsSync(TEST_TMP_DIR)) {
        fs.mkdirSync(TEST_TMP_DIR, { recursive: true });
    }
});

afterAll(() => {
    if (fs.existsSync(TEST_TMP_DIR)) {
        fs.rmSync(TEST_TMP_DIR, { recursive: true, force: true });
    }
});

function runVisualizer(code: string): any {
    const testId = Math.random().toString(36).substring(7);
    const cppFile = path.join(TEST_TMP_DIR, `test_${testId}.cpp`);
    const traceFile = path.join(TEST_TMP_DIR, `trace_custom.json`);
    
    // Clear old trace if exists
    if (fs.existsSync(traceFile)) {
        fs.rmSync(traceFile);
    }
    
    fs.writeFileSync(cppFile, code);
    
    // Run Visualizer.exe (the trace is generated in the current working directory of the process)
    try {
        execSync(`"${PLUGIN_BIN}" "${cppFile}" -- -std=c++17`, { cwd: TEST_TMP_DIR });
    } catch (e) {
        // Visualizer might return non-zero if there are compiler errors, but still generate trace
    }
    
    if (fs.existsSync(traceFile)) {
        return JSON.parse(fs.readFileSync(traceFile, 'utf-8'));
    }
    return null;
}

describe('Visualizer Clang Plugin', () => {
    test('extracts template arguments for functions', () => {
        const code = `
            template <typename T>
            T my_min(T a) { return a; }

            template <typename T, typename... Args>
            T my_min(T a, T b, Args... args) {
                return my_min(a < b ? a : b, args...);
            }

            int main() {
                my_min(5, 2, 9);
                return 0;
            }
        `;
        
        const trace = runVisualizer(code);
        expect(trace).not.toBeNull();
        expect(trace.nodes).toBeDefined();
        console.log(JSON.stringify(trace.nodes, null, 2));
        
        // We expect to see "my_min<int, int>" as a node detail, not just "my_min"
        const hasTemplateArgs = trace.nodes.some((n: any) => n.detail.includes('my_min<int, int>'));
        
        // If the plugin isn't enhanced yet, it probably only outputs "my_min"
        expect(hasTemplateArgs).toBe(true);
    });

    test('extracts non-type template parameters (NTTP) for classes', () => {
        const code = `
            template <int A, int B>
            struct Min {
                static constexpr int value = (A < B) ? A : B;
            };

            int main() {
                return Min<5, 2>::value;
            }
        `;
        
        const trace = runVisualizer(code);
        expect(trace).not.toBeNull();
        expect(trace.nodes).toBeDefined();
        
        // We expect to see "Min<5, 2>" as the class instantiation detail
        const hasNttpArgs = trace.nodes.some((n: any) => n.detail.includes('Min<5, 2>'));
        expect(hasNttpArgs).toBe(true);
    });
});
