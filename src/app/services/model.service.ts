import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BehaviorSubject } from 'rxjs';

export interface ModelPart {
  id: string;
  name: string;
  mesh: THREE.Object3D;
  originalPosition: THREE.Vector3;
  originalRotation: THREE.Euler;
  color: string;
  visible: boolean;
  highlighted: boolean;
  children?: ModelPart[];
}

@Injectable({ providedIn: 'root' })
export class ModelService {
  private loader = new GLTFLoader();

  parts$ = new BehaviorSubject<ModelPart[]>([]);
  loading$ = new BehaviorSubject<boolean>(false);
  loadProgress$ = new BehaviorSubject<number>(0);

  private partColors = [
    '#FFD6D6', '#D6F5F0', '#D6EDFF', '#D6FFE8', '#FFF6D6',
    '#EDD6FF', '#D6FFF3', '#FFFBD6', '#E8D6FF', '#D6EEFF',
    '#FFE8D6', '#D6FFE0', '#FFD6EE', '#D6F0FF', '#F0D6FF',
    '#FFECD6', '#D6FFD6', '#FFD6F5', '#D6FFFF', '#FFDFD6'
  ];

  /** Load a GLB file from URL */
  async loadGLB(url: string): Promise<ModelPart[]> {
    this.loading$.next(true);
    this.loadProgress$.next(0);

    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          const parts = this.extractParts(gltf.scene);
          this.parts$.next(parts);
          this.loading$.next(false);
          this.loadProgress$.next(100);
          resolve(parts);
        },
        (progress) => {
          const pct = Math.round((progress.loaded / (progress.total || 1)) * 100);
          this.loadProgress$.next(pct);
        },
        (error) => {
          console.error('GLB load error:', error);
          this.loading$.next(false);
          reject(error);
        }
      );
    });
  }

  /** Load a GLB from a File object (drag-drop / file input) */
  async loadGLBFromFile(file: File): Promise<ModelPart[]> {
    const url = URL.createObjectURL(file);
    try {
      return await this.loadGLB(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Build the demo engine model (procedural, no external file needed) */
  buildDemoModel(): ModelPart[] {
    const parts: ModelPart[] = [];
    const colorIndex = { i: 0 };

    const nextColor = () => this.partColors[colorIndex.i++ % this.partColors.length];

    // ── Engine Block (main body) ──────────────────────────────────────────
    const engineGeo = new THREE.BoxGeometry(3, 1.5, 2);
    const engineMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(nextColor()) });
    const engineMesh = new THREE.Mesh(engineGeo, engineMat);
    engineMesh.name = 'Engine Block';
    engineMesh.castShadow = true;
    engineMesh.receiveShadow = true;
    engineMesh.position.set(0, 0, 0);
    const blockPart = this.createPart('engine-block', 'Engine Block', engineMesh);
    parts.push(blockPart);

    // ── Cylinder Head Assembly ─────────────────────────────────────────────
    const headAssembly: ModelPart = {
      id: 'head-assembly',
      name: 'Cylinder Head Assembly',
      mesh: new THREE.Group(),
      originalPosition: new THREE.Vector3(),
      originalRotation: new THREE.Euler(),
      color: '#ffffff',
      visible: true,
      highlighted: false,
      children: []
    };
    parts.push(headAssembly);

    const headGeo = new THREE.BoxGeometry(2.8, 0.5, 1.8);
    const headMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(nextColor()) });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.name = 'Cylinder Head';
    headMesh.position.set(0, 1.1, 0);
    headAssembly.children!.push(this.createPart('cylinder-head', 'Cylinder Head', headMesh));

    const vcGeo = new THREE.BoxGeometry(2.6, 0.3, 1.6);
    const vcMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(nextColor()) });
    const vcMesh = new THREE.Mesh(vcGeo, vcMat);
    vcMesh.name = 'Valve Cover';
    vcMesh.position.set(0, 1.5, 0);
    headAssembly.children!.push(this.createPart('valve-cover', 'Valve Cover', vcMesh));

    // ── Rotating Assembly ──────────────────────────────────────────────────
    const rotatingAssembly: ModelPart = {
      id: 'rotating-assembly',
      name: 'Rotating Assembly',
      mesh: new THREE.Group(),
      originalPosition: new THREE.Vector3(),
      originalRotation: new THREE.Euler(),
      color: '#ffffff',
      visible: true,
      highlighted: false,
      children: []
    };
    parts.push(rotatingAssembly);

    // ── Pistons (x4) ─────────────────────────────────────────────────────
    [-1.0, -0.33, 0.33, 1.0].forEach((x, idx) => {
      const pGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.8, 16);
      const pMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(nextColor()) });
      const pMesh = new THREE.Mesh(pGeo, pMat);
      pMesh.name = `Piston ${idx + 1}`;
      pMesh.position.set(x, 0.2, 0);
      rotatingAssembly.children!.push(this.createPart(`piston-${idx + 1}`, `Piston ${idx + 1}`, pMesh));
    });

    // ── Crankshaft ────────────────────────────────────────────────────────
    const crankGeo = new THREE.CylinderGeometry(0.15, 0.15, 3.2, 12);
    const crankMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(nextColor()) });
    const crankMesh = new THREE.Mesh(crankGeo, crankMat);
    crankMesh.name = 'Crankshaft';
    crankMesh.rotation.z = Math.PI / 2;
    crankMesh.position.set(0, -0.5, 0);
    rotatingAssembly.children!.push(this.createPart('crankshaft', 'Crankshaft', crankMesh));

    // ── Oil Pan ───────────────────────────────────────────────────────────
    const oilGeo = new THREE.BoxGeometry(2.8, 0.4, 1.8);
    const oilMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(nextColor()) });
    const oilMesh = new THREE.Mesh(oilGeo, oilMat);
    oilMesh.name = 'Oil Pan';
    oilMesh.position.set(0, -1.1, 0);
    parts.push(this.createPart('oil-pan', 'Oil Pan', oilMesh));

    // ── Timing Cover ─────────────────────────────────────────────────────
    const tcGeo = new THREE.BoxGeometry(0.2, 1.4, 1.6);
    const tcMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(nextColor()) });
    const tcMesh = new THREE.Mesh(tcGeo, tcMat);
    tcMesh.name = 'Timing Cover';
    tcMesh.position.set(1.6, 0, 0);
    parts.push(this.createPart('timing-cover', 'Timing Cover', tcMesh));

    // ── Exhaust Manifold ──────────────────────────────────────────────────
    const exGeo = new THREE.BoxGeometry(2.4, 0.3, 0.2);
    const exMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(nextColor()) });
    const exMesh = new THREE.Mesh(exGeo, exMat);
    exMesh.name = 'Exhaust Manifold';
    exMesh.position.set(0, 0.3, -1.1);
    parts.push(this.createPart('exhaust-manifold', 'Exhaust Manifold', exMesh));

    // ── Intake Manifold ───────────────────────────────────────────────────
    const inGeo = new THREE.BoxGeometry(2.4, 0.3, 0.2);
    const inMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(nextColor()) });
    const inMesh = new THREE.Mesh(inGeo, inMat);
    inMesh.name = 'Intake Manifold';
    inMesh.position.set(0, 0.3, 1.1);
    parts.push(this.createPart('intake-manifold', 'Intake Manifold', inMesh));

    // ── Water Pump ────────────────────────────────────────────────────────
    const wpGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 16);
    const wpMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(nextColor()) });
    const wpMesh = new THREE.Mesh(wpGeo, wpMat);
    wpMesh.name = 'Water Pump';
    wpMesh.rotation.z = Math.PI / 2;
    wpMesh.position.set(1.7, 0.5, 0.5);
    parts.push(this.createPart('water-pump', 'Water Pump', wpMesh));

    this.parts$.next(parts);
    return parts;
  }

  private createPart(id: string, name: string, mesh: THREE.Object3D): ModelPart {
    return {
      id,
      name,
      mesh,
      originalPosition: mesh.position.clone(),
      originalRotation: mesh.rotation.clone(),
      color: (mesh instanceof THREE.Mesh
        ? '#' + ((mesh.material as THREE.MeshPhongMaterial).color.getHexString())
        : '#ffffff'),
      visible: true,
      highlighted: false
    };
  }

  /**
   * Extract parts from a loaded GLB scene.
   *
   * Flattens the hierarchy: finds all Mesh objects and reparents them
   * as direct children of the scene root using attach() (preserves world transforms).
   * This lets us move individual parts for explode/select features.
   */
  private extractParts(scene: THREE.Object3D): ModelPart[] {
    const parts: ModelPart[] = [];
    const meshes: THREE.Mesh[] = [];

    // Update world matrices first
    scene.updateMatrixWorld(true);

    // Collect all meshes
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        meshes.push(child);
      }
    });

    // Reparent each mesh to be a direct child of scene root (preserving world transform)
    meshes.forEach((mesh, idx) => {
      // attach() moves the mesh to be a direct child while preserving its world position
      scene.attach(mesh);

      const color = this.partColors[idx % this.partColors.length];
      parts.push({
        id: `part-${idx}`,
        name: mesh.name || `Part ${idx + 1}`,
        mesh: mesh,
        originalPosition: mesh.position.clone(),
        originalRotation: mesh.rotation.clone(),
        color,
        visible: true,
        highlighted: false
      });
    });

    return parts;
  }
}
