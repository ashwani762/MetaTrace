// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// End-to-end check of a packaged MetaTrace binary: start it, trace a program that uses the
// standard library, and verify the trace is complete. Used by CI on every platform.
//
// Usage: node scripts/smoke_test.js <path-to-MetaTrace-binary> [port]

const { spawn } = require('child_process');

const binary = process.argv[2];
const port = Number(process.argv[3] || 8787);
if (!binary) {
    console.error('Usage: node scripts/smoke_test.js <path-to-MetaTrace-binary> [port]');
    process.exit(2);
}

const CODE = `
#include <type_traits>
#include <vector>
#include <string>

template <int N> struct Fib { static constexpr long value = Fib<N - 1>::value + Fib<N - 2>::value; };
template <> struct Fib<1> { static constexpr long value = 1; };
template <> struct Fib<0> { static constexpr long value = 0; };

template <typename T> std::enable_if_t<std::is_integral_v<T>, T> twice(T v) { return v * 2; }
template <typename T> std::enable_if_t<std::is_floating_point_v<T>, T> twice(T v) { return v + v; }

int main() {
    constexpr long f = Fib<10>::value;
    std::vector<std::string> names{"a", "b"};
    return static_cast<int>(f + twice(1) + twice(1.5) + names.size());
}
`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    const server = spawn(binary, ['--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    server.stdout.on('data', d => { log += d; });
    server.stderr.on('data', d => { log += d; });
    const stop = () => { try { server.kill(); } catch { /* already exited */ } };

    try {
        // Wait for the server (first start extracts the Visualizer and its headers)
        let up = false;
        for (let i = 0; i < 60 && !up; i++) {
            try { up = (await fetch(`http://127.0.0.1:${port}/`)).ok; } catch { await sleep(1000); }
        }
        if (!up) throw new Error('server did not start');

        const res = await fetch(`http://127.0.0.1:${port}/api/compile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: CODE, standard: 'c++17' })
        });
        const data = await res.json();
        const nodes = data.nodes || [];
        const errors = (String(data.stderr || '').match(/error:.*/g) || []);

        const checks = [
            ['page is served', (await (await fetch(`http://127.0.0.1:${port}/`)).text()).includes('<div id="app">')],
            ['trace has nodes', nodes.length > 0],
            ['standard headers compile without errors', errors.length === 0],
            ['recursion is traced (Fib<10>)', nodes.some(n => n.detail === 'Fib<10>')],
            ['base case is reported (Fib<0>)', nodes.some(n => n.kindName === 'ExplicitSpecialization' && n.detail === 'Fib<0>')],
            ['SFINAE rejection is reported', nodes.some(n => n.failKind === 'sfinae')],
            ['constexpr values are evaluated', data.values && data.values['Fib<10>::value'] === '55'],
        ];

        let failed = 0;
        for (const [name, ok] of checks) {
            console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
            if (!ok) failed++;
        }
        if (errors.length) console.log('Compiler errors:\n' + errors.slice(0, 10).join('\n'));
        if (failed) throw new Error(`${failed} smoke check(s) failed`);
        console.log(`Smoke test passed (${nodes.length} nodes).`);
    } catch (e) {
        console.error(`Smoke test failed: ${e.message}\n--- server output ---\n${log}`);
        process.exitCode = 1;
    } finally {
        stop();
    }
}

main();
