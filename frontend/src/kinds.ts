// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// Human-readable descriptions of Clang's Sema::CodeSynthesisContext kinds.
// The plugin reports these by name (`kindName`) so they stay stable across LLVM versions.

export interface KindInfo {
  tag: string;         // Short badge shown on graph nodes
  explanation: string; // One-line explanation shown in the steps panel
  isSubstitution: boolean; // Deduction/substitution step (can fail silently via SFINAE)
}

const KINDS: Record<string, KindInfo> = {
  TemplateInstantiation: { tag: 'instantiate', explanation: 'Instantiating the definition (class body or function body) for these arguments.', isSubstitution: false },
  DefaultTemplateArgumentInstantiation: { tag: 'default arg', explanation: 'Instantiating a default template argument.', isSubstitution: false },
  DefaultFunctionArgumentInstantiation: { tag: 'default fn arg', explanation: 'Instantiating a default function argument at the call site.', isSubstitution: false },
  ExplicitTemplateArgumentSubstitution: { tag: 'explicit subst', explanation: 'Substituting explicitly specified template arguments into the signature.', isSubstitution: true },
  DeducedTemplateArgumentSubstitution: { tag: 'deduce', explanation: 'Overload candidate: substituting deduced arguments into the signature. A failure here removes the candidate (SFINAE) instead of causing an error.', isSubstitution: true },
  LambdaExpressionSubstitution: { tag: 'lambda', explanation: 'Substituting into a lambda expression.', isSubstitution: true },
  PriorTemplateArgumentSubstitution: { tag: 'prior arg', explanation: 'Substituting earlier template arguments into a later template parameter.', isSubstitution: true },
  DefaultTemplateArgumentChecking: { tag: 'check default', explanation: 'Checking a default template argument.', isSubstitution: true },
  ExceptionSpecEvaluation: { tag: 'noexcept eval', explanation: 'Computing an implicit exception specification.', isSubstitution: false },
  ExceptionSpecInstantiation: { tag: 'noexcept', explanation: 'Instantiating a noexcept specification (done lazily, only when needed).', isSubstitution: false },
  RequirementInstantiation: { tag: 'requires', explanation: 'Checking a requirement of a requires-expression.', isSubstitution: false },
  NestedRequirementConstraintsCheck: { tag: 'nested requires', explanation: 'Checking a nested requirement inside a requires-expression.', isSubstitution: false },
  DeclaringSpecialMember: { tag: 'special member', explanation: 'Implicitly declaring a special member function (ctor, dtor, assignment).', isSubstitution: false },
  DeclaringImplicitEqualityComparison: { tag: 'implicit ==', explanation: 'Implicitly declaring operator== from a defaulted operator<=>.', isSubstitution: false },
  DefiningSynthesizedFunction: { tag: 'synthesize', explanation: 'Defining an implicitly generated (defaulted) function.', isSubstitution: false },
  ConstraintsCheck: { tag: 'concept check', explanation: 'Checking whether the associated constraints (concepts / requires-clause) are satisfied.', isSubstitution: false },
  ConstraintSubstitution: { tag: 'constraint subst', explanation: 'Substituting template arguments into a constraint expression.', isSubstitution: false },
  ConstraintNormalization: { tag: 'normalize', explanation: 'Normalizing constraints to compare which template is more constrained.', isSubstitution: false },
  RequirementParameterInstantiation: { tag: 'requires params', explanation: 'Instantiating the parameters of a requires-expression.', isSubstitution: false },
  ParameterMappingSubstitution: { tag: 'param mapping', explanation: 'Substituting into a constraint parameter mapping.', isSubstitution: false },
  RewritingOperatorAsSpaceship: { tag: '<=> rewrite', explanation: 'Rewriting a comparison in terms of operator<=>.', isSubstitution: false },
  InitializingStructuredBinding: { tag: 'binding', explanation: 'Initializing a structured binding (tuple-like protocol).', isSubstitution: false },
  MarkingClassDllexported: { tag: 'dllexport', explanation: 'Instantiating members of a dllexported class.', isSubstitution: false },
  BuildingBuiltinDumpStructCall: { tag: 'dump struct', explanation: 'Building a __builtin_dump_struct call.', isSubstitution: false },
  BuildingDeductionGuides: { tag: 'CTAD guides', explanation: 'Building implicit deduction guides for class template argument deduction.', isSubstitution: false },
  TypeAliasTemplateInstantiation: { tag: 'alias', explanation: 'Substituting into an alias template (e.g. enable_if_t, conditional_t).', isSubstitution: true },
  PartialOrderingTTP: { tag: 'partial order', explanation: 'Partially ordering template template parameters.', isSubstitution: false },
};

