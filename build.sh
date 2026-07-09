#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
FRONTEND_DIR="$DIR/frontend"
BACKEND_DIR="$DIR/backend"
RELEASE_DIR="$DIR/release"

echo "======================================="
echo "Checking Linux build dependencies..."
echo "======================================="
if ! command -v cmake &> /dev/null || ! dpkg -s llvm-dev &> /dev/null || ! dpkg -s libclang-dev &> /dev/null; then
    echo "Missing dependencies. Attempting to install via apt-get..."
    sudo apt-get update
    sudo apt-get install -y cmake llvm-dev libclang-dev build-essential
fi

echo "======================================="
echo "0. Generating Version Information..."
echo "======================================="
node scripts/generate_version.js

echo "======================================="
echo "1. Building C++ Visualizer Plugin..."
echo "======================================="
cd "$BACKEND_DIR/plugin"
mkdir -p build
cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build .
cp Visualizer ../
cd "$DIR"

echo "======================================="
echo "2. Building Frontend..."
echo "======================================="
cd "$FRONTEND_DIR"
npm install
npm run build

echo "======================================="
echo "3. Compiling Backend TypeScript..."
echo "======================================="
cd "$BACKEND_DIR"
npm install
npm run build

echo "======================================="
echo "4. Packaging Backend to Binary using pkg..."
echo "======================================="
npm install pkg --no-save
npx pkg . --target node18-linux-x64 --output CppTemplateVisualizer

echo "======================================="
echo "5. Creating Release Directory..."
echo "======================================="
mkdir -p "$RELEASE_DIR"
cp "$BACKEND_DIR/CppTemplateVisualizer" "$RELEASE_DIR/"

echo "======================================="
echo "SUCCESS! Linux Release is ready in: $RELEASE_DIR"
echo "======================================="
