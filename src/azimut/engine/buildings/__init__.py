"""Buildings round an eye, for Horizon: read from open sources, merged by stated rules.

Each source has its own module (`osm`, `ign`, `globfp`) that turns what it reads
into `model.Building` records one z14 tile at a time; `merge` decides, per tile,
whose footprints are drawn and whose height each one takes; `service` fetches
in the background, keeps every source's tiles under the workspace cache and
answers the view. Nothing is read until the analyst switches buildings on.
"""
