/**
 * A real video for the specs that play one, served the way the app's file route
 * serves a file.
 *
 * Thirty frames at 25 fps, 32 px square, each one flat grey at eight times its own
 * index: whatever the browser draws says which frame it is. Lossless VP9, so the
 * grey survives the round trip to within a step of rounding. (`inspect-player.spec.js`
 * holds the same clip.)
 */
export const STEPS_WEBM = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAgtEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggX77AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECSwAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYhSaj/es0qbKZyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAJiWgDgkLCBILqBIJqBAlWwhFW5gQESVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYwLjE2LjEwMHNz2mPAi2PFiFJqP96zSpspZ8ilRaOHRU5DT0RFUkSHmExhdmM2MC4zMS4xMDIgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMjAwMDAwMDAwAB9DtnVESueBAKOkgQAAgIJJg0IAAfAB9gA4JBwYAAAAIAAAXz////bJ+AArEsAAo6OBACiAgkmDQgAB8AH2ADgkHBgAAAAgAABfP///9mkoAFYlgKOjgQBQgIJJg0IAAfAB9gA4JBwYAAAAIAAAXz////WngACsSwCjo4EAeICCSYNCAAHwAfYAOCQcGAAAACAAAF8////0lgAArEsAo6OBAKCAgkmDQgAB8AH2ADgkHBgAAAAgAABfP///8vXgAViWAKOjgQDIgIJJg0IAAfAB9gA4JBwYAAAAIAAAXz////DLuABWJYCjo4EA8ICCSYNCAAHwAfYAOCQcGAAAACAAAF8////v5iAArEsAo6OBARiAgkmDQgAB8AH2ADgkHBgAAAAgAABfP///7imwAKxLAKOjgQFAgIJJg0IAAfAB9gA4JBwYAAAAIAAAXz///+u9gAFYlgCjo4EBaICCSYNCAAHwAfYAOCQcGAAAACAAAF8////m5UACsSwAo6OBAZCAgkmDQgAB8AH2ADgkHBgAAAAgAABfP///4O0ABWJYAKOigQG4gIJJg0IAAfAB9gA4JBwYAAAAIAAAXz///9YLAArEsKOigQHggIJJg0IAAfAB9gA4JBwYAAAAIAAAXz///8ePAArEsKOigQIIgIJJg0IAAfAB9gA4JBwYAAAAIAAAXz///62uABWJYKOhgQIwgIJJg0IAAfAB9gA4JBwYAAAAIAAAXz///X8ACsSwo6KBAliAgkmDQgAB8AH2ADgkHBgAAAAgAABfP//F8AArEsAAo5+BAoCAgkmDQgAB8AH2ADgkHBgAAAAgAABfP2mACsSwo6GBAqiAgkmDQgAB8AH2ADgkHBgAAAAgAABjfP9aAAKglwCjooEC0ICCSYNCAAHwAfYAOCQcGAAAACAAAF8//+bQACsSwACjooEC+ICCSYNCAAHwAfYAOCQcGAAAACAAAF8///+TcAAViWCjooEDIICCSYNCAAHwAfYAOCQcGAAAACAAAF8///+2kAAViWCjooEDSICCSYNCAAHwAfYAOCQcGAAAACAAAF8////L8gAKxLCjo4EDcICCSYNCAAHwAfYAOCQcGAAAACAAAF8////beQAFYlgAo6OBA5iAgkmDQgAB8AH2ADgkHBgAAAAgAABfP///45OAArEsAKOjgQPAgIJJg0IAAfAB9gA4JBwYAAAAIAAAXz///+lNAAKxLACjo4ED6ICCSYNCAAHwAfYAOCQcGAAAACAAAF8////s8EABWJYAo6OBBBCAgkmDQgAB8AH2ADgkHBgAAAAgAABfP///7v0AAViWAKOjgQQ4gIJJg0IAAfAB9gA4JBwYAAAAIAAAXz////BYoACsSwCjo4EEYICCSYNCAAHwAfYAOCQcGAAAACAAAF8////w8kAAViWAo6OBBIiAgkmDQgAB8AH2ADgkHBgAAAAgAABfP///85NAAViWABxTu2tCLLuPs4EAt4r3gQHxggGr8IEDu4+zgSi3iveBAfGCAavwgSm7j7OBULeK94EB8YIBq/CBTruPs4F4t4r3gQHxggGr8IFzu4+zgaC3iveBAfGCAavwgZi7j7OByLeK94EB8YIBq/CBvbuPs4Hwt4r3gQHxggGr8IHiu5GzggEYt4v3gQHxggGr8IIBB7uRs4IBQLeL94EB8YIBq/CCASy7kbOCAWi3i/eBAfGCAavwggFRu5GzggGQt4v3gQHxggGr8IIBdruRs4IBuLeL94EB8YIBq/CCAZu7kbOCAeC3i/eBAfGCAavwggG/u5GzggIIt4v3gQHxggGr8IIB47uRs4ICMLeL94EB8YIBq/CCAge7kbOCAli3i/eBAfGCAavwggIqu5GzggKAt4v3gQHxggGr8IICTruRs4ICqLeL94EB8YIBq/CCAm+7kbOCAtC3i/eBAfGCAavwggKSu5GzggL4t4v3gQHxggGr8IICtruRs4IDILeL94EB8YIBq/CCAtq7kbOCA0i3i/eBAfGCAavwggL+u5GzggNwt4v3gQHxggGr8IIDIruRs4IDmLeL94EB8YIBq/CCA0e7kbOCA8C3i/eBAfGCAavwggNsu5GzggPot4v3gQHxggGr8IIDkbuRs4IEELeL94EB8YIBq/CCA7a7kbOCBDi3i/eBAfGCAavwggPbu5GzggRgt4v3gQHxggGr8IIEALuRs4IEiLeL94EB8YIBq/CCBCU=', 'base64');
export const STEPS_FPS = 25;
export const STEPS_DURATION = 1.2;

/**
 * A file answered in byte ranges, as the app's file route does: a browser only
 * seeks a video whose server says it can.
 */
export function serveRange(route, body, contentType) {
  const range = /bytes=(\d*)-(\d*)/.exec(route.request().headers().range ?? '');
  if (!range) {
    return route.fulfill({ status: 200, contentType, body, headers: { 'Accept-Ranges': 'bytes' } });
  }
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
  return route.fulfill({
    status: 206,
    contentType,
    body: body.subarray(start, end + 1),
    headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${body.length}` },
  });
}
