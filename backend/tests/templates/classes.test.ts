import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { runVisualizer, setupTestEnvironment, teardownTestEnvironment } from '../utils/runVisualizer';

let tmpDir: string;

beforeAll(() => {
    tmpDir = setupTestEnvironment();
});

afterAll(() => {
    teardownTestEnvironment(tmpDir);
});

describe('Class Templates', () => {
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
        
        const trace = runVisualizer(code, tmpDir);
        expect(trace).not.toBeNull();
        expect(trace.nodes).toBeDefined();
        
        // We expect to see "Min<5, 2>" as the class instantiation detail
        const hasNttpArgs = trace.nodes.some((n: any) => n.detail.includes('Min<5, 2>'));
        expect(hasNttpArgs).toBe(true);
    });
});
