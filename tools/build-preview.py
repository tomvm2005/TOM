#!/usr/bin/env python3
"""Maakt één los HTML-bestand (scripts ingebakken) van index.html: python3 tools/build-preview.py uitvoer.html"""
import re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
s = (root / "index.html").read_text()
for f in ["config", "engine", "cloud", "app"]:
    tag = f'<script src="js/{f}.js"></script>'
    assert tag in s, tag
    s = s.replace(tag, "<script>\n" + (root / "js" / f"{f}.js").read_text() + "\n</script>")
pathlib.Path(sys.argv[1]).write_text(s)
