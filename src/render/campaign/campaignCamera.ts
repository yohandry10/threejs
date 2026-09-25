import * as THREE from 'three';
import { clamp, damp, lerp } from '../../core/math';

/** Strategy camera: pan / zoom / rotate / tilt with smoothing and terrain collision. */
export class StrategyCamera {
  camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3(1000, 0, 2000);
  goal = new THREE.Vector3(1000, 0, 2000);
  distance = 1200;
  goalDistance = 1200;
  yaw = 0; // radians around Y, 0 = looking north (-z)
  goalYaw = 0;
  pitchOffset = 0;
  minDist = 45;
  maxDist = 4200;
  minPitch = 0.42;
  maxPitch = 1.2;
  bounds: THREE.Box2;
  groundAt: (x: number, z: number) => number;
  keys = new Set<string>();
  sensitivity = 1;
  edgeScroll = false;
  mouse = { x: 0.5, y: 0.5, inside: false };
  private dragging: null | { button: number; x: number; y: number; moved: boolean; startTarget: THREE.Vector3 } = null;
  flying = false;
  flyT = 1;
  private flyFrom = new THREE.Vector3();
  private flyTo = new THREE.Vector3();
  private flyDistFrom = 0;
  private flyDistTo = 0;
  enabled = true;
  bindings: Record<string, string>;

