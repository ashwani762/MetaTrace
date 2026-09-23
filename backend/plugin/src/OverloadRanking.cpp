// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

#include "OverloadRanking.h"
#include "ClangHelpers.h"
#include "TraceModel.h"
#include "clang/AST/RecursiveASTVisitor.h"
#include "clang/Basic/SourceManager.h"
#include "clang/Sema/Template.h"

namespace metatrace {

using namespace clang;

namespace {

// Collects the function actually called at each call site in the main file
class CallCollector : public RecursiveASTVisitor<CallCollector> {
public:
    const SourceManager &SM;
    std::map<unsigned, const CallExpr *> Calls;
    explicit CallCollector(const SourceManager &SM) : SM(SM) {}
    bool shouldVisitTemplateInstantiations() const { return true; }
    bool VisitCallExpr(CallExpr *CE) {
        if (!SM.isInMainFile(SM.getExpansionLoc(CE->getBeginLoc()))) return true;
        Calls.emplace(CE->getBeginLoc().getRawEncoding(), CE);
        Calls.emplace(CE->getExprLoc().getRawEncoding(), CE);
        if (const Expr *Callee = CE->getCallee())
            Calls.emplace(Callee->IgnoreImplicit()->getExprLoc().getRawEncoding(), CE);
        return true;
    }
};

std::string signatureOf(const FunctionDecl *FD, const PrintingPolicy &Policy) {
    std::string Out = FD->getNameAsString() + "(";
    for (unsigned i = 0; i < FD->getNumParams(); ++i) {
        if (i) Out += ", ";
        Out += FD->getParamDecl(i)->getType().getAsString(Policy);
    }
    return Out + ")";
}

// How an argument binds to a parameter, simplified from [over.ics.rank]
struct ArgMatch {
    std::string label;
    bool viable = true;        // false if the argument cannot bind at all (e.g. lvalue to T&&)
    int rank = 0;              // 0 exact, 1 promotion, 2 conversion
    bool rvalueRefBinding = false; // an rvalue bound to an rvalue reference (preferred over const&)
};

ArgMatch matchArgument(ASTContext &Ctx, QualType P, const Expr *Arg) {
    ArgMatch M;
    QualType A = Arg->getType();
    QualType PN = P.getNonReferenceType();
    QualType PU = PN.getUnqualifiedType(), AU = A.getNonReferenceType().getUnqualifiedType();
    bool IsLValue = Arg->isLValue();

    // Reference binding rules decide viability before any ranking
    if (P->isRValueReferenceType() && IsLValue) {
        M.viable = false;
        M.label = "not viable: an lvalue cannot bind to an rvalue reference";
        return M;
    }
    if (P->isLValueReferenceType() && !PN.isConstQualified() && !IsLValue) {
        M.viable = false;
        M.label = "not viable: a temporary cannot bind to a non-const lvalue reference";
        return M;
    }
    M.rvalueRefBinding = P->isRValueReferenceType() && !IsLValue;

    if (Ctx.hasSameType(PU, AU)) {
        M.label = P->isReferenceType() ? (M.rvalueRefBinding ? "exact match (rvalue reference binding)" : "exact match (reference binding)") : "exact match";
    } else if (AU->isArrayType() && PU->isPointerType() && Ctx.hasSameType(Ctx.getArrayDecayedType(AU), PU)) {
        M.label = "exact match (array-to-pointer)";
    } else if (AU->isArithmeticType() && PU->isArithmeticType()) {
        bool Promotion = (Ctx.isPromotableIntegerType(AU) && Ctx.hasSameType(Ctx.getPromotedIntegerType(AU), PU)) ||
                         (AU->isSpecificBuiltinType(BuiltinType::Float) && PU->isSpecificBuiltinType(BuiltinType::Double));
        M.rank = Promotion ? 1 : 2;
        M.label = Promotion ? "promotion" : "arithmetic conversion";
    } else {
        M.rank = 2;
        M.label = "conversion";
    }
    return M;
}

} // namespace

llvm::json::Array computeRankings(Sema &S, ASTContext &Ctx) {
    llvm::json::Array Out;
    SourceManager &SM = Ctx.getSourceManager();
    PrintingPolicy Policy = Ctx.getPrintingPolicy();
    CallCollector Calls(SM);
    for (Decl *D : Ctx.getTranslationUnitDecl()->decls())
        if (SM.isInMainFile(SM.getExpansionLoc(D->getLocation()))) Calls.TraverseDecl(D);

    // The specialization each successful deduction produced (matched structurally, since the
    // arguments seen during deduction may carry sugar the specialization set does not)
    for (TraceNode &n : g_traceNodes) {
        if (n.deducedSpec || n.failed || n.internal || n.kindName != "DeducedTemplateArgumentSubstitution") continue;
        auto *FTD = dyn_cast_or_null<FunctionTemplateDecl>(n.entity);
        if (!FTD) continue;
        for (FunctionDecl *Spec : FTD->specializations()) {
            const TemplateArgumentList *L = Spec->getTemplateSpecializationArgs();
            if (!L || L->size() != n.args.size()) continue;
            bool Same = true;
            for (unsigned i = 0; i < L->size() && Same; ++i) Same = Ctx.isSameTemplateArgument(L->get(i), n.args[i]);
            if (Same) { n.deducedSpec = Spec; break; }
        }
    }

    // Viable template candidates per call site
    std::map<unsigned, std::vector<TraceNode *>> Sites;
    for (TraceNode &n : g_traceNodes) {
        if (n.failed || n.internal || !n.deducedSpec || n.kindName != "DeducedTemplateArgumentSubstitution") continue;
        auto &List = Sites[n.poi.getRawEncoding()];
        bool Seen = false;
        for (TraceNode *o : List) Seen |= o->entity == n.entity;
        if (!Seen) List.push_back(&n);
    }

    for (auto &[Raw, Candidates] : Sites) {
        auto It = Calls.Calls.find(Raw);
        if (It == Calls.Calls.end()) continue;
        const CallExpr *CE = It->second;
        const FunctionDecl *Chosen = CE->getDirectCallee();
        if (!Chosen) continue;
        FunctionTemplateDecl *Winner = Chosen->getPrimaryTemplate();
        if (Candidates.size() < 2 && Winner) continue;

        for (TraceNode *C : Candidates) {
            auto *Loser = cast<FunctionTemplateDecl>(C->entity);
            if (Loser == Winner) continue;
            llvm::json::Object R;
            R["line"] = SM.getSpellingLineNumber(C->poi);
            R["col"] = SM.getSpellingColumnNumber(C->poi);
            R["loserDeclLine"] = mainFileLine(SM, Loser->getLocation());
            R["loser"] = signatureOf(C->deducedSpec, Policy);
            R["winner"] = signatureOf(Chosen, Policy);
            R["winnerDeclLine"] = mainFileLine(SM, Chosen->getLocation());
            llvm::json::Array Details;

            if (!Winner) {
                R["reason"] = "nonTemplate";
                Details.push_back("A non-template function that matches equally well is preferred over a template specialization.");
            } else {
                // 1. Viability and the conversion needed for each argument
                bool WinnerBetter = false, LoserBetter = false, LoserNotViable = false, BetterBinding = false;
                unsigned N = std::min({CE->getNumArgs(), Chosen->getNumParams(), C->deducedSpec->getNumParams()});
                for (unsigned i = 0; i < N; ++i) {
                    const Expr *Arg = CE->getArg(i);
                    ArgMatch WM = matchArgument(Ctx, Chosen->getParamDecl(i)->getType(), Arg);
                    ArgMatch LM = matchArgument(Ctx, C->deducedSpec->getParamDecl(i)->getType(), Arg);
                    if (!LM.viable) LoserNotViable = true;
                    if (WM.viable && LM.viable) {
                        if (WM.rank < LM.rank) WinnerBetter = true;
                        if (LM.rank < WM.rank) LoserBetter = true;
                        if (WM.rank == LM.rank && WM.rvalueRefBinding && !LM.rvalueRefBinding) BetterBinding = true;
                    }
                    Details.push_back("argument " + std::to_string(i + 1) + " (" + (Arg->isLValue() ? "lvalue " : "rvalue ") +
                                      Arg->getType().getAsString(Policy) + "): chosen " +
                                      Chosen->getParamDecl(i)->getType().getAsString(Policy) + " = " + WM.label + ", this one " +
                                      C->deducedSpec->getParamDecl(i)->getType().getAsString(Policy) + " = " + LM.label);
                }
                if (LoserNotViable) {
                    R["reason"] = "notViable";
                    R["details"] = std::move(Details);
                    Out.push_back(std::move(R));
                    continue;
                }
                if (!WinnerBetter && !LoserBetter && BetterBinding) {
                    R["reason"] = "referenceBinding";
                    Details.push_back("Both need the same conversions, but binding an rvalue to an rvalue reference (T&&) is better than binding it to a const lvalue reference.");
                    R["details"] = std::move(Details);
                    Out.push_back(std::move(R));
                    continue;
                }
                if (WinnerBetter && !LoserBetter) {
                    R["reason"] = "conversion";
                } else {
                    // 2. Equally good conversions: partial ordering picks the more specialized template
                    Sema::SFINAETrap Trap(S);
                    FunctionTemplateDecl *More = S.getMoreSpecializedTemplate(Winner, Loser, CE->getBeginLoc(), TPOC_Call, N);
                    // getMoreSpecializedTemplate also applies the C++20 constraints tie-breaker; with
                    // equivalent signatures (canonical template parameters compare equal) only
                    // constraints can have decided it
                    bool SameSignature = Ctx.hasSameType(Winner->getTemplatedDecl()->getType(), Loser->getTemplatedDecl()->getType());
                    if (More == Winner && !SameSignature) {
                        R["reason"] = "moreSpecialized";
                        Details.push_back("Both match equally well, so partial ordering applies: " +
                                          signatureOf(Winner->getTemplatedDecl(), Policy) + " is more specialized than " +
                                          signatureOf(Loser->getTemplatedDecl(), Policy) + ".");
                    } else {
                        // 3. Still tied: the more constrained template (C++20) wins
                        llvm::SmallVector<AssociatedConstraint, 4> AW, AL;
                        Winner->getAssociatedConstraints(AW);
                        Loser->getAssociatedConstraints(AL);
                        bool WAtLeast = false, LAtLeast = false;
                        bool Err = S.IsAtLeastAsConstrained(Winner, AW, Loser, AL, WAtLeast) ||
                                   S.IsAtLeastAsConstrained(Loser, AL, Winner, AW, LAtLeast);
                        if (!Err && WAtLeast && !LAtLeast) {
                            R["reason"] = "moreConstrained";
                            Details.push_back("Both match equally well and neither is more specialized, but the chosen template's constraints subsume this one's (it is more constrained).");
                        } else {
                            R["reason"] = "unknown";
                        }
                    }
                }
            }
            R["details"] = std::move(Details);
            Out.push_back(std::move(R));
        }
    }
    return Out;
}


} // namespace metatrace
