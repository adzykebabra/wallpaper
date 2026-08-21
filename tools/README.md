# Dev tooling

Optional. The wallpaper itself has no build-time or runtime dependencies —
these scripts just make it easier to iterate on the pixel art.

    python3 tools/build.py          # regenerate Bluerydge_Arena_Wallpaper.html

    npm install --no-save playwright
    node tools/preview.js Bluerydge_Arena_Wallpaper.html "?density=2" 3840 1080 out.png 6000
    node tools/spritesheet.js sheet.png 5    # contact sheet of every fighter/frame

`spritesheet.js` needs `?debug=1`, which exposes the baked sheets on
`window.__arena`. It is inert without that flag.
