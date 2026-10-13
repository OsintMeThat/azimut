"""Portable layer downloads contain geometry and styling, without case references."""

from __future__ import annotations

import base64
import binascii
import copy
import json
import zipfile
from io import BytesIO
from typing import Any
from xml.etree import ElementTree as ET

from PIL import Image, UnidentifiedImageError

from ..workspace import Case
from . import layerediting, maplayers

NS = "http://www.opengis.net/kml/2.2"
ET.register_namespace("", NS)


def icon_key(symbol: str, colour: str) -> str:
    return f"{symbol}-{colour.lower().removeprefix('#')}"


def decode_icons(values: dict[str, str]) -> dict[str, bytes]:
    result = {}
    for key, encoded in values.items():
        try:
            data = base64.b64decode(encoded, validate=True)
            with Image.open(BytesIO(data)) as image:
                if image.format != "PNG" or max(image.size) > 512 or min(image.size) < 1:
                    raise ValueError
                image.load()
                output = BytesIO()
                image.convert("RGBA").save(output, "PNG")
                result[key] = output.getvalue()
        except (ValueError, binascii.Error, OSError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
            raise maplayers.LayerError("this export contains an invalid icon") from exc
    return result


def _element(parent: ET.Element, tag: str, text: Any = None, **attrs: str) -> ET.Element:
    child = ET.SubElement(parent, f"{{{NS}}}{tag}", attrs)
    if text is not None:
        child.text = str(text)
    return child


def _coordinates(points: list[list[float]]) -> str:
    return " ".join(",".join(format(number, ".15g") for number in point) for point in points)


def _geometry(parent: ET.Element, geometry: dict[str, Any]) -> None:
    kind, coordinates = geometry["type"], geometry["coordinates"]
    if kind == "Point":
        _element(_element(parent, "Point"), "coordinates", _coordinates([coordinates]))
    elif kind == "LineString":
        line = _element(parent, "LineString")
        _element(line, "tessellate", 1)
        _element(line, "coordinates", _coordinates(coordinates))
    elif kind == "Polygon":
        polygon = _element(parent, "Polygon")
        for index, ring in enumerate(coordinates):
            boundary = _element(polygon, "outerBoundaryIs" if index == 0 else "innerBoundaryIs")
            _element(_element(boundary, "LinearRing"), "coordinates", _coordinates(ring))
    elif kind.startswith("Multi"):
        group = _element(parent, "MultiGeometry")
        single = {"MultiPoint": "Point", "MultiLineString": "LineString", "MultiPolygon": "Polygon"}[kind]
        for part in coordinates:
            _geometry(group, {"type": single, "coordinates": part})


def export(case: Case, name: str, fmt: str, encoded_icons: dict[str, str]) -> tuple[bytes, str, str]:
    spec = layerediting._spec(case, name)
    rendered = layerediting.drawing(spec, case)["geojson"]
    features = copy.deepcopy(rendered["features"])
    for feature in features:
        props = feature["properties"]
        feature["properties"] = {key: props[key] for key in (
            "name", "description", "colour", "category", "symbol", "group", "icon", "icon_scale", "stroke_width"
        ) if key in props}
    if fmt == "geojson":
        ranks = {group["id"]: index for index, group in enumerate(layerediting._groups(spec))}
        features.sort(key=lambda feature: ranks[feature["properties"]["group"]])
        for feature in features:
            props = feature["properties"]
            props.update({"marker-color": props.get("colour", "#0072b2"), "stroke": props.get("colour", "#0072b2"),
                          "stroke-width": props.get("stroke_width", 2)})
        geojson_document = {"type": "FeatureCollection", "name": spec["title"], "azimut_personal_layer": 1,
                    "description": spec.get("description", ""), "features": features}
        return json.dumps(geojson_document, ensure_ascii=False, indent=2).encode(), "application/geo+json", spec["title"]
    images = decode_icons(encoded_icons) if fmt == "kmz" else {}
    root = ET.Element(f"{{{NS}}}kml")
    document = _element(root, "Document")
    _element(document, "name", spec["title"])
    if spec.get("description"):
        _element(document, "description", spec["description"])
    folders = {}
    for group in layerediting._groups(spec):
        folder = _element(document, "Folder")
        _element(folder, "name", group["name"])
        _element(folder, "visibility", int(group["name"] not in spec.get("hidden", [])))
        folders[group["id"]] = folder
    assets: dict[str, bytes] = {}
    for index, feature in enumerate(features):
        props = feature["properties"]
        colour = str(props.get("colour") or "#0072b2").removeprefix("#")
        kml_colour = f"ff{colour[4:6]}{colour[2:4]}{colour[:2]}"
        style = _element(document, "Style", id=f"s{index}")
        line = _element(style, "LineStyle")
        _element(line, "color", kml_colour)
        _element(line, "width", props.get("stroke_width", 2))
        _element(_element(style, "PolyStyle"), "color", f"40{kml_colour[2:]}")
        icon_style = _element(style, "IconStyle")
        _element(icon_style, "scale", props.get("icon_scale", 1))
        key = icon_key(str(props.get("symbol") or "pin"), f"#{colour}")
        png = images.get(key)
        own = props.get("icon")
        if own and fmt == "kmz":
            try:
                png = maplayers.icon(case, name, own)
            except maplayers.LayerError:
                pass
        if png and fmt == "kmz":
            asset_name = f"icons/{maplayers.digest(png)[:32]}.png"
            assets[asset_name] = png
            _element(_element(icon_style, "Icon"), "href", asset_name)
            _element(icon_style, "color", "ffffffff")
            y = "0.5" if own or str(props.get("symbol", "pin")).startswith("badge-") else "0.12"
            _element(icon_style, "hotSpot", x="0.5", y=y, xunits="fraction", yunits="fraction")
        else:
            _element(icon_style, "color", kml_colour)
        order = {"color": 0, "scale": 1, "Icon": 2, "hotSpot": 3}
        icon_style[:] = sorted(icon_style, key=lambda child: order[child.tag.rsplit("}", 1)[-1]])
        style.remove(icon_style)
        style.insert(0, icon_style)
        placemark = _element(folders.get(props.get("group"), document), "Placemark")
        _element(placemark, "name", props.get("name", ""))
        _element(placemark, "description", props.get("description", ""))
        _element(placemark, "styleUrl", f"#s{index}")
        extra = _element(placemark, "ExtendedData")
        for field in ("symbol", "colour", "icon_scale", "stroke_width"):
            _element(_element(extra, "Data", name=f"azimut_{field}"), "value", props.get(field, ""))
        _geometry(placemark, feature["geometry"])
    document[:] = [child for child in document if child.tag != f"{{{NS}}}Folder"] + list(folders.values())
    xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    if fmt == "kml":
        return xml, "application/vnd.google-earth.kml+xml", spec["title"]
    archive = BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
        zipped.writestr("doc.kml", xml)
        for path, image in assets.items():
            zipped.writestr(path, image)
    return archive.getvalue(), "application/vnd.google-earth.kmz", spec["title"]
