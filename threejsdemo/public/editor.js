import * as THREE from './three.module.js';
import { STLLoader } from './STLLoader.js';
import { OrbitControls } from './OrbitControls.js';
const { saveAs } = window;
import GUI from './lil-gui.esm.js'; // Importing lil-gui

let scene, camera, renderer, controls, raycaster, mouse, intersectedObject, line;
let savedPoints = [];
let initialCameraPosition, initialControlsTarget;
let modelLoaded = false;
let stlFileName;

// Define distance variable
const params = {
    distance: 20
};

function init() {
  // Fetch labels and stlFileName from JSON
  fetch('./labels.json')
    .then(response => response.json())
    .then(data => {
      stlFileName = data.stlFileName;

      // Initialize the scene after data is loaded
      initScene();
    })
    .catch(error => console.error('Error loading labels.json:', error));
}

function initScene() {
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

    // Additional lights
    const bottomLight = new THREE.DirectionalLight(0xffffff, 0.5);
    bottomLight.position.set(0, -1, 0).normalize(); // From below
    scene.add(bottomLight);

    const backgroundLight = new THREE.DirectionalLight(0xffffff, 0.5);
    backgroundLight.position.set(0, 0, -1).normalize(); // From behind
    scene.add(backgroundLight);

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Handle mouse move and click
    window.addEventListener('mousemove', onMouseMove, false);
    window.addEventListener('click', onMouseClick, false);

    // Create GUI for distance
    const gui = new GUI();
    gui.add(params, 'distance', 1, 100).name('Distance');

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
        const secondPoint = intersectPoint.clone().add(normal.multiplyScalar(params.distance));

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
                intersectPoint.clone().add(normal.multiplyScalar(params.distance))
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
                intersectPoint.clone().add(normal.multiplyScalar(params.distance))
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