  constructor(aspect: number, bounds: THREE.Box2, groundAt: (x: number, z: number) => number, bindings: Record<string, string>) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 1, 20000);
    this.bounds = bounds;
    this.groundAt = groundAt;
    this.bindings = bindings;
  }

  get pitch() {
    const t = clamp((this.distance - this.minDist) / (this.maxDist - this.minDist), 0, 1);
    return clamp(lerp(this.minPitch, this.maxPitch, Math.pow(t, 0.6)) + this.pitchOffset, 0.25, 1.45);
  }

  focus(x: number, z: number, dist?: number, instant = false) {
    if (instant) {
      this.goal.set(x, 0, z);
      this.target.copy(this.goal);
      if (dist !== undefined) this.distance = this.goalDistance = dist;
      this.flying = false;
      return;
    }
    this.flying = true;
    this.flyT = 0;
    this.flyFrom.copy(this.target);
    this.flyTo.set(x, 0, z);
    this.flyDistFrom = this.distance;
    this.flyDistTo = dist ?? this.goalDistance;
  }

  onWheel(e: WheelEvent, groundPoint?: THREE.Vector3 | null) {
    if (!this.enabled) return;
    const f = Math.exp(e.deltaY * 0.0012 * this.sensitivity);
    if (e.ctrlKey || e.altKey) {
      this.pitchOffset = clamp(this.pitchOffset + e.deltaY * 0.0008, -0.35, 0.35);
      return;
    }
    const nd = clamp(this.goalDistance * f, this.minDist, this.maxDist);
    // zoom toward the cursor
    if (groundPoint && f < 1) {
      const k = 1 - nd / this.goalDistance;
      this.goal.x += (groundPoint.x - this.goal.x) * k * 0.9;
      this.goal.z += (groundPoint.z - this.goal.z) * k * 0.9;
    }
    this.goalDistance = nd;
    this.flying = false;
  }

  onPointerDown(e: PointerEvent) {
    if (!this.enabled) return;
    if (e.button === 0 || e.button === 1) this.dragging = { button: e.button, x: e.clientX, y: e.clientY, moved: false, startTarget: this.goal.clone() };
  }

  onPointerMove(e: PointerEvent, w: number, h: number) {
    this.mouse.x = e.clientX / w;
    this.mouse.y = e.clientY / h;
    this.mouse.inside = true;
    if (!this.dragging || !this.enabled) return;
    const dx = e.clientX - this.dragging.x;
    const dy = e.clientY - this.dragging.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) this.dragging.moved = true;
    if (!this.dragging.moved) return;
    if (this.dragging.button === 1 || e.shiftKey) {
      this.goalYaw -= e.movementX * 0.005 * this.sensitivity;
      this.pitchOffset = clamp(this.pitchOffset + e.movementY * 0.003, -0.35, 0.35);
    } else {
      const scale = (this.distance / h) * 1.6 * this.sensitivity;
      const cs = Math.cos(this.yaw);
      const sn = Math.sin(this.yaw);
      const mx = -e.movementX * scale;
      const mz = -e.movementY * scale;
      this.goal.x += mx * cs + mz * sn;
      this.goal.z += -mx * sn + mz * cs;
      this.flying = false;
    }
  }

  /** Returns true if the pointer-up ends a drag (so it should not count as a click). */
  onPointerUp(e: PointerEvent): boolean {
    const d = this.dragging;
    this.dragging = null;
    return !!d && d.moved && d.button === e.button;
  }

  update(dt: number) {
    const k = this.bindings;
    let px = 0;
    let pz = 0;
    if (this.enabled) {
      if (this.keys.has(k.panUp) || this.keys.has('ArrowUp')) pz -= 1;
      if (this.keys.has(k.panDown) || this.keys.has('ArrowDown')) pz += 1;
      if (this.keys.has(k.panLeft) || this.keys.has('ArrowLeft')) px -= 1;
      if (this.keys.has(k.panRight) || this.keys.has('ArrowRight')) px += 1;
      if (this.keys.has(k.rotateLeft)) this.goalYaw += dt * 1.2;
      if (this.keys.has(k.rotateRight)) this.goalYaw -= dt * 1.2;
      if (this.edgeScroll && this.mouse.inside) {
        const m = 0.012;
        if (this.mouse.x < m) px -= 1;
        if (this.mouse.x > 1 - m) px += 1;
        if (this.mouse.y < m) pz -= 1;
        if (this.mouse.y > 1 - m) pz += 1;
      }
    }
    if (px || pz) {
      const speed = this.goalDistance * 0.9 * dt * this.sensitivity;
      const cs = Math.cos(this.yaw);
      const sn = Math.sin(this.yaw);
      this.goal.x += (px * cs + pz * sn) * speed;
      this.goal.z += (-px * sn + pz * cs) * speed;
      this.flying = false;
    }
    if (this.flying) {
      this.flyT = Math.min(1, this.flyT + dt / 1.4);
      const t = this.flyT < 0.5 ? 4 * this.flyT ** 3 : 1 - Math.pow(-2 * this.flyT + 2, 3) / 2;
      this.goal.lerpVectors(this.flyFrom, this.flyTo, t);
      // arc out while flying far
      const span = this.flyFrom.distanceTo(this.flyTo);
      const lift = Math.sin(t * Math.PI) * Math.min(this.maxDist * 0.6, span * 0.5);
      this.goalDistance = lerp(this.flyDistFrom, this.flyDistTo, t) + lift;
      this.target.copy(this.goal);
      this.distance = this.goalDistance;
      if (this.flyT >= 1) {
        this.flying = false;
        this.goalDistance = this.flyDistTo;
      }
    }
    this.goal.x = clamp(this.goal.x, this.bounds.min.x, this.bounds.max.x);
    this.goal.z = clamp(this.goal.z, this.bounds.min.y, this.bounds.max.y);
    this.target.x = damp(this.target.x, this.goal.x, 10, dt);
    this.target.z = damp(this.target.z, this.goal.z, 10, dt);
    this.distance = damp(this.distance, this.goalDistance, 8, dt);
    this.yaw = damp(this.yaw, this.goalYaw, 10, dt);
    const ground = Math.max(0, this.groundAt(this.target.x, this.target.z));
    this.target.y = damp(this.target.y, ground, 6, dt);
    const p = this.pitch;
    const cx = this.target.x + Math.sin(this.yaw) * Math.cos(p) * this.distance;
    const cz = this.target.z + Math.cos(this.yaw) * Math.cos(p) * this.distance;
    let cy = this.target.y + Math.sin(p) * this.distance;
    // terrain collision along the camera position and a little in front of it
    const minClear = Math.max(6, this.distance * 0.04);
    const g1 = this.groundAt(cx, cz);
    const g2 = this.groundAt((cx + this.target.x) / 2, (cz + this.target.z) / 2);
    cy = Math.max(cy, Math.max(g1, 0) + minClear, Math.max(g2, 0) + minClear * 0.5);
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.target);
    this.camera.near = clamp(this.distance * 0.01, 0.5, 20);
    this.camera.far = Math.max(9000, this.distance * 9);
    this.camera.updateProjectionMatrix();
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
