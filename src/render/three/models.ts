// The robots' 3D models (public/models/<chassis>.glb, meshopt-compressed, made
// from the owner's renders and slimmed with scripts/slim-models.sh). Each model
// is loaded once and cloned per robot, with its own materials so a hit can
// flash one robot without touching the others.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** Turn so the model's face looks down +z (the arena turns +z to the facing direction). */
const FRONT_YAW: Record<string, number> = { clank: 0, bruiser: 0, roller: 0, whirl: -0.55, picks: 0 };

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<THREE.Object3D | null>>();

function load(chassis: string): Promise<THREE.Object3D | null> {
  let p = cache.get(chassis);
  if (!p) {
    // a host that won't serve .glb (the claude.ai test page) can point elsewhere: window.__ROBO_MODELS = 'models/{id}.bin'
    const pattern = (globalThis as { __ROBO_MODELS?: string }).__ROBO_MODELS ?? 'models/{id}.glb';
    p = loader.loadAsync(pattern.replace('{id}', chassis)).then(g => g.scene).catch(() => null);
    cache.set(chassis, p);
  }
  return p;
}

export interface RobotModel {
  /** yaw (facing) on the outer group, the per-chassis motion on `body` */
  root: THREE.Group;
  body: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
  height: number;
}

/**
 * A copy of the chassis model, scaled so its footprint fits a tile (`size`
 * world units), standing on y = 0 and centred on its pivot.
 */
export async function robotModel(chassis: string, size: number): Promise<RobotModel | null> {
  const src = await load(chassis);
  if (!src) return null;
  const inner = src.clone(true);
  const mats: THREE.MeshStandardMaterial[] = [];
  inner.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = (mesh.material as THREE.MeshStandardMaterial).clone();
    m.emissive = new THREE.Color(0, 0, 0);
    mesh.material = m;
    mats.push(m);
  });
  inner.rotation.y = FRONT_YAW[chassis] ?? 0;
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const s = box.getSize(new THREE.Vector3());
  const k = Math.min(size / Math.max(s.x, s.z), (size * 1.5) / s.y);
  inner.scale.setScalar(k);
  inner.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(inner);
  const ctr = b2.getCenter(new THREE.Vector3());
  inner.position.set(-ctr.x, -b2.min.y, -ctr.z);
  const body = new THREE.Group();
  body.add(inner);
  const root = new THREE.Group();
  root.add(body);
  return { root, body, mats, height: b2.max.y - b2.min.y };
}

/** Facing d (0 N, 1 E, 2 S, 3 W) as a yaw for a model whose face looks down +z. */
export const yawFor = (d: number) => Math.PI - (d * Math.PI) / 2;
