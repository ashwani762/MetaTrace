// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// MetaTrace Visualizer: a Clang tool that traces template instantiation for one translation
// unit and writes trace_custom.json. See docs/GUIDE.md ("How it works") for the pipeline.

#include "src/CompileTimeValues.h"
#include "src/InstantiationTracer.h"
#include "src/OverloadRanking.h"
#include "src/TraceModel.h"
#include "src/TraceWriter.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/FrontendAction.h"
#include "clang/Sema/Sema.h"
#include "clang/Sema/SemaConsumer.h"
#include "clang/Tooling/ArgumentsAdjusters.h"
#include "clang/Tooling/CommonOptionsParser.h"
#include "clang/Tooling/Tooling.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/Path.h"
#include "llvm/Support/raw_ostream.h"
#include "version.h"
#include <cstdlib>
#include <string>
#include <vector>

using namespace clang;
using namespace clang::tooling;
using namespace metatrace;

namespace {

class VisualizerASTConsumer : public SemaConsumer {
    Sema *S = nullptr;
public:
    void InitializeSema(Sema &TheSema) override {
        S = &TheSema;
        TheSema.TemplateInstCallbacks.push_back(createInstantiationTracer());
    }

    void HandleTranslationUnit(ASTContext &Context) override {
        llvm::json::Array Rankings;
        if (S) {
            // Questions answered after parsing with Sema's own logic; not part of the trace
            g_postProcessing = true;
            computeResults(*S, Context);
            Rankings = computeRankings(*S, Context);
            g_postProcessing = false;
        }
        writeTrace("trace_custom.json", collectValues(Context), std::move(Rankings));
    }
};

class VisualizerAction : public ASTFrontendAction {
public:
    std::unique_ptr<ASTConsumer> CreateASTConsumer(CompilerInstance &CI, StringRef file) override {
        return std::make_unique<VisualizerASTConsumer>();
    }
};

} // namespace

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
