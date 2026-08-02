# PyInstaller spec for the standalone, single-file Azimut executable.
#
# Prerequisites (CI does this):
#   1. Build the frontend so src/azimut/static exists:  (cd frontend && npm run build)
#   2. Install the package so its data is discoverable:  pip install .
#   3. Build:                                            pyinstaller packaging/azimut.spec
#
# The bundled UI (azimut/static/**) and uvicorn / yt-dlp / gallery-dl submodules
# are collected explicitly because they are loaded dynamically and PyInstaller
# can't see them.

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

hiddenimports = (
    collect_submodules("uvicorn")
    + collect_submodules("azimut")
    + collect_submodules("yt_dlp")
    + collect_submodules("gallery_dl")
    # fontTools loads a TrueType table's converter by looking up a module named
    # after the tag it just read, so nothing imports those modules by name and
    # PyInstaller cannot see them. Without this the notes PDF would fail in the
    # frozen binary only, on the first font fpdf2 subsets.
    + collect_submodules("fontTools")
)

# Linux only: yt-dlp reaches for these lazily to unseal a Chromium-family
# browser's cookies from the Secret Service keyring (gated downloads, see
# engine/media.py + pyproject.toml). They aren't submodules of anything above,
# so PyInstaller can't discover them on its own. macOS uses the `security` CLI
# and Windows uses the cookies.txt fallback, so neither bundles these.
if sys.platform == "linux":
    hiddenimports += (
        collect_submodules("secretstorage")
        + collect_submodules("jeepney")
        + ["cryptography"]
    )

# Grabs the package's data files from the installed wheel: azimut/static/**
# (index.html, assets, favicon) and azimut/assets/fonts/** — the 15 MB of Noto,
# Droid and DejaVu faces the notes PDF draws with (engine/pdffonts.py). The
# fonts have to be in the bundle, not on the machine: a PDF embeds the glyphs it
# uses, so an export made on Windows and one made on Linux must find the same
# faces or they are different documents.
datas = collect_data_files("azimut")

# The IANA timezone database, which `zoneinfo` falls back to when the OS has none
# — that is Windows. Nothing imports `tzdata` by name, so PyInstaller cannot
# discover it, and a missing database would not crash: engine/localtime.py would
# quietly answer UTC and every local time in the sun and moon panel would be wrong
# on Windows only. Collected explicitly for all three platforms, at 3 MB.
#
# Both halves are needed. `zoneinfo` reaches a zone as
# `importlib.resources.files("tzdata.zoneinfo.Europe")`, so every region folder has
# to be an importable package (the submodules) as well as a file on disk (the data)
# — naming `tzdata` alone would ship the TZif files under a package Python cannot
# import, which is the same silent UTC.
datas += collect_data_files("tzdata")
hiddenimports += collect_submodules("tzdata")

# Static ffmpeg / ffprobe, when the release CI has dropped them in
# packaging/vendor/. They land at the bundle root, where engine/ffmpeg.py looks
# for them (sys._MEIPASS). Absent (a plain local build), the binary just falls
# back to a system ffmpeg on PATH — same as a pip install. See docs/SPEC.md.
vendor = Path(SPECPATH) / "vendor"
binaries = [
    (str(p), ".")
    for name in ("ffmpeg", "ffprobe", "ffmpeg.exe", "ffprobe.exe")
    for p in [vendor / name]
    if p.is_file()
]

a = Analysis(
    ["entry.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

# The .exe icon. Windows is the only shipped artifact that embeds one: Linux
# binaries can't, and our macOS artifact is a raw binary (not an .app bundle),
# so Finder shows no custom icon there either. PyInstaller wants a .ico.
ico = Path(SPECPATH) / "azimut.ico"
icon = str(ico) if sys.platform == "win32" and ico.is_file() else None

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="azimut",
    console=True,           # it's a local server; the console shows the URL
    disable_windowed_traceback=False,
    upx=False,
    icon=icon,
)
