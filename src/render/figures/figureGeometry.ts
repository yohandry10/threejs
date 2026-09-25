import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { UnitVisual } from '../../data/units';

/**
 * Figures are built from simple parts. Each vertex carries:
 *  aBone: which limb it belongs to (animated in the vertex shader)
 *  aMat:  material slot (0 skin, 1 primary cloth, 2 secondary cloth, 3 metal, 4 leather, 5 wood, 6 hair, 7 shield face, 8 dark, 9 bright steel, 10 horse coat, 11 horse dark)
 *  aVar:  variant mask (0 = always shown, 1..3 = shown only for that instance variant)
 *  aUV2:  shield-face uv for the heraldry atlas
 */
export const BONE = { pelvis: 0, torso: 1, head: 2, armR: 3, foreR: 4, armL: 5, foreL: 6, thighR: 7, shinR: 8, thighL: 9, shinL: 10 };
export const HBONE = { body: 0, neck: 1, flU: 2, frU: 3, flL: 4, frL: 5, blU: 6, brU: 7, blL: 8, brL: 9, tail: 10 };
export const MAT = { skin: 0, prim: 1, sec: 2, metal: 3, leather: 4, wood: 5, hair: 6, shield: 7, dark: 8, steel: 9, coat: 10, hdark: 11 };

function tag(g: THREE.BufferGeometry, bone: number, mat: number, variant = 0, shieldUV = false): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const n = ng.attributes.position.count;
  const b = new Float32Array(n).fill(bone);
  const m = new Float32Array(n).fill(mat);
  const v = new Float32Array(n).fill(variant);
  const uv2 = new Float32Array(n * 2);
  if (shieldUV) {
    const pos = ng.attributes.position;
    ng.computeBoundingBox();
    const bb = ng.boundingBox!;
    for (let i = 0; i < n; i++) {
      uv2[i * 2] = 1 - (pos.getX(i) - bb.min.x) / Math.max(1e-4, bb.max.x - bb.min.x);
      uv2[i * 2 + 1] = (pos.getY(i) - bb.min.y) / Math.max(1e-4, bb.max.y - bb.min.y);
    }
  }
  ng.setAttribute('aBone', new THREE.BufferAttribute(b, 1));
  ng.setAttribute('aMat', new THREE.BufferAttribute(m, 1));
  ng.setAttribute('aVar', new THREE.BufferAttribute(v, 1));
  ng.setAttribute('aUV2', new THREE.BufferAttribute(uv2, 2));
  ng.deleteAttribute('uv');
  return ng;
}

