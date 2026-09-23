// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

#include "Constraints.h"
#include "ClangHelpers.h"
#include "clang/AST/ExprConcepts.h"
#include "llvm/Support/raw_ostream.h"
#include <map>

namespace metatrace {

namespace {
// Describes one unsatisfied-constraint record from a ConstraintSatisfaction
std::string describeRecord(const UnsatisfiedConstraintRecord &Record, const PrintingPolicy &Policy) {
    std::string Out;
    llvm::raw_string_ostream OS(Out);
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
    return OS.str();
}

} // namespace

std::string describeUnsatisfied(const ConstraintSatisfaction &Sat, const ASTContext &Ctx) {
    PrintingPolicy Policy = Ctx.getPrintingPolicy();
    std::string Out;
    for (const auto &Record : Sat.Details) {
        if (!Out.empty()) Out += "; ";
        Out += describeRecord(Record, Policy);
    }
    return Out;
}

namespace {

SourceLocation recordLocation(const UnsatisfiedConstraintRecord &Record) {
    if (auto *E = Record.dyn_cast<const Expr *>()) return E->getBeginLoc();
    if (auto *CR = Record.dyn_cast<const ConceptReference *>()) return CR->getBeginLoc();
    if (auto *Diag = Record.dyn_cast<const ConstraintSubstitutionDiagnostic *>()) return Diag->first;
    return {};
}

/**
 * Builds the normalized constraint tree of a candidate (conjunctions, disjunctions, concept-ids
 * expanded into their definitions, atomic constraints) and annotates each node with the result
 * Clang reached: true, false, or skipped because of short-circuit evaluation.
 *
 * Clang only reports the atoms that failed; which atoms were evaluated follows from the
 * short-circuit rules, and failures are matched back to the tree by source location
 * (substitution preserves the locations of the original constraint expressions).
 */
class ConstraintTreeBuilder {
    const SourceManager &SM;
    PrintingPolicy Policy;
    std::map<unsigned, std::string> Failed; // raw location -> description

    std::string print(const Expr *E) {
        std::string S;
        llvm::raw_string_ostream OS(S);
        E->printPretty(OS, nullptr, Policy);
        return OS.str();
    }

    llvm::json::Object makeNode(const char *Kind, const std::string &Text, SourceLocation Loc) {
        llvm::json::Object N;
        N["kind"] = Kind;
        N["text"] = Text;
        N["line"] = mainFileLine(SM, Loc);
        return N;
    }

    // Returns the node and its truth value; `Evaluated` is false for short-circuited subtrees
    llvm::json::Object build(const Expr *E, bool Evaluated, bool &Result, int Depth) {
        E = E->IgnoreParens();
        if (auto *BO = dyn_cast<BinaryOperator>(E); BO && (BO->getOpcode() == BO_LAnd || BO->getOpcode() == BO_LOr)) {
            bool IsAnd = BO->getOpcode() == BO_LAnd;
            bool L = true, R = true;
            llvm::json::Array Children;
            Children.push_back(build(BO->getLHS(), Evaluated, L, Depth));
            // && stops at the first false operand, || at the first true one
            bool EvalRHS = Evaluated && (IsAnd ? L : !L);
            Children.push_back(build(BO->getRHS(), EvalRHS, R, Depth));
            Result = IsAnd ? (L && R) : (L || R);
            if (!EvalRHS) Result = L;
            llvm::json::Object N = makeNode(IsAnd ? "and" : "or", IsAnd ? "all of" : "any of", BO->getOperatorLoc());
            N["result"] = Evaluated ? (Result ? "true" : "false") : "skipped";
            N["children"] = std::move(Children);
            return N;
        }
        if (auto *CSE = dyn_cast<ConceptSpecializationExpr>(E)) {
            llvm::json::Object N = makeNode("concept", print(CSE), CSE->getBeginLoc());
            auto It = Failed.find(CSE->getBeginLoc().getRawEncoding());
            bool ConceptFailed = It != Failed.end();
            const ConceptDecl *CD = CSE->getNamedConcept();
            bool Expand = Depth < 6 && CD->getConstraintExpr() &&
                          (ConceptFailed || SM.isInMainFile(SM.getExpansionLoc(CD->getLocation())));
            bool Inner = !ConceptFailed;
            if (Expand) {
                llvm::json::Array Children;
                Children.push_back(build(CD->getConstraintExpr(), Evaluated, Inner, Depth + 1));
                N["children"] = std::move(Children);
            }
            Result = ConceptFailed ? false : (Expand ? Inner : true);
            N["declLine"] = mainFileLine(SM, CD->getLocation());
            N["result"] = Evaluated ? (Result ? "true" : "false") : "skipped";
            return N;
        }
        llvm::json::Object N = makeNode("atom", print(E), E->getBeginLoc());
        auto It = Failed.find(E->getBeginLoc().getRawEncoding());
        Result = It == Failed.end();
        if (!Result && Evaluated) N["note"] = It->second;
        N["result"] = Evaluated ? (Result ? "true" : "false") : "skipped";
        return N;
    }

public:
    ConstraintTreeBuilder(const SourceManager &SM, const ASTContext &Ctx, const ConstraintSatisfaction &Sat)
        : SM(SM), Policy(Ctx.getPrintingPolicy()) {
        for (const auto &Record : Sat.Details) {
            SourceLocation Loc = recordLocation(Record);
            if (Loc.isValid()) Failed.emplace(Loc.getRawEncoding(), describeRecord(Record, Policy));
        }
    }

    llvm::json::Object build(const TemplateDecl *TD) {
        llvm::SmallVector<AssociatedConstraint, 4> ACs;
        TD->getAssociatedConstraints(ACs);
        // Multiple associated constraints (type-constraints + requires-clause) form a conjunction
        llvm::json::Array Children;
        bool All = true, Evaluated = true;
        for (const AssociatedConstraint &AC : ACs) {
            if (!AC.ConstraintExpr) continue;
            bool R = true;
            Children.push_back(build(AC.ConstraintExpr, Evaluated, R, 0));
            if (!R && Evaluated) { All = false; Evaluated = false; }
        }
        if (Children.size() == 1) return std::move(*Children[0].getAsObject());
        llvm::json::Object Root = makeNode("and", "all of", TD->getLocation());
        Root["result"] = All ? "true" : "false";
        Root["children"] = std::move(Children);
        return Root;
    }
};

} // namespace

llvm::json::Object buildConstraintTree(const SourceManager &SM, const ASTContext &Ctx,
                                       const ConstraintSatisfaction &Sat, const TemplateDecl *TD) {
    return ConstraintTreeBuilder(SM, Ctx, Sat).build(TD);
}

} // namespace metatrace
