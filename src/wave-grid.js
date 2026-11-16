import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

const canvas = document.querySelector("#wave-grid");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Wave grid canvas was not found.");
}

const gridSize = 40;
const cubeWidth = 0.8;
const spacing = 0.82;
const bounds = gridSize * spacing;
const maxRipples = 16;
const ripples = [];
const clock = new THREE.Clock();
let idleTime = 0;
let randomRippleTime = 0;
let frame = 0;
let disposed = false;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
camera.position.set(0, 32, 34);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: "low-power",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

scene.add(new THREE.HemisphereLight("#ffffff", "#cbd5e1", 2.2));
const keyLight = new THREE.DirectionalLight("#ffffff", 3);
keyLight.position.set(-16, 28, 12);
scene.add(keyLight);

const geometry = new THREE.BoxGeometry(cubeWidth, 1, cubeWidth);
const material = new THREE.MeshStandardMaterial({
  color: "#ffffff",
  roughness: 0.34,
  metalness: 0.08,
});
const count = gridSize * gridSize;
const cubes = new THREE.InstancedMesh(geometry, material, count);
cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(cubes);

const dummy = new THREE.Object3D();
const baseColor = new THREE.Color("#e2e8f0");
const highColor = new THREE.Color("#2563eb");
const darkColor = new THREE.Color("#0f294a");
const instanceColor = new THREE.Color();
const halfBounds = bounds / 2;

for (let row = 0; row < gridSize; row += 1) {
  for (let column = 0; column < gridSize; column += 1) {
    const index = row * gridSize + column;
    const x = row * spacing - halfBounds + spacing / 2;
    const z = column * spacing - halfBounds + spacing / 2;
    dummy.position.set(x, 0, z);
    dummy.scale.set(1, 0.08, 1);
    dummy.updateMatrix();
    cubes.setMatrixAt(index, dummy.matrix);
    cubes.setColorAt(index, baseColor);
  }
}
cubes.instanceMatrix.needsUpdate = true;
if (cubes.instanceColor) cubes.instanceColor.needsUpdate = true;

const resize = () => {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const aspect = width / height;
  const viewHeight = bounds / Math.max(1, aspect);
  camera.left = -(viewHeight * aspect) / 2;
  camera.right = (viewHeight * aspect) / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
};

const addRipple = (x, z, strength = 1) => {
  if (ripples.length === maxRipples) ripples.shift();
  ripples.push({ x, z, age: 0, strength });
};

const onPointerMove = (event) => {
  const x = (event.clientX / window.innerWidth) * 2 - 1;
  const y = 1 - (event.clientY / window.innerHeight) * 2;
  const viewHeight = camera.top - camera.bottom;
  const viewWidth = camera.right - camera.left;
  addRipple(
    x * viewWidth * 0.48,
    -y * viewHeight * 0.48,
    Math.min(1.4, 0.55 + Math.hypot(event.movementX, event.movementY) * 0.012),
  );
  idleTime = 0;
};

window.addEventListener("pointermove", onPointerMove, { passive: true });
window.addEventListener("resize", resize);
resize();

const animate = () => {
  if (disposed) return;
  frame = window.requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  idleTime += delta;
  randomRippleTime += delta;

  if (idleTime > 2.5 && randomRippleTime > 1.4) {
    addRipple((Math.random() - 0.5) * bounds * 0.55, (Math.random() - 0.5) * bounds * 0.55, 0.42);
    randomRippleTime = 0;
  }

  for (let i = ripples.length - 1; i >= 0; i -= 1) {
    ripples[i].age += delta;
    if (ripples[i].age > 4) ripples.splice(i, 1);
  }

  const time = clock.elapsedTime;
  for (let row = 0; row < gridSize; row += 1) {
    for (let column = 0; column < gridSize; column += 1) {
      const index = row * gridSize + column;
      const x = row * spacing - halfBounds + spacing / 2;
      const z = column * spacing - halfBounds + spacing / 2;
      let wave = Math.sin(x * 0.24 + time * 0.55) * Math.cos(z * 0.22 - time * 0.42) * 0.13;

      for (const ripple of ripples) {
        const distance = Math.hypot(x - ripple.x, z - ripple.z);
        const front = distance - ripple.age * 5.2;
        const ring = Math.exp(-(front * front) / 5.2);
        wave += Math.cos(front * 1.7) * ring * Math.exp(-ripple.age * 0.9) * ripple.strength * 1.15;
      }

      const height = Math.max(0.08, 0.3 + wave);
      dummy.position.set(x, height / 2, z);
      dummy.scale.set(1, height, 1);
      dummy.updateMatrix();
      cubes.setMatrixAt(index, dummy.matrix);

      const colorMix = THREE.MathUtils.clamp((height - 0.22) / 0.85, 0, 1);
      instanceColor.copy(baseColor).lerp(highColor, colorMix);
      if (colorMix > 0.55) instanceColor.lerp(darkColor, (colorMix - 0.55) * 0.26);
      cubes.setColorAt(index, instanceColor);
    }
  }

  cubes.instanceMatrix.needsUpdate = true;
  if (cubes.instanceColor) cubes.instanceColor.needsUpdate = true;
  renderer.render(scene, camera);
};

const dispose = () => {
  disposed = true;
  window.cancelAnimationFrame(frame);
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("resize", resize);
  geometry.dispose();
  material.dispose();
  renderer.dispose();
};

window.addEventListener("pagehide", dispose, { once: true });
animate();
