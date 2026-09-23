// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

#include "CompileTimeValues.h"
#include "TraceModel.h"
#include "clang/AST/RecursiveASTVisitor.h"
#include "clang/Basic/SourceManager.h"
#include "clang/Sema/Lookup.h"
#include "clang/Sema/Template.h"
#include "llvm/Support/raw_ostream.h"

namespace metatrace {

using namespace clang;

namespace {

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


static std::string typeString(QualType T, const PrintingPolicy &Policy) {
    return T.getCanonicalType().getAsString(Policy);
}

} // namespace

void computeResults(Sema &S, ASTContext &Ctx) {
    PrintingPolicy Policy = Ctx.getPrintingPolicy();
    const size_t Count = g_traceNodes.size();
    for (size_t i = 0; i < Count; ++i) {
        TraceNode &n = g_traceNodes[i];
        llvm::json::Object Result;

        // Class specializations: the conventional metaprogramming results `value` and `type`
        // (looked up through base classes, so std::is_integral<int>::value works)
        if (n.kindName == "TemplateInstantiation") {
            if (auto *CTSD = dyn_cast_or_null<ClassTemplateSpecializationDecl>(n.entity);
                CTSD && CTSD->isCompleteDefinition() && !CTSD->isInvalidDecl()) {
                for (const char *Member : {"value", "type"}) {
                    LookupResult R(S, DeclarationName(&Ctx.Idents.get(Member)), CTSD->getLocation(), Sema::LookupOrdinaryName);
                    Sema::SFINAETrap Trap(S);
                    if (!S.LookupQualifiedName(R, CTSD) || !R.isSingleResult()) continue;
                    NamedDecl *ND = R.getFoundDecl();
                    if (auto *VD = dyn_cast<VarDecl>(ND); VD && VD->hasInit() && !VD->getType()->isDependentType()) {
                        if (VD->evaluateValue()) {
                            std::string V;
                            llvm::raw_string_ostream OS(V);
                            VD->getEvaluatedValue()->printPretty(OS, Ctx, VD->getType());
                            Result[Member] = OS.str();
                        }
                    } else if (auto *TND = dyn_cast<TypedefNameDecl>(ND)) {
                        QualType T = TND->getUnderlyingType();
                        if (!T->isDependentType()) Result[Member] = typeString(T, Policy);
                    }
                }
            }
        }

        // Alias templates (enable_if_t, conditional_t, ...): the type they produce
        if (n.kindName == "TypeAliasTemplateInstantiation" && !n.failed && !n.args.empty()) {
            if (auto *TATD = dyn_cast_or_null<TypeAliasTemplateDecl>(n.entity)) {
                bool Dependent = false;
                TemplateArgumentListInfo Args;
                for (const TemplateArgument &A : n.args) {
                    if (A.isNull() || A.isDependent()) { Dependent = true; break; }
                    if (A.getKind() == TemplateArgument::Pack) {
                        for (const TemplateArgument &P : A.pack_elements())
                            Args.addArgument(S.getTrivialTemplateArgumentLoc(P, QualType(), n.poi));
                    } else {
                        Args.addArgument(S.getTrivialTemplateArgumentLoc(A, QualType(), n.poi));
                    }
                }
                if (!Dependent) {
                    Sema::SFINAETrap Trap(S);
                    QualType T = S.CheckTemplateIdType(ElaboratedTypeKeyword::None, TemplateName(TATD), n.poi, Args, nullptr, false);
                    if (!T.isNull() && !Trap.hasErrorOccurred()) {
                        if (auto *TST = T->getAs<TemplateSpecializationType>(); TST && TST->isTypeAlias())
                            T = TST->getAliasedType();
                        Result["type"] = typeString(T, Policy);
                    }
                }
            }
        }

        if (!Result.empty()) g_results[n.id] = std::move(Result);
    }
}


llvm::json::Object collectValues(ASTContext &Ctx) {
    llvm::json::Object ValuesMap;
    EvaluatedValueVisitor Visitor(&Ctx, ValuesMap);
    SourceManager &SM = Ctx.getSourceManager();
    for (auto *D : Ctx.getTranslationUnitDecl()->decls()) {
        if (SM.isInMainFile(D->getLocation())) {
            Visitor.TraverseDecl(D);
        }
    }
    return ValuesMap;
}

} // namespace metatrace
