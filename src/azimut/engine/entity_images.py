"""Presentation images attached to hand-made case entities.

An image chosen from the Media Library stays a reference to that existing
media. An image added from the computer is different: it is normalized into a
private presentation file owned by the entity and never enters the Media
Library or the media browse index.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, BinaryIO

from PIL import Image, ImageOps, UnidentifiedImageError

from .. import layout
from ..repository import CaseRepository
from ..workspace import Case, CaseError, _new_id, _replace_with_retry, ensure_dir
from . import entities

IMAGE_TYPES = frozenset({"media", "capture"})
PHOTO_MAX = 2048
THUMB_MAX = 512


def supports(type_: str) -> bool:
    entry = entities.entity_type(type_)
    return bool(entry and entry.image_gallery)


def _target(case: CaseRepository, entity_id: str) -> dict[str, Any]:
    entity = case.get_entity(entity_id)
    if entity is None:
        raise CaseError(f"entity '{entity_id}' not found")
    if not supports(str(entity.get("type") or "")):
        raise CaseError("this entity type does not have a photo gallery")
    return entity


def _media(case: CaseRepository, media_ids: list[str]) -> list[str]:
    unique = list(dict.fromkeys(media_ids))
    kinds = case.media_kinds(unique)
    for media_id in unique:
        entity = case.get_entity(media_id)
        if entity is None:
            raise CaseError(f"entity '{media_id}' not found")
        if entity.get("type") not in IMAGE_TYPES:
            raise CaseError("only case images can be added to a photo gallery")
        kind = kinds.get(media_id) or (entity.get("attrs") or {}).get("kind")
        if kind != "image":
            raise CaseError("only images can be added to a photo gallery")
    return unique


def _title(filename: str | None) -> str:
    name = Path(filename or "").name
    return (Path(name).stem.strip() or "Photo")[:300]


def _write_photo(
    source: BinaryIO,
    photo_path: Path,
    thumb_path: Path,
) -> None:
    photo_tmp = photo_path.with_name(f".{uuid.uuid4().hex}.tmp.jpg")
    thumb_tmp = thumb_path.with_name(f".{uuid.uuid4().hex}.tmp.jpg")
    try:
        with Image.open(source) as opened:
            photo = ImageOps.exif_transpose(opened).convert("RGB")
            photo.thumbnail((PHOTO_MAX, PHOTO_MAX), Image.Resampling.LANCZOS)
            thumb = photo.copy()
            thumb.thumbnail((THUMB_MAX, THUMB_MAX), Image.Resampling.LANCZOS)
            photo.save(photo_tmp, "JPEG", quality=90, optimize=True)
            thumb.save(thumb_tmp, "JPEG", quality=82, optimize=True)
        _replace_with_retry(photo_tmp, photo_path)
        _replace_with_retry(thumb_tmp, thumb_path)
    except (
        OSError,
        SyntaxError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
    ) as exc:
        photo_tmp.unlink(missing_ok=True)
        thumb_tmp.unlink(missing_ok=True)
        photo_path.unlink(missing_ok=True)
        thumb_path.unlink(missing_ok=True)
        raise CaseError("the selected file is not a readable image") from exc
    except BaseException:
        photo_tmp.unlink(missing_ok=True)
        thumb_tmp.unlink(missing_ok=True)
        photo_path.unlink(missing_ok=True)
        thumb_path.unlink(missing_ok=True)
        raise


def import_photo(
    case: Case,
    entity_id: str,
    source: BinaryIO,
    filename: str | None,
) -> dict[str, Any]:
    """Store a bounded private photo without creating a Media entity or row."""
    with case.lock:
        _target(case, entity_id)
        image_id = _new_id("i")
        photo_rel = layout.entity_image_rel(image_id)
        thumb_rel = layout.entity_image_thumb_rel(image_id)
        ensure_dir(layout.entity_images(case.path))
        ensure_dir(layout.entity_image_thumbs(case.path))
        photo_path = case.resolve_inside(photo_rel)
        thumb_path = case.resolve_inside(thumb_rel)
        _write_photo(source, photo_path, thumb_path)
        try:
            case.add_entity_image_file(
                entity_id, image_id, photo_rel, thumb_rel, _title(filename)
            )
        except BaseException:
            photo_path.unlink(missing_ok=True)
            thumb_path.unlink(missing_ok=True)
            prune_empty_dirs(case)
            raise
        return {"added": 1, "images": case.entity_images(entity_id)}


def prune_empty_dirs(case: Case) -> None:
    """Remove the lazy gallery directories once their last private file is gone."""
    for directory in (layout.entity_image_thumbs(case.path), layout.entity_images(case.path)):
        try:
            directory.rmdir()
        except OSError:
            pass


def list_images(case: CaseRepository, entity_id: str) -> list[dict[str, Any]]:
    _target(case, entity_id)
    return case.entity_images(entity_id)


def attach(
    case: CaseRepository, entity_id: str, media_ids: list[str]
) -> dict[str, Any]:
    _target(case, entity_id)
    images = _media(case, media_ids)
    added = case.add_entity_images(entity_id, images)
    return {"added": added, "images": case.entity_images(entity_id)}


def set_primary(
    case: CaseRepository, entity_id: str, image_id: str
) -> list[dict[str, Any]]:
    _target(case, entity_id)
    case.set_primary_entity_image(entity_id, image_id)
    return case.entity_images(entity_id)


def detach(case: Case, entity_id: str, image_id: str) -> list[dict[str, Any]]:
    """Remove a reference, or delete the private files owned by a direct photo."""
    with case.lock:
        _target(case, entity_id)
        image = next(
            (item for item in case.entity_images(entity_id) if item["id"] == image_id),
            None,
        )
        if image is None:
            raise CaseError("that image is not attached to this entity")
        staged: list[tuple[Path, Path]] = []
        if image.get("direct"):
            for rel in (image.get("path"), image.get("thumbnail")):
                if not isinstance(rel, str) or not rel:
                    continue
                path = case.resolve_inside(rel)
                if path.exists():
                    temporary = path.with_name(f".{uuid.uuid4().hex}.remove")
                    _replace_with_retry(path, temporary)
                    staged.append((path, temporary))
        try:
            case.remove_entity_image(entity_id, image_id)
        except BaseException:
            for original, temporary in reversed(staged):
                if temporary.exists():
                    _replace_with_retry(temporary, original)
            raise
        for _original, temporary in staged:
            temporary.unlink(missing_ok=True)
        prune_empty_dirs(case)
        return case.entity_images(entity_id)
