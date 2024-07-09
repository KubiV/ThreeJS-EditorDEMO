import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { saveAs } from 'file-saver';

import { stlFileName } from './labels.js';

let scene, camera, renderer, controls, raycaster, mouse, intersectedObject, line;
let savedPoints = [];

const distance = 20; // Set the distance for the second point

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

  // Initialize raycaster and mouse
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Load the STL file
  loadModel(stlFileName);

  // Add some lights
  const ambientLight = new THREE.AmbientLight(0x404040, 2);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(0, 1, 1).normalize();
  scene.add(directionalLight);

  // Handle window resize
  window.addEventListener('resize', onWindowResize, false);

  // Handle mouse move and click
  window.addEventListener('mousemove', onMouseMove, false);
  window.addEventListener('click', onMouseClick, false);

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

    // Update the controls to match the new camera position
    controls.update();
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onMouseMove(event) {
  // Calculate mouse position in normalized device coordinates
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onMouseClick(event) {
  if (intersectedObject) {
    const intersect = raycaster.intersectObject(intersectedObject)[0];
    const intersectPoint = intersect.point;
    const normal = intersect.face.normal.clone().transformDirection(intersectedObject.matrixWorld);
    const secondPoint = intersectPoint.clone().add(normal.multiplyScalar(distance));

    // Save both points
    savedPoints.push({
      surfacePoint: intersectPoint,
      secondPoint: secondPoint
    });
    savePointsToFile(savedPoints);
  }
}

function savePointsToFile(points) {
  const blob = new Blob([JSON.stringify(points)], { type: 'text/plain;charset=utf-8' });
  saveAs(blob, 'saved_points.txt');
}

function animate() {
  requestAnimationFrame(animate);

  // Update the raycaster to use the latest mouse coordinates
  raycaster.setFromCamera(mouse, camera);

  // Check for intersections
  const intersects = raycaster.intersectObjects(scene.children, false);

  if (intersects.length > 0) {
    if (intersectedObject !== intersects[0].object || !line) {
      if (line) {
        scene.remove(line);
      }

      intersectedObject = intersects[0].object;
      const normal = intersects[0].face.normal.clone().transformDirection(intersectedObject.matrixWorld);
      const intersectPoint = intersects[0].point;

      // Create geometry for the line
      const geometry = new THREE.BufferGeometry().setFromPoints([
        intersectPoint,
        intersectPoint.clone().add(normal.multiplyScalar(distance))
      ]);

      // Create the line material
      const material = new THREE.LineBasicMaterial({ color: 0xff0000 });

      // Create the line
      line = new THREE.Line(geometry, material);
      scene.add(line);
    } else {
      // Update the line position and direction
      const normal = intersects[0].face.normal.clone().transformDirection(intersectedObject.matrixWorld);
      const intersectPoint = intersects[0].point;

      const points = [
        intersectPoint,
        intersectPoint.clone().add(normal.multiplyScalar(distance))
      ];

      line.geometry.setFromPoints(points);
    }
  } else {
    if (line) {
      scene.remove(line);
      line = null;
    }
    intersectedObject = null;
  }

  controls.update();
  renderer.render(scene, camera);
}

// Initialize the scene
init();
