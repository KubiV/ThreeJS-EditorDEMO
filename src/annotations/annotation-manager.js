import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { categoryColor as colorForCategoryName } from '../api/model3d-format.js';

const DEFAULT_NORMAL = [0, 0, 1];
const MIN_LINE_LENGTH = 0.0001;
const ANCHOR_RADIUS = 0.11;
const HANDLE_RADIUS = 0.17;
const PAINT_OPACITY = 0.64;

function endpointOf(tag) {
  const anchor = new THREE.Vector3().fromArray(tag.position);
  const direction = new THREE.Vector3().fromArray(tag.normal || DEFAULT_NORMAL).normalize();
  const requestedLength = Number(tag.lineLength);
  const length = Number.isFinite(requestedLength) && requestedLength > 0 ? requestedLength : 1.5;
  return anchor.addScaledVector(direction, Math.max(length, MIN_LINE_LENGTH));
}

function lineMaterial({ color, width = 2, dashed = false } = {}) {
  return new LineMaterial({
    color,
    linewidth: width,
    dashed,
    transparent: true,
    opacity: 0.92,
    worldUnits: false
  });
}

function createLine(options) {
  const geometry = new LineGeometry();
  // Line2 needs its instanced start/end attributes before distances are computed.
  geometry.setPositions([0, 0, 0, 0, 0, 0]);
  const line = new Line2(geometry, lineMaterial(options));
  line.computeLineDistances();
  return line;
}

function disposePaint(root) {
  root.traverse((object) => {
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  });
}

/** Keeps Three.js leader lines and their screen-space Czech labels in sync. */
export class AnnotationManager {
  constructor(sceneManager, layer, { onSelect, onChange } = {}) {
    this.sceneManager = sceneManager;
    this.layer = layer;
    this.onSelect = onSelect;
    this.onChange = onChange;
    this.tags = [];
    this.items = new Map();
    this.categoryColors = new Map();
    this.visibleCategories = new Set();
    this.hiddenTagIds = new Set();
    this.selectedId = null;
    this.drag = null;
    this.preview = createLine({ color: '#68a9d5', width: 1.5, dashed: true });
    this.preview.visible = false;
    this.previewAnchor = new THREE.Mesh(
      new THREE.SphereGeometry(ANCHOR_RADIUS, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#68a9d5', transparent: true, opacity: 0.92 })
    );
    this.previewAnchor.visible = false;
    this.brushPreview = new THREE.Group();
    this.brushPreview.name = 'Náhled štětce plochy';
    this.sceneManager.annotationRoot.add(this.preview, this.previewAnchor);
    this.sceneManager.annotationRoot.add(this.brushPreview);
  }

  setTags(tags = [], { preserveCategories = true, categories = [], hiddenTagIds = this.hiddenTagIds } = {}) {
    this.tags = tags;
    this.categoryColors = new Map((categories || []).map((category) => [category.id, category.color || colorForCategoryName(category.name)]));
    const allCategories = new Set(tags.map((tag) => tag.category));
    if (!preserveCategories || this.visibleCategories.size === 0) this.visibleCategories = allCategories;
    else this.visibleCategories = new Set([...this.visibleCategories].filter((category) => allCategories.has(category)));
    const knownTagIds = new Set(tags.map((tag) => tag.id));
    this.hiddenTagIds = new Set([...hiddenTagIds].filter((id) => knownTagIds.has(id)));

    this.items.forEach((item) => this.removeVisual(item));
    this.items.clear();
    this.layer.replaceChildren();
    tags.forEach((tag) => this.addVisual(tag));
    this.update(this.sceneManager.camera);
  }

  addVisual(tag) {
    // A painted region is a visual object in its own right. Its colour must
    // therefore also drive its line, anchor and floating label; categories
    // remain a filtering/organisation aid rather than a competing palette.
    const categoryColor = this.categoryColors.get(tag.category) || colorForCategoryName(tag.category);
    const visualStyle = tag.style || tag.highlight;
    const color = visualStyle?.colorMode === 'custom' ? visualStyle.color : categoryColor;
    const label = document.createElement('button');
    label.className = 'annotation-label';
    label.type = 'button';
    label.textContent = tag.title || 'Nový štítek';
    label.title = `Zobrazit popisek: ${tag.title || 'Nový štítek'}`;
    label.style.setProperty('--category-color', color);
    label.addEventListener('click', (event) => {
      event.stopPropagation();
      this.select(tag.id);
    });

    const line = createLine({ color, width: 2 });
    const anchor = new THREE.Mesh(
      new THREE.SphereGeometry(ANCHOR_RADIUS, 16, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88 })
    );
    const handle = new THREE.Mesh(
      new THREE.SphereGeometry(HANDLE_RADIUS, 18, 14),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
    );
    handle.userData.annotationId = tag.id;
    handle.userData.isLeaderHandle = true;
    handle.visible = false;
    const highlight = this.createHighlight(tag.highlight, color);
    this.sceneManager.annotationRoot.add(line, anchor, handle, highlight);
    this.layer.append(label);
    this.items.set(tag.id, { tag, label, line, anchor, handle, highlight });
  }

