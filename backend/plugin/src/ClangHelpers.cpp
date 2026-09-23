// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

#include "ClangHelpers.h"
#include "clang/AST/DeclTemplate.h"
#include "llvm/Support/raw_ostream.h"

namespace metatrace {

std::string entityKindOf(const Decl *D) {
    if (!D) return "other";
    if (isa<ConceptDecl>(D)) return "concept";
    if (isa<TypeAliasTemplateDecl>(D) || isa<TypeAliasDecl>(D) || isa<TypedefNameDecl>(D)) return "alias";
    if (isa<FunctionTemplateDecl>(D) || isa<FunctionDecl>(D)) return "function";
    if (isa<ClassTemplateDecl>(D) || isa<CXXRecordDecl>(D)) return "class";
    if (isa<VarTemplateDecl>(D) || isa<VarDecl>(D)) return "variable";
    return "other";
}

bool isExplicitSpecialization(const Decl *D) {
    if (auto *CTSD = dyn_cast_or_null<ClassTemplateSpecializationDecl>(D))
        return CTSD->getSpecializationKind() == TSK_ExplicitSpecialization;
    if (auto *VTSD = dyn_cast_or_null<VarTemplateSpecializationDecl>(D))
        return VTSD->getSpecializationKind() == TSK_ExplicitSpecialization;
    if (auto *FD = dyn_cast_or_null<FunctionDecl>(D))
        return FD->getTemplateSpecializationKind() == TSK_ExplicitSpecialization;
    return false;
}

unsigned int mainFileLine(const SourceManager &SM, SourceLocation Loc) {
    if (Loc.isInvalid()) return 0;
    SourceLocation Exp = SM.getExpansionLoc(Loc);
    return SM.isInMainFile(Exp) ? SM.getExpansionLineNumber(Exp) : 0;
}

const char *kindToString(Sema::CodeSynthesisContext::SynthesisKind K) {
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

bool isSubstitutionKind(Sema::CodeSynthesisContext::SynthesisKind K) {
    using CSC = Sema::CodeSynthesisContext;
    return K == CSC::ExplicitTemplateArgumentSubstitution ||
           K == CSC::DeducedTemplateArgumentSubstitution ||
           K == CSC::DefaultTemplateArgumentChecking ||
           K == CSC::PriorTemplateArgumentSubstitution ||
           K == CSC::TypeAliasTemplateInstantiation;
}

bool isDeductionKind(Sema::CodeSynthesisContext::SynthesisKind K) {
    return K == Sema::CodeSynthesisContext::DeducedTemplateArgumentSubstitution ||
           K == Sema::CodeSynthesisContext::ExplicitTemplateArgumentSubstitution;
}

std::string getEntityName(const Decl *Entity) {
    if (auto *ND = dyn_cast_or_null<NamedDecl>(Entity)) {
        std::string Name;
        llvm::raw_string_ostream OS(Name);
        ND->getNameForDiagnostic(OS, ND->getASTContext().getPrintingPolicy(), true);
        return OS.str();
    }
    return "Unknown";
}

bool isStaticMemberOfSpecialization(const Decl *D) {
    auto *VD = dyn_cast_or_null<VarDecl>(D);
    return VD && !isa<VarTemplateSpecializationDecl>(VD) && VD->isStaticDataMember();
}

bool isFilteredVarDecl(const Decl *D) {
    return isa_and_nonnull<VarDecl>(D) && !isa<VarTemplateSpecializationDecl>(D);
}

} // namespace metatrace
