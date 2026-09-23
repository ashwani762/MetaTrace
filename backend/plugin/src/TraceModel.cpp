// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

#include "TraceModel.h"

namespace metatrace {

std::vector<TraceNode> g_traceNodes;
std::vector<TraceEvent> g_events;
int g_nextNodeId = 1;
std::vector<int> g_activeNodes;
std::map<std::string, int> g_memoHits;
std::vector<ReuseEvent> g_reuses;
bool g_postProcessing = false;
std::map<int, llvm::json::Object> g_results;

TraceNode *findNode(int id) {
    if (id <= 0 || id > (int)g_traceNodes.size()) return nullptr;
    TraceNode &node = g_traceNodes[id - 1];
    return node.id == id ? &node : nullptr;
}

} // namespace metatrace
