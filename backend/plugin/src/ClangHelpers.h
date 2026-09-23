// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// Small helpers for naming and classifying what Sema is doing.
#pragma once

#include "clang/Basic/SourceManager.h"
#include "clang/Sema/Sema.h"
#include <string>

namespace metatrace {

using namespace clang;

// class | function | alias | concept | variable | other
std::string entityKindOf(const Decl *D);
bool isExplicitSpecialization(const Decl *D);
// Line in the main file, or 0 when the location is elsewhere (e.g. a system header)
unsigned int mainFileLine(const SourceManager &SM, SourceLocation Loc);

const char *kindToString(Sema::CodeSynthesisContext::SynthesisKind K);
// Substitution contexts where a trapped error means the candidate is discarded (SFINAE)
bool isSubstitutionKind(Sema::CodeSynthesisContext::SynthesisKind K);
bool isDeductionKind(Sema::CodeSynthesisContext::SynthesisKind K);

std::string getEntityName(const Decl *Entity);
// Static data members (e.g. Fib<N>::value) are not shown as nodes of their own, but
// whatever their initializer instantiates is caused by the owning specialization.
bool isStaticMemberOfSpecialization(const Decl *D);
bool isFilteredVarDecl(const Decl *D);

} // namespace metatrace
