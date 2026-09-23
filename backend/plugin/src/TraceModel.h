// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// The trace being recorded: instantiation nodes, enter/leave events and cache reuses.
#pragma once

#include "clang/AST/DeclTemplate.h"
#include "clang/Basic/SourceLocation.h"
#include "llvm/Support/JSON.h"
#include <map>
#include <string>
#include <vector>

namespace metatrace {

using namespace clang;

struct TraceNode {
    int id;
    int parentId;
    std::string detail;
    long long ts;
    long long dur;
    unsigned int line;
    unsigned int col;
    bool failed;
    std::string failReason;
    bool isAlias;
    int kind;
    std::string desugaredCode;
    std::string kindName;
    unsigned int declLine; // Line of the template being instantiated/deduced (0 if outside main file)
    std::string entityKind; // class | function | alias | concept | variable | other
    std::string failKind;   // sfinae | constraints | invalid (empty when not failed)
    bool internal = false;  // Compiler bookkeeping on dependent types (e.g. checking a partial specialization)
    llvm::json::Array specCandidates; // For class specializations: which (partial) specializations were considered
    llvm::json::Value constraints = nullptr; // Constraint tree of a constrained candidate
    // Kept for analysis after parsing (not serialized)
    Decl *entity = nullptr;
    SourceLocation poi;
    std::vector<TemplateArgument> args;        // Deduced / alias template arguments
    FunctionDecl *deducedSpec = nullptr;       // Specialization produced by successful deduction
};

// A request for a specialization that already existed, so nothing was instantiated
struct ReuseEvent {
    int parentId;
    std::string detail;
    unsigned int line;
    unsigned int col;
};

struct TraceEvent {
    std::string type;
    int nodeId;
};

extern std::vector<TraceNode> g_traceNodes;
extern std::vector<TraceEvent> g_events;
extern int g_nextNodeId;
extern std::vector<int> g_activeNodes;
// How often an already-instantiated specialization was looked up again (Memoization contexts)
extern std::map<std::string, int> g_memoHits;
extern std::vector<ReuseEvent> g_reuses;
// Set while MetaTrace itself queries Sema after parsing, so that work is not traced
extern bool g_postProcessing;
// Computed members / alias results per node id (e.g. {"value": "true", "type": "int"})
extern std::map<int, llvm::json::Object> g_results;

// Node ids are handed out sequentially starting at 1, so the id is also the index
TraceNode *findNode(int id);

} // namespace metatrace
