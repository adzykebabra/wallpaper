#!/usr/bin/env python3
"""Inline app.js + the woff2 subsets into the single distributable wallpaper file.

    python3 tools/build.py

Fonts live in assets/fonts.json as base64 woff2 (latin subsets of Press Start 2P
and Rajdhani 700) so the wallpaper works with no network access at all.
"""
import base64, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "Bluerydge_Arena_Wallpaper.html")

def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf8") as f:
        return f.read()

PLACEMAT_MIME = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif",
}


def placemat_data_uri():
    """Inline assets/placemat.* if the real artwork has been dropped in.

    Optional. Without it the wallpaper draws its own Bluerydge lockup, which
    stays sharp at any resolution; with it, the supplied artwork is used
    verbatim, centred on each monitor.
    """
    for ext, mime in PLACEMAT_MIME.items():
        path = os.path.join(ROOT, "assets", "placemat" + ext)
        if not os.path.exists(path):
            continue
        with open(path, "rb") as f:
            raw = f.read()
        uri = "data:%s;base64,%s" % (mime, base64.b64encode(raw).decode("ascii"))
        print("  embedding assets/placemat%s (%.1f KB)" % (ext, len(raw) / 1024))
        return uri
    return ""


def main():
    tpl = read("src", "wallpaper.template.html")
    app = read("src", "app.js")
    fonts = json.loads(read("assets", "fonts.json"))
    app = app.replace("__PLACEMAT_SRC__", placemat_data_uri())

    if "</script>" in app:
        sys.exit("app.js must not contain a literal </script>")

    html = (tpl
            .replace("__FONT_PRESSSTART__", fonts["pressstart"])
            .replace("__FONT_RAJDHANI__", fonts["rajdhani700"])
            .replace("__APP_JS__", app))

    for token in ("__FONT_PRESSSTART__", "__FONT_RAJDHANI__", "__APP_JS__",
                  "__PLACEMAT_SRC__"):
        if token in html:
            sys.exit("unsubstituted token: " + token)

    with open(OUT, "w", encoding="utf8") as f:
        f.write(html)
    print("wrote %s (%.1f KB)" % (os.path.relpath(OUT, ROOT), len(html.encode()) / 1024))

if __name__ == "__main__":
    main()
