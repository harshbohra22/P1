import {
  Component, ElementRef, ViewChild, OnInit, OnDestroy,
  Input, Output, EventEmitter, AfterViewInit, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { ModelPart } from '../../services/model.service';
import gsap from 'gsap';

@Component({
  selector: 'app-three-viewer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="viewer-wrapper">
      <canvas #canvas class="viewer-canvas"></canvas>

      <!-- Overlay: part label on hover -->
      <div class="part-tooltip" [style.left.px]="tooltipX" [style.top.px]="tooltipY"
           [class.visible]="hoveredPart !== null">
        {{ hoveredPart?.name }}
      </div>

    </div>
  `,
  styles: [`
    .viewer-wrapper {
      position: relative;
      width: 100%;
      height: 100%;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
    }
    .viewer-canvas {
      display: block;
      width: 100% !important;
      height: 100% !important;
      cursor: grab;
      &:active { cursor: grabbing; }
    }
    .part-tooltip {
      position: absolute;
      pointer-events: none;
      background: rgba(10,10,20,0.9);
      color: #4ecdc4;
      padding: 6px 14px;
      border-radius: 20px;
      font-family: 'Space Mono', monospace;
      font-size: 12px;
      border: 1px solid #4ecdc4;
      transform: translate(-50%, -140%);
      opacity: 0;
      transition: opacity 0.2s;
      white-space: nowrap;
      &.visible { opacity: 1; }
    }

  `]
})
export class ThreeViewerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() explodeAmount = 0;
  @Input() wireframe = false;
  @Output() partClicked = new EventEmitter<ModelPart>();
  @Output() partHovered = new EventEmitter<ModelPart | null>();

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private composer!: EffectComposer;
  private outlinePass!: OutlinePass;
  private hoverOutlinePass!: OutlinePass;
  private frameId: number | null = null;
  private parts: ModelPart[] = [];
  private flatParts: ModelPart[] = [];
  private sceneGroup: THREE.Group | null = null;
  private partExplodeDirs = new Map<string, THREE.Vector3>(); // bbox-based explode directions
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private resizeObserver!: ResizeObserver;

  hoveredPart: ModelPart | null = null;
  tooltipX = 0;
  tooltipY = 0;

  constructor(private zone: NgZone) {}

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => {
      this.initScene();
      this.animate();
      this.setupResize();
    });
    this.setupMouseEvents();
  }

  // ── Scene init ────────────────────────────────────────────────────────
  private initScene() {
    const canvas = this.canvasRef.nativeElement;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);
    this.scene.fog = new THREE.Fog(0xffffff, 20, 60);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      50, canvas.clientWidth / canvas.clientHeight, 0.1, 100
    );
    this.camera.position.set(6, 5, 8);

    // Controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 25;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(8, 10, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x4ecdc4, 0.4);
    fill.position.set(-5, -3, -5);
    this.scene.add(fill);

    const rim = new THREE.PointLight(0xff6b6b, 0.8, 20);
    rim.position.set(-4, 6, -4);
    this.scene.add(rim);



    // Post-processing setup
    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.outlinePass = new OutlinePass(new THREE.Vector2(canvas.clientWidth, canvas.clientHeight), this.scene, this.camera);
    this.outlinePass.visibleEdgeColor.set('#4ecdc4');
    this.outlinePass.hiddenEdgeColor.set('#000000');
    this.outlinePass.edgeStrength = 6;
    this.outlinePass.edgeThickness = 2;
    this.outlinePass.pulsePeriod = 0; // Set to > 0 for pulsing effect
    this.composer.addPass(this.outlinePass);

    this.hoverOutlinePass = new OutlinePass(new THREE.Vector2(canvas.clientWidth, canvas.clientHeight), this.scene, this.camera);
    this.hoverOutlinePass.visibleEdgeColor.set('#4a90e2'); // Bright Blue for Hover
    this.hoverOutlinePass.hiddenEdgeColor.set('#000000');
    this.hoverOutlinePass.edgeStrength = 5;
    this.hoverOutlinePass.edgeThickness = 2;
    this.composer.addPass(this.hoverOutlinePass);
  }

  // ── Public: Load parts into scene ─────────────────────────────────────
  loadParts(parts: ModelPart[]) {
    // Remove the old group from the scene
    if (this.sceneGroup) {
      this.scene.remove(this.sceneGroup);
      this.sceneGroup = null;
    }

    this.parts = parts;
    this.flatParts = this.flattenParts(parts);

    // Wrap all part meshes in a single group and add to scene.
    this.sceneGroup = new THREE.Group();
    this.flatParts.forEach(p => {
      // Only add actual meshes, not dummy groups
      if (p.mesh instanceof THREE.Mesh) {
        this.sceneGroup!.add(p.mesh);
      }
    });
    this.scene.add(this.sceneGroup);

    // fitCamera normalizes model scale — do it first
    this.fitCamera();

    // After normalization, re-capture originalPosition in local space
    this.flatParts.forEach(p => {
      p.originalPosition = p.mesh.position.clone();
      p.originalRotation = p.mesh.rotation.clone();
    });

    // Pre-compute explode directions from bounding-box centers
    this.computeExplodeDirs();
  }

  private flattenParts(parts: ModelPart[]): ModelPart[] {
    let result: ModelPart[] = [];
    for (const p of parts) {
      result.push(p);
      if (p.children) {
        result = result.concat(this.flattenParts(p.children));
      }
    }
    return result;
  }

  // ── Explode direction pre-computation ────────────────────────────────
  private computeExplodeDirs() {
    if (!this.sceneGroup || this.flatParts.length === 0) return;
    this.partExplodeDirs.clear();

    // Center of ONLY visible parts
    const visibleBox = new THREE.Box3();
    let hasVisible = false;
    this.flatParts.forEach(p => {
      if (p.visible && p.mesh instanceof THREE.Mesh) {
        const partBox = new THREE.Box3().setFromObject(p.mesh);
        if (!partBox.isEmpty()) {
           visibleBox.expandByPoint(partBox.min);
           visibleBox.expandByPoint(partBox.max);
           hasVisible = true;
        }
      }
    });

    if (!hasVisible) return;
    const center = visibleBox.getCenter(new THREE.Vector3());

    this.flatParts.forEach(part => {
      if (!(part.mesh instanceof THREE.Mesh) || !part.visible) return;

      // Part bbox center in world space
      const partBox = new THREE.Box3().setFromObject(part.mesh);
      const partCenter = partBox.getCenter(new THREE.Vector3());

      // Outward direction from visible center → part center
      let dir = partCenter.clone().sub(center);
      if (dir.length() < 0.001) {
        // Part is exactly at model center — random outward direction
        dir.set(
          (Math.random() - 0.5),
          (Math.random() * 0.5 + 0.2),
          (Math.random() - 0.5)
        );
      }
      this.partExplodeDirs.set(part.id, dir.normalize());
    });
  }

  // ── Explode / implode ─────────────────────────────────────────────────
  /** Explode ALL parts outward using pre-computed bbox directions */
  setExplodeAnimated(amount: number, duration = 600) {
    if (!this.sceneGroup) return;
    const localScale = this.sceneGroup.scale.x || 1;
    // amount is 0-2; map to world units (up to TARGET_SIZE = 5)
    const worldOffset = amount * 5;
    const localOffset = worldOffset / localScale;

    this.flatParts.forEach((part) => {
      if (!(part.mesh instanceof THREE.Mesh) || !part.visible) return;
      const dir = this.partExplodeDirs.get(part.id) ?? new THREE.Vector3(0, 1, 0);
      const target = part.originalPosition.clone().add(dir.clone().multiplyScalar(localOffset));
      this.animatePosition(part.mesh, part.mesh.position.clone(), target, duration);
    });
  }

  /** Explode ONE part outward; restore all others; dim non-selected parts */
  explodePartById(partId: string | null, explodeDistance = 5, duration = 500) {
    if (!this.sceneGroup) return;
    const localScale = this.sceneGroup.scale.x || 1;
    const localOffset = explodeDistance / localScale;

    this.flatParts.forEach((part) => {
      if (!(part.mesh instanceof THREE.Mesh)) return;

      if (part.id === partId) {
        const dir = this.partExplodeDirs.get(part.id) ?? new THREE.Vector3(0, 1, 0);
        const target = part.originalPosition.clone().add(dir.clone().multiplyScalar(localOffset));
        this.animatePosition(part.mesh, part.mesh.position.clone(), target, duration);
        // Make selected part fully opaque
        this.setMeshOpacity(part.mesh, 1, false);
      } else {
        // Return other parts to original position & dim them
        this.animatePosition(
          part.mesh, part.mesh.position.clone(), part.originalPosition.clone(), duration
        );
        this.setMeshOpacity(part.mesh, 0.15, true);
      }
    });
  }

  /** Snap all parts back and restore full opacity */
  implodeAll(duration = 500) {
    this.flatParts.forEach((part) => {
      if (!(part.mesh instanceof THREE.Mesh)) return;
      this.animatePosition(
        part.mesh, part.mesh.position.clone(), part.originalPosition.clone(), duration
      );
      this.setMeshOpacity(part.mesh, 1, false);
    });
  }

  /** Sequenced "Movie-like" disassembly of the demo engine OR custom GLB */
  playDemoSequence() {
    if (!this.sceneGroup || this.flatParts.length === 0) return;

    // Reset everything first
    this.implodeAll(0);
    this.highlightPart(null);

    // Create a GSAP Timeline
    const tl = gsap.timeline();

    // 1. Smoothly rotate camera to a standard "straight" front view
    tl.to(this.camera.position, {
      x: 0, 
      y: 2, 
      z: 12,
      duration: 1.0,
      ease: "power2.inOut",
      onUpdate: () => { 
        this.controls.target.set(0, 0, 0); 
        this.controls.update(); 
      }
    });

    // 2. Move backwards on Z-axis (zoom out) before exploding
    tl.to(this.camera.position, {
      z: 18,
      duration: 1.0,
      ease: "power1.inOut",
      onUpdate: () => this.controls.update()
    });

    const getPartMesh = (id: string) => this.flatParts.find(p => p.id === id)?.mesh;
    const valveCover = getPartMesh('valve-cover');

    if (valveCover) {
      // --- DEMO ENGINE CHOREOGRAPHY ---
      const cylinderHead = getPartMesh('cylinder-head');
      const oilPan = getPartMesh('oil-pan');
      const crankshaft = getPartMesh('crankshaft');
      const intake = getPartMesh('intake-manifold');
      const exhaust = getPartMesh('exhaust-manifold');
      const waterPump = getPartMesh('water-pump');
      const pistons = [
        getPartMesh('piston-1'), getPartMesh('piston-2'),
        getPartMesh('piston-3'), getPartMesh('piston-4')
      ].filter(p => p); // remove undefined

      const localScale = this.sceneGroup.scale.x || 1;

      // Step 1: Lift Valve Cover (Starts at 1s, after camera)
      if (valveCover) tl.to(valveCover.position, { y: valveCover.position.y + (3 / localScale), duration: 0.8, ease: "power1.inOut" });

      // Step 2: Lift Cylinder Head & move Manifolds/Pump
      if (cylinderHead) tl.to(cylinderHead.position, { y: cylinderHead.position.y + (1.5 / localScale), duration: 0.8, ease: "power2.inOut" });
      if (intake) tl.to(intake.position, { z: intake.position.z + (2 / localScale), duration: 0.8, ease: "power2.inOut" }, "<");
      if (exhaust) tl.to(exhaust.position, { z: exhaust.position.z - (2 / localScale), duration: 0.8, ease: "power2.inOut" }, "<");
      if (waterPump) tl.to(waterPump.position, { x: waterPump.position.x + (2 / localScale), duration: 0.8, ease: "power2.inOut" }, "<");

      // Step 3: Drop Oil Pan
      if (oilPan) tl.to(oilPan.position, { y: oilPan.position.y - (2 / localScale), duration: 0.8, ease: "power2.inOut" }, "<");

      // Step 4: Push Pistons outward
      if (pistons.length > 0) tl.to(pistons.map(p => p!.position), { y: "+=" + (1 / localScale), duration: 1.0, ease: "back.out(1.7)" });

      // Step 5: Pull Crankshaft out
      if (crankshaft) tl.to(crankshaft.position, { z: crankshaft.position.z + (3 / localScale), duration: 1.0, ease: "power2.out" }, "-=0.5");

    } else {
      // --- CUSTOM UPLOADED GLB SEQUENCE ---
      // Explode outwards by a fixed distance
      const localScale = this.sceneGroup.scale.x || 1;
      const localOffset = 2 / localScale; 
      
      const validParts = this.flatParts.filter(p => p.mesh instanceof THREE.Mesh);
      const staggerDelay = Math.min(0.2, 3.0 / Math.max(1, validParts.length));

      let startTime = 1.0; // Start at 1.0s (after camera move finishes)
      
      validParts.forEach((part, index) => {
        const dir = this.partExplodeDirs.get(part.id) ?? new THREE.Vector3(0, 1, 0);
        const target = part.originalPosition.clone().add(dir.clone().multiplyScalar(localOffset));
        
        tl.to(part.mesh.position, {
          x: target.x,
          y: target.y,
          z: target.z,
          duration: 0.8,
          ease: "power2.out"
        }, startTime + (index * staggerDelay));
      });
    }
  }

  /** Set opacity on all meshes within an Object3D */
  private setMeshOpacity(obj: THREE.Object3D, opacity: number, transparent: boolean) {
    obj.traverse(child => {
      if (child instanceof THREE.Mesh) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m: any) => {
          m.transparent = transparent;
          m.opacity = opacity;
          m.depthWrite = !transparent;
        });
      }
    });
  }

  private animatePosition(
    obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, dur: number
  ) {
    gsap.to(obj.position, {
      x: to.x,
      y: to.y,
      z: to.z,
      duration: dur / 1000,
      ease: "power2.inOut"
    });
  }

  // ── Wireframe toggle ──────────────────────────────────────────────────
  setWireframe(val: boolean) {
    this.wireframe = val;
    this.flatParts.forEach(p => {
      p.mesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m: any) => { if ('wireframe' in m) m.wireframe = val; });
        }
      });
    });
  }

  // ── Hover Outline ─────────────────────────────────────────────────
  setHoveredPart(part: ModelPart | null) {
    this.hoveredPart = part;
    
    if (part && part.mesh instanceof THREE.Mesh) {
      // Only show hover outline if the part is not already selected (highlighted)
      if (!part.highlighted) {
        this.hoverOutlinePass.selectedObjects = [part.mesh];
      } else {
        this.hoverOutlinePass.selectedObjects = [];
      }
    } else {
      this.hoverOutlinePass.selectedObjects = [];
    }
  }

  // ── Highlight (Selection Outline) ─────────────────────────────────────
  highlightPart(part: ModelPart | null) {
    this.flatParts.forEach(p => {
      p.highlighted = part?.id === p.id;
    });

    if (part && part.mesh instanceof THREE.Mesh) {
      this.outlinePass.selectedObjects = [part.mesh];
    } else {
      this.outlinePass.selectedObjects = [];
    }
  }

  // ── Visibility & Isolation ─────────────────────────────────────────────
  setPartVisible(partId: string, visible: boolean) {
    const part = this.flatParts.find(p => p.id === partId);
    if (part) {
      part.visible = visible;
      part.mesh.visible = visible;
    }
  }

  private getDescendantIds(part: ModelPart): Set<string> {
    const ids = new Set<string>();
    ids.add(part.id);
    if (part.children) {
      part.children.forEach(c => {
        this.getDescendantIds(c).forEach(id => ids.add(id));
      });
    }
    return ids;
  }

  isolatePart(partId: string | null) {
    if (partId) {
      const rootPart = this.flatParts.find(p => p.id === partId);
      if (!rootPart) return;
      
      const isolateIds = this.getDescendantIds(rootPart);
      
      this.flatParts.forEach(p => {
        const isIsolated = isolateIds.has(p.id);
        p.visible = isIsolated;
        p.mesh.visible = isIsolated;
      });
    } else {
      // Un-isolate
      this.flatParts.forEach(p => {
        p.visible = true;
        p.mesh.visible = true;
      });
    }

    // Reset everything, recalculate center, and zoom in
    this.implodeAll(0);
    this.computeExplodeDirs();
    this.fitCamera();
  }

  // ── Camera fit ────────────────────────────────────────────────────────
  private fitCamera() {
    if (!this.sceneGroup || this.flatParts.length === 0) return;

    // Compute bounding box of ONLY visible parts
    const box = new THREE.Box3();
    let hasVisible = false;
    this.flatParts.forEach(p => {
      if (p.visible && p.mesh instanceof THREE.Mesh) {
        const partBox = new THREE.Box3().setFromObject(p.mesh);
        if (!partBox.isEmpty()) {
           box.expandByPoint(partBox.min);
           box.expandByPoint(partBox.max);
           hasVisible = true;
        }
      }
    });

    if (!hasVisible) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    if (maxDim > 0) {
      // Normalize: scale the group so the model fits in TARGET_SIZE units
      const TARGET_SIZE = 4; // Made slightly smaller
      const scale = TARGET_SIZE / maxDim;
      this.sceneGroup.scale.setScalar(scale);
      // Re-center the group so it sits at world origin
      this.sceneGroup.position.set(
        -center.x * scale,
        -center.y * scale,
        -center.z * scale
      );
    }

    // After normalization, place camera at a good distance to see the explosion
    const dist = 12;
    this.camera.position.set(dist, dist * 0.6, dist);
    this.camera.near = 0.01;
    this.camera.far = 1000;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 1;
    this.controls.maxDistance = 100;
    this.controls.update();
  }

  resetCamera() { this.fitCamera(); }

  // ── Render loop ───────────────────────────────────────────────────────
  private animate() {
    this.frameId = requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.composer.render();
  }

  // ── Mouse events ─────────────────────────────────────────────────────
  private setupMouseEvents() {
    const canvas = this.canvasRef.nativeElement;

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.tooltipX = e.clientX - rect.left;
      this.tooltipY = e.clientY - rect.top;
      this.checkHover();
    });

    canvas.addEventListener('click', () => {
      const hit = this.raycast();
      if (hit) {
        this.zone.run(() => this.partClicked.emit(hit));
        this.highlightPart(hit);
      }
    });
  }

  private checkHover() {
    const hit = this.raycast();
    const prev = this.hoveredPart;
    if (prev?.id !== hit?.id) {
      this.setHoveredPart(hit);
      this.zone.run(() => {
        this.partHovered.emit(hit);
      });
    }
  }

  private raycast(): ModelPart | null {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes: THREE.Object3D[] = [];
    this.flatParts.forEach(p => { if (p.visible && p.mesh instanceof THREE.Mesh) meshes.push(p.mesh); });
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (!hits.length) return null;
    const hitObj = hits[0].object;
    return this.flatParts.find(p => {
      let found = false;
      p.mesh.traverse(c => { if (c === hitObj) found = true; });
      return found;
    }) ?? null;
  }

  // ── Resize ────────────────────────────────────────────────────────────
  private setupResize() {
    this.resizeObserver = new ResizeObserver(() => {
      const canvas = this.canvasRef.nativeElement;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      this.renderer.setSize(w, h, false);
      this.composer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });
    this.resizeObserver.observe(this.canvasRef.nativeElement.parentElement!);
  }

  ngOnDestroy() {
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
  }
}
