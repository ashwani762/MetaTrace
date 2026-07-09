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

function runVisualizer(code: string, std: string = 'c++17'): any {
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
        execSync(`"${PLUGIN_BIN}" "${cppFile}" -- -std=${std}`, { cwd: TEST_TMP_DIR });
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

    test('supports C++14 SFINAE with std::enable_if_t', () => {
        const code = `
            #include <type_traits>

            template <typename T>
            std::enable_if_t<std::is_integral<T>::value, T> 
            process(T val) { return val * 2; }

            template <typename T>
            std::enable_if_t<std::is_floating_point<T>::value, T> 
            process(T val) { return val / 2.0; }

            int main() {
                process(5);
                process(3.14);
                return 0;
            }
        `;
        const trace = runVisualizer(code, 'c++14');
        expect(trace).not.toBeNull();
        expect(trace.nodes).toBeDefined();
        
        const hasIntProcess = trace.nodes.some((n: any) => n.detail.includes('process<int>'));
        const hasDoubleProcess = trace.nodes.some((n: any) => n.detail.includes('process<double>'));
        expect(hasIntProcess).toBe(true);
        expect(hasDoubleProcess).toBe(true);
    });

    test('supports C++17 fold expressions (Variadic Templates)', () => {
        const code = `
            template<typename... Args>
            int sum(Args... args) {
                return (... + args);
            }

            int main() {
                return sum(1, 2, 3);
            }
        `;
        const trace = runVisualizer(code, 'c++17');
        expect(trace).not.toBeNull();
        expect(trace.nodes).toBeDefined();
        const hasVariadic = trace.nodes.some((n: any) => n.detail.includes('sum<int, int, int>'));
        expect(hasVariadic).toBe(true);
    });

    test('supports C++20 concepts and constraints', () => {
        const code = `
            template <typename T>
            concept Integral = __is_integral(T);

            template <Integral T>
            T add(T a, T b) { return a + b; }

            int main() {
                add(5, 10);
                return 0;
            }
        `;
        const trace = runVisualizer(code, 'c++20');
        expect(trace).not.toBeNull();
        expect(trace.nodes).toBeDefined();
        
        const hasConceptMatch = trace.nodes.some((n: any) => n.detail.includes('add<int>'));
        expect(hasConceptMatch).toBe(true);
    });
});