const cyl = (r0: number, r1: number, h: number, seg = 6) => new THREE.CylinderGeometry(r1, r0, h, seg, 1);
const bx = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
/** Cylinder spanning from point a to point b. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg = 6): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = cyl(r0, r1, len, seg);
  g.translate(0, len / 2, 0);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

// joint positions (rest pose, facing +z)
export const J = {
  hipY: 0.92,
  kneeY: 0.5,
  ankleY: 0.08,
  hipX: 0.1,
  waistY: 0.98,
  shoulderY: 1.42,
  shoulderX: 0.21,
  elbowY: 1.14,
  wristY: 0.9,
  neckY: 1.5,
  headY: 1.63,
};

export function buildSoldierGeometry(v: UnitVisual, villager = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const armored = v.body >= 2;
  const plate = v.body === 3;
  // --- legs
  for (const s of [-1, 1]) {
    const thighB = s < 0 ? BONE.thighR : BONE.thighL;
    const shinB = s < 0 ? BONE.shinR : BONE.shinL;
    const x = s * J.hipX;
    parts.push(tag(limb(P(x, J.hipY, 0), P(x, J.kneeY, 0.01), 0.085, 0.07), thighB, plate ? MAT.metal : villager ? MAT.sec : MAT.leather));
    parts.push(tag(limb(P(x, J.kneeY, 0.01), P(x, J.ankleY + 0.04, -0.01), 0.065, 0.05), shinB, plate ? MAT.metal : MAT.dark));
    const foot = bx(0.1, 0.08, 0.22);
    foot.translate(x, 0.04, 0.05);
    parts.push(tag(foot, shinB, MAT.dark));
  }
  // --- pelvis & skirt
  const pel = bx(0.34, 0.2, 0.22);
  pel.translate(0, J.hipY + 0.02, 0);
  parts.push(tag(pel, BONE.pelvis, armored ? MAT.metal : MAT.prim));
  // tunic skirt (cloth, hangs from waist)
  const skirt = cyl(0.21, 0.19, 0.3, 8);
  skirt.translate(0, J.hipY - 0.08, 0);
  parts.push(tag(skirt, BONE.pelvis, villager ? MAT.prim : MAT.prim));
  // --- torso (tapered)
  const torso = cyl(0.17, 0.21, J.shoulderY - J.waistY + 0.04, 8);
  torso.scale(1, 1, 0.72);
  torso.translate(0, (J.shoulderY + J.waistY) / 2, 0);
  parts.push(tag(torso, BONE.torso, armored ? MAT.metal : MAT.prim));
  if (armored || v.body === 1) {
    // tabard over the armour
    const tab = bx(0.34, 0.5, 0.04);
    tab.translate(0, 1.18, 0.14);
    parts.push(tag(tab, BONE.torso, MAT.prim));
    const tabB = bx(0.34, 0.5, 0.04);
    tabB.translate(0, 1.18, -0.14);
    parts.push(tag(tabB, BONE.torso, MAT.prim));
    const stripe = bx(0.08, 0.5, 0.05);
    stripe.translate(0, 1.18, 0.15);
    parts.push(tag(stripe, BONE.torso, MAT.sec));
  }
  const belt = cyl(0.19, 0.19, 0.05, 8);
  belt.scale(1, 1, 0.75);
  belt.translate(0, J.waistY, 0);
  parts.push(tag(belt, BONE.torso, MAT.leather));
  // shoulders
  for (const s of [-1, 1]) {
    const sh = new THREE.SphereGeometry(plate ? 0.1 : 0.08, 6, 4);
    sh.translate(s * J.shoulderX, J.shoulderY - 0.02, 0);
    parts.push(tag(sh, BONE.torso, armored ? MAT.metal : MAT.prim));
  }
  // cloak
  if (v.cloak) {
    const cl = new THREE.PlaneGeometry(0.46, 0.95, 1, 3);
    const pos = cl.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, -Math.abs(pos.getY(i) - 0.47) * 0.1);
    cl.rotateY(Math.PI);
    cl.translate(0, 1.0, -0.17);
    parts.push(tag(cl, BONE.torso, MAT.sec));
    const cl2 = cl.clone();
    cl2.rotateY(Math.PI);
    cl2.translate(0, 0, -0.34);
    parts.push(tag(cl2, BONE.torso, MAT.sec));
  }
  // quiver
  if (v.weapon === 3) {
    const q = limb(P(0.08, 1.05, -0.16), P(-0.12, 1.5, -0.12), 0.06, 0.06, 6);
    parts.push(tag(q, BONE.torso, MAT.leather));
  }
  // --- neck & head
  const neck = cyl(0.05, 0.05, 0.1, 6);
  neck.translate(0, J.neckY, 0);
  parts.push(tag(neck, BONE.head, MAT.skin));
  const head = new THREE.IcosahedronGeometry(0.115, 1);
  head.scale(0.95, 1.08, 1);
  head.translate(0, J.headY, 0.01);
  parts.push(tag(head, BONE.head, MAT.skin));
  // nose
  const nose = bx(0.03, 0.05, 0.04);
  nose.translate(0, J.headY - 0.01, 0.115);
  parts.push(tag(nose, BONE.head, MAT.skin));
  // hair (visible under helmets / bare) and beard variant
  const hair = new THREE.SphereGeometry(0.122, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55);
  hair.translate(0, J.headY + 0.015, -0.008);
  parts.push(tag(hair, BONE.head, MAT.hair, 0));
  const beard = bx(0.16, 0.08, 0.06);
  beard.translate(0, J.headY - 0.09, 0.08);
  parts.push(tag(beard, BONE.head, MAT.hair, 2));
  // --- helmets (variants give per-soldier variety)
  const hy = J.headY + 0.02;
  const addHelm = (type: number, variant: number) => {
    switch (type) {
      case 0: {
        // hood / coif (cloth)
        const h = new THREE.SphereGeometry(0.135, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.62);
        h.translate(0, hy, -0.01);
        parts.push(tag(h, BONE.head, villager ? MAT.sec : MAT.sec, variant));
        break;
      }
      case 1: {
        // kettle hat
        const dome = new THREE.SphereGeometry(0.13, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
        dome.translate(0, hy + 0.03, 0);
        const brim = cyl(0.21, 0.21, 0.02, 10);
        brim.translate(0, hy + 0.03, 0);
        parts.push(tag(dome, BONE.head, MAT.metal, variant), tag(brim, BONE.head, MAT.metal, variant));
        break;
      }
      case 2: {
        // conical nasal helm
        const c = new THREE.ConeGeometry(0.135, 0.22, 8);
        c.translate(0, hy + 0.1, 0);
        const ring = cyl(0.135, 0.135, 0.06, 8);
        ring.translate(0, hy, 0);
        const nas = bx(0.025, 0.11, 0.02);
        nas.translate(0, hy - 0.06, 0.13);
        parts.push(tag(c, BONE.head, MAT.metal, variant), tag(ring, BONE.head, MAT.metal, variant), tag(nas, BONE.head, MAT.metal, variant));
        break;
      }
      case 3: {
        // great helm with crest
        const g = cyl(0.14, 0.14, 0.3, 10);
        g.translate(0, hy - 0.02, 0);
        const top = cyl(0.14, 0.11, 0.04, 10);
        top.translate(0, hy + 0.15, 0);
        const slit = bx(0.2, 0.02, 0.02);
        slit.translate(0, hy + 0.01, 0.14);
        const crest = bx(0.03, 0.12, 0.22);
        crest.translate(0, hy + 0.22, 0);
        parts.push(tag(g, BONE.head, MAT.metal, variant), tag(top, BONE.head, MAT.metal, variant), tag(slit, BONE.head, MAT.dark, variant), tag(crest, BONE.head, MAT.sec, variant));
        break;
      }
      case 4: {
        // bascinet
        const b = new THREE.SphereGeometry(0.14, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6);
        b.scale(1, 1.4, 1);
        b.translate(0, hy + 0.02, -0.01);
        const avent = cyl(0.15, 0.13, 0.1, 8);
        avent.translate(0, hy - 0.12, 0);
        parts.push(tag(b, BONE.head, MAT.metal, variant), tag(avent, BONE.head, MAT.metal, variant));
        break;
      }
    }
  };
  if (!villager && v.helmet !== 5) {
    addHelm(v.helmet, 1);
    // alternative helmets for variety
    const alt: Record<number, number[]> = { 0: [0, 1], 1: [2, 0], 2: [1, 4], 3: [4, 3], 4: [2, 3] };
    const [a2, a3] = alt[v.helmet] ?? [v.helmet, v.helmet];
    addHelm(a2, 2);
    addHelm(a3, 3);
  } else if (villager) {
    addHelm(0, 1); // hood for some villagers
  }
  // --- arms
  for (const s of [-1, 1]) {
    const upB = s < 0 ? BONE.armR : BONE.armL;
    const foB = s < 0 ? BONE.foreR : BONE.foreL;
    const x = s * (J.shoulderX + 0.04);
    parts.push(tag(limb(P(x, J.shoulderY, 0), P(x + s * 0.02, J.elbowY, 0), 0.06, 0.052), upB, armored ? MAT.metal : MAT.prim));
    parts.push(tag(limb(P(x + s * 0.02, J.elbowY, 0), P(x + s * 0.02, J.wristY + 0.02, 0.02), 0.05, 0.042), foB, plate ? MAT.metal : armored ? MAT.metal : villager ? MAT.skin : MAT.leather));
    const hand = new THREE.IcosahedronGeometry(0.045, 0);
    hand.translate(x + s * 0.02, J.wristY - 0.03, 0.025);
    parts.push(tag(hand, foB, plate ? MAT.metal : MAT.skin));
  }
  // --- weapons (right hand at x = -(shoulderX+0.06))
  const hx = -(J.shoulderX + 0.06);
  const hy2 = J.wristY - 0.03;
  const hz = 0.03;
  const W = (g: THREE.BufferGeometry, mat: number, bone = BONE.foreR) => parts.push(tag(g, bone, mat));
  switch (villager ? -1 : v.weapon) {
    case 0: {
      // sword (blade points up/forward)
      const blade = bx(0.045, 0.78, 0.012);
      blade.translate(hx, hy2 + 0.5, hz + 0.04);
      const guard = bx(0.2, 0.03, 0.04);
      guard.translate(hx, hy2 + 0.1, hz + 0.04);
      const grip = cyl(0.018, 0.018, 0.16);
      grip.translate(hx, hy2, hz + 0.04);
      W(blade, MAT.steel);
      W(guard, MAT.metal);
      W(grip, MAT.leather);
      break;
    }
    case 1:
    case 6: {
      const len = v.weapon === 6 ? 4.2 : 2.5;
      const shaft = cyl(0.022, 0.022, len, 5);
      shaft.translate(hx, hy2 + len * 0.35, hz + 0.02);
      const tip = new THREE.ConeGeometry(0.04, 0.2, 5);
      tip.translate(hx, hy2 + len * 0.85 + 0.1, hz + 0.02);
      W(shaft, MAT.wood);
      W(tip, MAT.steel);
      break;
    }
    case 2: {
      const shaft = cyl(0.022, 0.022, 1.1, 5);
      shaft.translate(hx, hy2 + 0.35, hz + 0.02);
      const blade = bx(0.02, 0.26, 0.2);
      blade.translate(hx, hy2 + 0.82, hz + 0.1);
      W(shaft, MAT.wood);
      W(blade, MAT.steel);
      break;
    }
    case 8: {
      const shaft = cyl(0.02, 0.02, 1.4, 5);
      shaft.translate(hx, hy2 + 0.45, hz + 0.02);
      const head = bx(0.1, 0.16, 0.1);
      head.translate(hx, hy2 + 1.12, hz + 0.02);
      const spike = new THREE.ConeGeometry(0.03, 0.2, 4);
      spike.translate(hx, hy2 + 1.28, hz + 0.02);
      W(shaft, MAT.wood);
      W(head, MAT.metal);
      W(spike, MAT.steel);
      break;
    }
    case 7: {
      // pitchfork / club
      const shaft = cyl(0.025, 0.025, 1.6, 5);
      shaft.translate(hx, hy2 + 0.55, hz + 0.02);
      W(shaft, MAT.wood);
      for (const dx of [-0.05, 0, 0.05]) {
        const t = cyl(0.008, 0.008, 0.22, 3);
        t.translate(hx + dx, hy2 + 1.45, hz + 0.02);
        W(t, MAT.metal);
      }
      break;
    }
    case 3: {
      // bow held in the left hand: vertical arc
      const lx = J.shoulderX + 0.06;
      const bow = new THREE.TorusGeometry(0.62, 0.018, 4, 12, Math.PI * 0.72);
      bow.rotateZ(Math.PI / 2 - Math.PI * 0.36);
      bow.rotateY(Math.PI / 2);
      bow.translate(lx - 0.02, hy2, hz + 0.02 - 0.48);
      W(bow, MAT.wood, BONE.foreL);
      const string = bx(0.006, 1.02, 0.006);
      string.translate(lx - 0.02, hy2, hz - 0.2);
      W(string, MAT.hair, BONE.foreL);
      break;
    }
    case 4: {
      // crossbow held forward
      const stock = bx(0.05, 0.05, 0.7);
      stock.translate(hx + 0.05, hy2 + 0.02, hz + 0.25);
      const prod = bx(0.62, 0.035, 0.035);
      prod.translate(hx + 0.05, hy2 + 0.03, hz + 0.56);
      W(stock, MAT.wood);
      W(prod, MAT.metal);
      break;
    }
    case 5: {
      // lance
      const shaft = cyl(0.035, 0.02, 3.6, 6);
      shaft.translate(hx, hy2 + 1.2, hz + 0.02);
      const pen = bx(0.005, 0.18, 0.28);
      pen.translate(hx, hy2 + 2.7, hz + 0.16);
      W(shaft, MAT.wood);
      W(pen, MAT.prim);
      break;
    }
    case -1: {
      // villager tool (hoe / sack) – a simple staff
      const shaft = cyl(0.02, 0.02, 1.3, 4);
      shaft.translate(hx, hy2 + 0.45, hz + 0.02);
      W(shaft, MAT.wood);
      break;
    }
  }
  // --- shields on the left forearm
  const sx = J.shoulderX + 0.11;
  const sy = J.elbowY - 0.08;
  const shield = (g: THREE.BufferGeometry, rim: THREE.BufferGeometry | null) => {
    parts.push(tag(g, BONE.foreL, MAT.shield, 0, true));
    if (rim) parts.push(tag(rim, BONE.foreL, MAT.metal));
  };
  switch (villager ? 0 : v.shield) {
    case 1: {
      const g = new THREE.CircleGeometry(0.34, 12);
      g.rotateY(Math.PI / 2);
      g.translate(sx + 0.03, sy, 0.02);
      const back = cyl(0.34, 0.34, 0.03, 12);
      back.rotateZ(Math.PI / 2);
      back.translate(sx, sy, 0.02);
      shield(g, back);
      break;
    }
    case 2:
    case 3: {
      const s = new THREE.Shape();
      const tall = v.shield === 2 ? 0.92 : 0.7;
      s.moveTo(-0.24, 0.3);
      s.lineTo(0.24, 0.3);
      s.lineTo(0.24, 0.05);
      s.quadraticCurveTo(0.22, -tall + 0.4, 0, -tall + 0.3);
      s.quadraticCurveTo(-0.22, -tall + 0.4, -0.24, 0.05);
      s.lineTo(-0.24, 0.3);
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false });
      g.rotateY(Math.PI / 2);
      g.translate(sx - 0.02, sy + 0.05, 0.02);
      // front face only for the atlas: use a flat shape
      const f = new THREE.ShapeGeometry(s);
      f.rotateY(Math.PI / 2);
      f.translate(sx + 0.025, sy + 0.05, 0.02);
      parts.push(tag(g, BONE.foreL, MAT.leather));
      parts.push(tag(f, BONE.foreL, MAT.shield, 0, true));
      break;
    }
    case 4: {
      // pavise slung on the back
      const g = bx(0.5, 0.95, 0.05);
      g.translate(0, 1.05, -0.2);
      parts.push(tag(g, BONE.torso, MAT.prim));
      const st = bx(0.1, 0.95, 0.06);
      st.translate(0, 1.05, -0.21);
      parts.push(tag(st, BONE.torso, MAT.sec));
      break;
    }
  }
  const merged = mergeGeometries(parts)!;
  merged.computeBoundingSphere();
  return merged;
}

export function buildHorseGeometry(barded: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // body
  const body = cyl(0.3, 0.33, 1.25, 10);
  body.rotateX(Math.PI / 2);
  body.scale(0.95, 1.1, 1);
  body.translate(0, 1.22, 0);
  parts.push(tag(body, HBONE.body, MAT.coat));
  const rump = new THREE.SphereGeometry(0.34, 8, 6);
  rump.translate(0, 1.26, -0.55);
  parts.push(tag(rump, HBONE.body, MAT.coat));
  const chest = new THREE.SphereGeometry(0.33, 8, 6);
  chest.translate(0, 1.24, 0.55);
  parts.push(tag(chest, HBONE.body, MAT.coat));
  // neck and head
  parts.push(tag(limb(P(0, 1.35, 0.62), P(0, 1.95, 0.95), 0.2, 0.13, 8), HBONE.neck, MAT.coat));
  const head = bx(0.2, 0.22, 0.52);
  head.rotateX(0.6);
  head.translate(0, 1.95, 1.15);
  parts.push(tag(head, HBONE.neck, MAT.coat));
  const mane = bx(0.06, 0.12, 0.62);
  mane.rotateX(-0.95);
  mane.translate(0, 1.82, 0.78);
  parts.push(tag(mane, HBONE.neck, MAT.hdark));
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.04, 0.12, 4);
    ear.translate(s * 0.07, 2.12, 0.98);
    parts.push(tag(ear, HBONE.neck, MAT.coat));
  }
  // legs
  const leg = (x: number, z: number, upB: number, loB: number) => {
    parts.push(tag(limb(P(x, 1.1, z), P(x, 0.62, z + 0.02), 0.09, 0.07), upB, MAT.coat));
    parts.push(tag(limb(P(x, 0.62, z + 0.02), P(x, 0.1, z), 0.055, 0.05), loB, MAT.coat));
    const hoof = cyl(0.07, 0.065, 0.1, 6);
    hoof.translate(x, 0.05, z);
    parts.push(tag(hoof, loB, MAT.hdark));
  };
  leg(0.16, 0.5, HBONE.flU, HBONE.flL);
  leg(-0.16, 0.5, HBONE.frU, HBONE.frL);
  leg(0.16, -0.5, HBONE.blU, HBONE.blL);
  leg(-0.16, -0.5, HBONE.brU, HBONE.brL);
  // tail
  parts.push(tag(limb(P(0, 1.35, -0.8), P(0, 0.75, -1.0), 0.06, 0.035, 5), HBONE.tail, MAT.hdark));
  // saddle
  const saddle = bx(0.46, 0.1, 0.5);
  saddle.translate(0, 1.56, -0.05);
  parts.push(tag(saddle, HBONE.body, MAT.leather));
  if (barded) {
    // caparison skirt
    const cap = cyl(0.42, 0.46, 0.7, 12, );
    cap.scale(1, 1, 2.1);
    cap.translate(0, 1.05, 0);
    parts.push(tag(cap, HBONE.body, MAT.prim));
    const trim = cyl(0.465, 0.465, 0.08, 12);
    trim.scale(1, 1, 2.1);
    trim.translate(0, 0.72, 0);
    parts.push(tag(trim, HBONE.body, MAT.sec));
    const chanfron = bx(0.22, 0.2, 0.44);
    chanfron.rotateX(0.6);
    chanfron.translate(0, 1.99, 1.16);
    parts.push(tag(chanfron, HBONE.neck, MAT.metal));
    const neckCloth = limb(P(0, 1.36, 0.6), P(0, 1.92, 0.93), 0.215, 0.14, 8);
    parts.push(tag(neckCloth, HBONE.neck, MAT.prim));
  }
  const merged = mergeGeometries(parts)!;
  merged.computeBoundingSphere();
  return merged;
}
