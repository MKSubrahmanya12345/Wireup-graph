import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";

// ---------- renderer / scene / camera ----------

const canvas = document.getElementById("viewport");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

const camera = new THREE.PerspectiveCamera(
  40,
  window.innerWidth / window.innerHeight,
  0.01,
  100
);
camera.position.set(3.2, 2.4, 3.6);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1;
controls.maxDistance = 12;
controls.target.set(0, 0.3, 0);

// ---------- environment lighting (studio HDRI substitute, no external file) ----------

const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

// key light for defined shadows (environment alone gives soft ambient only)
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(3, 5, 2);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 15;
keyLight.shadow.camera.left = -3;
keyLight.shadow.camera.right = 3;
keyLight.shadow.camera.top = 3;
keyLight.shadow.camera.bottom = -3;
keyLight.shadow.bias = -0.0015;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xbcd4ff, 0.4);
fillLight.position.set(-4, 2, -3);
scene.add(fillLight);

// ---------- ground ----------

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(6, 64),
  new THREE.MeshStandardMaterial({ color: 0x1c1e23, roughness: 0.9, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.001;
ground.receiveShadow = true;
scene.add(ground);

// ---------- materials ----------

const materials = {
  metal: new THREE.MeshPhysicalMaterial({
    color: 0x9aa0ac,
    metalness: 1.0,
    roughness: 0.32,
    clearcoat: 0.1,
  }),
  plastic: new THREE.MeshPhysicalMaterial({
    color: 0x5b9bd5,
    metalness: 0.0,
    roughness: 0.5,
    clearcoat: 0.4,
    clearcoatRoughness: 0.25,
  }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.04,
    transmission: 1.0,
    thickness: 0.4,
    ior: 1.5,
    envMapIntensity: 1.2,
  }),
};

// ---------- parametric CSG: box(width, depth, height).subtract(cylinder) ----------
// Scene units = cm; source params are mm -> divide by 10 to keep the model on-screen.

const SCALE = 1 / 10;
const evaluator = new Evaluator();

let currentMesh = null;

function buildPlate(widthMM, depthMM, heightMM, holeRadiusMM) {
  const t0 = performance.now();

  const w = widthMM * SCALE;
  const d = depthMM * SCALE;
  const h = heightMM * SCALE;
  const r = holeRadiusMM * SCALE;

  const boxGeo = new THREE.BoxGeometry(w, h, d);
  const cylGeo = new THREE.CylinderGeometry(r, r, h * 2, 48);

  const boxBrush = new Brush(boxGeo);
  boxBrush.updateMatrixWorld();

  const cylBrush = new Brush(cylGeo);
  cylBrush.updateMatrixWorld();

  const resultBrush = evaluator.evaluate(boxBrush, cylBrush, SUBTRACTION);
  resultBrush.geometry.computeVertexNormals();

  const t1 = performance.now();

  document.getElementById("csgTime").textContent = `${(t1 - t0).toFixed(1)} ms CSG`;
  document.getElementById("triCount").textContent =
    `${(resultBrush.geometry.index.count / 3).toLocaleString()} triangles`;

  return resultBrush.geometry;
}

function rebuild() {
  const width = parseFloat(document.getElementById("width").value);
  const depth = parseFloat(document.getElementById("depth").value);
  const height = parseFloat(document.getElementById("height").value);
  const hole = parseFloat(document.getElementById("hole").value);
  const matKey = document.getElementById("material").value;

  document.getElementById("widthVal").textContent = width;
  document.getElementById("depthVal").textContent = depth;
  document.getElementById("heightVal").textContent = height;
  document.getElementById("holeVal").textContent = hole;

  const geometry = buildPlate(width, depth, height, hole);

  if (currentMesh) {
    currentMesh.geometry.dispose();
    scene.remove(currentMesh);
  }

  currentMesh = new THREE.Mesh(geometry, materials[matKey]);
  currentMesh.position.y = (height * SCALE) / 2;
  currentMesh.castShadow = true;
  currentMesh.receiveShadow = true;
  scene.add(currentMesh);
}

// ---------- wire up controls ----------

["width", "depth", "height", "hole", "material"].forEach((id) => {
  document.getElementById(id).addEventListener("input", rebuild);
});

rebuild();

// ---------- resize + render loop ----------

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();