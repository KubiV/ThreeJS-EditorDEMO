import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
    this.controls.target.set(0, 0, 0);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'Načtený model';
    this.scene.add(this.modelRoot);
    this.annotationRoot = new THREE.Group();
    this.annotationRoot.name = 'Štítky modelu';
    this.scene.add(this.annotationRoot);
    this.clipPlanes = {
      x: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
      y: new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
      z: new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)
    };
    this.modelBounds = new THREE.Box3();
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
  }

  resetView() {
    this.animation = null;
    if (this.modelRoot.children.length) this.frameObject(this.modelRoot);
    else this.showEmptyCanvas();
  }

  focus(position, direction = [0, 0, 1]) {
    const target = new THREE.Vector3().fromArray(position);
    const normal = new THREE.Vector3().fromArray(direction).normalize();
    const distance = Math.max(this.camera.position.distanceTo(this.controls.target) * 0.55, 1);
    this.animation = {
      startedAt: performance.now(),
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPosition: target.clone().addScaledVector(normal, distance),
      toTarget: target
    };
  }

  updateCameraState(camera) {
    if (!camera?.position || !camera?.target) return;
    this.animation = null;
    this.camera.position.fromArray(camera.position);
    this.controls.target.fromArray(camera.target);
    this.controls.update();
  }

  cameraState() {
    return { position: this.camera.position.toArray(), target: this.controls.target.toArray() };
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
    this.controls.dispose();
    this.renderer.dispose();
    this.container.replaceChildren();
  }
}
