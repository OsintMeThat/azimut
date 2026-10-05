"""A stand-in for yt-dlp, so a download runs without a network."""

import io
import os
import sys
import types

from PIL import Image


def png_bytes(color=(200, 30, 30), size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def install_fake_ydl(monkeypatch, extract_info_fn, content_fn=None):
    """Patch a fake ``yt_dlp`` module. ``extract_info_fn(ydl, url, download)``
    returns the info dict from the (single) ``extract_info`` call; ``prepare_filename``
    writes a placeholder PNG next to the resolved name so ``download_url`` finds it
    — ``content_fn(info)`` picks its bytes (default: identical for every call;
    pass a per-``info`` variant to avoid sha256-dedup collisions across items
    that are supposed to be distinct, e.g. in a concurrency test).
    ``process_ie_result`` is a passthrough, matching the real "download from
    already-extracted info, no second extraction" call ``download_url`` makes."""
    content_fn = content_fn or (lambda info: png_bytes())

    class FakeYDL:
        def __init__(self, opts):
            self.opts = opts

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def prepare_filename(self, info):
            path = os.path.join(
                os.path.dirname(self.opts["outtmpl"]), f"{info['title']} [{info['id']}].png"
            )
            with open(path, "wb") as fh:
                fh.write(content_fn(info))
            return path

        def process_ie_result(self, info, download=True):
            return info

        def extract_info(self, url, download=False):
            return extract_info_fn(self, url, download)

    fake = types.ModuleType("yt_dlp")
    fake.YoutubeDL = FakeYDL
    monkeypatch.setitem(sys.modules, "yt_dlp", fake)
