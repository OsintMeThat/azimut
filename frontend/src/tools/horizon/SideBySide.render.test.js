// @vitest-environment happy-dom
/**
 * The photo above the terrain, asked for from the band: the two pictures in
 * one frame, the names and the trace on both, a line down both that says the
 * direction, and a way back to the view.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import SideBySide from "./SideBySide.svelte";

const CAMERA = {
  heading: 90,
  tilt: 0,
  roll: 0,
  fov: 60,
  projection: "camera",
  width: 800,
  height: 400,
};

function canvas(name) {
  const drawn = document.createElement("canvas");
  drawn.dataset.name = name;
  return drawn;
}

let live = [];

function sheet(props = {}) {
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(SideBySide, {
    target,
    props: {
      frames: [canvas("photo"), canvas("terrain")],
      camera: CAMERA,
      labels: [
        {
          name: "Jebel Ras",
          x: 400,
          y: 120,
          left: 370,
          width: 60,
          baseline: 100,
        },
      ],
      ticks: [{ azimuth: 90, x: 400, label: "E", named: true }],
      trace: [
        [
          { x: 0, y: 200 },
          { x: 800, y: 180 },
        ],
      ],
      traceOnTerrain: [
        [
          { x: 0, y: 205 },
          { x: 800, y: 185 },
        ],
      ],
      ridges: [false],
      ...props,
    },
  });
  live.push({ component, target });
  // the sheet takes its room from its box, which happy-dom does not lay out
  const box = target.querySelector(".side");
  Object.defineProperty(box, "clientWidth", {
    configurable: true,
    value: 1000,
  });
  Object.defineProperty(box, "clientHeight", {
    configurable: true,
    value: 700,
  });
  window.dispatchEvent(new Event("resize"));
  flushSync();
  return target;
}

afterEach(() => {
  for (const { component, target } of live) {
    unmount(component);
    target.remove();
  }
  live = [];
});

describe("the photo above the terrain", () => {
  it("lays the photo over the terrain with what the view placed on them", () => {
    const root = sheet({ reshaped: true });
    expect(root.querySelector("h2").textContent).toBe(
      "Photo above the terrain",
    );
    const pictures = [...root.querySelectorAll("figure")];
    expect(
      pictures.map((figure) => figure.querySelector("canvas")?.dataset.name),
    ).toEqual(["photo", "terrain"]);
    expect(
      pictures.map((figure) => figure.querySelector("figcaption").textContent),
    ).toEqual(["Photo, reshaped", "Terrain, simulated"]);
    expect(root.querySelectorAll(".name").length).toBe(2);
    // the trace as traced on the photo, as laid on the terrain below
    const lines = pictures.map((figure) =>
      figure.querySelector("polyline.over").getAttribute("points"),
    );
    expect(lines).toEqual(["0.0,200.0 800.0,180.0", "0.0,205.0 800.0,185.0"]);
    expect(root.querySelector(".tick.named").textContent).toBe("E");
  });

  it("runs a line down both under the pointer, with the direction it stands at", () => {
    const root = sheet();
    const stack = root.querySelector(".stack");
    stack.getBoundingClientRect = () => ({
      left: 100,
      top: 0,
      width: 400,
      height: 300,
      right: 500,
      bottom: 300,
    });
    stack.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 300, bubbles: true }),
    );
    flushSync();
    expect(root.querySelectorAll(".cursor").length).toBe(3);
    expect(root.querySelector(".say").textContent).toBe(
      "The same frame on both · 90.0°",
    );
    stack.dispatchEvent(new PointerEvent("pointerleave"));
    flushSync();
    expect(root.querySelectorAll(".cursor").length).toBe(0);
  });

  it("saves the pair as a picture, and goes back to the view on Escape or the close button", () => {
    const onsave = vi.fn();
    const onclose = vi.fn();
    const root = sheet({ onsave, onclose });
    root
      .querySelector('button[title="Write the two out as one picture"]')
      .click();
    expect(onsave).toHaveBeenCalledOnce();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    root.querySelector('button[aria-label="Close"]').click();
    expect(onclose).toHaveBeenCalledTimes(2);
    const busy = sheet({ saving: true });
    expect(
      busy.querySelector('button[title="Write the two out as one picture"]')
        .disabled,
    ).toBe(true);
  });
});

describe("a cut collage, as the search read it", () => {
  /** Two pieces cut down the middle; the right one turned a degree and a half right. */
  const SEARCHED = {
    frame: canvas("pieces"),
    seams: [
      [
        { x: 400, y: 0 },
        { x: 400, y: 400 },
      ],
    ],
    layers: {
      labels: [
        { name: "Left top", x: 200, y: 120, left: 170, width: 60, baseline: 100 },
        { name: "Right top", x: 600, y: 120, left: 570, width: 60, baseline: 100 },
      ],
      ticks: [{ azimuth: 80, x: 300, label: "80°", named: false }],
    },
    cameras: [CAMERA, { ...CAMERA, heading: 91.5 }],
    eases: [null, { piece: 1, turn: 1.5, tilt: -0.2, roll: 0.4 }],
  };
  const pieceAt = ({ u }) => (u > 0.5 ? 1 : 0);

  it("draws the terrain piece by piece, the seams on both, with each piece's names and ticks and the trace where it was drawn", () => {
    const root = sheet({ searched: SEARCHED, pieceAt });
    const pictures = [...root.querySelectorAll("figure")];
    expect(
      pictures.map((figure) => figure.querySelector("canvas")?.dataset.name),
    ).toEqual(["photo", "pieces"]);
    expect(pictures[1].querySelector("figcaption").textContent).toBe(
      "Terrain, simulated piece by piece",
    );
    expect(
      pictures.map((figure) => figure.querySelectorAll("polyline.seam.over").length),
    ).toEqual([1, 1]);
    expect([...root.querySelectorAll(".name")].map((name) => name.textContent)).toEqual([
      "Left top",
      "Right top",
      "Left top",
      "Right top",
    ]);
    expect(root.querySelector(".tick").textContent).toBe("80°");
    expect(
      pictures[1].querySelector("polyline.over:not(.seam)").getAttribute("points"),
    ).toBe("0.0,200.0 800.0,180.0");
    expect(
      root.querySelector('[role="radio"][aria-checked="true"]').textContent,
    ).toBe("Piece by piece");
  });

  it("reads the direction through the piece under the pointer, and says how the search eased it", () => {
    const root = sheet({ searched: SEARCHED, pieceAt });
    const stack = root.querySelector(".stack");
    stack.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 });
    stack.dispatchEvent(new PointerEvent("pointermove", { clientX: 300, bubbles: true }));
    flushSync();
    const say = root.querySelector(".say").textContent;
    expect(say).toMatch(/^The same frame on both · \d+\.\d° · piece 2 of 2, turned \+1\.5°, tilted −0\.2°, rolled \+0\.4°$/);
    // the right piece's camera faces a degree and a half further right
    const through = Number(say.match(/· (\d+\.\d)°/)[1]);
    stack.dispatchEvent(new PointerEvent("pointerleave"));
    flushSync();
    root.querySelector('[role="radio"]').click();
    flushSync();
    stack.dispatchEvent(new PointerEvent("pointermove", { clientX: 300, bubbles: true }));
    flushSync();
    const whole = Number(root.querySelector(".say").textContent.match(/· (\d+\.\d)°/)[1]);
    expect(through - whole).toBeCloseTo(1.5, 1);
  });

  it("goes back to one camera on a press, and saves what it shows", () => {
    const onsave = vi.fn();
    const root = sheet({ searched: SEARCHED, pieceAt, onsave });
    root.querySelector('button[title^="Write the two out"]').click();
    expect(onsave).toHaveBeenLastCalledWith({ cut: true });
    root.querySelector('[role="radio"]').click();
    flushSync();
    const terrain = [...root.querySelectorAll("figure")][1];
    expect(terrain.querySelector("canvas").dataset.name).toBe("terrain");
    expect(terrain.querySelector("figcaption").textContent).toBe("Terrain, simulated");
    expect(root.querySelectorAll("polyline.seam").length).toBe(0);
    expect(terrain.querySelector("polyline.over").getAttribute("points")).toBe("0.0,205.0 800.0,185.0");
    root.querySelector('button[title^="Write the two out"]').click();
    expect(onsave).toHaveBeenLastCalledWith({ cut: false });
  });

  it("offers no choice for a photo that is not cut", () => {
    const root = sheet();
    expect(root.querySelector('[role="radiogroup"]')).toBeNull();
  });
});
