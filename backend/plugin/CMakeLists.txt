cmake_minimum_required(VERSION 3.20.0)
project(Visualizer)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT DEFINED LLVM_PATH)
    message(FATAL_ERROR "LLVM_PATH is not defined. Please pass it via -DLLVM_PATH=<path>")
endif()

find_package(LLVM REQUIRED CONFIG PATHS "${LLVM_PATH}" NO_DEFAULT_PATH)
list(APPEND CMAKE_MODULE_PATH "${LLVM_CMAKE_DIR}")
include(AddLLVM)

find_package(Clang REQUIRED CONFIG PATHS "${LLVM_PATH}" NO_DEFAULT_PATH)

add_definitions(${LLVM_DEFINITIONS})
include_directories(${LLVM_INCLUDE_DIRS} ${CLANG_INCLUDE_DIRS})
link_directories(${LLVM_LIBRARY_DIRS})

add_executable(Visualizer Visualizer.cpp)

target_link_libraries(Visualizer PRIVATE
    clangTooling
    clangASTMatchers
    clangAST
    clangBasic
    clangFrontend
    clangLex
    clangSema
    clangSerialization
    clangParse
    clangEdit
    clangAnalysis
    clangDriver
    clangRewrite
)

if(NOT DEFINED DIA_SDK_PATH)
    set(DIA_SDK_PATH "C:/Program Files/Microsoft Visual Studio/18/Community/DIA SDK")
endif()

# Fix diaguids.lib path in all targets
get_cmake_property(all_targets BUILDSYSTEM_TARGETS)
foreach(target IN LISTS all_targets)
    if(TARGET ${target})
        get_target_property(support_libs ${target} INTERFACE_LINK_LIBRARIES)
        if(support_libs)
            string(REGEX REPLACE "C:/[^;]*diaguids\\.lib" "${DIA_SDK_PATH}/lib/amd64/diaguids.lib" new_support_libs "${support_libs}")
            set_target_properties(${target} PROPERTIES INTERFACE_LINK_LIBRARIES "${new_support_libs}")
        endif()
    endif()
endforeach()
