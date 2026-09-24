/**
 * What Inspect writes for a file, and what a collage writes for itself.
 *
 * The shapes on disk are documented beside the code that stores them
 * (`engine/inspectwork.py`). These helpers decide what goes into a save, when there
 * is nothing worth saving yet, and whether an output already sits in the case as it
 * reads now.
 */
import { buildFrameOps, hasVideoEdits, isNeutral, normalizeRightAngleRotation } from './inspect.js';

/**
 * Bumped after every work save, so a reader of the works list (the collage piece
 * picker) refetches rather than showing frames from before the latest capture.
 */
export const workState = $state({ rev: 0 });

/**
 * What a case image or video is, in the words the pickers filter by: a map
 * capture, something Inspect made (a frame, a collage), or plain imported media.
 */
export function categoryOf(item) {
  const source = item?.source ?? {};
  if (source.type === 'satellite' || source.type === 'screenshot') return 'capture';
  if (source.op === 'collage') return 'collage';
  if (source.op === 'frame' || source.op === 'adjust') return 'frame';
  return item?.kind;
}

/** One frame as it is stored: its recipe, never the preview pixels. */
export function frameRecord(frame) {
  return {
    id: frame.id,
    path: frame.path,
    time: frame.time ?? null,
    adjust: { ...(frame.adjust ?? {}) },
    crop: frame.crop ?? null,
    sourceOps: frame.sourceOps ?? [],
    rotation: normalizeRightAngleRotation(frame.rotation),
    w: frame.w ?? null,
    h: frame.h ?? null,
    filed: frame.filed ?? null,
  };
}

/** The body of a work save. */
export function workSpec(work) {
  return {
    videoAdjust: { ...(work.videoAdjust ?? {}) },
    videoRotation: normalizeRightAngleRotation(work.videoRotation),
    videoFiled: work.videoFiled ?? null,
    activeFrameId: work.activeFrameId ?? null,
    frames: (work.frames ?? []).map(frameRecord),
  };
}

/** A frame nobody has touched: the image exactly as the case holds it. */
export function isUntouched(frame, filters) {
  return (
    !frame.crop &&
    !normalizeRightAngleRotation(frame.rotation) &&
    !(frame.sourceOps?.length) &&
    isNeutral(filters, frame.adjust)
  );
}

/**
 * Whether the work holds anything at all.
 *
 * Opening a file to look at it must not file a work for it. A video has done
 * nothing until a frame is cut or the clip is adjusted; an image starts as one
 * frame, the image itself, and has done nothing until that frame changes or a
 * second one appears.
 */
export function isPristine(work, filters, videoFilters) {
  const frames = work.frames ?? [];
  if (work.source?.kind === 'video') {
    return frames.length === 0 && !hasVideoEdits(videoFilters, work.videoAdjust, work.videoRotation);
  }
  return frames.length <= 1 && frames.every((f) => isUntouched(f, filters) && !f.filed);
}

/** What a frame would be saved as: its whole op pipeline. */
export const frameSignature = (filters, frame) => JSON.stringify(buildFrameOps(filters, frame));

/** What the adjusted video would be saved as. */
export const videoSignature = (videoFilters, adjust, rotation) =>
  JSON.stringify([normalizeRightAngleRotation(rotation), videoFilters.map((f) => adjust?.[f.id] ?? null)]);

/**
 * Whether an output is in the case as it reads now.
 *
 * `filed` is what the last save recorded: the media it produced and the recipe it
 * was made from. Editing after the save, or deleting that media, makes it unsaved
 * again, which is what lets the check stay honest after a reopen.
 */
export function isFiled(filed, signature, mediaPaths) {
  return !!filed && filed.signature === signature && mediaPaths.has(filed.path);
}

// -- collages -----------------------------------------------------------------

/** One piece as it is stored: the recipe it was frozen from and where it sits. */
export function pieceRecord(node) {
  return {
    id: node.id,
    frameId: node.frameId ?? null,
    save: node.save,
    w: node.w,
    h: node.h,
    quad: node.quad.map(([x, y]) => [x, y]),
    frameOps: node.frameOps ?? node.save?.ops ?? [],
    crop: node.crop ?? null,
  };
}

/** The body of a collage save. */
export function collageSpec(collage) {
  return {
    width: collage.width,
    height: collage.height,
    background: collage.background,
    transparent: collage.transparent,
    nodes: collage.nodes.map(pieceRecord),
    exported: collage.exported ?? null,
  };
}

/** What a collage would export as: its pieces' recipes and corners. */
export const collageSignature = (collage) => JSON.stringify(collage.nodes.map((n) => [n.save, n.quad]));

/** Pieces whose file is gone. They keep their place but cannot be exported. */
export const missingPieces = (collage) => collage.nodes.filter((n) => n.missing);
