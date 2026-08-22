import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

function disposeObject(root) {
  root.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => {
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap']) {
        material[key]?.dispose?.();
      }
      material.dispose?.();
    });
  });
}

export class SceneManager {
  constructor(container, onRender) {
    this.container = container;
    this.onRender = onRender;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f7fafc');
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.className = 'viewport-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Interaktivní 3D model');
    container.append(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.navigationMode = 'orbit';
    this.controls.target.set(0, 0, 0);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.contentRoot = new THREE.Group();
    this.contentRoot.name = 'Otočitelný obsah modelu';
    this.scene.add(this.contentRoot);
    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'Načtený model';
    this.contentRoot.add(this.modelRoot);
    this.annotationRoot = new THREE.Group();
    this.annotationRoot.name = 'Štítky modelu';
    this.contentRoot.add(this.annotationRoot);
    this.clipPlanes = {
      x: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
      y: new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
      z: new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)
    };
    this.modelBounds = new THREE.Box3();
    this.rotationCenter = new THREE.Vector3();
    this.rotationDrag = null;
    this.rotationHandle = new THREE.Object3D();
    this.rotationHandle.name = 'Ovladač natočení tělesa';
    this.scene.add(this.rotationHandle);
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode('rotate');
    this.transformControls.setSpace('world');
    this.transformControls.attach(this.rotationHandle);
    this.transformControls.visible = false;
    this.transformControls.enabled = false;
    this.rotationGizmoChanged = false;
    this.scene.add(this.transformControls);
    this.transformControls.addEventListener('objectChange', () => {
      if (this.transformControls.dragging) {
        this.rotationGizmoChanged = true;
        this.setContentQuaternion(this.rotationHandle.quaternion, { syncHandle: false });
      }
    });
    this.transformControls.addEventListener('dragging-changed', ({ value }) => {
      this.controls.enabled = !value;
    });
    this.animation = null;

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#d8e7ee', 2.2));
    const key = new THREE.DirectionalLight('#ffffff', 3.2);
    key.position.set(5, 8, 10);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#b9dcf5', 1.4);
    fill.position.set(-7, 2, -5);
    this.scene.add(fill);
    this.grid = new THREE.GridHelper(20, 20, '#d4e1e7', '#e9f0f4');
    this.grid.position.y = -4;
    this.grid.visible = false;
    this.scene.add(this.grid);

