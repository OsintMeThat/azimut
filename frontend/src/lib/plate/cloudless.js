/**
 * EOX's Sentinel-2 cloudless as a plate's ground (`engine/cloudless.py`): one
 * cloud-free picture of the world a year, made of many passes, so a plate says
 * "a year's mosaic" and never a day. Its years, each with the credit and the
 * licence EOX gives it, come from the app (`/api/satellite/cloudless/years`).
 */
export const CLOUDLESS_ID = 's2cloudless';

/** The provider id a map on Sentinel-2 cloudless draws from: its year's, or the newest. */
export const cloudlessId = (year) => (year ? `${CLOUDLESS_ID}~${year}` : CLOUDLESS_ID);

/** The year a map is drawn on, out of the years the app offers, newest first: its own, else the newest. */
export const cloudlessYear = (element, years = []) => years.find((entry) => entry.year === element?.year) ?? years[0] ?? null;

/** What `{imagery}` writes for a map on it. */
export const cloudlessSaid = (entry) => (entry ? `Sentinel-2 cloudless ${entry.year}, a year's mosaic` : '');
