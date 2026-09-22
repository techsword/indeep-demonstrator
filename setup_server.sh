#!/bin/bash
# Setup script for the remote server (server side).
# Run this ONCE on the remote server to set up the environment.
#
# CUDA libraries (cuBLAS, cuDNN, ...) come from the nvidia-*-cu12 wheels that
# torch depends on; uv installs them automatically. Two ctranslate2 4.4.0
# wheel quirks are handled below: the executable-stack flag it ships with,
# and the cuDNN component libraries that its bundled dispatcher needs but the
# wheel does not include.

set -e

echo "=== InDeep Demonstrator Server Setup ==="

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

# Install Python 3.10
echo "Installing Python 3.10..."
uv python install 3.10

# Create venv (reused when it already exists)
if [ -x env/bin/python ]; then
    echo "Virtual environment already exists, reusing it"
else
    echo "Creating virtual environment..."
    uv venv env --python 3.10
fi

# Install dependencies
# (setuptools is pinned in requirements.txt for the environment and in
# pyproject.toml for source-distribution build environments)
echo "Installing dependencies (this may take a while)..."
VIRTUAL_ENV=env uv pip install -r requirements.txt

# Fix ctranslate2 executable stack issue on newer kernels
echo "Checking ctranslate2 executable-stack flag..."
env/bin/python - <<'PY'
import glob
import struct
import sys

paths = glob.glob("env/lib/python3.10/site-packages/ctranslate2.libs/libctranslate2-*.so.*")
if not paths:
    sys.exit("ctranslate2 shared library not found - did the install step succeed?")

path = paths[0]
data = bytearray(open(path, "rb").read())

e_phoff = struct.unpack_from("<Q", data, 32)[0]
e_phentsize = struct.unpack_from("<H", data, 54)[0]
e_phnum = struct.unpack_from("<H", data, 56)[0]

changed = False
for i in range(e_phnum):
    off = e_phoff + i * e_phentsize
    if struct.unpack_from("<I", data, off)[0] == 0x6474E551:  # PT_GNU_STACK
        flags_off = off + 4
        flags = struct.unpack_from("<I", data, flags_off)[0]
        if flags & 0x1:
            struct.pack_into("<I", data, flags_off, flags & ~0x1)
            changed = True
        break

if changed:
    with open(path, "wb") as f:
        f.write(data)
    print(f"{path}: cleared executable-stack flag")
else:
    print(f"{path}: executable-stack flag already clear, nothing to do")
PY

# ctranslate2 4.4.0 bundles only the cuDNN 8.9.7 dispatcher, not the component
# libraries it loads on first use; without them the GPU path aborts with
# "Could not load library libcudnn_ops_infer.so.8". Symlink the components
# from torch's nvidia-cudnn-cu12 package next to the dispatcher.
echo "Linking cuDNN component libraries for ctranslate2..."
CT2LIBS=env/lib/python3.10/site-packages/ctranslate2.libs
CUDNN_LIBS="libcudnn_ops_infer.so.8 libcudnn_ops_train.so.8 libcudnn_cnn_infer.so.8 libcudnn_cnn_train.so.8 libcudnn_adv_infer.so.8 libcudnn_adv_train.so.8"
for lib in $CUDNN_LIBS; do
    ln -sf ../nvidia/cudnn/lib/$lib "$CT2LIBS/$lib"
done

# Download Piper TTS models (skipped when the files are already present)
echo "Checking Piper TTS models..."
mkdir -p src/resources/models
download_if_missing() {
    local url="$1"
    local dest="$2"
    if [ -s "$dest" ]; then
        echo "  $(basename "$dest"): already present, skipping"
        return 0
    fi
    echo "  $(basename "$dest"): downloading"
    if ! curl -L --fail -o "$dest.part" "$url"; then
        rm -f "$dest.part"
        echo "  $(basename "$dest"): download failed" >&2
        return 1
    fi
    mv "$dest.part" "$dest"
}

download_if_missing "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx" "src/resources/models/en-us-ryan-high.onnx"
download_if_missing "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx.json" "src/resources/models/en-us-ryan-high.onnx.json"
download_if_missing "https://huggingface.co/rhasspy/piper-voices/resolve/main/nl/nl_BE/rdh/medium/nl_BE-rdh-medium.onnx" "src/resources/models/nl_BE-rdh-medium.onnx"
download_if_missing "https://huggingface.co/rhasspy/piper-voices/resolve/main/nl/nl_BE/rdh/medium/nl_BE-rdh-medium.onnx.json" "src/resources/models/nl_BE-rdh-medium.onnx.json"

# Create .env for server mode
cat > .env << 'EOF'
PYTHONPATH=.
DEMONSTRATOR_MODE="server"
DEMONSTRATOR_PROFILE="default"
EOF

# Check the CUDA stack, including whether ctranslate2 can load cuDNN: the wheel
# ships the cuDNN dispatcher but not its component libraries, so this tells us
# whether the environment resolves them.
echo ""
echo "=== Checking CUDA stack ==="
env/bin/python - <<'PY'
import glob
import os

import ctranslate2
import torch

print(f"torch {torch.__version__}, cuda available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"  device: {torch.cuda.get_device_name(0)}")
    try:
        print(f"  torch's cuDNN: {torch.backends.cudnn.version()}")
    except Exception as exc:
        print(f"  torch's cuDNN: unavailable ({exc})")
nvidia_cudnn = glob.glob(
    os.path.join(os.path.dirname(torch.__file__), os.pardir, "nvidia", "cudnn", "lib", "libcudnn*")
)
print(f"  nvidia-cudnn-cu12 files: {len(nvidia_cudnn)}")
print(f"ctranslate2 {ctranslate2.__version__}, cuda devices: {ctranslate2.get_cuda_device_count()}")
PY

set +e
env/bin/python - <<'PY'
import ctypes
import glob
import os
import sys

import ctranslate2

libs_dir = os.path.normpath(
    os.path.join(os.path.dirname(ctranslate2.__file__), os.pardir, "ctranslate2.libs")
)
dispatchers = glob.glob(os.path.join(libs_dir, "libcudnn-*.so.*"))
if not dispatchers:
    sys.exit(f"no bundled cuDNN dispatcher found in {libs_dir}")

cudnn = ctypes.CDLL(dispatchers[0])
handle = ctypes.c_void_p()
cudnn.cudnnCreate(ctypes.byref(handle))
print("ctranslate2's bundled cuDNN dispatcher loaded its component libraries")
PY
CUDNN_PROBE=$?
set -e

if [ "$CUDNN_PROBE" -eq 0 ]; then
    echo "cuDNN: OK"
else
    echo "cuDNN: ctranslate2's dispatcher could not load cuDNN (exit $CUDNN_PROBE)."
    echo "      Start the server with the cuDNN directory on the loader path instead:"
    echo "        LD_LIBRARY_PATH=env/lib/python3.10/site-packages/nvidia/cudnn/lib python src/main.py"
fi

echo ""
echo "=== Setup complete! ==="
echo ""
echo "To start the server:"
echo "  source env/bin/activate"
if [ "$CUDNN_PROBE" -eq 0 ]; then
    echo "  python src/main.py"
else
    echo "  LD_LIBRARY_PATH=env/lib/python3.10/site-packages/nvidia/cudnn/lib python src/main.py"
fi
echo ""
echo "To connect from the demo laptop:"
echo "  ssh -L 8031:localhost:8031 youruser@remote-server"
echo ""
