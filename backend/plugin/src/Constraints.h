// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// Explains C++20 constraint checks: why a candidate's constraints failed, and the full
// constraint tree (&&, ||, concept-ids, atoms) with the result of every node.
#pragma once

#include "clang/AST/ASTConcept.h"
#include "clang/AST/DeclTemplate.h"
#include "llvm/Support/JSON.h"
#include <string>

namespace metatrace {

using namespace clang;

// Describes why the associated constraints (requires-clause / concepts) were not satisfied
std::string describeUnsatisfied(const ConstraintSatisfaction &Sat, const ASTContext &Ctx);

// Constraint tree of a template, annotated with true / false / skipped for each node
llvm::json::Object buildConstraintTree(const SourceManager &SM, const ASTContext &Ctx,
                                       const ConstraintSatisfaction &Sat, const TemplateDecl *TD);

} // namespace metatrace
