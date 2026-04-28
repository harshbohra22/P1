import {
  Component, ElementRef, ViewChild, OnInit, OnDestroy,
  Input, Output, EventEmitter, AfterViewInit, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ModelPart } from '../../services/model.service';

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

      <!-- Axes legend -->
      <div class="axes-legend">
        <span style="color:#ff6b6b">X</span>
        <span style="color:#4ecdc4">Y</span>
        <span style="color:#45b7d1">Z</span>
      </div>
    </div>
  `,
  styles: [`
    .viewer-wrapper {
      position: relative;
      width: 100%;
      height: 100%;
      background: #0a0a0f;
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
    .axes-legend {
      position: absolute;
      bottom: 16px;
      right: 16px;
      display: flex;
      gap: 8px;
      font-family: 'Space Mono', monospace;
      font-size: 13px;
      font-weight: 700;
      background: rgba(0,0,0,0.5);
      padding: 6px 12px;
      border-radius: 8px;
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
  private frameId: number | null = null;
  private parts: ModelPart[] = [];
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
    this.scene.background = new THREE.Color(0x0a0a14);
    this.scene.fog = new THREE.Fog(0x0a0a14, 20, 60);

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

    // Grid
    const grid = new THREE.GridHelper(20, 20, 0x222233, 0x151525);
    grid.position.y = -2;
    this.scene.add(grid);

    // Axes helper
    const axes = new THREE.AxesHelper(3);
    axes.position.set(-7, -1.8, -7);
    this.scene.add(axes);
  }

  // ── Public: Load parts into scene ─────────────────────────────────────
  loadParts(parts: ModelPart[]) {
    // Remove the old group from the scene
    if (this.sceneGroup) {
      this.scene.remove(this.sceneGroup);
      this.sceneGroup = null;
    }

    this.parts = parts;

    // Wrap all part meshes in a single group and add to scene.
    // This preserves the relative hierarchy of GLB models.
    this.sceneGroup = new THREE.Group();
    parts.forEach(p => this.sceneGroup!.add(p.mesh));
    this.scene.add(this.sceneGroup);

    // fitCamera normalizes model scale — do it first
    this.fitCamera();

    // After normalization, re-capture originalPosition in local space
    parts.forEach(p => {
      p.originalPosition = p.mesh.position.clone();
      p.originalRotation = p.mesh.rotation.clone();
    });

    // Pre-compute explode directions from bounding-box centers
    this.computeExplodeDirs();
  }

  // ── Explode direction pre-computation ────────────────────────────────
  /**
   * Compute explode direction for each part using its bounding-box center.
   * This works even when all mesh.position values are (0,0,0).
   */
  private computeExplodeDirs() {
    if (!this.sceneGroup || this.parts.length === 0) return;
    this.partExplodeDirs.clear();

    // Model center in world space
    const modelBox = new THREE.Box3().setFromObject(this.sceneGroup);
    const modelCenter = modelBox.getCenter(new THREE.Vector3());

    this.parts.forEach(part => {
      // Part bbox center in world space
      const partBox = new THREE.Box3().setFromObject(part.mesh);
      const partCenter = partBox.getCenter(new THREE.Vector3());

      // Outward direction from model center → part center
      let dir = partCenter.clone().sub(modelCenter);
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

    this.parts.forEach((part) => {
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

    this.parts.forEach((part) => {
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
    this.parts.forEach((part) => {
      this.animatePosition(
        part.mesh, part.mesh.position.clone(), part.originalPosition.clone(), duration
      );
      this.setMeshOpacity(part.mesh, 1, false);
    });
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
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / dur, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOut
      obj.position.lerpVectors(from, to, ease);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ── Wireframe toggle ──────────────────────────────────────────────────
  setWireframe(val: boolean) {
    this.wireframe = val;
    this.parts.forEach(p => {
      p.mesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m: any) => { if ('wireframe' in m) m.wireframe = val; });
        }
      });
    });
  }

  // ── Highlight ─────────────────────────────────────────────────────────
  highlightPart(part: ModelPart | null) {
    this.parts.forEach(p => {
      p.highlighted = part?.id === p.id;
      p.mesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m: any) => {
            if ('emissive' in m) {
              m.emissive.set(p.highlighted ? 0x224422 : 0x000000);
              m.emissiveIntensity = p.highlighted ? 0.6 : 0;
            }
          });
        }
      });
    });
  }

  // ── Visibility ────────────────────────────────────────────────────────
  setPartVisible(partId: string, visible: boolean) {
    const part = this.parts.find(p => p.id === partId);
    if (part) {
      part.visible = visible;
      part.mesh.visible = visible;
    }
  }

  // ── Camera fit ────────────────────────────────────────────────────────
  private fitCamera() {
    if (!this.sceneGroup) return;

    // Compute bounding box of everything in the scene group
    const box = new THREE.Box3().setFromObject(this.sceneGroup);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    if (maxDim > 0) {
      // Normalize: scale the group so the model fits in TARGET_SIZE units
      const TARGET_SIZE = 5;
      const scale = TARGET_SIZE / maxDim;
      this.sceneGroup.scale.setScalar(scale);
      // Re-center the group so it sits at world origin
      this.sceneGroup.position.set(
        -center.x * scale,
        -center.y * scale,
        -center.z * scale
      );
    }

    // After normalization, place camera at a good distance
    const dist = 8;
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
    this.renderer.render(this.scene, this.camera);
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
    this.zone.run(() => {
      this.hoveredPart = hit;
      if (prev?.id !== hit?.id) this.partHovered.emit(hit);
    });
  }

  private raycast(): ModelPart | null {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes: THREE.Object3D[] = [];
    this.parts.forEach(p => { if (p.visible) p.mesh.traverse(c => { if (c instanceof THREE.Mesh) meshes.push(c); }); });
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (!hits.length) return null;
    const hitObj = hits[0].object;
    return this.parts.find(p => {
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
