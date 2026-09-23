// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// Tests for what the Visualizer derives beyond the raw trace: overload ranking explanations,
// constraint trees and computed types/values.

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { runVisualizer, setupTestEnvironment, teardownTestEnvironment } from '../utils/runVisualizer';

let tmpDir: string;

beforeAll(() => {
    tmpDir = setupTestEnvironment();
});

afterAll(() => {
    teardownTestEnvironment(tmpDir);
});

const reasonAt = (trace: any, line: number) => trace.rankings.filter((r: any) => r.line === line).map((r: any) => r.reason);

describe('Overload ranking explanations', () => {
    test('explains partial ordering, constraints, reference binding and viability', () => {
        const code = `
            #include <concepts>
            #include <string>
            template <typename T> int pick(T)  { return 1; }
            template <typename T> int pick(T*) { return 2; }
            template <std::integral T> int kind(T) { return 1; }
            template <std::signed_integral T> int kind(T) { return 2; }
            template <typename T> int take(const T&) { return 1; }
            template <typename T> int take(T&&) { return 2; }
            std::string make();
            int main() {
                int x = 0;
                const int cx = 0;
                pick(&x);
                kind(5);
                take(make());
                take(cx);
                return 0;
            }
        `;
        const trace = runVisualizer(code, tmpDir, 'c++20');
        expect(trace).not.toBeNull();
        expect(reasonAt(trace, 14)).toContain('moreSpecialized');
        expect(reasonAt(trace, 15)).toContain('moreConstrained');
        // take(T&&) with T = std::string beats take(const T&) for an rvalue
        expect(reasonAt(trace, 16)).toContain('referenceBinding');
    });
});

describe('Constraint trees', () => {
    test('annotates every node, including short-circuited ones', () => {
        const code = `
            #include <type_traits>
            template <typename T> concept Small = sizeof(T) <= 4;
            template <typename T> concept Number = std::is_arithmetic_v<T>;
            template <typename T> requires (Number<T> && Small<T>) || std::is_pointer_v<T> int fit(T) { return 1; }
            template <typename T> int fit(T, int = 0) { return 2; }
            int main() { return fit(2.0); }
        `;
        const trace = runVisualizer(code, tmpDir, 'c++20');
        const node = trace.nodes.find((n: any) => n.constraints && n.detail === 'fit<double>');
        expect(node).toBeDefined();
        const tree = node.constraints;
        expect(tree.kind).toBe('or');
        expect(tree.result).toBe('false');
        const [conj, pointer] = tree.children;
        expect(conj.kind).toBe('and');
        expect(conj.children[0].result).toBe('true');   // Number<double>
        expect(conj.children[1].result).toBe('false');  // Small<double>
        expect(conj.children[1].children[0].note).toContain('sizeof(double) <= 4');
        expect(pointer.result).toBe('false');
    });
});

describe('Computed results', () => {
    test('reports alias results and value/type members of specializations', () => {
        const code = `
            #include <type_traits>
            using A = std::conditional_t<false, long, int>;
            constexpr bool B = std::is_integral<char>::value;
            int main() { return B; }
        `;
        const trace = runVisualizer(code, tmpDir, 'c++17');
        const alias = trace.nodes.find((n: any) => n.detail === 'std::conditional_t<false, long, int>');
        expect(alias?.results?.type).toBe('int');
        const trait = trace.nodes.find((n: any) => n.detail === 'std::is_integral<char>' && n.results);
        expect(trait?.results?.value).toBe('true');
    });

    test('does not crash on deductions with not-yet-deduced arguments (generic lambdas, tuples)', () => {
        const code = `
            #include <tuple>
            #include <utility>
            #include <type_traits>
            template <typename Tuple, typename F, std::size_t... I>
            void each(Tuple&& t, F&& f, std::index_sequence<I...>) { (f(std::get<I>(t)), ...); }
            int main() {
                auto t = std::make_tuple(1, 2.5);
                int sum = 0;
                each(t, [&](const auto& v) { if constexpr (std::is_integral_v<std::remove_cvref_t<decltype(v)>>) sum += v; },
                     std::make_index_sequence<2>{});
                return sum;
            }
        `;
        const trace = runVisualizer(code, tmpDir, 'c++20');
        expect(trace).not.toBeNull();
        expect(trace.nodes.length).toBeGreaterThan(0);
    });
});
