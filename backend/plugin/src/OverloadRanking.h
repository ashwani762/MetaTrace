// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// Why one viable overload candidate beat another at a call site: a better conversion,
// partial ordering (more specialized), constraints (more constrained), or a non-template.
#pragma once

#include "clang/Sema/Sema.h"
#include "llvm/Support/JSON.h"

namespace metatrace {

llvm::json::Array computeRankings(clang::Sema &S, clang::ASTContext &Ctx);

} // namespace metatrace
