import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

const extensionOf = (url = '') => url.split('?')[0].split('.').pop().toLowerCase();

function loadWithProgress(loader, url, onProgress) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      resolve,
      (event) => onProgress?.(event.total ? event.loaded / event.total : 0),
      reject
    );
  });
}

/** Loads the formats accepted by the MediaWiki model registry. */
export async function loadModel(url, { mtlUrl, color = '#c7dce9', onProgress } = {}) {
  const extension = extensionOf(url);

  if (extension === 'stl') {
    const geometry = await loadWithProgress(new STLLoader(), url, onProgress);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.58,
      metalness: 0,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.isStlModel = true;
    return mesh;
  }

  if (extension === 'glb' || extension === 'gltf') {
    const gltf = await loadWithProgress(new GLTFLoader(), url, onProgress);
    return gltf.scene;
  }

  if (extension === 'obj') {
    const loader = new OBJLoader();
    if (mtlUrl) {
      const materials = await loadWithProgress(new MTLLoader(), mtlUrl, onProgress);
      materials.preload();
      loader.setMaterials(materials);
    }
    const object = await loadWithProgress(loader, url, onProgress);
    object.traverse((child) => {
      if (child.isMesh && !child.material) {
        child.material = new THREE.MeshStandardMaterial({ color, roughness: 0.58 });
      }
    });
    return object;
  }

  throw new Error('Nepodporovaný formát modelu. Použijte STL, OBJ, GLTF nebo GLB.');
}

export function findMaterialFile(files = []) {
  return files.find((file) => extensionOf(file) === 'mtl');
}

export function applyMaterialSettings(root, settings) {
  if (!root) return;

  root.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => {
      // Imported textured materials keep their base colour; STL has no texture to preserve.
      if (object.userData.isStlModel && material.color) material.color.set(settings.color);
      if ('roughness' in material) material.roughness = Number(settings.roughness);
      material.wireframe = Boolean(settings.wireframe);
      material.transparent = Number(settings.opacity) < 1;
      material.opacity = Number(settings.opacity);
      material.needsUpdate = true;
    });
  });
}
