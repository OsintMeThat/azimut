"""Azimut, a local OSINT workspace."""

import warnings

from PIL import Image as _Image

# The single source of truth for the app version. pyproject.toml reads it back
# through hatchling's dynamic version (``[tool.hatch.version]``) and the
# extension manifest is kept in lock-step by a test, so a release is bumped in
# exactly one place. Getting this wrong nags every user with a false update
# (the binary's self-check compares this against the latest GitHub tag).
__version__ = "0.2.6"

# Cap the pixels Pillow will decode from a file, process-wide. A tiny,
# highly-compressed image can otherwise expand to gigabytes in memory and take
# the process down (a local denial of service). 100 MP sits far above any
# legitimate input — a screenshot, a satellite crop (≤4096²) or a proof — and
# well under Pillow's ~179 MP default. This only guards *decoding untrusted
# files*; composites built with Image.new() are unaffected. Set here because
# importing azimut is the one thing every entry point does first.
_Image.MAX_IMAGE_PIXELS = 100_000_000
warnings.filterwarnings("error", category=_Image.DecompressionBombWarning)
