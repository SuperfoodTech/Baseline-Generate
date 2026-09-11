#!/usr/bin/env python3
"""
Root entrypoint wrapper for OFD Report Automation Pipeline.
Delegates all CLI calls to src/cli.py with correct working directory.
"""
import os
import sys
import subprocess

if __name__ == "__main__":
    current_dir = os.path.dirname(os.path.abspath(__file__))
    src_dir = os.path.join(current_dir, "src")
    src_cli = os.path.join(src_dir, "cli.py")

    # Locate Python interpreter: prefer src/.venv or root .venv if exists, fallback to sys.executable
    venv_candidates = [
        os.path.join(src_dir, ".venv", "bin", "python"),
        os.path.join(current_dir, ".venv", "bin", "python"),
        os.path.join(src_dir, ".venv", "Scripts", "python.exe"),
        os.path.join(current_dir, ".venv", "Scripts", "python.exe"),
    ]
    python_exe = sys.executable
    for cand in venv_candidates:
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            python_exe = cand
            break

    cmd = [python_exe, src_cli] + sys.argv[1:]
    try:
        result = subprocess.run(cmd, cwd=src_dir)
        sys.exit(result.returncode)
    except KeyboardInterrupt:
        sys.exit(130)
