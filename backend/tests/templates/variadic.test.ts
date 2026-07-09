import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { runVisualizer, setupTestEnvironment, teardownTestEnvironment } from '../utils/runVisualizer';

let tmpDir: string;

beforeAll(() => {
    tmpDir = setupTestEnvironment();
});

afterAll(() => {
    teardownTestEnvironment(tmpDir);
});

describe('Variadic Templates', () => {
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
        const trace = runVisualizer(code, tmpDir, 'c++17');
        expect(trace).not.toBeNull();
        expect(trace.nodes).toBeDefined();
        const hasVariadic = trace.nodes.some((n: any) => n.detail.includes('sum<int, int, int>'));
        expect(hasVariadic).toBe(true);
    });
});
