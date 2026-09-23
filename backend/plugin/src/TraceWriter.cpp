// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

#include "TraceWriter.h"
#include "TraceModel.h"
#include "llvm/Support/FormatVariadic.h"
#include "llvm/Support/raw_ostream.h"

namespace metatrace {

void writeTrace(const std::string &Path, llvm::json::Object ValuesMap, llvm::json::Array RankingsArr) {
        llvm::json::Array nodesArr;
        for (const auto &n : g_traceNodes) {
            llvm::json::Object nodeObj;
            nodeObj["id"] = n.id;
            nodeObj["parentId"] = n.parentId;
            nodeObj["detail"] = n.detail;
            nodeObj["ts"] = n.ts;
            nodeObj["dur"] = n.dur;
            nodeObj["line"] = n.line;
            nodeObj["col"] = n.col;
            nodeObj["failed"] = n.failed;
            nodeObj["isAlias"] = n.isAlias;
            nodeObj["kind"] = n.kind;
            nodeObj["kindName"] = n.kindName;
            nodeObj["declLine"] = n.declLine;
            nodeObj["entityKind"] = n.entityKind;
            if (n.internal) nodeObj["internal"] = true;
            if (!n.failKind.empty()) nodeObj["failKind"] = n.failKind;
            if (!n.specCandidates.empty()) nodeObj["specCandidates"] = llvm::json::Array(n.specCandidates);
            if (n.constraints.kind() != llvm::json::Value::Null) nodeObj["constraints"] = n.constraints;
            auto R = g_results.find(n.id);
            if (R != g_results.end() && !R->second.empty()) nodeObj["results"] = llvm::json::Object(R->second);
            if (!n.desugaredCode.empty()) {
                nodeObj["desugaredCode"] = n.desugaredCode;
            }
            if (n.failed) {
                nodeObj["failReason"] = n.failReason;
            }
            nodesArr.push_back(std::move(nodeObj));
        }

        llvm::json::Array eventsArr;
        for (const auto &e : g_events) {
            llvm::json::Object evtObj;
            evtObj["type"] = e.type;
            evtObj["nodeId"] = e.nodeId;
            eventsArr.push_back(std::move(evtObj));
        }

        llvm::json::Object MemoObj;
        for (const auto &[name, hits] : g_memoHits) {
            MemoObj[name] = hits;
        }

        llvm::json::Array reusesArr;
        for (const auto &r : g_reuses) {
            llvm::json::Object rObj;
            rObj["parentId"] = r.parentId;
            rObj["detail"] = r.detail;
            rObj["line"] = r.line;
            rObj["col"] = r.col;
            reusesArr.push_back(std::move(rObj));
        }

        llvm::json::Object Root;
        Root["reuses"] = std::move(reusesArr);
        Root["rankings"] = std::move(RankingsArr);
        Root["nodes"] = std::move(nodesArr);
        Root["events"] = std::move(eventsArr);
        Root["values"] = std::move(ValuesMap);
        Root["memoHits"] = std::move(MemoObj);

        std::error_code EC;
        llvm::raw_fd_ostream OS(Path, EC);
        if (!EC) {
            OS << llvm::formatv("{0:2}", llvm::json::Value(std::move(Root)));
        }
}

} // namespace metatrace
