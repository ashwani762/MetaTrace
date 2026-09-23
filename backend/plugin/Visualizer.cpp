// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

#include "clang/AST/ASTConcept.h"
#include "clang/AST/ASTConsumer.h"
#include "clang/AST/DeclTemplate.h"
#include "clang/AST/ExprConcepts.h"
#include "clang/AST/RecursiveASTVisitor.h"
#include "clang/Basic/PartialDiagnostic.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/FrontendAction.h"
#include "clang/Sema/Sema.h"
#include "clang/Sema/SemaConsumer.h"
#include "clang/Sema/TemplateDeduction.h"
#include "clang/Sema/TemplateInstCallback.h"
#include "clang/Tooling/ArgumentsAdjusters.h"
#include "clang/Tooling/Tooling.h"
#include "clang/Tooling/CommonOptionsParser.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/Path.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Support/JSON.h"
#include <vector>
#include <map>
#include <set>
#include <string>
#include <iostream>
#include <fstream>
#include "version.h"
#include <chrono>
#include <cstdlib>


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

static std::vector<TraceNode> g_traceNodes;
static std::vector<TraceEvent> g_events;
static int g_nextNodeId = 1;
static std::vector<int> g_activeNodes;
// How often an already-instantiated specialization was looked up again (Memoization contexts)
static std::map<std::string, int> g_memoHits;
static std::vector<ReuseEvent> g_reuses;

static std::string entityKindOf(const Decl *D) {
    if (!D) return "other";
    if (isa<ConceptDecl>(D)) return "concept";
    if (isa<TypeAliasTemplateDecl>(D) || isa<TypeAliasDecl>(D) || isa<TypedefNameDecl>(D)) return "alias";
    if (isa<FunctionTemplateDecl>(D) || isa<FunctionDecl>(D)) return "function";
    if (isa<ClassTemplateDecl>(D) || isa<CXXRecordDecl>(D)) return "class";
    if (isa<VarTemplateDecl>(D) || isa<VarDecl>(D)) return "variable";
    return "other";
}

static bool isExplicitSpecialization(const Decl *D) {
    if (auto *CTSD = dyn_cast_or_null<ClassTemplateSpecializationDecl>(D))
        return CTSD->getSpecializationKind() == TSK_ExplicitSpecialization;
    if (auto *VTSD = dyn_cast_or_null<VarTemplateSpecializationDecl>(D))
        return VTSD->getSpecializationKind() == TSK_ExplicitSpecialization;
    if (auto *FD = dyn_cast_or_null<FunctionDecl>(D))
        return FD->getTemplateSpecializationKind() == TSK_ExplicitSpecialization;
    return false;
}

static unsigned int mainFileLine(const SourceManager &SM, SourceLocation Loc) {
    if (Loc.isInvalid()) return 0;
    SourceLocation Exp = SM.getExpansionLoc(Loc);
    return SM.isInMainFile(Exp) ? SM.getExpansionLineNumber(Exp) : 0;
}

