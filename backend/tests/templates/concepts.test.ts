import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { runVisualizer, setupTestEnvironment, teardownTestEnvironment } from '../utils/runVisualizer';

let tmpDir: string;

beforeAll(() => {
    tmpDir = setupTestEnvironment();
});

afterAll(() => {
    teardownTestEnvironment(tmpDir);
});

describe('Concepts and Constraints', () => {
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
        const trace = runVisualizer(code, tmpDir, 'c++20');
        expect(trace).not.toBeNull();
        expect(trace.nodes).toBeDefined();
        
        const hasConceptMatch = trace.nodes.some((n: any) => n.detail.includes('add<int>'));
        expect(hasConceptMatch).toBe(true);
    });
});
