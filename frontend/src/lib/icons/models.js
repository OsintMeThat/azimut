/**
 * The vehicle models: one small generic model per class, in metres.
 *
 * Proportions are per class, never a real type's: no turret shape, hull, livery,
 * roundel, marking or silhouette is copied from a vehicle that exists. Two lessons
 * from the first drawings hold every model together: a turret's hatches sit off
 * its centre line (a symmetric pair reads as a face), and every outline is drawn
 * round a solid rather than a face.
 *
 * This module is the heavy half of the icon library and is loaded on demand
 * (`loadModels.js`); the catalogue names the models without it.
 */
import { Build, finish, rad } from './build.js';

/* -- shared parts ------------------------------------------------------------ */

/** Tracks either side, `l` metres from the middle to each end. */
function tracks(b, l, inner, outer, h = 0.82, ink = 'dark') {
  const t = [[-l, 0.42], [-l + 0.42, 0.06], [l - 0.5, 0.06], [l, 0.5], [l - 0.3, h], [-l + 0.25, h]];
  b.extX(t, -outer, -inner, { ink });
  b.extX(t, inner, outer, { ink });
}

/** A lorry's chassis and cab, the cab centred `cab` metres forward. */
function truckBase(b, cab = 3) {
  b.wheels(cab - 0.22, 1.12, 0.56, 0.38);
  b.wheels(-1.7, 1.12, 0.56, 0.38);
  b.wheels(-2.95, 1.12, 0.56, 0.38);
  b.box(0, -0.25, 2.05, 7.5, 0.62, 0.98, { ink: 'dark' });
  b.box(0, cab, 2.46, 2.05, 0.72, 1.86, { c: 0.12 });
  b.box(0, cab, 2.42, 2.03, 1.86, 2.72, { tx: 0.08, tf: 0.46, tb: 0.02, side: 'glass', top: 'light' });
}

/** A pickup's wheels, cab and open bed. */
function pickupBase(b) {
  b.wheels(1.6, 0.9, 0.38, 0.27);
  b.wheels(-1.6, 0.9, 0.38, 0.27);
  b.box(0, 0.98, 1.92, 3.34, 0.34, 1.02, { c: 0.26, tf: 0.16, tx: 0.04 });
  b.box(0, 0.05, 1.74, 1.94, 1.02, 1.76, { tx: 0.13, tf: 0.5, tb: 0.08, side: 'glass', top: 'light' });
  b.box(0, -1.68, 1.92, 1.96, 0.34, 0.72, { ink: 'dark' });
  for (const s of [-1, 1]) b.box(s * 0.9, -1.68, 0.12, 1.96, 0.72, 1.04, { ink: 'body' });
  b.box(0, -2.6, 1.68, 0.12, 0.72, 1.04, { ink: 'body' });
}

/** A twin anti-aircraft gun on its mount, barrels raised `rise` metres over their run. */
function twinGun(b, y, z, { run = 2.65, rise = 0.42 } = {}) {
  b.cyl(0, y, 0.6, z, z + 0.13, { ink: 'metal', n: 14 });
  b.box(0, y - 0.05, 0.9, 1.05, z + 0.13, z + 0.67, { ink: 'body', tx: 0.08, top: 'light' });
  b.box(0, y - 0.75, 0.42, 0.38, z + 0.13, z + 0.5, { ink: 'dark' });
  b.box(0.06, y - 0.97, 0.36, 0.07, z + 0.5, z + 0.9, { ink: 'dark' });
  for (const s of [-1, 1]) {
    b.box(s * 0.62, y - 0.1, 0.3, 0.62, z + 0.17, z + 0.6, { ink: 'dark' });
    b.tube([s * 0.17, y + 0.1, z + 0.75], [s * 0.17, y + run, z + 0.75 + rise], 0.045, { ink: 'metal', n: 6 });
    b.tube([s * 0.17, y + run - 0.25, z + 0.71 + rise], [s * 0.17, y + run + 0.2, z + 0.78 + rise], 0.07, { ink: 'dark', n: 6 });
  }
}

/** A hull outline in plan, `L` long and `B` across, pointed at the bow. */
const hull = (L, B) => [
  [-B * 0.44, -L / 2], [B * 0.44, -L / 2], [B / 2, -L * 0.22], [B / 2, L * 0.12],
  [B * 0.3, L * 0.36], [0, L / 2], [-B * 0.3, L * 0.36], [-B / 2, L * 0.12], [-B / 2, -L * 0.22],
];

/** A rail bogie at `y`: its frame and two axles. */
function bogie(b, y) {
  b.box(0, y, 2.3, 2.7, 0.3, 0.95, { ink: 'dark' });
  for (const dy of [-0.85, 0.85]) b.wheels(y + dy, 0.78, 0.46, 0.14);
}

/* -- the models ----------------------------------------------------------------- */