// Describes why the associated constraints (requires-clause / concepts) were not satisfied
static std::string describeUnsatisfied(const ConstraintSatisfaction &Sat, const ASTContext &Ctx) {
    std::string Out;
    llvm::raw_string_ostream OS(Out);
    PrintingPolicy Policy = Ctx.getPrintingPolicy();
    bool First = true;
    for (const auto &Record : Sat.Details) {
        OS << (First ? "" : "; ");
        First = false;
        if (auto *E = Record.dyn_cast<const Expr *>()) {
            if (auto *RE = dyn_cast<RequiresExpr>(E->IgnoreParenImpCasts())) {
                // Name the individual requirements that failed instead of printing the whole
                // requires-expression (failed expressions print as <<error-expression>>)
                OS << "requires-expression not satisfied:";
                for (const concepts::Requirement *R : RE->getRequirements()) {
                    if (R->isDependent() || R->isSatisfied()) continue;
                    if (auto *ER = dyn_cast<concepts::ExprRequirement>(R)) {
                        if (ER->isExprSubstitutionFailure()) {
                            auto *D = ER->getExprSubstitutionDiagnostic();
                            OS << " '" << D->SubstitutedEntity << "' is invalid (" << D->DiagMessage << ");";
                        } else {
                            OS << " '";
                            ER->getExpr()->printPretty(OS, nullptr, Policy);
                            OS << "' does not meet its return-type requirement;";
                        }
                    } else if (auto *TR = dyn_cast<concepts::TypeRequirement>(R)) {
                        if (TR->isSubstitutionFailure()) {
                            auto *D = TR->getSubstitutionDiagnostic();
                            OS << " type '" << D->SubstitutedEntity << "' does not exist (" << D->DiagMessage << ");";
                        }
                    } else if (auto *NR = dyn_cast<concepts::NestedRequirement>(R)) {
                        if (NR->hasInvalidConstraint()) {
                            OS << " nested requirement '" << const_cast<concepts::NestedRequirement *>(NR)->getInvalidConstraintEntity() << "' is invalid;";
                        } else {
                            OS << " nested requirement '";
                            NR->getConstraintExpr()->printPretty(OS, nullptr, Policy);
                            OS << "' is false;";
                        }
                    }
                }
            } else {
                OS << "'";
                E->printPretty(OS, nullptr, Policy);
                OS << "' evaluated to false";
            }
        } else if (auto *CR = Record.dyn_cast<const ConceptReference *>()) {
            OS << "concept '";
            CR->print(OS, Policy);
            OS << "' is not satisfied";
        } else if (auto *Diag = Record.dyn_cast<const ConstraintSubstitutionDiagnostic *>()) {
            OS << "substitution failed: " << Diag->second;
        }
    }
    return OS.str();
}

static const char *kindToString(Sema::CodeSynthesisContext::SynthesisKind K) {
    using CSC = Sema::CodeSynthesisContext;
    switch (K) {
    case CSC::TemplateInstantiation: return "TemplateInstantiation";
    case CSC::DefaultTemplateArgumentInstantiation: return "DefaultTemplateArgumentInstantiation";
    case CSC::DefaultFunctionArgumentInstantiation: return "DefaultFunctionArgumentInstantiation";
    case CSC::ExplicitTemplateArgumentSubstitution: return "ExplicitTemplateArgumentSubstitution";
    case CSC::DeducedTemplateArgumentSubstitution: return "DeducedTemplateArgumentSubstitution";
    case CSC::LambdaExpressionSubstitution: return "LambdaExpressionSubstitution";
    case CSC::PriorTemplateArgumentSubstitution: return "PriorTemplateArgumentSubstitution";
    case CSC::DefaultTemplateArgumentChecking: return "DefaultTemplateArgumentChecking";
    case CSC::ExceptionSpecEvaluation: return "ExceptionSpecEvaluation";
    case CSC::ExceptionSpecInstantiation: return "ExceptionSpecInstantiation";
    case CSC::RequirementInstantiation: return "RequirementInstantiation";
    case CSC::NestedRequirementConstraintsCheck: return "NestedRequirementConstraintsCheck";
    case CSC::DeclaringSpecialMember: return "DeclaringSpecialMember";
    case CSC::DeclaringImplicitEqualityComparison: return "DeclaringImplicitEqualityComparison";
    case CSC::DefiningSynthesizedFunction: return "DefiningSynthesizedFunction";
    case CSC::ConstraintsCheck: return "ConstraintsCheck";
    case CSC::ConstraintSubstitution: return "ConstraintSubstitution";
    case CSC::ConstraintNormalization: return "ConstraintNormalization";
    case CSC::RequirementParameterInstantiation: return "RequirementParameterInstantiation";
    case CSC::ParameterMappingSubstitution: return "ParameterMappingSubstitution";
    case CSC::RewritingOperatorAsSpaceship: return "RewritingOperatorAsSpaceship";
    case CSC::InitializingStructuredBinding: return "InitializingStructuredBinding";
    case CSC::MarkingClassDllexported: return "MarkingClassDllexported";
    case CSC::BuildingBuiltinDumpStructCall: return "BuildingBuiltinDumpStructCall";
    case CSC::Memoization: return "Memoization";
    case CSC::BuildingDeductionGuides: return "BuildingDeductionGuides";
    case CSC::TypeAliasTemplateInstantiation: return "TypeAliasTemplateInstantiation";
    case CSC::PartialOrderingTTP: return "PartialOrderingTTP";
    }
    return "Unknown";
}

