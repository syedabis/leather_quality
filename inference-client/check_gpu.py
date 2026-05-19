"""
GPU & CUDA readiness check for the spray-plant inference client.
Run this before run_live_preview.py to verify the environment is ready.

    python check_gpu.py
"""

import subprocess
import sys

PASS = "[PASS]"
FAIL = "[FAIL]"
WARN = "[WARN]"
INFO = "[INFO]"

def section(title):
    print(f"\n{'='*50}")
    print(f"  {title}")
    print('='*50)

# ── 1. Python version ──────────────────────────────
section("Python")
v = sys.version_info
print(f"{INFO} Python {sys.version}")
if v >= (3, 11) and v < (3, 14):
    print(f"{PASS} Version is compatible (3.11–3.13 recommended)")
elif v >= (3, 14):
    print(f"{WARN} Python 3.14 — PyTorch wheels may be missing. Use 3.11.")
else:
    print(f"{FAIL} Python {v.major}.{v.minor} is too old. Install 3.11+.")

# ── 2. NVIDIA driver (nvidia-smi) ─────────────────
section("NVIDIA Driver")
try:
    out = subprocess.check_output(
        ["nvidia-smi", "--query-gpu=name,driver_version,memory.total",
         "--format=csv,noheader"],
        stderr=subprocess.DEVNULL
    ).decode().strip()
    for line in out.split("\n"):
        name, driver, mem = [x.strip() for x in line.split(",")]
        print(f"{PASS} GPU found : {name}")
        print(f"{INFO} Driver    : {driver}")
        print(f"{INFO} VRAM      : {mem}")
except FileNotFoundError:
    print(f"{FAIL} nvidia-smi not found — NVIDIA drivers not installed or not in PATH")
    print(f"      Download: https://www.nvidia.com/Download/index.aspx")
except subprocess.CalledProcessError:
    print(f"{FAIL} nvidia-smi failed — driver issue detected")

# ── 3. PyTorch import ─────────────────────────────
section("PyTorch")
try:
    import torch
    print(f"{PASS} torch {torch.__version__} imported successfully")

    # ── 4. CUDA availability ───────────────────────
    section("CUDA")
    if torch.cuda.is_available():
        print(f"{PASS} CUDA is available")
        print(f"{INFO} CUDA version : {torch.version.cuda}")
        print(f"{INFO} Device count  : {torch.cuda.device_count()}")
        for i in range(torch.cuda.device_count()):
            props = torch.cuda.get_device_properties(i)
            print(f"{INFO} Device {i}      : {props.name}")
            print(f"{INFO} VRAM          : {props.total_memory / 1024**3:.1f} GB")
            print(f"{INFO} Compute cap.  : {props.major}.{props.minor}")

        # Quick tensor test
        try:
            t = torch.tensor([1.0, 2.0]).cuda()
            print(f"{PASS} GPU tensor test passed")
        except Exception as e:
            print(f"{FAIL} GPU tensor test failed: {e}")
    else:
        cuda_ver = getattr(torch.version, "cuda", None)
        if cuda_ver:
            print(f"{FAIL} CUDA not available — torch built for CUDA {cuda_ver} but runtime not found")
            print(f"      Install CUDA toolkit: https://developer.nvidia.com/cuda-toolkit")
            print(f"      Or reinstall CPU torch: pip install torch --index-url https://download.pytorch.org/whl/cpu")
        else:
            print(f"{WARN} Running CPU-only torch — no CUDA support in this build")
            print(f"      For RTX 4050, install: pip install torch --index-url https://download.pytorch.org/whl/cu121")
        print(f"{INFO} Inference will run on CPU (slower but functional)")

except ImportError as e:
    print(f"{FAIL} torch not installed or broken: {e}")
    print(f"      Run: pip install -r requirements.txt")
    section("CUDA")
    print(f"{FAIL} Skipped — torch must be installed first")

# ── 5. Key dependencies ───────────────────────────
section("Key Dependencies")
deps = {
    "cv2": "opencv-python",
    "ultralytics": "ultralytics",
    "pyodbc": "pyodbc",
    "dotenv": "python-dotenv",
    "requests": "requests",
    "numpy": "numpy",
}
all_ok = True
for mod, pkg in deps.items():
    try:
        m = __import__(mod)
        ver = getattr(m, "__version__", "?")
        print(f"{PASS} {pkg:<20} {ver}")
    except ImportError:
        print(f"{FAIL} {pkg:<20} NOT INSTALLED  →  pip install {pkg}")
        all_ok = False

# ── 6. Summary ────────────────────────────────────
section("Summary")
try:
    import torch
    if torch.cuda.is_available():
        device = torch.cuda.get_device_properties(0).name
        print(f"{PASS} Ready for GPU inference on {device}")
    else:
        print(f"{WARN} GPU not available — will run on CPU")
        print(f"      For RTX 4050 install: pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121")
except ImportError:
    print(f"{FAIL} Not ready — install requirements first")
    print(f"      pip install -r requirements.txt")

if not all_ok:
    print(f"{FAIL} Some dependencies missing — run: pip install -r requirements.txt")

print()
