# PyInstaller spec for the standalone, single-file Azimut executable.
#
# Prerequisites (CI does this):
#   1. Build the frontend so src/azimut/static exists:  (cd frontend && npm run build)
#   2. Install the package so its data is discoverable:  pip install .
#   3. Build:                                            pyinstaller packaging/azimut.spec
#
# The bundled UI (azimut/static/**) and uvicorn / yt-dlp submodules are collected
# explicitly because they are loaded dynamically and PyInstaller can't see them.

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

hiddenimports = (
    collect_submodules("uvicorn")
    + collect_submodules("azimut")
    + collect_submodules("yt_dlp")
)

# Grabs azimut/static/** (index.html, assets, favicon) from the installed package.
datas = collect_data_files("azimut")

a = Analysis(
    ["entry.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

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
)
