// Copyright (c) 2024 MetaTrace Contributors
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { runVisualizer, setupTestEnvironment, teardownTestEnvironment } from '../utils/runVisualizer';

let tmpDir: string;

beforeAll(() => {
    tmpDir = setupTestEnvironment();
});

afterAll(() => {
    teardownTestEnvironment(tmpDir);
});

describe('Header Inclusion', () => {
    test('filters out AST noise from standard library headers like <vector>', () => {
        const code = `
            #include <vector>
            
            template <typename T>
            struct UserStruct {
                std::vector<T> vec;
            };

            int main() {
                UserStruct<int> s;
                return 0;
            }
        `;
        
        const trace = runVisualizer(code, tmpDir);
        if (!trace) {
            console.log("Visualizer failed. Trace is null.");
        }
        expect(trace).not.toBeNull();
        expect(trace.nodes).toBeDefined();
        
        // Ensure UserStruct<int> is captured
        const hasUserStruct = trace.nodes.some((n: any) => n.detail.includes('UserStruct<int>'));
        expect(hasUserStruct).toBe(true);

        // Ensure we don't have thousands of internal std::vector nodes
        // (A raw vector inclusion usually produces 10k+ nodes, filtering should drop it to <100)
        expect(trace.nodes.length).toBeLessThan(100);
    });
});