// Substitution contexts where a trapped error means the candidate is discarded (SFINAE)
static bool isSubstitutionKind(Sema::CodeSynthesisContext::SynthesisKind K) {
    using CSC = Sema::CodeSynthesisContext;
    return K == CSC::ExplicitTemplateArgumentSubstitution ||
           K == CSC::DeducedTemplateArgumentSubstitution ||
           K == CSC::DefaultTemplateArgumentChecking ||
           K == CSC::PriorTemplateArgumentSubstitution ||
           K == CSC::TypeAliasTemplateInstantiation;
}

static std::string getEntityName(const Decl *Entity) {
    if (auto *ND = dyn_cast_or_null<NamedDecl>(Entity)) {
        std::string Name;
        llvm::raw_string_ostream OS(Name);
        ND->getNameForDiagnostic(OS, ND->getASTContext().getPrintingPolicy(), true);
        return OS.str();
    }
    return "Unknown";
}

// Static data members (e.g. Fib<N>::value) are not shown as nodes of their own, but
// whatever their initializer instantiates is caused by the owning specialization.
static bool isStaticMemberOfSpecialization(const Decl *D) {
    auto *VD = dyn_cast_or_null<VarDecl>(D);
    return VD && !isa<VarTemplateSpecializationDecl>(VD) && VD->isStaticDataMember();
}

static bool isFilteredVarDecl(const Decl *D) {
    return isa_and_nonnull<VarDecl>(D) && !isa<VarTemplateSpecializationDecl>(D);
}

class VisualizerTemplateCallback : public TemplateInstantiationCallback {
    struct StackEntry {
        int id;
        long long start_ts;
        bool passthrough; // Not a node itself; nested work is attributed to `id`
    };
    std::vector<StackEntry> instStack;
    // Most recent node created for a declaration, used to re-parent work that happens
    // inside passthrough contexts.
    std::map<const Decl *, int> declToNode;
    std::set<std::pair<int, std::string>> explicitSeen;

    long long getTimestamp() {
        return std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
    }

    // Node ids are handed out sequentially starting at 1, so the id is also the index
    TraceNode *findNode(int id) {
        if (id <= 0 || id > (int)g_traceNodes.size()) return nullptr;
        TraceNode &node = g_traceNodes[id - 1];
        return node.id == id ? &node : nullptr;
    }

