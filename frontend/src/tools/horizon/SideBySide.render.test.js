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
