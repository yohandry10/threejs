import type * as THREE from 'three';

/** A top-level game scene (menu, campaign, battle...). Only one is active at a time. */
export interface GameScene {
  readonly name: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update(dt: number, realDt: number): void;
  resize(w: number, h: number): void;
  dispose(): void;
}
