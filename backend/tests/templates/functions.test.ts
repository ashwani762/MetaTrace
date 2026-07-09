import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { runVisualizer, setupTestEnvironment, teardownTestEnvironment } from '../utils/runVisualizer';

let tmpDir: string;

beforeAll(() => {
    tmpDir = setupTestEnvironment();
});

afterAll(() => {
    teardownTestEnvironment(tmpDir);
});

describe('Function Templates', () => {
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
        
        const trace = runVisualizer(code, tmpDir);
        expect(trace).not.toBeNull();
        expect(trace.nodes).toBeDefined();
        
        // We expect to see "my_min<int, int>" as a node detail, not just "my_min"
        const hasTemplateArgs = trace.nodes.some((n: any) => n.detail.includes('my_min<int, int>'));
        
        // If the plugin isn't enhanced yet, it probably only outputs "my_min"
        expect(hasTemplateArgs).toBe(true);
    });
});
