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

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

hiddenimports = (
    collect_submodules("uvicorn")
    + collect_submodules("azimut")
    + collect_submodules("yt_dlp")
    + collect_submodules("gallery_dl")
)

# Grabs azimut/static/** (index.html, assets, favicon) from the installed package.
datas = collect_data_files("azimut")

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
import sys

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