export const GEOMETRY = {
  /* generic marks */
  'model-block': (b) => {
    b.extX([[-2.9, 0], [2.75, 0], [2.9, 0.5], [1.5, 1.7], [-2.9, 1.7]], -1.2, 1.2, { edge: [null, null, 'light'], ink: 'body' });
    b.slab([[0, 1.05, 1.7], [-0.72, -0.1, 1.7], [-0.72, -0.75, 1.7], [0, 0.3, 1.7]], 0.06, { ink: 'dark' });
    b.slab([[0, 1.05, 1.7], [0, 0.3, 1.7], [0.72, -0.75, 1.7], [0.72, -0.1, 1.7]], 0.06, { ink: 'dark' });
  },
  'model-chevron': (b) => {
    b.prism([[0, 2.5], [-2.1, -0.9], [-2.1, -2.1], [0, -0.4]], 0, 0.45, { s: 0.97 });
    b.prism([[0, 2.5], [0, -0.4], [2.1, -2.1], [2.1, -0.9]], 0, 0.45, { s: 0.97 });
  },

  /* road */
  'model-car': (b) => {
    b.wheels(1.42, 0.87, 0.33, 0.22);
    b.wheels(-1.42, 0.87, 0.33, 0.22);
    b.box(0, 0, 1.84, 4.62, 0.28, 0.66, { c: 0.34 });
    b.box(0, 0, 1.82, 4.6, 0.66, 0.88, { c: 0.32, tx: 0.05, tf: 0.2, tb: 0.1 });
    b.box(0, -0.26, 1.62, 2.72, 0.88, 1.44, { tx: 0.17, tf: 0.74, tb: 0.42, side: 'glass', top: 'light' });
    for (const s of [-1, 1]) b.box(s * 0.58, 2.27, 0.42, 0.06, 0.56, 0.72, { ink: 'light' });
  },
  // a plain pickup: the cab and the open bed, nothing mounted
  'model-pickup-plain': (b) => {
    pickupBase(b);
  },
  'model-pickup': (b) => {
    pickupBase(b);
    b.cyl(0, -1.45, 0.07, 0.72, 2.02, { ink: 'metal', n: 8 });
    b.box(0, -1.5, 0.26, 0.5, 2.02, 2.2, { ink: 'metal' });
    b.tube([0, -1.25, 2.12], [0, 0.98, 2.12], 0.075, { ink: 'metal', n: 8 });
  },
  'model-van': (b) => {
    b.wheels(1.85, 0.88, 0.36, 0.24);
    b.wheels(-1.7, 0.88, 0.36, 0.24);
    b.box(0, 0.05, 1.98, 5.7, 0.3, 0.86, { c: 0.22 });
    b.box(0, 2.4, 1.94, 1.0, 0.86, 1.18, { c: 0.2, tf: 0.28 });
    b.box(0, 1.35, 1.96, 1.1, 0.86, 2.3, { c: 0.18, tx: 0.05, tf: 0.62, side: 'glass', top: 'light' });
    b.box(0, -0.95, 1.98, 3.5, 0.86, 2.36, { c: 0.16, tx: 0.04, top: 'light' });
  },
  'model-truck': (b) => {
    truckBase(b);
    const arch = [[-1.2, 0.98], [1.2, 0.98], [1.2, 2.72], [0.76, 3.22], [-0.76, 3.22], [-1.2, 2.72]];
    for (let i = 0; i < 4; i++) b.extY(arch, -3.95 + i * 1.4, -3.95 + (i + 1) * 1.4, { ink: 'body' });
  },
  'model-tanker': (b) => {
    truckBase(b);
    b.box(0, -1.1, 1.2, 5.2, 0.98, 1.0, { ink: 'dark' });
    b.tube([0, 1.55, 2.06], [0, -3.9, 2.06], 1.08, { n: 18, capA: 'metal', capB: 'metal', ink: 'body' });
    for (const y of [0.1, -2.1]) b.cyl(0, y, 0.3, 3.14, 3.28, { ink: 'metal', n: 10 });
  },
  'model-bus': (b) => {
    b.wheels(3.7, 1.14, 0.52, 0.34);
    b.wheels(-3.4, 1.14, 0.52, 0.34);
    b.box(0, 0, 2.54, 12, 0.42, 1.46, { c: 0.24 });
    b.box(0, 0, 2.5, 11.95, 1.46, 2.62, { c: 0.22, side: 'glass', top: 'glass' });
    b.box(0, -0.62, 2.54, 10.6, 2.62, 3.0, { c: 0.2, tx: 0.1, tf: 0.14, tb: 0.1, top: 'light' });
    b.box(0, -2.2, 1.4, 2.5, 3.0, 3.3, { ink: 'metal', c: 0.12, tx: 0.08, tf: 0.08, tb: 0.08 });
    b.box(0, 1.9, 0.9, 0.9, 3.0, 3.1, { ink: 'dark' });
  },
  'model-moto': (b) => {
    for (const y of [0.74, -0.74]) b.tube([-0.07, y, 0.32], [0.07, y, 0.32], 0.32, { n: 12, ink: 'dark', capA: 'metal', capB: 'metal' });
    b.box(0, 0.02, 0.24, 1.0, 0.42, 0.74, { ink: 'metal' });
    b.box(0, 0.22, 0.3, 0.52, 0.74, 0.98, { c: 0.06, top: 'light' });
    b.box(0, -0.4, 0.3, 0.74, 0.74, 0.86, { ink: 'dark' });
    b.tube([-0.38, 0.54, 1.08], [0.38, 0.54, 1.08], 0.03, { ink: 'metal', n: 6 });
    b.tube([0, 0.72, 0.42], [0, 0.52, 1.05], 0.03, { ink: 'metal', n: 6 });
    b.tube([0, -0.3, 0.88], [0, 0.02, 1.38], 0.17, { r1: 0.2, n: 10 });
    b.tube([0, 0.08, 1.46], [0, 0.12, 1.7], 0.1, { r1: 0.11, n: 10, ink: 'light' });
    for (const s of [-1, 1]) {
      b.tube([s * 0.2, 0, 1.33], [s * 0.32, 0.5, 1.1], 0.04, { n: 6 });
      b.tube([s * 0.17, -0.28, 0.84], [s * 0.2, 0.14, 0.72], 0.07, { n: 6, ink: 'metal' });
    }
  },

  /* armour and guns */
  'model-mrap': (b) => {
    b.wheels(1.8, 1.14, 0.56, 0.4);
    b.wheels(-1.65, 1.14, 0.56, 0.4);
    b.prism(b.rect(0, 0, 2.3, 5.7, 0.3), 0.42, 1.22, { b: 0.7 });
    b.box(0, 2.05, 2.22, 1.6, 1.22, 1.74, { c: 0.2, tf: 0.4 });
    b.box(0, -0.75, 2.36, 3.9, 1.22, 2.02, { c: 0.16 });
    b.box(0, 0.62, 2.32, 1.1, 2.02, 2.56, { c: 0.15, tx: 0.12, tf: 0.42, side: 'glass', top: 'light' });
    b.box(0, -1.25, 2.32, 2.7, 2.02, 2.56, { c: 0.15, tx: 0.12, tb: 0.04, top: 'light' });
    b.cyl(-0.12, -1.2, 0.5, 2.56, 2.78, { ink: 'metal', n: 12 });
    b.box(-0.12, -0.84, 0.62, 0.12, 2.78, 3.12, { ink: 'metal' });
    b.tube([-0.12, -1.05, 2.98], [-0.12, 0.65, 2.98], 0.05, { ink: 'metal', n: 6 });
  },
  'model-apc': (b) => {
    for (const y of [2.45, 0.95, -0.95, -2.45]) b.wheels(y, 1.3, 0.6, 0.36);
    const foot = [[-1.26, -3.7], [1.26, -3.7], [1.26, 2.5], [0.76, 3.82], [-0.76, 3.82], [-1.26, 2.5]];
    b.prism(foot, 0.5, 1.32, { b: 0.9 });
    b.prism(foot.map(([x, y]) => [x * 0.97, y * 0.97]), 1.32, 2.06, { s: 0.82 });
    b.cyl(0, 0.55, 0.66, 2.06, 2.5, { ink: 'light', n: 10, capB: 'light' });
    b.tube([0, 1.2, 2.3], [0, 3.4, 2.3], 0.07, { ink: 'metal', n: 8 });
    for (const s of [-1, 1]) b.box(s * 0.46, -2.05, 0.55, 0.8, 2.06, 2.12, { ink: 'dark' });
  },
  'model-ifv': (b) => {
    tracks(b, 3.4, 1.36, 1.9);
    for (const s of [-1, 1]) b.box(s * 1.63, 0, 0.56, 6.6, 0.82, 0.92, { ink: 'metal' });
    b.extX([[-3.3, 0.5], [3.3, 0.5], [3.45, 0.78], [1.75, 1.68], [-2.5, 1.86], [-3.3, 1.2]], -1.36, 1.36);
    b.prism([[-0.42, 1.05], [0.42, 1.05], [0.95, 0.45], [0.95, -0.75], [0.6, -1.05], [-0.6, -1.05], [-0.95, -0.75], [-0.95, 0.45]], 1.78, 2.36, { s: 0.84, top: 'light' });
    b.tube([0, 1, 2.12], [0, 3.9, 2.12], 0.075, { ink: 'metal', n: 8 });
    b.box(1.08, -0.2, 0.24, 1.0, 2.02, 2.3, { ink: 'metal' });
    for (const s of [-1, 1]) b.box(s * 0.55, -2.05, 0.6, 0.72, 1.86, 1.92, { ink: 'dark' });
  },
  'model-tank': (b) => {
    tracks(b, 3.75, 1.2, 1.82);
    for (const s of [-1, 1]) b.box(s * 1.5, -0.04, 0.74, 7.5, 0.82, 0.97, { ink: 'metal' });
    b.extX([[-3.72, 0.5], [3.55, 0.5], [3.75, 0.82], [2.0, 1.62], [-3.6, 1.62], [-3.75, 1.28]], -1.14, 1.14);
    b.box(0, -2.72, 1.72, 1.45, 1.62, 1.68, { ink: 'dark' });
    b.prism([[-0.62, 1.62], [0.62, 1.62], [1.6, 0.5], [1.66, -1.25], [1.14, -2.15], [-1.14, -2.15], [-1.66, -1.25], [-1.6, 0.5]], 1.62, 2.36, { s: 0.88, top: 'light' });
    b.box(0, 1.72, 0.74, 0.34, 1.82, 2.2, { ink: 'metal' });
    const z = 2.02;
    b.tube([0, 1.88, z], [0, 3.5, z], 0.13, { ink: 'metal', n: 8 });
    b.tube([0, 3.5, z], [0, 4.25, z], 0.2, { ink: 'metal', n: 8 });
    b.tube([0, 4.25, z], [0, 7.05, z], 0.13, { ink: 'metal', n: 8 });
    b.cyl(-0.62, -0.62, 0.34, 2.36, 2.6, { ink: 'metal', n: 10 });
    b.box(0.66, 0.7, 0.36, 0.34, 2.36, 2.5, { ink: 'metal' });
  },
  'model-spg': (b) => {
    tracks(b, 3.6, 1.24, 1.84);
    for (const s of [-1, 1]) b.box(s * 1.52, 0, 0.72, 7.1, 0.82, 0.95, { ink: 'metal' });
    b.extX([[-3.5, 0.5], [3.4, 0.5], [3.6, 0.8], [1.9, 1.5], [-3.5, 1.5]], -1.18, 1.18);
    b.box(0, -1.15, 2.9, 4.1, 1.5, 3.0, { c: 0.3, tx: 0.1, tf: 0.4, tb: 0.06, top: 'light' });
    b.tube([0, 0.9, 2.32], [0, 6.3, 2.62], 0.14, { ink: 'metal', n: 8 });
    b.tube([0, 6.3, 2.62], [0, 7.1, 2.66], 0.24, { ink: 'dark', n: 8 });
    b.box(0, 0.82, 0.9, 0.3, 1.96, 2.66, { ink: 'metal' });
    b.cyl(0.7, -1.6, 0.3, 3.0, 3.14, { ink: 'dark', n: 10 });
  },
  'model-towed-gun': (b) => {
    b.wheels(0, 1.08, 0.56, 0.3);
    b.box(0, 0.1, 1.1, 1.2, 0.46, 1.0, { ink: 'body' });
    for (const s of [-1, 1]) b.box(s * 0.6, 0.74, 0.86, 0.08, 0.42, 1.62, { ink: 'body', top: 'light' });
    b.box(0, 0.74, 0.34, 0.08, 0.42, 0.86, { ink: 'body' });
    b.box(0, 0.74, 0.34, 0.08, 1.44, 1.62, { ink: 'body', top: 'light' });
    b.tube([0, -0.9, 1.12], [0, 1.6, 1.16], 0.2, { ink: 'metal', n: 8 });
    b.tube([0, 1.6, 1.16], [0, 5.2, 1.27], 0.09, { ink: 'metal', n: 8 });
    b.tube([0, 5.2, 1.27], [0, 5.62, 1.28], 0.15, { ink: 'dark', n: 8 });
    for (const s of [-1, 1]) {
      b.tube([s * 0.32, -0.56, 0.62], [s * 1.12, -4.0, 0.2], 0.11, { ink: 'body', n: 6 });
      b.box(s * 1.17, -4.12, 0.44, 0.3, 0, 0.34, { ink: 'dark' });
    }
  },
  'model-mlrs': (b) => {
    truckBase(b, 3);
    b.box(0, -1.6, 2.3, 4.2, 0.98, 1.14, { ink: 'metal' });
    b.box(0, -1.5, 0.9, 1.2, 1.14, 1.52, { ink: 'dark' });
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 5; c++) b.pitched([(c - 2) * 0.44, -1.3, 2.02 + r * 0.42], 0.42, 4.3, 0.4, 14, { ink: 'metal', top: 'body', front: 'dark' });
    }
  },
  'model-sam': (b) => {
    truckBase(b, 3);
    b.box(0, -1.6, 2.3, 4.2, 0.98, 1.14, { ink: 'metal' });
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        const x = (c - 0.5) * 1.02;
        const z = 1.75 + r * 0.92;
        b.tube([x, -3.7, z - 0.52], [x, 1.9, z + 0.5], 0.46, { n: 14, ink: 'body', capA: 'metal', capB: 'dark' });
      }
    }
  },
  'model-aa-gun': (b) => {
    b.prism([[-0.95, -1.1], [0.95, -1.1], [0.95, 0.9], [0.5, 1.3], [-0.5, 1.3], [-0.95, 0.9]], 0.42, 0.55, { ink: 'body' });
    b.wheels(-0.2, 1.22, 0.4, 0.2);
    b.tube([0, -1.12, 0.48], [0, -2.5, 0.32], 0.06, { ink: 'metal', n: 6 });
    twinGun(b, 0, 0.55);
  },
  'model-aa-pickup': (b) => {
    pickupBase(b);
    twinGun(b, -1.62, 0.72, { run: 3.0, rise: 0.55 });
  },
  'model-dozer': (b) => {
    tracks(b, 2.4, 0.95, 1.55, 0.85);
    b.box(0, -0.35, 1.9, 4.2, 0.55, 1.45, { c: 0.12, top: 'light' });
    b.box(0, 0.95, 1.6, 1.3, 1.45, 1.78, { ink: 'metal', c: 0.1 });
    b.box(0, -1.25, 1.5, 1.5, 1.45, 2.0);
    b.box(0, -1.25, 1.5, 1.5, 2.0, 2.75, { tx: 0.04, side: 'glass' });
    b.box(0, -1.25, 1.66, 1.66, 2.75, 2.95, { top: 'light' });
    b.cyl(0.45, 1.05, 0.08, 1.78, 2.35, { ink: 'dark', n: 6 });
    b.extX([[3.05, 0.04], [3.42, 0.04], [3.48, 1.48], [3.16, 1.6]], -1.85, 1.85, { ink: 'metal' });
    for (const s of [-1, 1]) b.tube([s * 1.25, 2.0, 1.0], [s * 1.25, 3.04, 0.62], 0.1, { ink: 'dark', n: 6 });
  },

  /* air */
  'model-heli': (b) => {
    b.loft([
      { y: 5.1, rx: 0.14, rz: 0.14, z: 1.45 }, { y: 4.5, rx: 0.64, rz: 0.62, z: 1.52, ink: 'glass' },
      { y: 3.2, rx: 1, rz: 1, z: 1.68, ink: 'glass' }, { y: 1.4, rx: 1.14, rz: 1.14, z: 1.84 },
      { y: -1.2, rx: 1.06, rz: 1.06, z: 1.9 }, { y: -2.6, rx: 0.55, rz: 0.62, z: 2.14 },
    ]);
    b.box(0, -0.45, 1.1, 3.3, 2.9, 3.36, { tx: 0.16, tf: 0.5, tb: 0.3, ink: 'metal' });
    b.tube([0, -2.62, 2.2], [0, -9.3, 2.8], 0.4, { r1: 0.14, n: 8 });
    b.extX([[-8.9, 2.62], [-9.7, 2.72], [-10.1, 4.1], [-9.5, 4.1]], -0.05, 0.05, { ink: 'metal' });
    b.box(0, -8.3, 2.5, 0.62, 2.56, 2.64, { ink: 'metal' });
    b.tube([0.08, -9.7, 3.65], [0.13, -9.7, 3.65], 1.1, { n: 18, ink: 'light', alpha: 0.4 });
    b.cyl(0, 0, 0.12, 3.36, 3.74, { ink: 'metal', n: 8 });
    b.cyl(0, 0, 0.34, 3.74, 3.94, { ink: 'dark', n: 10 });
    for (const a of [45, 135, 225, 315]) {
      const s = Math.sin(rad(a));
      const c = Math.cos(rad(a));
      const w = 0.26;
      const P = (r, q) => [s * r + c * q, c * r - s * q, 3.82];
      b.slab([P(0.34, -w), P(7.4, -w), P(7.4, w), P(0.34, w)], 0.07, { ink: 'dark' });
    }
    b.cyl(0, 0, 7.4, 3.96, 3.97, { n: 36, ink: 'light', alpha: 0.1 });
    for (const s of [-1, 1]) {
      b.tube([s * 1.2, 2.4, 0.09], [s * 1.2, -2.3, 0.09], 0.07, { ink: 'metal', n: 6 });
      b.tube([s * 1.2, 1.3, 0.09], [s * 0.72, 1.3, 1.05], 0.05, { ink: 'metal', n: 6 });
      b.tube([s * 1.2, -1.2, 0.09], [s * 0.72, -1.2, 1.05], 0.05, { ink: 'metal', n: 6 });
    }
  },
  'model-fighter': (b) => {
    b.tube([0, 4.6, 0], [0, 4.6, 1.6], 0.05, { ink: 'metal', n: 6 });
    for (const s of [-1, 1]) b.tube([s * 1.5, -1.5, 0], [s * 1.2, -1.5, 1.6], 0.06, { ink: 'metal', n: 6 });
    b.loft([
      { y: 8.2, rx: 0.05, rz: 0.05, z: 1.95 }, { y: 5.8, rx: 0.56, rz: 0.52, z: 2.02 }, { y: 2.8, rx: 0.92, rz: 0.82, z: 2.16 },
      { y: -1.5, rx: 1.3, rz: 0.86, z: 2.18 }, { y: -6, rx: 1.14, rz: 0.74, z: 2.18 }, { y: -7.1, rx: 0.96, rz: 0.6, z: 2.18 },
    ]);
    b.loft([
      { y: 4.7, rx: 0.04, rz: 0.04, z: 2.66 }, { y: 3.8, rx: 0.38, rz: 0.34, z: 2.74, ink: 'glass' },
      { y: 2.6, rx: 0.46, rz: 0.42, z: 2.84, ink: 'glass' }, { y: 1.3, rx: 0.26, rz: 0.2, z: 2.92 },
    ], { ink: 'glass', n: 10 });
    for (const s of [-1, 1]) {
      b.prism([[s * 1.05, 2.6], [s * 1.2, -4.7], [s * 5.5, -5.1], [s * 5.5, -4.05]], 2.02, 2.2, {});
      b.prism([[s * 1.05, -5.3], [s * 1.05, -7], [s * 3.3, -7.9], [s * 3.3, -7.05]], 2.04, 2.16, { ink: 'body' });
      b.extX([[-5.1, 2.84], [-7.2, 2.84], [-8.3, 5.2], [-7.3, 5.2]], s * 1 - 0.06, s * 1 + 0.06, { ink: 'light' });
      b.tube([s * 0.56, -7.1, 2.18], [s * 0.56, -7.6, 2.18], 0.44, { r1: 0.38, ink: 'dark', n: 10 });
    }
  },
  'model-transport': (b) => {
    b.tube([0, 15, 0], [0, 15, 1.4], 0.12, { ink: 'metal', n: 6 });
    for (const s of [-1, 1]) b.tube([s * 2.6, -1, 0], [s * 2.2, -1, 1.4], 0.16, { ink: 'metal', n: 6 });
    b.loft([
      { y: 20.8, rx: 0.5, rz: 0.5, z: 4 }, { y: 18.8, rx: 1.9, rz: 1.9, z: 4, ink: 'glass' }, { y: 17.2, rx: 2.4, rz: 2.4, z: 4.05 },
      { y: 15, rx: 2.8, rz: 2.8, z: 4.1 }, { y: -8, rx: 2.8, rz: 2.8, z: 4.1 }, { y: -14, rx: 2.1, rz: 2.1, z: 4.7 },
      { y: -20.5, rx: 0.7, rz: 0.8, z: 5.6 },
    ], { n: 16 });
    for (const s of [-1, 1]) {
      b.prism([[s * 1.9, 3.8], [s * 1.9, -3.2], [s * 20.5, -6.3], [s * 20.5, -4.5]], 6.92, 7.3, {});
      for (const x of [7.5, 13.5]) {
        b.tube([s * x, 1.9 - x * 0.14, 5.8], [s * x, -3.2 - x * 0.14, 5.8], 1, { n: 12, capA: 'dark', capB: 'metal', ink: 'metal', r1: 0.72 });
        b.box(s * x, -0.8 - x * 0.14, 0.34, 2.4, 6.6, 6.92, { ink: 'metal' });
      }
      b.prism([[s * 0.25, -17.4], [s * 0.25, -20.8], [s * 7.3, -22.2], [s * 7.3, -20.6]], 12.6, 12.84, {});
    }
    b.extX([[-13.8, 6.7], [-20, 6.7], [-22, 12.6], [-18.7, 12.6]], -0.22, 0.22, { ink: 'light' });
  },
  'model-quad': (b) => {
    b.box(0, 0, 0.13, 0.25, 0.06, 0.12, { c: 0.03, tx: 0.012, tf: 0.03, tb: 0.012, top: 'light' });
    b.box(0, 0.14, 0.05, 0.05, 0.03, 0.08, { ink: 'glass' });
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        b.tube([sx * 0.05, sy * 0.06, 0.09], [sx * 0.17, sy * 0.17, 0.1], 0.012, { ink: 'metal', n: 6 });
        b.cyl(sx * 0.17, sy * 0.17, 0.022, 0.08, 0.13, { ink: 'dark', n: 8 });
        b.cyl(sx * 0.17, sy * 0.17, 0.13, 0.138, 0.14, { ink: 'light', alpha: 0.16, n: 22 });
        const t = rad(sx * sy * 30);
        const c = Math.cos(t);
        const s = Math.sin(t);
        const P = (r, q) => [sx * 0.17 + c * r - s * q, sy * 0.17 + s * r + c * q, 0.133];
        b.slab([P(-0.13, -0.009), P(0.13, -0.009), P(0.13, 0.009), P(-0.13, 0.009)], 0.004, { ink: 'dark' });
      }
    }
    for (const s of [-1, 1]) {
      b.tube([s * 0.05, 0.08, 0], [s * 0.05, -0.08, 0], 0.006, { ink: 'metal', n: 5 });
      b.tube([s * 0.05, 0, 0], [s * 0.05, 0, 0.07], 0.006, { ink: 'metal', n: 5 });
    }
  },
  'model-fpv': (b) => {
    for (const [sx, sy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      b.tube([sx * 0.025, sy * 0.025, 0.03], [sx * 0.105, sy * 0.105, 0.03], 0.007, { ink: 'dark', n: 4, phase: Math.PI / 4 });
      b.cyl(sx * 0.11, sy * 0.11, 0.015, 0.024, 0.05, { ink: 'metal', n: 8 });
      b.cyl(sx * 0.11, sy * 0.11, 0.064, 0.052, 0.055, { ink: 'light', alpha: 0.2, n: 20 });
    }
    b.box(0, 0, 0.055, 0.08, 0.022, 0.045, { ink: 'dark', c: 0.008 });
    b.box(0, -0.008, 0.04, 0.072, 0.045, 0.078, { ink: 'body', top: 'light', c: 0.006 });
    b.box(0, 0.05, 0.024, 0.02, 0.03, 0.058, { ink: 'glass' });
    b.tube([0, -0.075, 0.008], [0, 0.12, 0.008], 0.02, { ink: 'body', n: 8, capB: 'metal' });
    b.tube([0, 0.12, 0.008], [0, 0.155, 0.008], 0.024, { ink: 'metal', r1: 0.01, n: 8 });
  },
  'model-uav': (b) => {
    b.tube([0, 1.6, 0], [0, 1.6, 0.8], 0.03, { ink: 'metal', n: 6 });
    for (const s of [-1, 1]) b.tube([s * 0.7, -0.2, 0], [s * 0.2, -0.2, 0.9], 0.03, { ink: 'metal', n: 6 });
    b.loft([{ y: 3.2, rx: 0.1, rz: 0.1, z: 1.04 }, { y: 2.6, rx: 0.33, rz: 0.36, z: 1.08 }, { y: 0.2, rx: 0.37, rz: 0.4, z: 1.08 }, { y: -2.7, rx: 0.13, rz: 0.15, z: 1.16 }]);
    for (const s of [-1, 1]) {
      b.prism([[s * 0.3, 0.8], [s * 0.3, -0.15], [s * 6.3, 0.12], [s * 6.3, 0.5]], 1.34, 1.42, {});
      b.slab([[s * 0.1, -1.95, 1.26], [s * 0.1, -2.7, 1.26], [s * 1.45, -3.0, 2.02], [s * 1.45, -2.55, 2.02]], 0.05, { ink: 'light' });
    }
    b.tube([0, -2.72, 1.16], [0, -2.76, 1.16], 0.58, { n: 18, ink: 'light', alpha: 0.34 });
  },
  'model-oneway': (b) => {
    b.loft([{ y: 1.9, rx: 0.04, rz: 0.04, z: 0.3 }, { y: 1.35, rx: 0.16, rz: 0.17, z: 0.31 }, { y: -0.8, rx: 0.19, rz: 0.19, z: 0.32 }, { y: -1.4, rx: 0.08, rz: 0.09, z: 0.32 }]);
    for (const s of [-1, 1]) {
      b.prism([[s * 0.17, 0.72], [s * 0.17, -1.0], [s * 1.28, -1.42], [s * 1.28, -1.02]], 0.3, 0.34, { ink: 'body' });
      b.box(s * 1.3, -1.22, 0.04, 0.46, 0.04, 0.62, { ink: 'metal' });
    }
    b.tube([0, -1.44, 0.32], [0, -1.47, 0.32], 0.36, { n: 14, ink: 'light', alpha: 0.34 });
  },

  /* sea */
  'model-skiff': (b) => {
    const h = hull(8, 2.6);
    b.prism(h, 0, 1, { b: 0.8 });
    b.prism(h.map(([x, y]) => [x * 0.8, y * 0.86]), 1, 1.03, { ink: 'dark' });
    b.box(0, 0.15, 0.84, 0.82, 1.03, 1.6, { tx: 0.05, tf: 0.1, tb: 0.04, top: 'light' });
    b.box(0, 0.62, 0.9, 0.05, 1.5, 2.0, { ink: 'glass' });
    b.box(0, -1.5, 1.5, 0.5, 1.03, 1.45, { ink: 'metal' });
    b.box(0, -4.3, 0.5, 0.6, 0.5, 1.5, { ink: 'dark', c: 0.08 });
  },
  'model-usv': (b) => {
    const h = hull(5.8, 1.6);
    b.prism(h, 0, 0.56, { b: 0.7 });
    b.prism(h.map(([x, y]) => [x * 0.66, y * 0.78 - 0.25]), 0.56, 0.78, { s: 0.82, top: 'light' });
    b.box(0, -1.35, 0.52, 0.62, 0.78, 0.96, { ink: 'dark', c: 0.06 });
    b.cyl(0.12, -1.55, 0.025, 0.96, 1.62, { ink: 'metal', n: 6 });
    b.cyl(-0.14, -1.25, 0.06, 0.96, 1.14, { ink: 'light', n: 8 });
    b.box(0, -3.05, 0.44, 0.34, 0.12, 0.5, { ink: 'dark', c: 0.06 });
  },
  'model-warship': (b) => {
    const h = hull(60, 9.8);
    b.prism(h, 0, 4.4, { b: 0.84 });
    b.box(0, -22, 7.2, 13, 4.4, 4.5, { ink: 'metal' });
    b.cyl(0, -22, 2.7, 4.5, 4.56, { ink: 'light', n: 20 });
    b.box(0, -11.5, 6.4, 7.8, 4.4, 7.3, { tx: 0.1, top: 'body' });
    b.box(0, 2.2, 6.6, 19, 4.4, 7.7, { tx: 0.12, tf: 0.8, tb: 0.1, top: 'body' });
    b.box(0, 7.3, 5.2, 6, 7.7, 10.6, { tx: 0.1, tf: 0.5, side: 'glass', top: 'light' });
    b.box(0, -3.6, 2.5, 4, 7.7, 10.2, { ink: 'metal', tx: 0.2, tf: 0.2, tb: 0.2, top: 'dark' });
    b.cyl(0, 5.2, 0.34, 10.6, 16.4, { ink: 'metal', n: 8 });
    b.box(0, 5.2, 3.6, 0.3, 14, 14.3, { ink: 'metal' });
    b.box(0, 14.7, 3.8, 3.4, 4.4, 4.9, { ink: 'dark' });
    b.cyl(0, 20, 1.7, 4.4, 5.9, { ink: 'metal', n: 12, capB: 'light' });
    b.tube([0, 21.4, 5.2], [0, 26, 5.8], 0.2, { ink: 'metal', n: 8 });
  },
  'model-cargo': (b) => {
    const h = hull(120, 20);
    b.prism(h, 0, 10, { b: 0.9 });
    const colours = ['body', 'metal', 'light', 'body', 'light', 'metal', 'body'];
    const tall = [6, 8, 8, 8, 7, 6, 4];
    for (let i = 0; i < 7; i++) {
      for (let c = 0; c < 3; c++) {
        const y = -26 + i * 11.2;
        b.box((c - 1) * 5.7, y, 5.5, 10.6, 10, 10 + tall[i] - ((i + c) % 3 === 2 ? 1.3 : 0), { ink: colours[(i + c) % 7] });
      }
    }
    b.box(0, -44, 17.5, 9, 10, 24, { tx: 0.3, top: 'body' });
    b.box(0, -42.6, 20, 4, 24, 26.6, { tx: 0.1, side: 'glass', top: 'light' });
    b.box(0, -52, 5.4, 5, 10, 23, { ink: 'dark', tx: 0.3, tf: 0.3, tb: 0.3 });
  },

  /* rail */
  'model-locomotive': (b) => {
    for (const y of [5.4, -5.4]) bogie(b, y);
    b.box(0, 0, 2.95, 17.4, 0.95, 1.3, { ink: 'metal' });
    b.box(0, -1.45, 2.5, 13.1, 1.3, 3.75, { c: 0.18, tx: 0.08, top: 'light' });
    b.box(0, 6.9, 2.9, 3.4, 1.3, 2.95, { c: 0.16 });
    b.box(0, 6.9, 2.9, 3.4, 2.95, 3.7, { c: 0.16, tx: 0.06, tf: 0.2, side: 'glass' });
    b.box(0, 6.9, 2.82, 3.2, 3.7, 4.1, { c: 0.2, tx: 0.08, tf: 0.12, tb: 0.08, top: 'light' });
    b.cyl(0.3, -2.6, 0.32, 3.75, 4.05, { ink: 'dark', n: 10 });
    for (const y of [-5.6, 0.6]) b.box(0, y, 1.6, 2.4, 3.75, 3.92, { ink: 'metal' });
  },
  'model-wagon': (b) => {
    for (const y of [4.6, -4.6]) bogie(b, y);
    b.box(0, 0, 2.9, 14.2, 0.95, 1.16, { ink: 'metal' });
    b.box(0, 0, 2.8, 13.8, 1.16, 3.56, { c: 0.08 });
    b.extY([[-1.4, 3.56], [1.4, 3.56], [1.05, 3.95], [-1.05, 3.95]], -6.9, 6.9, { ink: 'light' });
    for (const s of [-1, 1]) b.box(s * 1.43, 0, 0.06, 2.4, 1.3, 3.4, { ink: 'metal' });
  },
};

export const MODEL_IDS = Object.keys(GEOMETRY);

const built = new Map();

/** A model by id, built the first time it is asked for; null for an id this build lacks. */
export function modelById(id) {
  if (built.has(id)) return built.get(id);
  const make = GEOMETRY[id];
  if (!make) return null;
  const b = new Build();
  make(b);
  const model = finish(id, b);
  built.set(id, model);
  return model;
}
