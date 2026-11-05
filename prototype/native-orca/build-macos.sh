#!/bin/bash
# Pinned native reference build; never install into /Applications or /usr/local.
set -euo pipefail
if [[ $# != 1 ]]; then echo 'usage: build-macos.sh <repository-local-workspace>' >&2; exit 2; fi
recipe_dir="$(cd "$(dirname "$0")" && pwd -P)"
mkdir -p "$1"
workspace="$(cd "$1" && pwd -P)"
cd "$workspace"
python3 -B - "$workspace" <<'PYTHON'
from pathlib import Path
import sys
root=Path(sys.argv[1]).resolve(strict=True)
for child in ('logs','evidence','build-tools','orca-source','tmp','cache',
              'build-tools/make','build-tools/ninja','build-tools/git',
              'build-tools/gcc','build-tools/g++','evidence/build-inputs.txt',
              'evidence/native-executable.sha256','evidence/runtime.json'):
    if not (root/child).resolve().is_relative_to(root):
        raise SystemExit('workspace child escapes through symlink: '+child)
PYTHON
mkdir -p logs evidence
run() {
  local stage="$1"; shift
  if [[ -f "$workspace/logs/$stage.log" ]]; then
    local attempt=1
    while [[ -e "$workspace/logs/$stage.attempt-$attempt.log" ]]; do attempt=$((attempt+1)); done
    mv "$workspace/logs/$stage.log" "$workspace/logs/$stage.attempt-$attempt.log"
    if [[ -f "$workspace/logs/$stage.metrics.json" ]]; then
      mv "$workspace/logs/$stage.metrics.json" "$workspace/logs/$stage.attempt-$attempt.metrics.json"
    fi
  fi
  python3 -B "$recipe_dir/confined.py" --workspace "$workspace" --network \
    --log "$workspace/logs/$stage.log" --metrics "$workspace/logs/$stage.metrics.json" \
    --timeout 21600 -- "$@"
}
revision=d4da6e4d0efd6dc490e02147741a756a2ed98143
if [[ ! -d orca-source ]]; then
  run clone git clone --depth 1 --branch fin-support-v0.1.0 https://github.com/lewis252310/OrcaSlicer.git orca-source
fi
cd orca-source
[[ "$(git rev-parse HEAD)" == "$revision" ]] || { echo 'Wrong native source revision' >&2; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo 'Native source has tracked changes' >&2; exit 1; }
xcode="$(xcode-select -p)"
toolchain="$xcode/Toolchains/XcodeDefault.xctoolchain/usr/bin"
sdk="$xcode/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"
# The upstream GMP recipe invokes make -j without a limit. Limit the
# dependency superbuild to one recipe and each nested build to two workers.
native_ninja="$(command -v ninja)"
native_git="$(command -v git)"
native_make="$(command -v gmake)"
native_m4="$(command -v gm4)"
mkdir -p "$workspace/build-tools"
# FFmpeg defaults to gcc and does not honor CC. On macOS that name normally
# selects Apple's xcrun shim, whose cache is outside the workspace.
for compiler in gcc g++; do
  target="$toolchain/clang"
  [[ "$compiler" == g++ ]] && target="$toolchain/clang++"
  cat > "$workspace/build-tools/$compiler" <<WRAPPER
#!/bin/bash
exec "$target" "\$@"
WRAPPER
  chmod +x "$workspace/build-tools/$compiler"
done
cat > "$workspace/build-tools/make" <<WRAPPER
#!/bin/bash
exec "$native_make" "\$@" -j2
WRAPPER
cat > "$workspace/build-tools/ninja" <<WRAPPER
#!/bin/bash
case "\$PWD" in
  */deps/build/x86_64) exec "$native_ninja" "\$@" -j1 ;;
  *) exec "$native_ninja" "\$@" -j2 ;;
esac
WRAPPER
# ExternalProject's shallow clone omits the pinned wxWidgets commit once its
# branch advances. Fetch that exact commit before checkout; do not change pins.
cat > "$workspace/build-tools/git" <<WRAPPER
#!/bin/bash
set -e
if [[ "\${1:-}" == checkout && "\${2:-}" == 5b7e8c0cde6b975d63613188d2ac6c1ab8769fbc ]]; then
  if ! "$native_git" cat-file -e "\$2^{commit}" 2>/dev/null; then
    "$native_git" fetch --depth 1 origin "\$2"
  fi
fi
exec "$native_git" "\$@"
WRAPPER
chmod +x "$workspace/build-tools/make" "$workspace/build-tools/ninja" "$workspace/build-tools/git"
export PATH="$workspace/build-tools:$toolchain:$xcode/usr/bin:$PATH"
export M4="$native_m4"
export SDKROOT="$sdk" CC="$toolchain/clang" CXX="$toolchain/clang++"
export AR="$toolchain/ar" RANLIB="$toolchain/ranlib" xcrun_nocache=1
export ORCA_TESTS_BUILD_ONLY=1
args=(-DCMAKE_C_COMPILER="$CC" -DCMAKE_CXX_COMPILER="$CXX" -DCMAKE_AR="$AR"
      -DCMAKE_RANLIB="$RANLIB" -DCMAKE_OSX_SYSROOT="$sdk"
      -DCMAKE_MAKE_PROGRAM="$workspace/build-tools/ninja" -DGIT_EXECUTABLE="$workspace/build-tools/git")
{
  git rev-parse HEAD
  git submodule status --recursive
  "$CC" --version
  "$native_make" --version
  "$native_m4" --version
  cmake --version
  ninja --version
  shasum -a 256 build_release_macos.sh
} > "$workspace/evidence/build-inputs.txt"
run native-deps ./build_release_macos.sh -d -a x86_64 -x -j 2 -c Release -- "${args[@]}"
# Build the application and the one required test target, not unrelated test binaries.
export SLICER_CMAKE_GENERATOR="Ninja Multi-Config" SLICER_BUILD_TARGET=OrcaSlicer
run native-slicer ./build_release_macos.sh -s -a x86_64 -j 2 -c Release -T -- \
  "${args[@]}" -DCMAKE_PREFIX_PATH="$workspace/orca-source/deps/build/x86_64/OrcaSlicer_dep/usr/local"
run native-fin-tests-build cmake --build build/x86_64 --config Release --target fff_print_tests --parallel 2
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo 'Build changed tracked native source; inspect before accepting runtime' >&2; exit 1; }
shasum -a 256 build/x86_64/OrcaSlicer/OrcaSlicer.app/Contents/MacOS/OrcaSlicer \
  > "$workspace/evidence/native-executable.sha256"
python3 -B - "$workspace" "$revision" <<'PYTHON'
import hashlib, json, sys
from pathlib import Path
w=Path(sys.argv[1])
exe=w/'orca-source/build/x86_64/OrcaSlicer/OrcaSlicer.app/Contents/MacOS/OrcaSlicer'
(w/'evidence/runtime.json').write_text(json.dumps({
    'revision':sys.argv[2], 'sha256':hashlib.sha256(exe.read_bytes()).hexdigest(),
    'executable':str(exe.relative_to(w)), 'architecture':'x86_64',
    'sourceChanges':False, 'testExecution':'not-run'}, indent=2)+'\n')
PYTHON
