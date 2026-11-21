"""What a file someone else sent could do when opened, read from its first bytes alone.

A case may hold any file: analysts keep documents and archives, and a bundle mostly moves
one's own case to another machine. So nothing here refuses a file. It names two kinds, for
an import to leave out unless the analyst keeps them (`engine/bundles.py`):

- **what runs when opened**: a program (a Windows `MZ`, a Linux ELF, a macOS Mach-O, a Java
  class), a script (a `#!` first line, or a name Windows, macOS or Linux runs as one), an
  installer, a shortcut, a document with macros, a macOS `.app` folder. A file Azimut writes
  out of a bundle carries no mark of where it came from, so the system would not warn first;
- **a disguised file**: one named as a picture, a video or a sound whose first bytes are none
  of those. A `.jpg` holding a PNG or a WebP is still a picture, which downloads often are,
  and passes; a `.mp4` holding a playlist, a web page or a program does not, and the tools
  that read media (ffmpeg, the picture reader) would be handed it.

Only `HEAD_BYTES` are read of each file, so the check costs next to nothing on any case. The
names and their extensions are read the same on every system, never from the system's own
table of file types.
"""

from __future__ import annotations

import struct
from pathlib import PurePosixPath

#: How much of a file the screen reads.
HEAD_BYTES = 64

#: What runs when opened, by the extension Windows, macOS or Linux runs it by.
PROGRAM_SUFFIXES = frozenset({
    ".exe", ".dll", ".scr", ".com", ".pif", ".cpl", ".ocx", ".sys", ".drv", ".efi", ".appimage", ".run",
})
JAVA_SUFFIXES = frozenset({".jar", ".class"})
SCRIPT_SUFFIXES = frozenset({
    ".bat", ".cmd", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".hta", ".sct", ".msc",
    ".reg", ".sh", ".bash", ".zsh", ".csh", ".ksh", ".command", ".py", ".pyw", ".pyc", ".scpt", ".applescript",
})
INSTALLER_SUFFIXES = frozenset({
    ".msi", ".msp", ".mst", ".msix", ".msixbundle", ".appx", ".appxbundle", ".pkg", ".mpkg", ".dmg", ".deb",
    ".rpm", ".apk",
})
SHORTCUT_SUFFIXES = frozenset({".lnk", ".url", ".scf", ".desktop", ".webloc", ".inetloc"})
MACRO_SUFFIXES = frozenset({
    ".docm", ".dotm", ".xlsm", ".xltm", ".xlam", ".xlsb", ".pptm", ".potm", ".ppam", ".ppsm", ".sldm",
})
#: A macOS app is a folder: every file under one goes with it.
APP_SUFFIX = ".app"

#: The names that claim a picture, a video or a sound, as the screen reads them.
PICTURE_SUFFIXES = frozenset({
    ".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".ico", ".heic",
    ".heif", ".avif", ".jxl", ".jp2", ".psd", ".svg",
})
VIDEO_SUFFIXES = frozenset({
    ".mp4", ".m4v", ".mov", ".qt", ".3gp", ".3g2", ".mkv", ".webm", ".avi", ".wmv", ".asf", ".flv", ".mpg",
    ".mpeg", ".ogv",
})
AUDIO_SUFFIXES = frozenset({
    ".mp3", ".m4a", ".m4b", ".aac", ".wav", ".flac", ".ogg", ".oga", ".opus", ".wma", ".aif", ".aiff", ".amr",
    ".mka", ".weba",
})

#: The words each reason is said in.
WINDOWS_PROGRAM = "a Windows program"
LINUX_PROGRAM = "a Linux program"
MAC_PROGRAM = "a macOS program"
JAVA_PROGRAM = "a Java program"
MAC_APP = "a macOS app"
PROGRAM = "a program"
SCRIPT = "a script"
INSTALLER = "an installer"
SHORTCUT = "a shortcut"
MACROS = "a document with macros"
#: A name that lies: the extension, then what it claims.
DISGUISED = "named {suffix} but not {claim}"

