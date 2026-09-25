import * as THREE from 'three';

/** A small flock of seabirds gliding and flapping in lazy circles (vertex-animated). */
export class Birds {
  mesh: THREE.InstancedMesh;
  private uni = { uTime: { value: 0 } };
  private data: { cx: number; cz: number; r: number; h: number; sp: number; ph: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  constructor(count: number, center: THREE.Vector3, spread: number, seed = 1) {
    // body + two wings (each wing: inner and outer panel) in local space, beak along +z
    const pos = [
      0, 0, 0.35, -0.07, 0, -0.3, 0.07, 0, -0.3,
      0, 0, 0.12, -0.55, 0.05, -0.02, 0, 0, -0.12,
      -0.55, 0.05, -0.02, -1.05, 0.02, -0.12, 0, 0, -0.12,
      0, 0, 0.12, 0, 0, -0.12, 0.55, 0.05, -0.02,
      0.55, 0.05, -0.02, 0, 0, -0.12, 1.05, 0.02, -0.12,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2c2a2a, roughness: 0.9, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uni.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float id = float(gl_InstanceID);
          float flap = sin(uTime * 7.0 + id * 1.7) * (0.5 + 0.5 * sin(uTime * 0.6 + id));
          float span = abs(transformed.x);
          transformed.y += flap * span * 0.55;
        }`,
      );
    };
    this.mesh = new THREE.InstancedMesh(g, mat, count);
    this.mesh.frustumCulled = false;
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) this.data.push({ cx: center.x + (rnd() - 0.5) * spread, cz: center.z + (rnd() - 0.5) * spread, r: 20 + rnd() * 40, h: center.y + 14 + rnd() * 26, sp: 0.18 + rnd() * 0.18, ph: rnd() * 6.28 });
  }
  update(time: number, follow?: THREE.Vector3) {
    this.uni.uTime.value = time;
    this.data.forEach((b, i) => {
      const a = b.ph + time * b.sp * (i % 2 ? 1 : -1);
      const cx = follow ? follow.x + b.cx : b.cx;
      const cz = follow ? follow.z + b.cz : b.cz;
      const x = cx + Math.cos(a) * b.r;
      const z = cz + Math.sin(a) * b.r;
      const y = b.h + Math.sin(time * 0.4 + b.ph) * 3;
      const heading = Math.atan2(-Math.sin(a), Math.cos(a)) * (i % 2 ? 1 : -1);
      this.q.setFromEuler(new THREE.Euler(0, (i % 2 ? heading : heading + Math.PI), Math.sin(time * 0.5 + b.ph) * 0.25 * (i % 2 ? 1 : -1)));
      this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(1.4, 1.4, 1.4));
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
