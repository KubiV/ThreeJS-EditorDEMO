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
  constructor(sceneManager, layers, { onSelect, onChange } = {}) {
    this.sceneManager = sceneManager;
    if (layers && (layers.front || layers.back)) {
      this.frontLayer = layers.front || layers.back;
      this.backLayer = layers.back || layers.front;
    } else {
      this.frontLayer = layers;
      this.backLayer = layers;
    }
    this.layer = this.frontLayer;
    this.onSelect = onSelect;
    this.onChange = onChange;
    this.tags = [];
    this.items = new Map();
    this.categoryColors = new Map();
    this.visibleCategories = new Set();
    this.hiddenTagIds = new Set();
    this.selectedId = null;
    this.drag = null;
    this.arrangeMode = false;
    this.canEdit = true;
    this.labelFrameStyle = 'border';
    this.showAnchorDot = true;
    this.anchorDotSizeMode = 'dynamic';
    this.anchorDotScale = 1.0;
    this.behindMode = 'all';
    this.occlusionRaycaster = new THREE.Raycaster();
    this.occlusionRaycaster.firstHitOnly = true;
    this.abortController = new AbortController();
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
    this.setupBackLabelEvents();
  }

  setBehindMode(mode) {
    this.behindMode = ['hide', 'dim', 'all'].includes(mode) ? mode : 'all';
    this.update(this.sceneManager.camera);
  }

  setLabelFrameStyle(style) {
    this.labelFrameStyle = style === 'none' ? 'none' : 'border';
    this.items.forEach((item) => {
      item.label.classList.toggle('is-borderless', this.labelFrameStyle === 'none');
    });
  }

  setAnchorDotSettings({ show, sizeMode, scale } = {}) {
    if (sizeMode !== undefined) {
      this.anchorDotSizeMode = ['fixed', 'none', 'dynamic'].includes(sizeMode) ? sizeMode : 'dynamic';
      if (this.anchorDotSizeMode === 'none') {
        this.showAnchorDot = false;
      } else if (show === undefined) {
        this.showAnchorDot = true;
      }
    }
    if (show !== undefined) {
      this.showAnchorDot = Boolean(show);
      if (!this.showAnchorDot && this.anchorDotSizeMode !== 'none') {
        this.anchorDotSizeMode = 'none';
      } else if (this.showAnchorDot && this.anchorDotSizeMode === 'none') {
        this.anchorDotSizeMode = 'dynamic';
      }
    }
    if (scale !== undefined && Number.isFinite(Number(scale)) && Number(scale) > 0) {
      this.anchorDotScale = Number(scale);
    }
    this.update(this.sceneManager.camera);
  }

  setupBackLabelEvents() {
    const canvas = this.sceneManager.renderer.domElement;
    if (!canvas) return;

    const findBackLabelAt = (x, y) => {
      const elements = document.elementsFromPoint(x, y);
      return elements.find((el) => el.classList?.contains('annotation-label') && el.closest('.annotation-layer-back'));
    };

    let hoveredBackLabel = null;

    canvas.addEventListener('pointermove', (event) => {
      if (this.drag) return;
      const hit = this.sceneManager.intersectModel(event);
      if (hit) {
        if (hoveredBackLabel) {
          hoveredBackLabel.classList.remove('is-hovered');
          hoveredBackLabel = null;
          canvas.style.cursor = '';
        }
        return;
      }
      const backLabel = findBackLabelAt(event.clientX, event.clientY);
      if (backLabel !== hoveredBackLabel) {
        if (hoveredBackLabel) hoveredBackLabel.classList.remove('is-hovered');
        hoveredBackLabel = backLabel;
        if (hoveredBackLabel) {
          hoveredBackLabel.classList.add('is-hovered');
          canvas.style.cursor = 'pointer';
        } else {
          canvas.style.cursor = '';
        }
      }
    }, { signal: this.abortController.signal });

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const hit = this.sceneManager.intersectModel(event);
      if (hit) return;
      const backLabel = findBackLabelAt(event.clientX, event.clientY);
      if (!backLabel) return;

      event.stopPropagation();
      event.stopImmediatePropagation();

      const tagId = backLabel.dataset.tagId;
      const tag = this.tags.find((t) => t.id === tagId);
      if (!tag) return;

      if (this.arrangeMode) {
        this.beginTagDrag(tag, event, backLabel);
      } else {
        this.select(tag.id);
      }
    }, { capture: true, signal: this.abortController.signal });
  }

  setCanEdit(canEdit) {
    this.canEdit = Boolean(canEdit);
  }

  setArrangeMode(enabled) {
    this.arrangeMode = Boolean(enabled);
    this.update(this.sceneManager.camera);
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
    this.frontLayer?.replaceChildren?.();
    if (this.backLayer !== this.frontLayer) {
      this.backLayer?.replaceChildren?.();
    }
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
    if (this.labelFrameStyle === 'none') label.classList.add('is-borderless');
    label.dataset.tagId = tag.id;
    label.type = 'button';
    label.textContent = tag.title || 'Nový štítek';
    label.title = `Zobrazit popisek: ${tag.title || 'Nový štítek'}`;
    label.style.setProperty('--category-color', color);

    let pointerState = null;

    label.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (this.arrangeMode) {
        event.stopPropagation();
        pointerState = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          dragging: false
        };
        label.setPointerCapture?.(event.pointerId);
      }
    });

    label.addEventListener('pointermove', (event) => {
      if (!this.arrangeMode || !pointerState || pointerState.pointerId !== event.pointerId) return;
      event.stopPropagation();
      const dist = Math.hypot(event.clientX - pointerState.startX, event.clientY - pointerState.startY);
      if (!pointerState.dragging) {
        if (dist > 4) {
          pointerState.dragging = true;
          this.beginTagDrag(tag, event, label);
        }
      } else {
        this.dragTag(event);
      }
    });

    const handlePointerUp = (event) => {
      if (!pointerState || pointerState.pointerId !== event.pointerId) return;
      event.stopPropagation();
      label.releasePointerCapture?.(event.pointerId);
      const wasDragging = pointerState.dragging;
      pointerState = null;
      if (wasDragging) {
        this.endTagDrag();
      } else {
        this.select(tag.id);
      }
    };

    label.addEventListener('pointerup', handlePointerUp);
    label.addEventListener('pointercancel', (event) => {
      if (!pointerState || pointerState.pointerId !== event.pointerId) return;
      label.releasePointerCapture?.(event.pointerId);
      if (pointerState.dragging) this.endTagDrag();
      pointerState = null;
    });

    label.addEventListener('click', () => {
      if (this.arrangeMode) return;
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
    this.frontLayer.append(label);
    this.items.set(tag.id, { tag, label, line, anchor, handle, highlight, isBehind: false });
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
      item.handle.visible = Boolean(this.arrangeMode) && this.visibleCategories.has(item.tag.category) && !this.hiddenTagIds.has(item.tag.id);
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
      item.handle.visible = Boolean(this.arrangeMode) && this.visibleCategories.has(item.tag.category) && !this.hiddenTagIds.has(item.tag.id);
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
    const bounds = this.frontLayer.getBoundingClientRect();
    const viewportSize = this.sceneManager.renderer.getSize(new THREE.Vector2());

    this.items.forEach((item) => {
      const { tag, label, line, anchor, handle, highlight } = item;
      const isVisible = this.visibleCategories.has(tag.category) && !this.hiddenTagIds.has(tag.id);
      const isSelected = item.tag.id === this.selectedId;
      const start = new THREE.Vector3().fromArray(tag.position);
      const end = endpointOf(tag);
      const worldStart = this.sceneManager.contentPointToWorld(start);
      const worldEnd = this.sceneManager.contentPointToWorld(end);
      const worldNormal = this.sceneManager.contentDirectionToWorld(new THREE.Vector3().fromArray(tag.normal || DEFAULT_NORMAL)).normalize();
      // Leader line vector in world coordinates and its depth relative to camera view
      const leaderVec = new THREE.Vector3().subVectors(worldEnd, worldStart);
      const leaderLength = leaderVec.length();
      const cameraForward = camera.getWorldDirection(new THREE.Vector3());
      const leaderDepthNorm = leaderLength > 0.0001 ? leaderVec.dot(cameraForward) / leaderLength : 0;

      // Vector from camera to anchor point on model
      const toAnchor = new THREE.Vector3().subVectors(worldStart, camera.position);
      const distToAnchor = toAnchor.length();
      const viewDir = toAnchor.clone().normalize();

      // Normal dot with view vector:
      // > 0 means normal faces away from camera (back-facing surface)
      // < 0 means normal faces towards camera (front-facing surface)
      const normalDot = worldNormal.dot(viewDir);

      let isAnchorOccluded = false;
      let isLabelOccluded = false;

      if (this.behindMode !== 'all' && this.sceneManager.modelRoot?.children?.length > 0) {
        const extent = this.modelExtent();
        // Epsilon is tiny to detect occlusion even through very thin bone structures (e.g. scapula blade)
        const epsilon = Math.max(extent * 0.0006, 0.00005);

        if (distToAnchor > 0.001) {
          this.occlusionRaycaster.set(camera.position, viewDir);
          this.occlusionRaycaster.near = camera.near;
          this.occlusionRaycaster.far = distToAnchor;
          const hits = this.occlusionRaycaster.intersectObject(this.sceneManager.modelRoot, true);
          if (hits.length > 0 && hits[0].distance < distToAnchor - epsilon) {
            isAnchorOccluded = true;
          }
        }

        const toEnd = new THREE.Vector3().subVectors(worldEnd, camera.position);
        const distToEnd = toEnd.length();
        if (distToEnd > 0.001) {
          const viewEndDir = toEnd.clone().normalize();
          this.occlusionRaycaster.set(camera.position, viewEndDir);
          this.occlusionRaycaster.near = camera.near;
          this.occlusionRaycaster.far = distToEnd;
          const endHits = this.occlusionRaycaster.intersectObject(this.sceneManager.modelRoot, true);
          if (endHits.length > 0 && endHits[0].distance < distToEnd - epsilon) {
            isLabelOccluded = true;
          }
        }
      }

      // Hysteresis for stability
      let isBehind = item.isBehind ?? false;
      if (this.behindMode === 'all') {
        isBehind = false;
      } else {
        const shouldBeBehind = isAnchorOccluded || isLabelOccluded || normalDot > 0.08 || (leaderDepthNorm > 0.25 && normalDot > -0.15);
        const shouldBeFront = !isAnchorOccluded && !isLabelOccluded && normalDot < -0.05 && leaderDepthNorm < 0.15;

        if (shouldBeBehind) {
          isBehind = true;
        } else if (shouldBeFront) {
          isBehind = false;
        }
      }
      item.isBehind = isBehind;

      // When behindMode is 'hide', back tags are truly hidden unless in arrange mode
      const isHiddenBehind = this.behindMode === 'hide' && isBehind && !this.arrangeMode;

      if (isHiddenBehind || !isVisible) {
        line.visible = false;
        anchor.visible = false;
        handle.visible = false;
        highlight.visible = false;
        label.hidden = true;
        label.style.display = 'none';
        return;
      }
      label.style.display = '';

      line.geometry.setPositions([...start.toArray(), ...end.toArray()]);
      line.material.resolution.set(viewportSize.x, viewportSize.y);
      line.material.opacity = (isBehind && this.behindMode === 'dim') ? 0.35 : 0.92;
      line.visible = true;

      const hasSurface = Boolean(tag.highlight?.points?.length);
      anchor.position.copy(start);
      anchor.visible = !hasSurface && Boolean(this.showAnchorDot) && this.anchorDotSizeMode !== 'none';
      anchor.material.opacity = (isBehind && this.behindMode === 'dim') ? 0.35 : 0.88;

      handle.position.copy(end);
      handle.visible = Boolean(this.arrangeMode);

      highlight.visible = true;

      label.classList.toggle('is-arranging', Boolean(this.arrangeMode));
      label.classList.toggle('is-borderless', this.labelFrameStyle === 'none');

      handle.scale.setScalar(this.markerRadius(worldEnd, 'handle') / HANDLE_RADIUS);
      anchor.scale.setScalar(this.markerRadius(worldStart, 'anchor') / ANCHOR_RADIUS);

      // Layer assignment
      const useBackLayer = this.behindMode === 'dim' && isBehind;
      const targetLayer = useBackLayer ? this.backLayer : this.frontLayer;
      if (label.parentElement !== targetLayer) {
        targetLayer.append(label);
      }
      label.classList.toggle('is-behind', useBackLayer);

      const projected = worldEnd.clone().project(camera);
      const inView = projected.z > -1 && projected.z < 1 && projected.x > -1.12 && projected.x < 1.12 && projected.y > -1.12 && projected.y < 1.12;
      label.hidden = !inView;
      if (!label.hidden) {
        // Keep the handle visible directly beside the floating label so it remains draggable.
        label.style.transform = `translate(${(projected.x * 0.5 + 0.5) * bounds.width}px, ${(-projected.y * 0.5 + 0.5) * bounds.height}px) translate(12px, -50%)`;
        label.style.zIndex = Math.round((1 - projected.z) * 1000);
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
    if (isHandle) {
      const desired = this.cameraDistance(point) * 0.011;
      const minimum = modelExtent * 0.006;
      const maximum = modelExtent * 0.026;
      return THREE.MathUtils.clamp(desired, minimum, maximum);
    }
    const scale = Number.isFinite(this.anchorDotScale) && this.anchorDotScale > 0 ? this.anchorDotScale : 1.0;
    if (this.anchorDotSizeMode === 'fixed') {
      return modelExtent * 0.008 * scale;
    }
    const desired = this.cameraDistance(point) * 0.007 * scale;
    const minimum = modelExtent * 0.004 * scale;
    const maximum = modelExtent * 0.018 * scale;
    return THREE.MathUtils.clamp(desired, minimum, maximum);
  }

  showPreview(intersection, lineLength, options = {}) {
    if (!intersection?.face) return this.hidePreview();
    const normal = intersection.face.normal.clone().transformDirection(intersection.object.matrixWorld).normalize();
    this.showPreviewAt(
      this.sceneManager.worldPointToContent(intersection.point),
      this.sceneManager.worldDirectionToContent(normal),
      lineLength,
      options
    );
  }

  showPreviewAt(position, normal, lineLength, { hasSurface = false } = {}) {
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
    this.previewAnchor.visible = !hasSurface && Boolean(this.showAnchorDot) && this.anchorDotSizeMode !== 'none';
  }

  hidePreview() {
    this.preview.visible = false;
    this.previewAnchor.visible = false;
  }

  beginTagDrag(tag, event, element = null) {
    if (!this.arrangeMode) return false;
    const anchor = new THREE.Vector3().fromArray(tag.position);
    const worldAnchor = this.sceneManager.contentPointToWorld(anchor);
    const cameraDirection = new THREE.Vector3().subVectors(this.sceneManager.camera.position, this.sceneManager.controls.target).normalize();
    this.drag = {
      tag,
      anchor,
      element,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(cameraDirection, worldAnchor)
    };
    if (element) element.classList.add('is-dragging');
    this.sceneManager.controls.enabled = false;
    return true;
  }

  dragTag(event) {
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

  endTagDrag() {
    if (!this.drag) return false;
    const tag = this.drag.tag;
    if (this.drag.element) this.drag.element.classList.remove('is-dragging');
    this.drag = null;
    this.sceneManager.controls.enabled = true;
    this.onChange?.(tag, { transient: false });
    return true;
  }

  beginHandleDrag(event) {
    if (!this.arrangeMode) return false;
    const handles = [...this.items.values()].map((item) => item.handle).filter((handle) => handle.visible);
    const hit = this.sceneManager.intersectObjects(event, handles);
    if (!hit?.object?.userData?.annotationId) return false;
    const tag = this.tags.find((item) => item.id === hit.object.userData.annotationId);
    if (!tag) return false;
    return this.beginTagDrag(tag, event);
  }

  dragHandle(event) {
    return this.dragTag(event);
  }

  endHandleDrag() {
    return this.endTagDrag();
  }

  dispose() {
    this.abortController?.abort();
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
    this.frontLayer?.replaceChildren?.();
    if (this.backLayer !== this.frontLayer) {
      this.backLayer?.replaceChildren?.();
    }
  }
}
