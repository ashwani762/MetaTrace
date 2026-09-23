// Copyright (c) 2026 MetaTrace Contributors
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
    test('marks the discarded overload as a SFINAE failure with the compiler reason', () => {
        const code = `
            #include <type_traits>
            template <typename T> std::enable_if_t<std::is_integral<T>::value, T> process(T v) { return v * 2; }
            template <typename T> std::enable_if_t<std::is_floating_point<T>::value, T> process(T v) { return v / 2; }
            int main() { process(5); return 0; }
        `;
        const trace = runVisualizer(code, tmpDir, 'c++14');
        expect(trace).not.toBeNull();

        const candidates = trace.nodes.filter((n: any) => n.kindName === 'DeducedTemplateArgumentSubstitution');
        const rejected = candidates.filter((n: any) => n.failed);
        const viable = candidates.filter((n: any) => !n.failed);
        expect(rejected.length).toBe(1);
        expect(viable.length).toBe(1);
        expect(rejected[0].failReason).toContain('is_floating_point<int>');
        expect(rejected[0].declLine).not.toBe(viable[0].declLine);
    });

    test('keeps recursive instantiations nested under the specialization that caused them', () => {
        const code = `
            template <int N> struct Fact { static constexpr int value = N * Fact<N - 1>::value; };
            template <> struct Fact<0> { static constexpr int value = 1; };
            int main() { constexpr int r = Fact<3>::value; return r; }
        `;
        const trace = runVisualizer(code, tmpDir, 'c++17');
        expect(trace).not.toBeNull();

        const byId = new Map(trace.nodes.map((n: any) => [n.id, n]));
        const fact2 = trace.nodes.find((n: any) => n.detail === 'Fact<2>');
        expect(fact2).toBeDefined();
        expect((byId.get(fact2.parentId) as any)?.detail).toBe('Fact<3>');
    });
});
