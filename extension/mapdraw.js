/**
 * The canvas the tools draw on, over a map this code does not own.
 *
 * Deliberately ignorant: it is handed shapes in geographic coordinates and a
 * function that turns one coordinate into a page pixel, and it knows nothing
 * about projections, gestures or which site is underneath. Everything that can
 * be wrong about *where* a shape lands is therefore in `mapmath.js`, and
 * everything that can be wrong about *what* is drawn is in `maptools.js` —
 * neither of which needs a browser to be tested.
 *
 * What it does own is the look, and the look is the app's: the style vocabulary
 * here is the one `lib/map` takes (stroke, strokeWidth, strokeOpacity, dash,
 * fill, fillOpacity), the paint comes from `maptheme.js`, and the two marks
 * with a claim in them — a saved point, a body in the sky — are drawn the same
 * way the app draws them.
 *
 * Loaded after `mapmath.js` and `maptheme.js`, left on `window.AzimutMapDraw`.
 */

(() => {
  const THEME = window.AzimutMapTheme;

  /** Past this many pixels off-screen a shape is dropped rather than drawn.
   *  A point behind the camera or on the far side of the world projects to a
   *  coordinate large enough to cost real time to rasterise, and it is not
   *  visible either way. */
  const FAR = 20000;

  /** A saved mark is this wide, like the app's (`SavedOverlay.svelte`), and its
   *  glyph rides at 13. */
  const MARK = 24;
  const MARK_GLYPH = 13;

  /** How far the sharp corner hangs below the middle of that box once it is
   *  turned 45°, which is half a diagonal. The corner is what points at the
   *  coordinate, so the body is drawn this far *above* the point rather than
   *  around it — `lib/mapMarkers.js` states the same number for the app, and
   *  the two have to agree or the same point reads differently on each map. */
  const MARK_TIP = (MARK / 2) * Math.SQRT2;

  const near = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)
    && Math.abs(p.x) < FAR && Math.abs(p.y) < FAR;

  /** Longest label drawn on the map. Past this the name is the popup's job. */
  const LABEL_MAX = 34;
  const clip = (text) => (text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text);

  function createDrawLayer(root) {
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, {
      position: "fixed",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "1",
    });
    root.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    let width = 0;
    let height = 0;

    /** Match the backing store to the viewport and the device's pixel ratio.
     *  Skipped when nothing changed: this runs on every redraw, and
     *  reallocating a canvas clears it. */
    function fit() {
      const ratio = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w === width && h === height && canvas.width === Math.round(w * ratio)) return;
      width = w;
      height = h;
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function clear() {
      fit();
      ctx.clearRect(0, 0, width, height);
    }

    /** A shape's points, projected, or null when any of them lands nowhere
     *  usable — a half-projected polygon is a wrong polygon, not most of one. */
    function pixels(points, project) {
      const out = [];
      for (const point of points) {
        const at = project(point);
        if (!near(at)) return null;
        out.push(at);
      }
      return out;
    }

    /** The four corners of a lat/lon box, in order. Projected as corners rather
     *  than as a rectangle so a rotated map draws a rotated cell. */
    const corners = (b) => [
      { lat: b.north, lon: b.west },
      { lat: b.north, lon: b.east },
      { lat: b.south, lon: b.east },
      { lat: b.south, lon: b.west },
    ];

    function trace(points, close) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
      if (close) ctx.closePath();
    }

    function stroked(shape, points, close) {
      if (!shape.stroke) return;
      trace(points, close);
      ctx.setLineDash(shape.dash || []);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      // A dark casing under the colour, for the few marks that have to stay
      // readable over snow, sand and a blown-out roof alike. Off by default:
      // under a lattice of hundreds of cells it reads as a black grid, which is
      // the opposite of the thin bright outline the app draws.
      if (shape.casing) {
        ctx.save();
        ctx.strokeStyle = "rgba(0,0,0,0.45)";
        ctx.lineWidth = (shape.strokeWidth || 2) + 2.5;
        ctx.globalAlpha = 0.55;
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = shape.strokeOpacity ?? 1;
      ctx.lineWidth = shape.strokeWidth || 2;
      ctx.strokeStyle = shape.stroke;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }

    function filled(shape, points) {
      if (!shape.fill || !shape.fillOpacity) return;
      trace(points, true);
      ctx.globalAlpha = shape.fillOpacity;
      ctx.fillStyle = shape.fill;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    /** A name on the map, in a chip that keeps it readable over imagery. Drawn
     *  only for the mark being pointed at or held open — see `maptools.js`. */
    function label(text, at, offset = 14) {
      if (!text) return;
      const line = clip(String(text));
      ctx.font = "12px system-ui, -apple-system, 'Segoe UI', sans-serif";
      const w = ctx.measureText(line).width;
      const x = at.x + offset;
      const y = at.y - 10;
      ctx.beginPath();
      ctx.roundRect(x, y, w + 14, 21, 5);
      ctx.fillStyle = "rgba(20,20,20,0.92)";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = THEME.TOKENS.borderStrong;
      ctx.stroke();
      ctx.fillStyle = THEME.TOKENS.text1;
      ctx.textBaseline = "middle";
      ctx.fillText(line, x + 7, y + 11);
    }

    function dot(shape, at) {
      ctx.beginPath();
      ctx.arc(at.x, at.y, shape.radius || 4, 0, Math.PI * 2);
      if (shape.fill) {
        ctx.globalAlpha = shape.fillOpacity ?? 1;
        ctx.fillStyle = shape.fill;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (shape.stroke) {
        ctx.lineWidth = shape.strokeWidth || 2;
        ctx.strokeStyle = shape.stroke;
        ctx.stroke();
      }
    }

    /** One of the app's 24×24 icons, centred on (0,0) of the current transform. */
    function glyph(name, size, colour) {
      const path = THEME.ICONS[name] ?? THEME.ICONS.alert;
      ctx.save();
      ctx.scale(size / 24, size / 24);
      ctx.translate(-12, -12);
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke(new Path2D(path));
      ctx.restore();
    }

    /**
     * A saved point, drawn as the app draws it: a rounded teardrop turned 45°,
     * amber for work that carries imagery and outlined for a bare place, with
     * the count of what is stacked underneath.
     *
     * The corner is the claim, so it is the corner that goes on the coordinate
     * and the body that moves up out of the way (`MARK_TIP`).
     */
    function mark(shape, at) {
      const place = !!shape.place;
      const body = { x: at.x, y: at.y - MARK_TIP };
      ctx.save();
      ctx.translate(body.x, body.y);
      ctx.save();
      ctx.rotate(-Math.PI / 4);
      ctx.beginPath();
      ctx.roundRect(-MARK / 2, -MARK / 2, MARK, MARK, [MARK / 2, MARK / 2, MARK / 2, 2]);
      ctx.fillStyle = place ? "rgba(20,20,20,0.82)" : THEME.TOKENS.accent;
      ctx.fill();
      ctx.lineWidth = shape.lit ? 2.5 : 1.5;
      ctx.strokeStyle = place || shape.lit ? THEME.TOKENS.accent : "rgba(0,0,0,0.55)";
      ctx.stroke();
      ctx.restore();
      glyph(shape.glyph || "pin", MARK_GLYPH, place ? THEME.TOKENS.accent : THEME.TOKENS.accentText);
      if (shape.count > 1) {
        const text = String(shape.count);
        ctx.font = "700 9px system-ui, -apple-system, sans-serif";
        const w = Math.max(15, ctx.measureText(text).width + 6);
        ctx.beginPath();
        ctx.roundRect(6, -MARK / 2 - 5, w, 15, 8);
        ctx.fillStyle = "#141414";
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, 6 + w / 2, -MARK / 2 + 3);
        ctx.textAlign = "start";
      }
      ctx.restore();
      label(shape.label, body, MARK / 2 + 4);
    }

    /**
     * The sun or the moon on its ray, the way `lib/moonphase.js` draws one: a
     * disc for the sun, and for the moon the lit fraction as the terminator
     * ellipse — which is the same shape from the same two numbers.
     */
    function body(shape, at) {
      const r = shape.radius || 8;
      ctx.save();
      ctx.translate(at.x, at.y);
      ctx.beginPath();
      ctx.arc(0, 0, r + 1.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fill();
      if (shape.bodyKind === "moon") {
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = shape.colour;
        ctx.fill();
        ctx.globalAlpha = 1;
        litShape(r, shape.illuminated ?? 0, shape.waxing, shape.colour);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = shape.colour;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.stroke();
      ctx.restore();
    }

    /**
     * The lit part of the moon: a half disc closed by an ellipse whose width is
     * the phase, mirrored for a waning moon. `lib/moonphase.js` writes the same
     * shape as an SVG arc pair, and the cross-check compares the numbers that
     * drive both.
     */
    function litShape(radius, illuminated, waxing, colour) {
      const clamped = Math.min(1, Math.max(-1, 2 * illuminated - 1));
      const phase = Math.acos(clamped);
      const bulge = Math.abs(Math.cos(phase)) * radius;
      ctx.save();
      if (!waxing) ctx.rotate(Math.PI); // the lit side falls right when waxing
      ctx.beginPath();
      ctx.arc(0, 0, radius, -Math.PI / 2, Math.PI / 2);
      ctx.ellipse(0, 0, bulge, radius, 0, Math.PI / 2, -Math.PI / 2, illuminated <= 0.5);
      ctx.closePath();
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.restore();
    }

    /**
     * Redraw everything, once.
     *
     * @param {Array} shapes what the tools want drawn, in lat/lon
     * @param {(point: {lat: number, lon: number}) => {x: number, y: number}} project
     */
    function render(shapes, project) {
      clear();
      for (const shape of shapes || []) {
        if (shape.kind === "dot" || shape.kind === "mark" || shape.kind === "body") {
          const at = project(shape.at);
          if (!near(at)) continue;
          if (shape.kind === "mark") mark(shape, at);
          else if (shape.kind === "body") body(shape, at);
          else {
            dot(shape, at);
            label(shape.label, at, 8);
          }
          continue;
        }
        if (shape.kind === "cell" || shape.kind === "box") {
          const points = pixels(corners(shape.bounds), project);
          if (!points) continue;
          filled(shape, points);
          stroked(shape, points, true);
          continue;
        }
        const points = pixels(shape.points || [], project);
        if (!points || points.length < 2) continue;
        if (shape.kind === "polygon") filled(shape, points);
        stroked(shape, points, shape.kind === "polygon");
        if (shape.label) label(shape.label, points[points.length - 1]);
      }
    }

    return {
      canvas,
      render,
      clear,
      fit,
      destroy() {
        canvas.remove();
      },
    };
  }

  window.AzimutMapDraw = { createDrawLayer, FAR, LABEL_MAX, MARK, MARK_TIP };
})();
