#include "clang/AST/ASTConsumer.h"
#include "clang/AST/RecursiveASTVisitor.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/FrontendAction.h"
#include "clang/Sema/Sema.h"
#include "clang/Sema/SemaConsumer.h"
#include "clang/Sema/TemplateInstCallback.h"
#include "clang/Tooling/Tooling.h"
#include "clang/Tooling/CommonOptionsParser.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Support/JSON.h"
#include <vector>
#include <string>
#include <chrono>

using namespace clang;
using namespace clang::tooling;
using namespace std;

struct TraceNode {
    int id;
    int parentId;
    std::string detail;
    long long ts;
    long long dur;
    unsigned int line;
    unsigned int col;
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
        if (Inst.Entity) {
            if (auto *ND = dyn_cast<NamedDecl>(Inst.Entity)) {
                if (isa<VarDecl>(ND) || isa<VarTemplateSpecializationDecl>(ND)) return;
            }
        }

        int id = g_nextNodeId++;
        int parentId = instStack.empty() ? 0 : instStack.back().id;
        instStack.push_back({id, getTimestamp()});
        
        std::string detail = "Unknown";
        if (Inst.Entity) {
            if (auto *ND = dyn_cast<NamedDecl>(Inst.Entity)) {
                std::string Name;
                llvm::raw_string_ostream OS(Name);
                ND->getNameForDiagnostic(OS, ND->getASTContext().getPrintingPolicy(), true);
                detail = OS.str();
            }
        }
        
        unsigned int line = 0, col = 0;
        if (Inst.PointOfInstantiation.isValid()) {
            line = SM.getSpellingLineNumber(Inst.PointOfInstantiation);
            col = SM.getSpellingColumnNumber(Inst.PointOfInstantiation);
        }

        g_traceNodes.push_back({id, parentId, detail, getTimestamp(), 0, line, col});
        g_events.push_back({"Enter", id});
    }

    void atTemplateEnd(const Sema &TheSema, const Sema::CodeSynthesisContext &Inst) override {
        SourceManager &SM = TheSema.getSourceManager();
        if (!SM.isInMainFile(Inst.PointOfInstantiation)) {
            return;
        }
        if (Inst.Entity) {
            if (auto *ND = dyn_cast<NamedDecl>(Inst.Entity)) {
                if (isa<VarDecl>(ND) || isa<VarTemplateSpecializationDecl>(ND)) return;
            }
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

    bool shouldVisitTemplateInstantiations() const { return true; }
    bool shouldVisitImplicitCode() const { return true; }

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
        SourceManager &SM = Context.getSourceManager();
        for (auto *D : Context.getTranslationUnitDecl()->decls()) {
            if (SM.isInMainFile(D->getLocation())) {
                Visitor.TraverseDecl(D);
            }
        }

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

class VisualizerAction : public ASTFrontendAction {
public:
    std::unique_ptr<ASTConsumer> CreateASTConsumer(CompilerInstance &CI, StringRef file) override {
        return std::make_unique<VisualizerASTConsumer>(CI);
    }
};

static llvm::cl::OptionCategory MyToolCategory("my-tool options");

int main(int argc, const char **argv) {
    auto ExpectedParser = CommonOptionsParser::create(argc, argv, MyToolCategory);
    if (!ExpectedParser) {
        llvm::errs() << ExpectedParser.takeError();
        return 1;
    }
    CommonOptionsParser& OptionsParser = ExpectedParser.get();
    ClangTool Tool(OptionsParser.getCompilations(), OptionsParser.getSourcePathList());
    return Tool.run(newFrontendActionFactory<VisualizerAction>().get());
}
