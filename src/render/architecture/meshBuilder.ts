import * as THREE from 'three';

/** Accumulates triangles for one material bucket, with world-scaled UVs and vertex colours. */
export class Bucket {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];

  get empty() {
    return this.pos.length === 0;
  }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number], color: THREE.Color) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const [p, u] of [
      [a, ua],
      [b, ub],
      [c, uc],
    ] as const) {
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
      this.uv.push(u[0], u[1]);
      this.col.push(color.r, color.g, color.b);
    }
  }

  /** Quad a-b-c-d (counter-clockwise when viewed from the front). */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uw: number, vh: number, color: THREE.Color, u0 = 0, v0 = 0) {
    this.tri(a, b, c, [u0, v0], [u0 + uw, v0], [u0 + uw, v0 + vh], color);
    this.tri(a, c, d, [u0, v0], [u0 + uw, v0 + vh], [u0, v0 + vh], color);
  }

  build(): THREE.BufferGeometry | null {
    if (this.empty) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const tmpA = new THREE.Vector3();

/** Local frame helper: converts (lx, y, lz) local coordinates (rotated by yaw around a centre) to world. */
export function frame(cx: number, cz: number, yaw: number) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return (lx: number, y: number, lz: number) => new THREE.Vector3(cx + lx * c + lz * s, y, cz - lx * s + lz * c);
}

/**
 * Oriented box. y0 = bottom, h = height. Faces get UVs in world units scaled by uvScale.
 * Omits the bottom face.
 */
export function box(b: Bucket, cx: number, y0: number, cz: number, w: number, h: number, d: number, yaw: number, color: THREE.Color, uvScale = 0.25, top = true) {
  const f = frame(cx, cz, yaw);
  const hw = w / 2;
  const hd = d / 2;
  const y1 = y0 + h;
  const p = [f(-hw, y0, -hd), f(hw, y0, -hd), f(hw, y0, hd), f(-hw, y0, hd), f(-hw, y1, -hd), f(hw, y1, -hd), f(hw, y1, hd), f(-hw, y1, hd)];
  const s = uvScale;
  // front (+z local)
  b.quad(p[3], p[2], p[6], p[7], w * s, h * s, color);
  // back
  b.quad(p[1], p[0], p[4], p[5], w * s, h * s, color);
  // right
  b.quad(p[2], p[1], p[5], p[6], d * s, h * s, color);
  // left
  b.quad(p[0], p[3], p[7], p[4], d * s, h * s, color);
  if (top) b.quad(p[7], p[6], p[5], p[4], w * s, d * s, color);
}

/**
 * Gable roof: ridge along local x (width). Slopes face +z / -z. Gable triangles go to `gableBucket`.
 */
export function gableRoof(roof: Bucket, gable: Bucket, cx: number, y0: number, cz: number, w: number, d: number, rh: number, yaw: number, roofCol: THREE.Color, wallCol: THREE.Color, overhang = 0.5) {
  const f = frame(cx, cz, yaw);
  const hw = w / 2 + overhang;
  const hd = d / 2 + overhang;
  const e = overhang * (rh / (d / 2)); // eave drop to keep slope
  const a = f(-hw, y0 - e, -hd);
  const b2 = f(hw, y0 - e, -hd);
  const c = f(hw, y0 + rh, 0);
  const dd = f(-hw, y0 + rh, 0);
  const a2 = f(-hw, y0 - e, hd);
  const b3 = f(hw, y0 - e, hd);
  const slope = Math.hypot(hd, rh + e) * 0.3;
  roof.quad(b2, a, dd, c, w * 0.3, slope, roofCol);
  roof.quad(a2, b3, c, dd, w * 0.3, slope, roofCol);
  // underside of eaves not needed; gables
  const g0 = f(-w / 2, y0, -d / 2);
  const g1 = f(-w / 2, y0, d / 2);
  const g2 = f(-w / 2, y0 + rh - overhang * 0.2, 0);
  gable.tri(g0, g1, g2, [0, 0], [d * 0.25, 0], [d * 0.125, rh * 0.25], wallCol);
  const h0 = f(w / 2, y0, d / 2);
  const h1 = f(w / 2, y0, -d / 2);
  const h2 = f(w / 2, y0 + rh - overhang * 0.2, 0);
  gable.tri(h0, h1, h2, [0, 0], [d * 0.25, 0], [d * 0.125, rh * 0.25], wallCol);
}

export function cylinder(b: Bucket, cx: number, y0: number, cz: number, r0: number, r1: number, h: number, seg: number, color: THREE.Color, capTop = true, uvScale = 0.25) {
  const circ = 2 * Math.PI * Math.max(r0, r1);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = new THREE.Vector3(cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0);
    const p1 = new THREE.Vector3(cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0);
    const p2 = new THREE.Vector3(cx + Math.cos(a1) * r1, y0 + h, cz + Math.sin(a1) * r1);
    const p3 = new THREE.Vector3(cx + Math.cos(a0) * r1, y0 + h, cz + Math.sin(a0) * r1);
    const u0 = (i / seg) * circ * uvScale;
    b.quad(p1, p0, p3, p2, (circ / seg) * uvScale, h * uvScale, color, u0);
    if (capTop) {
      const c = tmpA.set(cx, y0 + h, cz).clone();
      b.tri(c, p2, p3, [0, 0], [r1 * uvScale, 0], [0, r1 * uvScale], color);
    }
  }
}

export function cone(b: Bucket, cx: number, y0: number, cz: number, r: number, h: number, seg: number, color: THREE.Color) {
  const apex = new THREE.Vector3(cx, y0 + h, cz);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = new THREE.Vector3(cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r);
    const p1 = new THREE.Vector3(cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r);
    b.tri(p1, p0, apex, [0, 0], [r * 0.4, 0], [r * 0.2, h * 0.3], color);
  }
}

/** Pyramid roof over a square footprint. */
export function pyramid(b: Bucket, cx: number, y0: number, cz: number, w: number, d: number, h: number, yaw: number, color: THREE.Color) {
  const f = frame(cx, cz, yaw);
  const hw = w / 2;
  const hd = d / 2;
  const apex = f(0, y0 + h, 0);
  const c = [f(-hw, y0, -hd), f(hw, y0, -hd), f(hw, y0, hd), f(-hw, y0, hd)];
  for (let i = 0; i < 4; i++) b.tri(c[(i + 1) % 4], c[i], apex, [0, 0], [w * 0.3, 0], [w * 0.15, h * 0.3], color);
}

/** Crenellations (merlons) along a straight top edge. */
export function merlons(b: Bucket, ax: number, az: number, bx: number, bz: number, y: number, thick: number, color: THREE.Color, size = 1.1) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.floor(len / (size * 2)));
  const yaw = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    box(b, ax + (bx - ax) * t, y, az + (bz - az) * t, size, size * 1.1, thick, yaw, color, 0.25);
  }
}
