"""Build a single self-contained HTML file from the Mudel sources.

Inlines style.css, js/ephem.js, js/app.js and the Earth texture, and loads
three.js from the jsDelivr CDN instead of js/vendor (so the file opens without
a local web server, but needs internet).

Usage:  python build_single.py [output.html]   (default: ../../varjutuste_mudel.html)
"""
import base64
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "..", "varjutuste_mudel.html")
CDN = "https://cdn.jsdelivr.net/npm/three@0.160.0/"


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


html = read("index.html")
css = read("style.css")
ephem = re.sub(r"\nexport \{.*?\};\n", "\n", read("js/ephem.js"), flags=re.S)
app = re.sub(r"import \{[^}]*\} from './ephem.js';\n", "", read("js/app.js"))
with open(os.path.join(ROOT, "textures", "earth.jpg"), "rb") as f:
    tex = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
app = app.replace("'textures/earth.jpg'", "'" + tex + "'")
# Ephemeris goes right after the three.js imports
app = app.replace("import { OrbitControls } from 'three/addons/controls/OrbitControls.js';\n",
                  "import { OrbitControls } from 'three/addons/controls/OrbitControls.js';\n\n" + ephem, 1)

html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + css + "</style>")
html = html.replace('"./js/vendor/three/three.module.js"', '"' + CDN + 'build/three.module.js"')
html = html.replace('"./js/vendor/three/addons/"', '"' + CDN + 'examples/jsm/"')
html = html.replace('<script type="module" src="js/app.js"></script>', '<script type="module">\n' + app + "</script>")

with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)
print(f"Wrote {os.path.normpath(OUT)} ({len(html) / 1024:.0f} kB)")
