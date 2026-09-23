// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// Records every template instantiation, deduction and constraint check that Sema performs
// for code in the main file, building the causal tree in TraceModel.
#pragma once

#include "clang/Sema/TemplateInstCallback.h"
#include <memory>

namespace metatrace {

std::unique_ptr<clang::TemplateInstantiationCallback> createInstantiationTracer();

} // namespace metatrace