    int currentParent() const { return instStack.empty() ? 0 : instStack.back().id; }

public:
    void initialize(const Sema &TheSema) override {}
    void finalize(const Sema &TheSema) override {}
    void atTemplateBegin(const Sema &TheSema, const Sema::CodeSynthesisContext &Inst) override {
        SourceManager &SM = TheSema.getSourceManager();
        if (!SM.isInMainFile(Inst.PointOfInstantiation)) {
            return;
        }

        if (Inst.Kind == Sema::CodeSynthesisContext::Memoization) {
            std::string name = getEntityName(Inst.Entity);
            g_memoHits[name]++;
            int parent = currentParent();
            unsigned int line = SM.getSpellingLineNumber(Inst.PointOfInstantiation);
            unsigned int col = SM.getSpellingColumnNumber(Inst.PointOfInstantiation);
            if (isExplicitSpecialization(Inst.Entity)) {
                // Explicit specializations (base cases like Fact<0>) are never instantiated, so
                // Clang only reports a lookup. Surface them as leaf nodes so recursion visibly ends.
                if (explicitSeen.insert({parent, name}).second) {
                    int id = g_nextNodeId++;
                    TraceNode node{id, parent, name, getTimestamp(), 0, line, col, false, "", false,
                                   (int)Inst.Kind, "", "ExplicitSpecialization",
                                   mainFileLine(SM, Inst.Entity->getLocation())};
                    node.entityKind = entityKindOf(Inst.Entity);
                    g_traceNodes.push_back(std::move(node));
                    g_events.push_back({"Enter", id});
                    g_events.push_back({"Leave", id});
                }
            } else {
                g_reuses.push_back({parent, name, line, col});
            }
            return;
        }

        if (isStaticMemberOfSpecialization(Inst.Entity)) {
            int owner = currentParent();
            auto It = declToNode.find(cast<Decl>(Inst.Entity->getDeclContext()));
            if (It != declToNode.end()) owner = It->second;
            instStack.push_back({owner, getTimestamp(), true});
            return;
        }
        if (isFilteredVarDecl(Inst.Entity)) return;

        bool isAlias = isa_and_nonnull<TypeAliasTemplateDecl>(Inst.Entity) ||
                       isa_and_nonnull<TypeAliasDecl>(Inst.Entity);

        int id = g_nextNodeId++;
        int parentId = currentParent();
        instStack.push_back({id, getTimestamp(), false});
        g_activeNodes.push_back(id);
        if (Inst.Entity) declToNode[Inst.Entity] = id;

        std::string detail = getEntityName(Inst.Entity);
        // During argument deduction, show the arguments being tried so that
        // competing overload candidates are distinguishable.
        if ((Inst.Kind == Sema::CodeSynthesisContext::DeducedTemplateArgumentSubstitution ||
             Inst.Kind == Sema::CodeSynthesisContext::ExplicitTemplateArgumentSubstitution ||
             (Inst.Kind == Sema::CodeSynthesisContext::ConstraintsCheck && isa_and_nonnull<ConceptDecl>(Inst.Entity))) &&
            Inst.Entity && !Inst.template_arguments().empty()) {
            std::string Args;
            llvm::raw_string_ostream OS(Args);
            printTemplateArgumentList(OS, Inst.template_arguments(),
                                      Inst.Entity->getASTContext().getPrintingPolicy());
            detail += OS.str();
        }

        unsigned int line = 0, col = 0;
        if (Inst.PointOfInstantiation.isValid()) {
            line = SM.getSpellingLineNumber(Inst.PointOfInstantiation);
            col = SM.getSpellingColumnNumber(Inst.PointOfInstantiation);
        }

        unsigned int declLine = 0;
        if (Inst.Entity && Inst.Entity->getLocation().isValid()) {
            SourceLocation DeclLoc = SM.getExpansionLoc(Inst.Entity->getLocation());
            if (SM.isInMainFile(DeclLoc)) declLine = SM.getExpansionLineNumber(DeclLoc);
        }

        TraceNode node{id, parentId, detail, getTimestamp(), 0, line, col, false, "", isAlias,
                       (int)Inst.Kind, "", kindToString(Inst.Kind), declLine};
        node.entityKind = entityKindOf(Inst.Entity);
        // Substitution into dependent placeholders happens when Clang checks a partial
        // specialization's declaration; it is not caused by any use in the program.
        node.internal = detail.find("type-parameter-") != std::string::npos;
        g_traceNodes.push_back(std::move(node));
        g_events.push_back({"Enter", id});
    }

