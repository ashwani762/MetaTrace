// Copyright (c) 2024 MetaTrace Contributors
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

#include "clang/AST/ASTConsumer.h"
#include "clang/AST/RecursiveASTVisitor.h"
#include "clang/AST/TemplateBase.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/FrontendAction.h"
#include "clang/Frontend/FrontendPluginRegistry.h"
#include "clang/Sema/Sema.h"
#include "clang/Sema/SemaConsumer.h"
#include "clang/Sema/TemplateInstCallback.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Support/JSON.h"
#include <fstream>
#include <vector>
#include <string>
#include <chrono>

using namespace clang;
using namespace std;

struct TraceNode {
    int id;
    int parentId;
    std::string detail;
    long long ts;
    long long dur;
    int kind;
};

struct TraceEvent {
    std::string type;
    int nodeId;
};

static std::vector<TraceNode> g_traceNodes;
static std::vector<TraceEvent> g_events;
static int g_nextNodeId = 1;

class VisualizerTemplateCallback : public TemplateInstantiationCallback {
    struct StackEntry {
        int id;
        long long start_ts;
    };
    std::vector<StackEntry> instStack;
    
    long long getTimestamp() {
        return std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
    }

public:
    void initialize(const Sema &TheSema) override {}
    void finalize(const Sema &TheSema) override {}

    void atTemplateBegin(const Sema &TheSema, const Sema::CodeSynthesisContext &Inst) override {
        SourceManager &SM = TheSema.getSourceManager();
        if (!SM.isInMainFile(Inst.PointOfInstantiation)) {
            return;
        }

        int id = g_nextNodeId++;
        int parentId = instStack.empty() ? 0 : instStack.back().id;
        instStack.push_back({id, getTimestamp()});
        
        std::string detail = "Unknown";
        if (Inst.Entity) {
            if (auto *ND = dyn_cast<NamedDecl>(Inst.Entity)) {
                std::string nameStr;
                llvm::raw_string_ostream OS(nameStr);
                PrintingPolicy Policy(TheSema.getLangOpts());
                Policy.SuppressScope = false;
                
                if (auto *FD = dyn_cast<FunctionDecl>(ND)) {
                    detail = FD->getQualifiedNameAsString();
                    if (const TemplateArgumentList *Args = FD->getTemplateSpecializationArgs()) {
                        std::string argStr;
                        llvm::raw_string_ostream ArgOS(argStr);
                        printTemplateArgumentList(ArgOS, Args->asArray(), Policy);
                        detail += argStr;
                    }
                } else if (auto *CTSD = dyn_cast<ClassTemplateSpecializationDecl>(ND)) {
                    CTSD->printQualifiedName(OS, Policy);
                    detail = nameStr;
                } else {
                    ND->printQualifiedName(OS, Policy);
                    detail = nameStr;
                }
            }
        }
        
        g_traceNodes.push_back({id, parentId, detail, getTimestamp(), 0, (int)Inst.Kind});
        g_events.push_back({"Enter", id});
    }

    void atTemplateEnd(const Sema &TheSema, const Sema::CodeSynthesisContext &Inst) override {
        SourceManager &SM = TheSema.getSourceManager();
        if (!SM.isInMainFile(Inst.PointOfInstantiation)) {
            return;
        }

        if (!instStack.empty()) {
            auto top = instStack.back();
            instStack.pop_back();
            for (auto &node : g_traceNodes) {
                if (node.id == top.id) {
                    node.dur = getTimestamp() - top.start_ts;
                    break;
                }
            }
            g_events.push_back({"Leave", top.id});
        }
    }
};

class EvaluatedValueVisitor : public RecursiveASTVisitor<EvaluatedValueVisitor> {
    ASTContext *Context;
    llvm::json::Object &ValuesMap;
public:
    explicit EvaluatedValueVisitor(ASTContext *Context, llvm::json::Object &ValuesMap)
        : Context(Context), ValuesMap(ValuesMap) {}

    bool VisitVarDecl(VarDecl *VD) {
        if (VD->isConstexpr() && VD->hasInit()) {
            APValue Result;
            if (VD->evaluateValue()) {
                if (auto *Val = VD->getEvaluatedValue()) {
                    std::string valStr;
                    llvm::raw_string_ostream OS(valStr);
                    Val->printPretty(OS, *Context, VD->getType());
                    ValuesMap[VD->getQualifiedNameAsString()] = valStr;
                }
            }
        }
        return true;
    }
    bool VisitTypeAliasDecl(TypeAliasDecl *TD) {
        std::string typeStr = TD->getUnderlyingType().getAsString();
        ValuesMap[TD->getQualifiedNameAsString()] = typeStr;
        return true;
    }

    bool VisitTypedefDecl(TypedefDecl *TD) {
        std::string typeStr = TD->getUnderlyingType().getAsString();
        ValuesMap[TD->getQualifiedNameAsString()] = typeStr;
        return true;
    }
};

class VisualizerASTConsumer : public SemaConsumer {
    CompilerInstance &Instance;
public:
    explicit VisualizerASTConsumer(CompilerInstance &Instance) : Instance(Instance) {}

    void InitializeSema(Sema &S) override {
        S.TemplateInstCallbacks.push_back(std::make_unique<VisualizerTemplateCallback>());
    }

    void HandleTranslationUnit(ASTContext &Context) override {
        llvm::json::Object ValuesMap;
        EvaluatedValueVisitor Visitor(&Context, ValuesMap);
        Visitor.TraverseDecl(Context.getTranslationUnitDecl());

        llvm::json::Array nodesArr;
        for (const auto &n : g_traceNodes) {
            llvm::json::Object nodeObj;
            nodeObj["id"] = n.id;
            nodeObj["parentId"] = n.parentId;
            nodeObj["detail"] = n.detail;
            nodeObj["ts"] = n.ts;
            nodeObj["dur"] = n.dur;
            nodeObj["kind"] = n.kind;
            nodesArr.push_back(std::move(nodeObj));
        }

        llvm::json::Array eventsArr;
        for (const auto &e : g_events) {
            llvm::json::Object evtObj;
            evtObj["type"] = e.type;
            evtObj["nodeId"] = e.nodeId;
            eventsArr.push_back(std::move(evtObj));
        }

        llvm::json::Object Root;
        Root["nodes"] = std::move(nodesArr);
        Root["events"] = std::move(eventsArr);
        Root["values"] = std::move(ValuesMap);

        std::error_code EC;
        llvm::raw_fd_ostream OS("trace_custom.json", EC);
        if (!EC) {
            OS << llvm::formatv("{0:2}", llvm::json::Value(std::move(Root)));
        }
    }
};

class VisualizerPluginAction : public PluginASTAction {
protected:
    std::unique_ptr<ASTConsumer> CreateASTConsumer(CompilerInstance &CI, llvm::StringRef) override {
        return std::make_unique<VisualizerASTConsumer>(CI);
    }

    bool ParseArgs(const CompilerInstance &CI, const std::vector<std::string> &args) override {
        return true;
    }
};

static FrontendPluginRegistry::Add<VisualizerPluginAction>
X("visualizer-plugin", "Visualizer Plugin to extract template instantiations and constexpr values");
