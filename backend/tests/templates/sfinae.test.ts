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

describe('SFINAE Templates', () => {
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
        const trace = runVisualizer(code, tmpDir, 'c++14');
        expect(trace).not.toBeNull();
        expect(trace.nodes).toBeDefined();
        
        const hasIntProcess = trace.nodes.some((n: any) => n.detail.includes('process<int>'));
        const hasDoubleProcess = trace.nodes.some((n: any) => n.detail.includes('process<double>'));
        expect(hasIntProcess).toBe(true);
        expect(hasDoubleProcess).toBe(true);
    });
});