    void atTemplateEnd(const Sema &TheSema, const Sema::CodeSynthesisContext &Inst) override {
        SourceManager &SM = TheSema.getSourceManager();
        if (!SM.isInMainFile(Inst.PointOfInstantiation)) {
            return;
        }
        if (Inst.Kind == Sema::CodeSynthesisContext::Memoization) return;
        if (isFilteredVarDecl(Inst.Entity) && !isStaticMemberOfSpecialization(Inst.Entity)) return;
        if (instStack.empty()) return;

        auto top = instStack.back();
        instStack.pop_back();

        if (top.passthrough) {
            // Charge the time spent in the member initializer to the owning specialization
            if (TraceNode *owner = findNode(top.id)) owner->dur += getTimestamp() - top.start_ts;
            return;
        }
        if (!g_activeNodes.empty()) g_activeNodes.pop_back();

        bool isInvalid = false;
        std::string failReason;
        std::string codeStr = "";
        if (auto *D = dyn_cast_or_null<Decl>(Inst.Entity)) {
            if (D->isInvalidDecl()) {
                isInvalid = true;
                failReason = "Invalid declaration";
            }
            if (Inst.Kind == Sema::CodeSynthesisContext::TemplateInstantiation) {
                llvm::raw_string_ostream OS(codeStr);
                D->print(OS, D->getASTContext().getPrintingPolicy());
            }
        }

        // An error trapped while substituting is a SFINAE rejection: the candidate is
        // silently discarded. Recover the suppressed diagnostic so the UI can show why.
        std::string failKind = isInvalid ? "invalid" : "";
        if (isSubstitutionKind(Inst.Kind)) {
            if (auto *Trap = TheSema.getSFINAEContext()) {
                if (Trap->hasErrorOccurred()) {
                    isInvalid = true;
                    failKind = "sfinae";
                    failReason = "Substitution failure (SFINAE)";
                    auto *Info = Trap->getDeductionInfo();
                    if (Info && Info->hasSFINAEDiagnostic()) {
                        const PartialDiagnosticAt &PDA = Info->peekSFINAEDiagnostic();
                        llvm::SmallString<256> Msg;
                        PDA.second.EmitToString(TheSema.getDiagnostics(), Msg);
                        failReason = Msg.str().str();
                        if (PDA.first.isValid()) {
                            SourceLocation DiagLoc = SM.getExpansionLoc(PDA.first);
                            if (SM.isInMainFile(DiagLoc))
                                failReason += " [line " + std::to_string(SM.getExpansionLineNumber(DiagLoc)) + "]";
                        }
                    }
                } else if (auto *Info = Trap->getDeductionInfo()) {
                    // Deduction succeeded, but the candidate may still be discarded because its
                    // requires-clause / concept constraints are not satisfied (C++20).
                    auto *TD = dyn_cast_or_null<TemplateDecl>(Inst.Entity);
                    const ConstraintSatisfaction &Sat = Info->AssociatedConstraintsSatisfaction;
                    if (TD && TD->hasAssociatedConstraints() && !Sat.IsSatisfied && !Sat.Details.empty()) {
                        isInvalid = true;
                        failKind = "constraints";
                        failReason = "Constraints not satisfied: " + describeUnsatisfied(Sat, TD->getASTContext());
                    }
                }
            }
        }

        // For a class template specialization, record which (partial) specialization was picked
        llvm::json::Array specCandidates;
        if (Inst.Kind == Sema::CodeSynthesisContext::TemplateInstantiation) {
            if (auto *CTSD = dyn_cast_or_null<ClassTemplateSpecializationDecl>(Inst.Entity)) {
                ClassTemplateDecl *Primary = CTSD->getSpecializedTemplate();
                llvm::SmallVector<ClassTemplatePartialSpecializationDecl *, 4> Partials;
                Primary->getPartialSpecializations(Partials);
                if (!Partials.empty()) {
                    auto Chosen = CTSD->getSpecializedTemplateOrPartial();
                    auto *ChosenPartial = Chosen.dyn_cast<ClassTemplatePartialSpecializationDecl *>();
                    PrintingPolicy Policy = CTSD->getASTContext().getPrintingPolicy();
                    llvm::json::Object PrimaryObj;
                    PrimaryObj["pattern"] = Primary->getNameAsString() + " (primary template)";
                    PrimaryObj["line"] = mainFileLine(SM, Primary->getLocation());
                    PrimaryObj["chosen"] = ChosenPartial == nullptr;
                    specCandidates.push_back(std::move(PrimaryObj));
                    for (auto *P : Partials) {
                        std::string Pattern;
                        llvm::raw_string_ostream POS(Pattern);
                        POS << Primary->getName();
                        if (auto *Written = P->getTemplateArgsAsWritten())
                            printTemplateArgumentList(POS, Written->arguments(), Policy);
                        else
                            printTemplateArgumentList(POS, P->getTemplateArgs().asArray(), Policy);
                        llvm::json::Object PObj;
                        PObj["pattern"] = POS.str();
                        PObj["line"] = mainFileLine(SM, P->getLocation());
                        PObj["chosen"] = P == ChosenPartial;
                        specCandidates.push_back(std::move(PObj));
                    }
                }
            }
        }

        if (TraceNode *node = findNode(top.id)) {
            node->dur += getTimestamp() - top.start_ts;
            node->desugaredCode = codeStr;
            if (!specCandidates.empty()) node->specCandidates = std::move(specCandidates);
            if (isInvalid) {
                node->failed = true;
                node->failReason = failReason;
                node->failKind = failKind;
            }
        }
        g_events.push_back({"Leave", top.id});
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
        // Trace type desugaring
        QualType QT = VD->getType();
        std::string initialType = QT.getAsString();

        // We only care if the type can be desugared (it's a typedef or alias)
        QualType singleStep = QT.getSingleStepDesugaredType(*Context);
        if (singleStep != QT) {
            std::string currentStr = initialType;
            while (true) {
                QualType next = singleStep.getSingleStepDesugaredType(*Context);
                if (next == singleStep) {
                    ValuesMap[currentStr] = singleStep.getAsString();
                    break;
                }
                ValuesMap[currentStr] = singleStep.getAsString();
                currentStr = singleStep.getAsString();
                singleStep = next;
            }
        }

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
            nodeObj["failed"] = n.failed;
            nodeObj["isAlias"] = n.isAlias;
            nodeObj["kind"] = n.kind;
            nodeObj["kindName"] = n.kindName;
            nodeObj["declLine"] = n.declLine;
            nodeObj["entityKind"] = n.entityKind;
            if (n.internal) nodeObj["internal"] = true;
            if (!n.failKind.empty()) nodeObj["failKind"] = n.failKind;
            if (!n.specCandidates.empty()) nodeObj["specCandidates"] = llvm::json::Array(n.specCandidates);
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
        Root["nodes"] = std::move(nodesArr);
        Root["events"] = std::move(eventsArr);
        Root["values"] = std::move(ValuesMap);
        Root["memoHits"] = std::move(MemoObj);

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
    if (argc >= 2 && std::string(argv[1]) == "--version") {
#ifdef BUILD_VERSION
        llvm::outs() << BUILD_VERSION << "\n";
#else
        llvm::outs() << "unknown\n";
#endif
        return 0;
    }

    auto ExpectedParser = CommonOptionsParser::create(argc, argv, MyToolCategory);
    if (!ExpectedParser) {
        llvm::errs() << ExpectedParser.takeError();
        return 1;
    }
    CommonOptionsParser& OptionsParser = ExpectedParser.get();
    ClangTool Tool(OptionsParser.getCompilations(), OptionsParser.getSourcePathList());

    // Clang looks for its builtin headers relative to the executable, which fails once the
    // binary is packaged and extracted elsewhere. Prefer, in order: an explicit override,
    // headers shipped next to the binary, then the build machine's LLVM installation.
    std::vector<std::string> Candidates;
    if (const char *Env = std::getenv("METATRACE_RESOURCE_DIR")) Candidates.push_back(Env);
    std::string Exe = llvm::sys::fs::getMainExecutable(argv[0], (void *)&main);
    if (!Exe.empty()) {
        llvm::SmallString<256> Shipped(llvm::sys::path::parent_path(Exe));
        llvm::sys::path::append(Shipped, "clang-resource");
        Candidates.push_back(std::string(Shipped));
    }
#ifdef METATRACE_DEFAULT_RESOURCE_DIR
    Candidates.push_back(METATRACE_DEFAULT_RESOURCE_DIR);
#endif
    for (const std::string &Dir : Candidates) {
        llvm::SmallString<256> Probe(Dir);
        llvm::sys::path::append(Probe, "include", "stddef.h");
        if (llvm::sys::fs::exists(Probe)) {
            Tool.appendArgumentsAdjuster(getInsertArgumentAdjuster(
                ("-resource-dir=" + Dir).c_str(), ArgumentInsertPosition::END));
            break;
        }
    }

    return Tool.run(newFrontendActionFactory<VisualizerAction>().get());
}
