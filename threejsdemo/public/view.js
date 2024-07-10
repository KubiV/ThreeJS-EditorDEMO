console.log('view script loaded and executed.');
import * as THREE from './three.module.js';
import { STLLoader } from './STLLoader.js';
import { OrbitControls } from './OrbitControls.js';
import { stlFileName, labels } from './labels.js';

let scene, camera, renderer, controls;
let initialCameraPosition, initialControlsTarget;
let modelLoaded = false;

function init() {
  // Create the scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfffff0);

  // Set up the camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  initialCameraPosition = new THREE.Vector3(0, 0, 0); // Set your initial camera position here

  // Set up the renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('app').appendChild(renderer.domElement);

  // Add OrbitControls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  initialControlsTarget = new THREE.Vector3(0, 0, 0); // Set your initial controls target here

  // Load the STL file
  loadModel(stlFileName);

  // Add some lights
  const ambientLight = new THREE.AmbientLight(0x404040, 2);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(0, 1, 1).normalize();
  scene.add(directionalLight);

  // Additional lights
  const bottomLight = new THREE.DirectionalLight(0xffffff, 0.5);
  bottomLight.position.set(0, -1, 0).normalize(); // From below
  scene.add(bottomLight);

  const backgroundLight = new THREE.DirectionalLight(0xffffff, 0.5);
  backgroundLight.position.set(0, 0, -1).normalize(); // From behind
  scene.add(backgroundLight);

  // Handle window resize
  window.addEventListener('resize', onWindowResize, false);

  // Add event listener for reset button
  document.getElementById('resetButton').addEventListener('click', resetModelPosition);

  // Start the animation loop
  animate();
}

function loadModel(stlFile) {
  const loader = new STLLoader();
  loader.load(stlFile, function (geometry) {
    const material = new THREE.MeshLambertMaterial({ color: 0xFFF7AC });
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

    // Store initial camera position after model is loaded
    initialCameraPosition.copy(camera.position);

    // Update the controls to match the new camera position
    controls.update();

    modelLoaded = true;

    // Add labels after the model is loaded
    addLabels();
  });
}

function addLabels() {
  labels.forEach(label => {
    // Create label sprite
    const spriteMaterial = new THREE.SpriteMaterial({
      map: createLabelCanvas(label.text),
      transparent: true
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.set(label.secondPoint.x, label.secondPoint.y, label.secondPoint.z);
    sprite.scale.set(10, 5, 1); // Adjust scale as needed
    scene.add(sprite);

    // Create line from surface point to label point
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(label.surfacePoint.x, label.surfacePoint.y, label.surfacePoint.z),
      new THREE.Vector3(label.secondPoint.x, label.secondPoint.y, label.secondPoint.z)
    ]);

    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    scene.add(line);

    // Create dot at surface point
    const dotGeometry = new THREE.SphereGeometry(0.5, 32, 32);
    const dotMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const dot = new THREE.Mesh(dotGeometry, dotMaterial);
    dot.position.set(label.surfacePoint.x, label.surfacePoint.y, label.surfacePoint.z);
    scene.add(dot);
  });
}

function createLabelCanvas(text) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const fontSize = 24;
  const scale = 4; // Scale factor for higher resolution

  context.font = `${fontSize * scale}px Arial`;
  const textWidth = context.measureText(text).width;

  canvas.width = textWidth + 20 * scale;
  canvas.height = (fontSize + 20) * scale;

  context.font = `${fontSize * scale}px Arial`;
  context.fillStyle = 'rgba(255, 255, 255, 0.8)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'black';
  context.fillText(text, 10 * scale, (fontSize + 5) * scale);

  // Scale down the canvas to the desired size
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter; // Use linear filter for smooth scaling
  texture.needsUpdate = true;
  return texture;
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function resetModelPosition() {
  if (!modelLoaded) return;

  // Reset camera position
  camera.position.copy(initialCameraPosition);
  camera.lookAt(initialControlsTarget);

  // Reset controls target
  controls.target.copy(initialControlsTarget);

  // Update controls
  controls.update();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// Initialize the scene
init();