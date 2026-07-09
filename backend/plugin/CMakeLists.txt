cmake_minimum_required(VERSION 3.20.0)
project(Visualizer)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(WIN32)
    if(NOT DEFINED LLVM_PATH)
        message(FATAL_ERROR "LLVM_PATH is not defined. Please pass it via -DLLVM_PATH=<path>")
    endif()
    find_package(LLVM REQUIRED CONFIG PATHS "${LLVM_PATH}" NO_DEFAULT_PATH)
    find_package(Clang REQUIRED CONFIG PATHS "${LLVM_PATH}" NO_DEFAULT_PATH)
else()
    find_program(LLVM_CONFIG_EXECUTABLE NAMES llvm-config llvm-config-23 llvm-config-22 llvm-config-21 llvm-config-20 llvm-config-19 llvm-config-18 llvm-config-17)
    if(LLVM_CONFIG_EXECUTABLE)
        execute_process(COMMAND ${LLVM_CONFIG_EXECUTABLE} --prefix OUTPUT_VARIABLE LLVM_PREFIX OUTPUT_STRIP_TRAILING_WHITESPACE)
        list(APPEND CMAKE_PREFIX_PATH "${LLVM_PREFIX}/lib/cmake/llvm" "${LLVM_PREFIX}/lib/cmake/clang")
    endif()
    find_package(LLVM REQUIRED CONFIG)
    find_package(Clang REQUIRED CONFIG)
endif()

list(APPEND CMAKE_MODULE_PATH "${LLVM_CMAKE_DIR}")
include(AddLLVM)

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