    this.resize = this.resize.bind(this);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(container);
    this.resize();
    this.render();
  }

  render = () => {
    requestAnimationFrame(this.render);
    if (this.animation) {
      const elapsed = Math.min((performance.now() - this.animation.startedAt) / 500, 1);
      const eased = 1 - (1 - elapsed) ** 3;
      this.camera.position.lerpVectors(this.animation.fromPosition, this.animation.toPosition, eased);
      this.controls.target.lerpVectors(this.animation.fromTarget, this.animation.toTarget, eased);
      if (elapsed === 1) this.animation = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.onRender?.(this.camera);
  };

  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  setBackground(color = '#f7fafc') {
    this.scene.background.set(color);
    this.container.style.background = color;
  }

  clearModel() {
    this.modelRoot.children.forEach(disposeObject);
    this.modelRoot.clear();
    this.resetContentRotation();
    this.setRotationGizmoVisible(false);
    this.grid.visible = false;
  }

  setModel(model) {
    this.clearModel();
    this.modelRoot.add(model);
    this.frameObject(model);
  }

  showEmptyCanvas() {
    this.clearModel();
    this.grid.visible = true;
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(8, 6, 10);
    this.controls.update();
  }

  frameObject(object) {
    this.modelBounds.setFromObject(object);
    if (this.modelBounds.isEmpty()) return;
    const center = this.modelBounds.getCenter(new THREE.Vector3());
    const sphere = this.modelBounds.getBoundingSphere(new THREE.Sphere());
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(this.camera.aspect, 0.1));
    // Fitting the bounding sphere into the narrower camera angle works for
    // tall, wide and irregular uploads alike. It replaces the former fixed
    // zoom and is used automatically until an editor stores a custom camera.
    const radius = Math.max(sphere.radius, 0.01);
    const distance = Math.max(radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.12, 1);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(1, 0.55, 1).normalize().multiplyScalar(distance));
    this.camera.near = Math.max(distance / 1000, 0.01);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.rotationCenter.copy(center);
    this.syncRotationHandle();
  }

  resetView() {
    this.animation = null;
    this.resetContentRotation();
    if (this.modelRoot.children.length) this.frameObject(this.modelRoot);
    else this.showEmptyCanvas();
  }

  setNavigationMode(mode) {
    this.navigationMode = ['orbit', 'turntable', 'trackball'].includes(mode) ? mode : 'orbit';
    // The original mode is an OrbitControls camera rotation. Both body modes
    // are handled below and leave OrbitControls responsible for pan and zoom.
    this.controls.enableRotate = this.navigationMode === 'orbit';
    this.rotationDrag = null;
  }

  setRotationGizmoVisible(visible) {
    const enabled = Boolean(visible) && this.modelRoot.children.length > 0;
    this.syncRotationHandle();
    this.transformControls.visible = enabled;
    this.transformControls.enabled = enabled;
  }

  rotationGizmoVisible() {
    return this.transformControls.visible;
  }

  consumeRotationGizmoChange() {
    const changed = this.rotationGizmoChanged;
    this.rotationGizmoChanged = false;
    return changed;
  }

  contentQuaternion() {
    return this.contentRoot.quaternion.toArray();
  }

  setContentQuaternionArray(value) {
    if (Array.isArray(value) && value.length === 4 && value.every((number) => Number.isFinite(Number(number)))) {
      this.setContentQuaternion(new THREE.Quaternion().fromArray(value));
      return;
    }
    this.resetContentRotation();
  }

  syncRotationHandle() {
    this.rotationHandle.position.copy(this.rotationCenter);
    this.rotationHandle.quaternion.copy(this.contentRoot.quaternion);
    this.rotationHandle.updateMatrixWorld(true);
  }

  contentTrackballPoint(event) {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    let x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    let y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    const lengthSquared = x * x + y * y;
    if (lengthSquared > 1) {
      const length = Math.sqrt(lengthSquared);
      x /= length;
      y /= length;
      return new THREE.Vector3(x, y, 0);
    }
    return new THREE.Vector3(x, y, Math.sqrt(1 - lengthSquared));
  }

  beginContentRotation(event) {
    if (this.rotationGizmoVisible() || this.navigationMode === 'orbit' || !this.modelRoot.children.length || event.button !== 0) return false;
    const point = this.contentTrackballPoint(event);
    if (!point) return false;
    this.animation = null;
    this.rotationDrag = {
      pointerId: event.pointerId,
      point,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false
    };
    return true;
  }

  dragContentRotation(event) {
    if (!this.rotationDrag || this.rotationDrag.pointerId !== event.pointerId) return false;
    const point = this.contentTrackballPoint(event);
    if (!point) return true;
    let delta;
    if (this.navigationMode === 'turntable') {
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (event.clientX - this.rotationDrag.clientX) * 0.01);
      const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (event.clientY - this.rotationDrag.clientY) * -0.01);
      delta = yaw.multiply(pitch);
      this.rotationDrag.clientX = event.clientX;
      this.rotationDrag.clientY = event.clientY;
    } else {
      delta = new THREE.Quaternion().setFromUnitVectors(this.rotationDrag.point, point);
    }
    if (delta.angleTo(new THREE.Quaternion()) > 0.001) {
      this.setContentQuaternion(delta.multiply(this.contentRoot.quaternion));
      this.rotationDrag.moved = true;
    }
    this.rotationDrag.point.copy(point);
    return true;
  }

  endContentRotation(event) {
    if (!this.rotationDrag || this.rotationDrag.pointerId !== event.pointerId) return false;
    const { moved } = this.rotationDrag;
    this.rotationDrag = null;
    return moved;
  }

  snapToFace(face) {
    const directions = {
      front: new THREE.Vector3(0, 0, 1),
      back: new THREE.Vector3(0, 0, -1),
      right: new THREE.Vector3(1, 0, 0),
      left: new THREE.Vector3(-1, 0, 0),
      top: new THREE.Vector3(0, 1, 0),
      bottom: new THREE.Vector3(0, -1, 0)
    };
    const direction = directions[face];
    if (!direction || !this.modelRoot.children.length) return;
    this.animation = null;
    if (this.navigationMode === 'orbit') {
      const distance = Math.max(this.camera.position.distanceTo(this.controls.target), 0.01);
      this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
      this.camera.lookAt(this.controls.target);
      this.controls.update();
      return;
    }
    const cameraDirection = this.camera.position.clone().sub(this.controls.target).normalize();
    this.setContentQuaternion(new THREE.Quaternion().setFromUnitVectors(direction, cameraDirection));
  }

  resetContentRotation() {
    this.setContentQuaternion(new THREE.Quaternion());
  }

  setContentQuaternion(value, { syncHandle = true } = {}) {
    this.contentRoot.quaternion.copy(value).normalize();
    // p = centre - R * centre keeps an offset imported object centred while
    // its body is being rotated.
    this.contentRoot.position.copy(this.rotationCenter)
      .sub(this.rotationCenter.clone().applyQuaternion(this.contentRoot.quaternion));
    this.contentRoot.updateMatrixWorld(true);
    if (syncHandle) this.syncRotationHandle();
  }

  contentPointToWorld(value) {
    this.contentRoot.updateMatrixWorld(true);
    return this.contentRoot.localToWorld(value.clone ? value.clone() : new THREE.Vector3().fromArray(value));
  }

  worldPointToContent(value) {
    this.contentRoot.updateMatrixWorld(true);
    return this.contentRoot.worldToLocal(value.clone ? value.clone() : new THREE.Vector3().fromArray(value));
  }

  contentDirectionToWorld(value) {
    const direction = value.clone ? value.clone() : new THREE.Vector3().fromArray(value);
    return direction.applyQuaternion(this.contentRoot.getWorldQuaternion(new THREE.Quaternion())).normalize();
  }

  worldDirectionToContent(value) {
    const direction = value.clone ? value.clone() : new THREE.Vector3().fromArray(value);
    return direction.applyQuaternion(this.contentRoot.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
  }

  focus(position, direction = [0, 0, 1]) {
    const target = this.contentPointToWorld(position);
    const normal = this.contentDirectionToWorld(direction);
    const distance = Math.max(this.camera.position.distanceTo(this.controls.target) * 0.55, 1);
    this.animation = {
      startedAt: performance.now(),
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPosition: target.clone().addScaledVector(normal, distance),
      toTarget: target
    };
  }

  updateCameraState(camera, { applyModelQuaternion = true } = {}) {
    if (!camera?.position || !camera?.target) return;
    this.animation = null;
    if (applyModelQuaternion && Array.isArray(camera.modelQuaternion) && camera.modelQuaternion.length === 4) {
      this.setContentQuaternion(new THREE.Quaternion().fromArray(camera.modelQuaternion));
    }
    this.camera.position.fromArray(camera.position);
    this.controls.target.fromArray(camera.target);
    this.controls.update();
  }

  cameraState() {
    const state = { position: this.camera.position.toArray(), target: this.controls.target.toArray() };
    if (this.contentRoot.quaternion.angleTo(new THREE.Quaternion()) > 0.00001) {
      state.modelQuaternion = this.contentRoot.quaternion.toArray();
    }
    return state;
  }

  captureCameraState() {
    // A label can still be moving the camera when the editor chooses this
    // action. Stop that transition so the saved state is exactly the view the
    // editor saw at the time of the click.
    this.animation = null;
    this.controls.update();
    return this.cameraState();
  }

  loadedObjectNames() {
    const names = [];
    this.modelRoot.traverse((object) => {
      if (object.isMesh) names.push(object.name || `Objekt ${names.length + 1}`);
    });
    return names;
  }

  normalizedPointer(event) {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    );
    return this.pointer;
  }

  getRay(event) {
    this.raycaster.setFromCamera(this.normalizedPointer(event), this.camera);
    return this.raycaster.ray;
  }

  intersectModel(event) {
    this.getRay(event);
    return this.raycaster.intersectObject(this.modelRoot, true)[0] || null;
  }

  intersectObjects(event, objects) {
    this.getRay(event);
    return this.raycaster.intersectObjects(objects, false)[0] || null;
  }

  setClipping(values = {}) {
    if (!this.modelRoot.children.length) return;
    this.modelBounds.setFromObject(this.modelRoot);
    const legacyValue = typeof values === 'number' ? values : 100;
    const requested = {
      x: Number(values.clipX ?? 100),
      y: Number(values.clipY ?? 100),
      z: Number(values.clipZ ?? values.clip ?? legacyValue)
    };
    const activePlanes = Object.entries(requested).flatMap(([axis, value]) => {
      if (value >= 100) return [];
      const plane = this.clipPlanes[axis];
      plane.constant = THREE.MathUtils.mapLinear(value, -100, 100, this.modelBounds.min[axis], this.modelBounds.max[axis]);
      return [plane];
    });
    this.modelRoot.traverse((object) => this.setObjectClipping(object, activePlanes));
  }

  setObjectClipping(object, planes) {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => {
      material.clippingPlanes = planes;
      material.needsUpdate = true;
    });
  }

  dispose() {
    this.observer?.disconnect();
    this.clearModel();
    this.annotationRoot.clear();
    this.transformControls.detach();
    this.transformControls.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.container.replaceChildren();
  }
}
