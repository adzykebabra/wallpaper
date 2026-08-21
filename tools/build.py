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

# .svg first: a vector lockup stays sharp at every size, unlike a bitmap
ASSET_MIME = {
    ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
}


def asset_data_uri(stem, label):
    """Inline assets/<stem>.(svg|png|webp|jpg) if it has been dropped in.

    Optional. Without it the wallpaper draws its own artwork, which stays
    sharp at any resolution; with it, the supplied file is used verbatim.
    """
    for ext, mime in ASSET_MIME.items():
        path = os.path.join(ROOT, "assets", stem + ext)
        if not os.path.exists(path):
            continue
        with open(path, "rb") as f:
            raw = f.read()
        print("%s: assets/%s%s (%.1f KB)" % (label, stem, ext, len(raw) / 1024))
        return "data:%s;base64,%s" % (mime, base64.b64encode(raw).decode("ascii"))
    return ""


def placemat_data_uri():
    return asset_data_uri("placemat", "  placemat")


def guest_endpoint():
    """Read assets/guests-endpoint.txt, if present.

    Optional. Without it GUEST_ENDPOINT is empty and the wallpaper never
    makes a network request of any kind.
    """
    path = os.path.join(ROOT, "assets", "guests-endpoint.txt")
    if not os.path.exists(path):
        return ""
    url = ""
    with open(path, encoding="utf8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                url = line
                break
    if not url:
        return ""
    local_dev = url.startswith("http://localhost") or url.startswith("http://127.0.0.1")
    if not url.startswith("https://") and not local_dev:
        sys.exit("guests-endpoint.txt must be an https:// URL, got: " + url)
    if local_dev:
        print("  WARNING: local dev endpoint, do not ship this build")
    if "'" in url or "\\" in url:
        sys.exit("guests-endpoint.txt contains characters that cannot be inlined")
    print("  guest endpoint: " + url)
    return url


def main():
    tpl = read("src", "wallpaper.template.html")
    app = read("src", "app.js")
    fonts = json.loads(read("assets", "fonts.json"))
    app = app.replace("__PLACEMAT_SRC__", placemat_data_uri())
    app = app.replace("__GUEST_ENDPOINT__", guest_endpoint())
    app = app.replace("__LOGO_SRC__", asset_data_uri("logo", "  logo"))

    if "</script>" in app:
        sys.exit("app.js must not contain a literal </script>")

    html = (tpl
            .replace("__FONT_PRESSSTART__", fonts["pressstart"])
            .replace("__FONT_RAJDHANI__", fonts["rajdhani700"])
            .replace("__APP_JS__", app))

    for token in ("__FONT_PRESSSTART__", "__FONT_RAJDHANI__", "__APP_JS__",
                  "__PLACEMAT_SRC__", "__GUEST_ENDPOINT__", "__LOGO_SRC__"):
        if token in html:
            sys.exit("unsubstituted token: " + token)

    with open(OUT, "w", encoding="utf8") as f:
        f.write(html)
    print("wrote %s (%.1f KB)" % (os.path.relpath(OUT, ROOT), len(html.encode()) / 1024))

if __name__ == "__main__":
    main()
