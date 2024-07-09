import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { stlFileName } from './labels.js';

let scene, camera, renderer, controls;

function init() {
  // Create the scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfffff0);

  // Set up the camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

  // Set up the renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('app').appendChild(renderer.domElement);

  // Add OrbitControls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);

  // Load the STL file
  loadModel(stlFileName)

  // Add some lights
  const ambientLight = new THREE.AmbientLight(0x404040, 2);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(0, 1, 1).normalize();
  scene.add(directionalLight);

  // Handle window resize
  window.addEventListener('resize', onWindowResize, false);

  // Start the animation loop
  animate();
}

function loadModel(stlFile) {
  const loader = new STLLoader();
  loader.load(stlFile, function (geometry) {
      //const material = new THREE.MeshStandardMaterial({ color: 0x0055ff });
      const material = new THREE.MeshLambertMaterial({color: 0xFFF7AC});
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
  
      // Compute the bounding box of the model
      const boundingBox = new THREE.Box3().setFromObject(mesh);
      const size = boundingBox.getSize(new THREE.Vector3());
      const center = boundingBox.getCenter(new THREE.Vector3());
  
      // Position the camera above the model, looking down
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = camera.fov * (Math.PI / 180); // Convert vertical FOV to radians
      const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
      camera.position.set(center.x, center.y + cameraZ, center.z);
      camera.lookAt(center);
  
      // Update the controls to match the new camera position
      controls.update();
    });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// Initialize the scene
init();