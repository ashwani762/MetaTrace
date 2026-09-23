// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// Serializes the recorded trace to trace_custom.json (format documented in docs/GUIDE.md).
#pragma once

#include "llvm/Support/JSON.h"
#include <string>

namespace metatrace {

void writeTrace(const std::string &Path, llvm::json::Object ValuesMap, llvm::json::Array RankingsArr);

} // namespace metatrace
