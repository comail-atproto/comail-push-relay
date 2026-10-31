#!/usr/bin/env python3
from pathlib import Path
import runpy
import sys

sys.argv.insert(1, 'dependency-merge')
runpy.run_path(str(Path(__file__).with_name("comail-policy-0.1.0.pyz")), run_name="__main__")
