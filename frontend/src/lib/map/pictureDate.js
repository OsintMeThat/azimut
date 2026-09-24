/**
 * When the picture on a map surface was taken, as the case records it.
 *
 * A capture and a saved comparison file the date of the pixels they show. Two
 * providers name it outright: a Sentinel-1 pass (its day and UTC time) and a
 * pinned Sentinel-2 day. Esri and Wayback only estimate it from their metadata,
 * so their date is kept with `exact: false`, which the Time panel shows as `~`.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

/**
 * @param {{ radarPass?: { date: string, time?: string } | null, pinnedDay?: string | null,
 *   estimated?: string | null }} shown
 * @returns {{ imageryDate: string | null, imageryExact: boolean, imageryWhen: string | null }}
 *   `imageryDate` is the day, as a capture shows it; `imageryWhen` adds a radar
 *   pass's time as a UTC instant.
 */
export function pictureDate({ radarPass = null, pinnedDay = null, estimated = null } = {}) {
  if (radarPass?.date && DAY.test(radarPass.date)) {
    const when = TIME.test(radarPass.time ?? '') ? `${radarPass.date}T${radarPass.time}Z` : radarPass.date;
    return { imageryDate: radarPass.date, imageryExact: true, imageryWhen: when };
  }
  if (pinnedDay && DAY.test(pinnedDay)) {
    return { imageryDate: pinnedDay, imageryExact: true, imageryWhen: pinnedDay };
  }
  if (estimated && DAY.test(estimated)) {
    return { imageryDate: estimated, imageryExact: false, imageryWhen: estimated };
  }
  return { imageryDate: null, imageryExact: true, imageryWhen: null };
}

/**
 * A picture's date as a filename can carry it: the day, and a radar pass's hour
 * and minute when it has one, since two passes can share a day. No colon, which
 * Windows refuses.
 *
 * @param {string | null | undefined} when a day or a UTC instant
 */
export function fileDate(when) {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):\d{2}Z)?$/.exec(String(when ?? ''));
  if (!match) return '';
  return match[2] ? `${match[1]}T${match[2]}${match[3]}Z` : match[1];
}
