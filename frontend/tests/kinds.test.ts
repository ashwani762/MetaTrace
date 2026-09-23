// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// Unit tests for the pure helpers that turn compiler output into readable names.
// Run with: npm test (uses Node's built-in test runner and TypeScript type stripping)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTemplateName, prettyName, isNoise, isDeduction, describeKind } from '../src/kinds.ts';

test('splitTemplateName splits only top-level arguments', () => {
  assert.deepEqual(splitTemplateName('Fib<5>'), { base: 'Fib', args: ['5'] });
  assert.deepEqual(splitTemplateName('std::pair<int, std::map<int, char>>'), { base: 'std::pair', args: ['int', 'std::map<int, char>'] });
  assert.deepEqual(splitTemplateName('f<void (int, char), 3>'), { base: 'f', args: ['void (int, char)', '3'] });
  assert.deepEqual(splitTemplateName('plain'), { base: 'plain', args: [] });
});

test('prettyName shortens lambdas and std::string spellings', () => {
  assert.equal(prettyName('for_each<(lambda at C:\\Temp\\x\\input.cpp:78:17)>'), 'for_each<lambda@78:17>');
  assert.equal(prettyName('std::vector<std::basic_string<char, std::char_traits<char>, std::allocator<char>>>'), 'std::vector<std::string>');
  assert.equal(prettyName('std::basic_string_view<char>'), 'std::string_view');
  assert.equal(prettyName('&"value"[0]'), '"value"');
});

test('isNoise hides bookkeeping but never failures', () => {
  assert.equal(isNoise({ kindName: 'ConstraintNormalization' }), true);
  assert.equal(isNoise({ kindName: 'TemplateInstantiation', internal: true }), true);
  assert.equal(isNoise({ kindName: 'ConstraintsCheck', entityKind: 'function' }), true);
  assert.equal(isNoise({ kindName: 'ConstraintsCheck', entityKind: 'concept' }), false);
  assert.equal(isNoise({ kindName: 'ConstraintNormalization', failed: true }), false);
  assert.equal(isNoise({ kindName: 'TemplateInstantiation' }), false);
});

test('kind helpers', () => {
  assert.equal(isDeduction('DeducedTemplateArgumentSubstitution'), true);
  assert.equal(isDeduction('TemplateInstantiation'), false);
  assert.equal(describeKind('TypeAliasTemplateInstantiation')?.tag, 'alias');
  assert.equal(describeKind('NotAKind'), null);
});