_MACH_O = (b"\xfe\xed\xfa\xce", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe", b"\xcf\xfa\xed\xfe")
_LNK = b"\x4c\x00\x00\x00\x01\x14\x02\x00\x00\x00\x00\x00\xc0\x00\x00\x00\x00\x00\x00\x46"
#: The ISO media brands of a still picture (HEIF, AVIF, Canon's CR3), which share video's box.
_PICTURE_BRANDS = frozenset({b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1", b"avif",
                             b"avis", b"crx "})
#: The boxes an ISO media file (MP4, MOV, 3GP, M4A) may start with.
_ISO_BOXES = frozenset({b"ftyp", b"moov", b"mdat", b"free", b"wide", b"skip", b"pnot"})


def _iso(head: bytes) -> bool:
    return head[4:8] in _ISO_BOXES


def _riff(head: bytes, kind: bytes) -> bool:
    return head[:4] == b"RIFF" and head[8:12] == kind


def is_picture(head: bytes) -> bool:
    """Whether the first bytes are a picture's, of any of the kinds a case may hold."""
    return (
        head[:3] == b"\xff\xd8\xff"
        or head[:8] == b"\x89PNG\r\n\x1a\n"
        or head[:6] in (b"GIF87a", b"GIF89a")
        or _riff(head, b"WEBP")
        or head[:2] == b"BM"
        or head[:4] in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")
        or head[:4] in (b"\x00\x00\x01\x00", b"\x00\x00\x02\x00")
        or (head[4:8] == b"ftyp" and head[8:12] in _PICTURE_BRANDS)
        or head[:2] == b"\xff\x0a"
        or head[:12] in (b"\x00\x00\x00\x0cJXL \r\n\x87\n", b"\x00\x00\x00\x0cjP  \r\n\x87\n")
        or head[:4] == b"\xff\x4f\xff\x51"
        or head[:4] == b"8BPS"
    )


def _is_svg(head: bytes) -> bool:
    """An SVG is text: markup from its first sign, after a byte-order mark and blank space."""
    return head.removeprefix(b"\xef\xbb\xbf").lstrip()[:1] == b"<"


def is_video(head: bytes) -> bool:
    return (
        _iso(head)
        or head[:4] == b"\x1a\x45\xdf\xa3"
        or _riff(head, b"AVI ")
        or head[:8] == b"\x30\x26\xb2\x75\x8e\x66\xcf\x11"
        or head[:3] == b"FLV"
        or head[:4] in (b"\x00\x00\x01\xba", b"\x00\x00\x01\xb3")
        or head[:4] == b"OggS"
    )


def is_audio(head: bytes) -> bool:
    return (
        head[:3] == b"ID3"
        or (len(head) >= 2 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0)
        or head[:4] in (b"fLaC", b"OggS", b"ADIF")
        or _riff(head, b"WAVE")
        or (head[:4] == b"FORM" and head[8:12] in (b"AIFF", b"AIFC"))
        or _iso(head)
        or head[:4] == b"\x1a\x45\xdf\xa3"
        or head[:8] == b"\x30\x26\xb2\x75\x8e\x66\xcf\x11"
        or head[:5] == b"#!AMR"
    )


def app_folder(name: str) -> str:
    """The `.app` folder a path lies in, as far as its name ("Tool.app"), or "" for none."""
    parts = PurePosixPath(name).parts
    for index, part in enumerate(parts[:-1]):
        if part.lower().endswith(APP_SUFFIX) and len(part) > len(APP_SUFFIX):
            return "/".join(parts[: index + 1])
    return ""


def _program(head: bytes) -> str:
    """What runs that the first bytes say, whatever the name: "" for none."""
    if head[:2] == b"MZ":
        return WINDOWS_PROGRAM
    if head[:4] == b"\x7fELF":
        return LINUX_PROGRAM
    if head[:4] in _MACH_O:
        return MAC_PROGRAM
    if head[:4] == b"\xca\xfe\xba\xbe" and len(head) >= 8:
        # a universal Mach-O counts its few architectures where a Java class has its version, 45 or more
        return MAC_PROGRAM if struct.unpack(">I", head[4:8])[0] < 45 else JAVA_PROGRAM
    if head[:len(_LNK)] == _LNK:
        return SHORTCUT
    if head[:2] == b"#!":
        return SCRIPT
    return ""


def _claim(suffix: str) -> str:
    """What a name claims to be, "" for a name that claims no media."""
    if suffix in PICTURE_SUFFIXES:
        return "a picture"
    if suffix in VIDEO_SUFFIXES:
        return "a video"
    return "a sound" if suffix in AUDIO_SUFFIXES else ""


def _bears_out(suffix: str, head: bytes) -> bool:
    if suffix == ".svg":
        return _is_svg(head)
    if suffix in PICTURE_SUFFIXES:
        return is_picture(head)
    if suffix in VIDEO_SUFFIXES:
        return is_video(head)
    return is_audio(head)


def reason(name: str, head: bytes) -> str:
    """Why a file is one to leave out, in a few words, or "" for an ordinary file. ``name`` is its
    path with `/` between folders, ``head`` its first bytes (at least `HEAD_BYTES` of them when the
    file is that long)."""
    if app_folder(name):
        return MAC_APP
    suffix = PurePosixPath(name).suffix.lower()
    claimed = _claim(suffix)
    if claimed and head and _bears_out(suffix, head):
        return ""
    found = _program(head)
    if found:
        return found
    if suffix in PROGRAM_SUFFIXES:
        return PROGRAM
    if suffix in JAVA_SUFFIXES:
        return JAVA_PROGRAM
    if suffix in SCRIPT_SUFFIXES:
        return SCRIPT
    if suffix in INSTALLER_SUFFIXES:
        return INSTALLER
    if suffix in SHORTCUT_SUFFIXES:
        return SHORTCUT
    if suffix in MACRO_SUFFIXES:
        return MACROS
    if suffix == APP_SUFFIX:
        return MAC_APP
    # an empty file holds nothing to hand a reader
    if claimed and head:
        return DISGUISED.format(suffix=suffix, claim=claimed)
    return ""
