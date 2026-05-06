import {
  Component, OnInit, ViewChild, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ThreeViewerComponent } from './components/viewer/three-viewer.component';
import { ModelService, ModelPart } from './services/model.service';
import { TreeTableModule } from 'primeng/treetable';
import { TreeNode } from 'primeng/api';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ThreeViewerComponent, TreeTableModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  @ViewChild('viewer') viewerRef!: ThreeViewerComponent;

  parts: ModelPart[] = [];
  treeNodes: TreeNode[] = [];
  selectedPart: ModelPart | null = null;
  hoveredPart: ModelPart | null = null;

  explodeValue = 0;
  wireframe = false;
  showAllParts = true;
  isLoading = false;
  loadProgress = 0;
  isDragging = false;
  activeTab: 'parts' | 'controls' = 'parts';

  constructor(
    private modelService: ModelService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit() {
    this.modelService.loading$.subscribe(v => { this.isLoading = v; this.cdr.detectChanges(); });
    this.modelService.loadProgress$.subscribe(v => { this.loadProgress = v; this.cdr.detectChanges(); });
    this.modelService.parts$.subscribe(parts => {
      this.parts = parts;
      this.treeNodes = this.buildTreeNodes(parts);
      this.cdr.detectChanges();
    });
  }

  buildTreeNodes(parts: ModelPart[]): TreeNode[] {
    return parts.map(part => {
      return {
        data: part,
        expanded: true,
        children: part.children ? this.buildTreeNodes(part.children) : []
      };
    });
  }

  ngAfterViewInit() {
    // Load the built-in demo engine immediately
    this.loadDemoModel();
  }

  loadDemoModel() {
    const parts = this.modelService.buildDemoModel();
    this.parts = parts;
    setTimeout(() => {
      this.viewerRef.loadParts(parts);
    }, 50);
  }

  // ── Explode ───────────────────────────────────────────────────────────
  onExplodeChange(value: number) {
    this.explodeValue = value;
    this.viewerRef.setExplodeAnimated(value, 500);
  }

  explodeStep(delta: number) {
    this.explodeValue = Math.max(0, Math.min(2, this.explodeValue + delta));
    this.viewerRef.setExplodeAnimated(this.explodeValue, 400);
  }

  isIsolated = false;

  resetAll() {
    this.isIsolated = false;
    this.viewerRef.isolatePart(null);
    this.explodeValue = 0;
    this.selectedPart = null;
    this.viewerRef.highlightPart(null);
    this.viewerRef.implodeAll();
    this.viewerRef.setExplodeAnimated(0, 600);
    this.viewerRef.resetCamera();
  }

  isolateSelectedPart() {
    if (this.selectedPart) {
      this.isIsolated = true;
      this.explodeValue = 0;
      this.viewerRef.isolatePart(this.selectedPart.id);
    }
  }

  exitIsolation() {
    this.isIsolated = false;
    this.explodeValue = 0;
    this.viewerRef.isolatePart(null);
    // Maintain selection but reset explosion
    if (this.selectedPart) {
      this.viewerRef.highlightPart(this.selectedPart);
    }
  }

  playSequence() {
    this.viewerRef.playDemoSequence();
  }

  // ── Wireframe ─────────────────────────────────────────────────────────
  toggleWireframe() {
    this.wireframe = !this.wireframe;
    this.viewerRef.setWireframe(this.wireframe);
  }

  // ── Visibility ────────────────────────────────────────────────────────
  togglePartVisibility(part: ModelPart) {
    part.visible = !part.visible;
    this.viewerRef.setPartVisible(part.id, part.visible);
    this.showAllParts = this.parts.every(p => p.visible);
  }

  toggleAllVisibility() {
    this.showAllParts = !this.showAllParts;
    this.parts.forEach(p => {
      p.visible = this.showAllParts;
      this.viewerRef.setPartVisible(p.id, p.visible);
    });
  }

  // ── Part selection ────────────────────────────────────────────────────
  selectPart(part: ModelPart) {
    const isDeselecting = this.selectedPart?.id === part.id;
    this.selectedPart = isDeselecting ? null : part;
    this.viewerRef.highlightPart(this.selectedPart);

    if (isDeselecting) {
      // Clicked same part again → snap all back
      this.viewerRef.implodeAll();
    } else {
      // Explode selected part outward, return rest to origin
      this.viewerRef.explodePartById(part.id);
    }
  }

  onPartClicked(part: ModelPart) {
    const isDeselecting = this.selectedPart?.id === part.id;
    this.selectedPart = isDeselecting ? null : part;

    if (isDeselecting) {
      this.viewerRef.implodeAll();
      this.viewerRef.highlightPart(null);
    } else {
      this.viewerRef.explodePartById(part.id);
      this.viewerRef.highlightPart(part);
    }
    this.cdr.detectChanges();
  }

  onPartHovered(part: ModelPart | null) {
    this.hoveredPart = part;
    if (this.viewerRef) {
      this.viewerRef.setHoveredPart(part);
    }
    this.cdr.detectChanges();
  }

  // ── File upload ───────────────────────────────────────────────────────
  onDragOver(e: DragEvent) { e.preventDefault(); this.isDragging = true; }
  onDragLeave() { this.isDragging = false; }

  async onDrop(e: DragEvent) {
    e.preventDefault();
    this.isDragging = false;
    const file = e.dataTransfer?.files[0];
    if (file && (file.name.endsWith('.glb') || file.name.endsWith('.gltf'))) {
      await this.loadFile(file);
    }
  }

  async onFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await this.loadFile(file);
  }

  private async loadFile(file: File) {
    try {
      const parts = await this.modelService.loadGLBFromFile(file);
      this.viewerRef.loadParts(parts);
    } catch (err) {
      console.error('Error loading file:', err);
      alert('Error loading 3D model. Make sure it is a valid GLB/GLTF file.');
    }
  }

  getVisibleCount() { return this.parts.filter(p => p.visible).length; }
}

