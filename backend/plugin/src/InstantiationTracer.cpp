// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

#include "InstantiationTracer.h"
#include "ClangHelpers.h"
#include "Constraints.h"
#include "TraceModel.h"
#include "clang/AST/DeclTemplate.h"
#include "clang/AST/TemplateBase.h"
#include "clang/Basic/PartialDiagnostic.h"
#include "clang/Sema/Sema.h"
#include "clang/Sema/TemplateDeduction.h"
#include "llvm/Support/raw_ostream.h"
#include <chrono>
#include <map>
#include <set>

namespace metatrace {

namespace {

// Template arguments seen during deduction may point into Sema's temporary storage (argument
// packs in particular); copy packs into ASTContext memory so they stay valid after parsing.
TemplateArgument persistentCopy(ASTContext &Ctx, const TemplateArgument &A) {
    if (A.getKind() != TemplateArgument::Pack) return A;
    llvm::SmallVector<TemplateArgument, 8> Elements;
    for (const TemplateArgument &E : A.pack_elements()) Elements.push_back(persistentCopy(Ctx, E));
    return TemplateArgument::CreatePackCopy(Ctx, Elements);
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

    int currentParent() const { return instStack.empty() ? 0 : instStack.back().id; }

public:
    void initialize(const Sema &TheSema) override {}
    void finalize(const Sema &TheSema) override {}
    void atTemplateBegin(const Sema &TheSema, const Sema::CodeSynthesisContext &Inst) override {
        SourceManager &SM = TheSema.getSourceManager();
        if (g_postProcessing || !SM.isInMainFile(Inst.PointOfInstantiation)) {
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
             Inst.Kind == Sema::CodeSynthesisContext::TypeAliasTemplateInstantiation ||
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
        node.entity = Inst.Entity;
        node.poi = Inst.PointOfInstantiation;
        if ((isDeductionKind(Inst.Kind) || Inst.Kind == Sema::CodeSynthesisContext::TypeAliasTemplateInstantiation) && Inst.Entity) {
            ASTContext &Ctx = Inst.Entity->getASTContext();
            for (const TemplateArgument &A : Inst.template_arguments()) node.args.push_back(persistentCopy(Ctx, A));
        }
        // Deductions on dependent arguments are Clang comparing two templates (partial ordering)
        for (const TemplateArgument &A : node.args)
            if (!A.isNull() && A.isDependent()) node.internal = true;
        g_traceNodes.push_back(std::move(node));
        g_events.push_back({"Enter", id});
    }

    void atTemplateEnd(const Sema &TheSema, const Sema::CodeSynthesisContext &Inst) override {
        SourceManager &SM = TheSema.getSourceManager();
        if (g_postProcessing || !SM.isInMainFile(Inst.PointOfInstantiation)) {
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
                    // Only when the constraints were actually checked (satisfied, or failures recorded)
                    if (TD && TD->hasAssociatedConstraints() && (Sat.IsSatisfied || !Sat.Details.empty())) {
                        if (TraceNode *node = findNode(top.id))
                            node->constraints = buildConstraintTree(SM, TD->getASTContext(), Sat, TD);
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


} // namespace

std::unique_ptr<TemplateInstantiationCallback> createInstantiationTracer() {
    return std::make_unique<VisualizerTemplateCallback>();
}

} // namespace metatrace