  removeVisual({ label, line, anchor, handle, highlight }) {
    label.remove();
    [line, anchor, handle, highlight].filter(Boolean).forEach((object) => {
      this.sceneManager.annotationRoot.remove(object);
      if (object === highlight) disposePaint(object);
      else {
        object.geometry?.dispose?.();
        object.material?.dispose?.();
      }
    });
  }

  createPaintMark({ position, normal }, radius, color, { outline = false } = {}) {
    const direction = new THREE.Vector3().fromArray(normal || DEFAULT_NORMAL).normalize();
    const paintColor = new THREE.Color(color);
    if (outline) paintColor.multiplyScalar(0.54);
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(radius * (outline ? 1.075 : 1), 28),
      new THREE.MeshBasicMaterial({
        color: paintColor,
        transparent: true,
        opacity: outline ? 0.88 : PAINT_OPACITY,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      })
    );
    mesh.position.fromArray(position).addScaledVector(direction, Math.max(radius * 0.003, 0.00001));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    mesh.renderOrder = outline ? 2 : 3;
    return mesh;
  }

  createHighlight(highlight, color) {
    const group = new THREE.Group();
    if (!highlight?.points?.length || !Number.isFinite(Number(highlight.radius))) return group;
    const resolvedColor = color || highlight.color || '#d64b3b';
    const outlines = new THREE.Group();
    const fills = new THREE.Group();
    // Render all borders first and all fills above them. Overlapping stamps in
    // one stroke merge into a surface, while a neighbouring tag keeps a clean
    // visible edge of its own.
    highlight.points.forEach((point) => {
      outlines.add(this.createPaintMark(point, Number(highlight.radius), resolvedColor, { outline: true }));
      fills.add(this.createPaintMark(point, Number(highlight.radius), resolvedColor));
    });
    group.add(outlines, fills);
    return group;
  }

  showBrushPreview(highlight) {
    disposePaint(this.brushPreview);
    this.brushPreview.clear();
    const next = this.createHighlight(highlight);
    this.brushPreview.add(...next.children);
    this.brushPreview.visible = true;
  }

  hideBrushPreview() {
    disposePaint(this.brushPreview);
    this.brushPreview.clear();
    this.brushPreview.visible = false;
  }

  select(id, { focus = true } = {}) {
    const tag = this.tags.find((item) => item.id === id);
    if (!tag) return;
    this.selectedId = id;
    this.items.forEach((item, itemId) => {
      const active = itemId === id;
      item.label.classList.toggle('is-selected', active);
      item.handle.visible = active && this.visibleCategories.has(item.tag.category) && !this.hiddenTagIds.has(item.tag.id);
    });
    if (focus) this.sceneManager.focus(tag.position, tag.normal);
    this.onSelect?.(tag);
    this.update(this.sceneManager.camera);
  }

  clearSelection() {
    if (this.selectedId === null) return;
    this.selectedId = null;
    this.items.forEach((item) => {
      item.label.classList.remove('is-selected');
      item.handle.visible = false;
    });
    this.onSelect?.(undefined);
    this.update(this.sceneManager.camera);
  }

  setVisible(categories) {
    this.visibleCategories = new Set(categories);
    this.update(this.sceneManager.camera);
  }

  setHiddenTags(tagIds) {
    this.hiddenTagIds = new Set(tagIds);
    this.update(this.sceneManager.camera);
  }

  showAll(show) {
    this.visibleCategories = show ? new Set(this.tags.map((tag) => tag.category)) : new Set();
    if (show) this.hiddenTagIds.clear();
    this.update(this.sceneManager.camera);
  }

  update(camera) {
    const bounds = this.layer.getBoundingClientRect();
    const viewportSize = this.sceneManager.renderer.getSize(new THREE.Vector2());
    this.items.forEach((item) => {
      const { tag, label, line, anchor, handle, highlight } = item;
      const isVisible = this.visibleCategories.has(tag.category) && !this.hiddenTagIds.has(tag.id);
      const start = new THREE.Vector3().fromArray(tag.position);
      const end = endpointOf(tag);
      line.geometry.setPositions([...start.toArray(), ...end.toArray()]);
      line.material.resolution.set(viewportSize.x, viewportSize.y);
      line.visible = isVisible;
      anchor.position.copy(start);
      anchor.visible = isVisible;
      handle.position.copy(end);
      handle.visible = isVisible && tag.id === this.selectedId;
      highlight.visible = isVisible;
      // Markers are screen-legible but never use an absolute world-unit minimum.
      // That would turn a marker into a disk on models with a small coordinate range.
      const worldStart = this.sceneManager.contentPointToWorld(start);
      const worldEnd = this.sceneManager.contentPointToWorld(end);
      handle.scale.setScalar(this.markerRadius(worldEnd, 'handle') / HANDLE_RADIUS);
      anchor.scale.setScalar(this.markerRadius(worldStart, 'anchor') / ANCHOR_RADIUS);

      const projected = worldEnd.clone().project(camera);
      const inView = projected.z > -1 && projected.z < 1 && projected.x > -1.12 && projected.x < 1.12 && projected.y > -1.12 && projected.y < 1.12;
      label.hidden = !isVisible || !inView;
      if (!label.hidden) {
        // Keep the handle visible directly beside the floating label so it remains draggable.
        label.style.transform = `translate(${(projected.x * 0.5 + 0.5) * bounds.width}px, ${(-projected.y * 0.5 + 0.5) * bounds.height}px) translate(12px, -50%)`;
      }
    });
  }

  cameraDistance(point) {
    return this.sceneManager.camera.position.distanceTo(point);
  }

  modelExtent() {
    const bounds = this.sceneManager.modelBounds;
    if (!bounds || bounds.isEmpty()) return 1;
    const size = bounds.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z, MIN_LINE_LENGTH);
  }

  minimumLineLength() {
    return Math.max(this.modelExtent() * 0.0005, MIN_LINE_LENGTH);
  }

  lineLengthStep() {
    // Keep at least hundredth-unit control even for large models; smaller models
    // receive progressively finer steps based on their actual coordinate range.
    return Math.max(Math.min(this.modelExtent() * 0.001, 0.01), MIN_LINE_LENGTH);
  }

  markerRadius(point, kind) {
    const modelExtent = this.modelExtent();
    const isHandle = kind === 'handle';
    const desired = this.cameraDistance(point) * (isHandle ? 0.011 : 0.007);
    const minimum = modelExtent * (isHandle ? 0.006 : 0.004);
    const maximum = modelExtent * (isHandle ? 0.026 : 0.018);
    return THREE.MathUtils.clamp(desired, minimum, maximum);
  }

  showPreview(intersection, lineLength) {
    if (!intersection?.face) return this.hidePreview();
    const normal = intersection.face.normal.clone().transformDirection(intersection.object.matrixWorld).normalize();
    this.showPreviewAt(
      this.sceneManager.worldPointToContent(intersection.point),
      this.sceneManager.worldDirectionToContent(normal),
      lineLength
    );
  }

  showPreviewAt(position, normal, lineLength) {
    const start = position.clone ? position.clone() : new THREE.Vector3().fromArray(position);
    const direction = normal.clone ? normal.clone().normalize() : new THREE.Vector3().fromArray(normal || DEFAULT_NORMAL).normalize();
    const requestedLength = Number(lineLength);
    const length = Number.isFinite(requestedLength) && requestedLength > 0
      ? Math.max(requestedLength, this.minimumLineLength())
      : this.modelExtent() * 0.14;
    const end = start.clone().addScaledVector(direction, length);
    const viewportSize = this.sceneManager.renderer.getSize(new THREE.Vector2());
    this.preview.geometry.setPositions([...start.toArray(), ...end.toArray()]);
    this.preview.computeLineDistances();
    this.preview.material.resolution.set(viewportSize.x, viewportSize.y);
    this.preview.visible = true;
    this.previewAnchor.position.copy(start);
    const worldStart = this.sceneManager.contentPointToWorld(start);
    this.previewAnchor.scale.setScalar(this.markerRadius(worldStart, 'anchor') / ANCHOR_RADIUS);
    this.previewAnchor.visible = true;
  }

  hidePreview() {
    this.preview.visible = false;
    this.previewAnchor.visible = false;
  }

  beginHandleDrag(event) {
    const handles = [...this.items.values()].map((item) => item.handle).filter((handle) => handle.visible);
    const hit = this.sceneManager.intersectObjects(event, handles);
    if (!hit?.object?.userData?.annotationId) return false;
    const tag = this.tags.find((item) => item.id === hit.object.userData.annotationId);
    if (!tag) return false;
    const anchor = new THREE.Vector3().fromArray(tag.position);
    const worldAnchor = this.sceneManager.contentPointToWorld(anchor);
    const cameraDirection = new THREE.Vector3().subVectors(this.sceneManager.camera.position, this.sceneManager.controls.target).normalize();
    this.drag = {
      tag,
      anchor,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(cameraDirection, worldAnchor)
    };
    this.sceneManager.controls.enabled = false;
    return true;
  }

  dragHandle(event) {
    if (!this.drag) return false;
    const point = this.sceneManager.getRay(event).intersectPlane(this.drag.plane, new THREE.Vector3());
    if (!point) return true;
    const vector = this.sceneManager.worldPointToContent(point).sub(this.drag.anchor);
    const length = vector.length();
    if (length < this.minimumLineLength()) return true;
    this.drag.tag.normal = vector.normalize().toArray();
    this.drag.tag.lineLength = length;
    this.update(this.sceneManager.camera);
    this.onChange?.(this.drag.tag, { transient: true });
    return true;
  }

  endHandleDrag() {
    if (!this.drag) return false;
    const tag = this.drag.tag;
    this.drag = null;
    this.sceneManager.controls.enabled = true;
    this.onChange?.(tag, { transient: false });
    return true;
  }

  dispose() {
    this.items.forEach((item) => this.removeVisual(item));
    this.items.clear();
    this.sceneManager.annotationRoot.remove(this.preview);
    this.preview.geometry.dispose();
    this.preview.material.dispose();
    this.sceneManager.annotationRoot.remove(this.previewAnchor);
    this.previewAnchor.geometry.dispose();
    this.previewAnchor.material.dispose();
    this.hideBrushPreview();
    this.sceneManager.annotationRoot.remove(this.brushPreview);
    this.layer.replaceChildren();
  }
}
