"""Is this package's V8 library for the machine Cura runs on? No Cura imports.

Each .curapackage carries one platform's mini-racer library (build.py, platform.json).
Installed on the wrong machine it fails to load with a ctypes error nobody can act
on; this turns that into "wrong download, get the one for <this machine>".
"""
import json
import os
import platform
import sys
import sysconfig

RELEASE = "https://github.com/gittrahan/support-fins/releases/tag/plugins-latest"

# what platform.machine() says on each OS -> build.py's names
_MACHINE = {"x86_64": "x86_64", "amd64": "amd64", "arm64": "arm64", "aarch64": "aarch64"}
_OS_NAME = {"darwin": "macOS", "win32": "Windows", "linux": "Linux"}


def here(os_name=None, machine=None):
    """(sys.platform, machine) for this process, in build.py's spelling."""
    os_name = os_name or sys.platform
    if machine is None and os_name == "win32":
        # The PROCESS's architecture, not the CPU's: Python 3.12's platform.machine()
        # asks Windows for the native CPU, so x64 Cura emulated on an ARM PC says ARM64
        # while it loads x64 libraries fine. sysconfig says "win-amd64" there.
        machine = sysconfig.get_platform().split("-", 1)[-1]
    machine = (machine or platform.machine()).lower()
    machine = _MACHINE.get(machine, machine)
    if os_name == "darwin" and machine == "aarch64":
        machine = "arm64"
    if os_name == "linux" and machine == "arm64":
        machine = "aarch64"
    if os_name == "win32" and machine == "x86_64":
        machine = "amd64"
    return os_name, machine


def mismatch(plugin_dir, os_name=None, machine=None):
    """None when the package fits this machine (or says nothing), else the message."""
    path = os.path.join(plugin_dir, "platform.json")
    if not os.path.exists(path):
        return None                      # a dev build linked in: nothing to check
    with open(path, encoding="utf-8") as f:
        built = json.load(f)
    now = here(os_name, machine)
    if (built["os"], built["machine"]) == now:
        return None
    mine = f"{_OS_NAME.get(now[0], now[0])} ({now[1]})"
    return (f"This Support Fins package is for {built['name']}, but Cura is running on {mine}. "
            f"Download the package for your computer from {RELEASE}")
