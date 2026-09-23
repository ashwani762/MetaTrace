// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// What templates computed: constexpr values, and the `value` / `type` members of class
// specializations and alias templates (e.g. std::conditional_t<false, long, int> = int).
#pragma once

#include "clang/Sema/Sema.h"
#include "llvm/Support/JSON.h"

namespace metatrace {

// constexpr variables and type aliases declared in the main file, keyed by qualified name
llvm::json::Object collectValues(clang::ASTContext &Ctx);

// Fills g_results for traced class specializations and alias template instantiations
void computeResults(clang::Sema &S, clang::ASTContext &Ctx);

} // namespace metatrace