export function describeKind(kindName: string | undefined): KindInfo | null {
  if (!kindName) return null;
  return KINDS[kindName] ?? null;
}

export function isDeduction(kindName: string | undefined): boolean {
  return kindName === 'DeducedTemplateArgumentSubstitution' || kindName === 'ExplicitTemplateArgumentSubstitution';
}

/** Split `Base<A, B<C>>` into base name and top-level arguments. */
export function splitTemplateName(name: string): { base: string; args: string[] } {
  const lt = name.indexOf('<');
  if (lt < 0 || !name.endsWith('>')) return { base: name, args: [] };
  const base = name.slice(0, lt).trim();
  const inner = name.slice(lt + 1, -1);
  const args: string[] = [];
  let depth = 0, cur = '';
  for (const c of inner) {
    if (c === '<' || c === '(' || c === '[') depth++;
    else if (c === '>' || c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return { base, args };
}

/** Kinds that are compiler bookkeeping rather than something the user wrote; hidden in Simple view. */
const NOISE_KINDS = new Set([
  'PriorTemplateArgumentSubstitution',
  'PartialOrderingTTP',
  'ConstraintSubstitution',
  'ConstraintNormalization',
  'ParameterMappingSubstitution',
  'DefaultTemplateArgumentChecking',
  'RequirementParameterInstantiation',
  'BuildingDeductionGuides',
  'ExceptionSpecEvaluation',
  'DeclaringSpecialMember',
  'DeclaringImplicitEqualityComparison',
  'DefiningSynthesizedFunction',
  'MarkingClassDllexported',
]);

export function isNoise(node: { kindName?: string; entityKind?: string; internal?: boolean; failed?: boolean }): boolean {
  if (node.failed) return false; // failures are always worth seeing
  if (node.internal) return true;
  if (node.kindName && NOISE_KINDS.has(node.kindName)) return true;
  // The function-level constraint check duplicates its candidate; the concept checks inside it are the interesting part
  if (node.kindName === 'ConstraintsCheck' && node.entityKind !== 'concept') return true;
  return false;
}

const TYPE_SUGAR: [RegExp, string][] = [
  [/(?:std::)?basic_string<char, std::char_traits<char>, std::allocator<char>\s*>/g, 'std::string'],
  [/std::basic_string<char>/g, 'std::string'],
  [/std::basic_string_view<char, std::char_traits<char>\s*>/g, 'std::string_view'],
  [/std::basic_string_view<char>/g, 'std::string_view'],
  [/std::basic_ostream<char, std::char_traits<char>\s*>/g, 'std::ostream'],
];

/**
 * Makes compiler-printed names readable: collapses std::string spellings and shortens
 * `(lambda at C:\long\temp\path\input.cpp:78:17)` to `lambda@78:17`.
 */
export function prettyName(name: string): string {
  if (!name) return name;
  let out = name.replace(/\(lambda at [^()]*?:(\d+):(\d+)\)/g, 'lambda@$1:$2');
  out = out.replace(/^&("(?:[^"\\]|\\.)*")\[0\]$/, '$1'); // string-literal constant printed as &"text"[0]
  for (const [re, rep] of TYPE_SUGAR) out = out.replace(re, rep);
  return out;
}
