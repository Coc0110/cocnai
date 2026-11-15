import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { center, dedup, prune, weld } from '@gltf-transform/functions';

const io = new NodeIO();

/**
 * Creates a mesh primitive from vertices and indices with basic material properties.
 */
function addPrimitiveToDoc(doc, scene, name, positions, indices, color, roughness = 0.4, metallic = 0.1) {
  const buffer = doc.getRoot().listBuffers()[0] || doc.createBuffer();
  const positionAccessor = doc.createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(positions))
    .setBuffer(buffer);

  const indicesAccessor = doc.createAccessor()
    .setType('SCALAR')
    .setArray(new Uint16Array(indices))
    .setBuffer(buffer);

  const material = doc.createMaterial(name + 'Mat')
    .setBaseColorFactor([...color, 1.0])
    .setRoughnessFactor(roughness)
    .setMetallicFactor(metallic);

  const prim = doc.createPrimitive()
    .setAttribute('POSITION', positionAccessor)
    .setIndices(indicesAccessor)
    .setMaterial(material);

  const mesh = doc.createMesh(name + 'Mesh').addPrimitive(prim);
  const node = doc.createNode(name + 'Node').setMesh(mesh);
  scene.addChild(node);
  return node;
}

/**
 * Generates UV sphere positions and triangle indices.
 */
function createSphereData(radius = 1, segX = 16, segY = 12, centerOffset = [0, 0, 0]) {
  const positions = [];
  const indices = [];

  for (let y = 0; y <= segY; y++) {
    const v = y / segY;
    const phi = v * Math.PI;
    for (let x = 0; x <= segX; x++) {
      const u = x / segX;
      const theta = u * Math.PI * 2;
      const px = centerOffset[0] + radius * Math.sin(phi) * Math.cos(theta);
      const py = centerOffset[1] + radius * Math.cos(phi);
      const pz = centerOffset[2] + radius * Math.sin(phi) * Math.sin(theta);
      positions.push(px, py, pz);
    }
  }

  const stride = segX + 1;
  for (let y = 0; y < segY; y++) {
    for (let x = 0; x < segX; x++) {
      const i1 = y * stride + x;
      const i2 = (y + 1) * stride + x;
      const i3 = (y + 1) * stride + (x + 1);
      const i4 = y * stride + (x + 1);
      indices.push(i1, i2, i4);
      indices.push(i2, i3, i4);
    }
  }

  return { positions, indices };
}

/**
 * Generates Box positions and triangle indices.
 */
function createBoxData(w = 1, h = 1, d = 1, centerOffset = [0, 0, 0]) {
  const [cx, cy, cz] = centerOffset;
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const p = [
    // Front face
    cx - hw, cy - hh, cz + hd,
    cx + hw, cy - hh, cz + hd,
    cx + hw, cy + hh, cz + hd,
    cx - hw, cy + hh, cz + hd,
    // Back face
    cx + hw, cy - hh, cz - hd,
    cx - hw, cy - hh, cz - hd,
    cx - hw, cy + hh, cz - hd,
    cx + hw, cy + hh, cz - hd,
    // Top face
    cx - hw, cy + hh, cz + hd,
    cx + hw, cy + hh, cz + hd,
    cx + hw, cy + hh, cz - hd,
    cx - hw, cy + hh, cz - hd,
    // Bottom face
    cx - hw, cy - hh, cz - hd,
    cx + hw, cy - hh, cz - hd,
    cx + hw, cy - hh, cz + hd,
    cx - hw, cy - hh, cz + hd,
    // Right face
    cx + hw, cy - hh, cz + hd,
    cx + hw, cy - hh, cz - hd,
    cx + hw, cy + hh, cz - hd,
    cx + hw, cy + hh, cz + hd,
    // Left face
    cx - hw, cy - hh, cz - hd,
    cx - hw, cy - hh, cz + hd,
    cx - hw, cy + hh, cz + hd,
    cx - hw, cy + hh, cz - hd,
  ];

  const indices = [];
  for (let f = 0; f < 6; f++) {
    const o = f * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  return { positions: p, indices };
}

/**
 * Generates a cute 3D model for Froakie (Cóc).
 */
async function buildFroakieModel() {
  const doc = new Document();
  const scene = doc.createScene('Scene');

  // Body & Head (Cyan-blue)
  const body = createSphereData(0.5, 16, 12, [0, 0, 0]);
  addPrimitiveToDoc(doc, scene, 'Body', body.positions, body.indices, [0.35, 0.72, 0.95], 0.3, 0.05);

  // Large White/Yellow Eyes
  const eyeL = createSphereData(0.18, 12, 8, [-0.22, 0.35, 0.3]);
  const eyeR = createSphereData(0.18, 12, 8, [0.22, 0.35, 0.3]);
  addPrimitiveToDoc(doc, scene, 'EyeL', eyeL.positions, eyeL.indices, [1.0, 0.95, 0.3], 0.2);
  addPrimitiveToDoc(doc, scene, 'EyeR', eyeR.positions, eyeR.indices, [1.0, 0.95, 0.3], 0.2);

  // Pupils (Black)
  const pupilL = createSphereData(0.08, 8, 6, [-0.22, 0.38, 0.44]);
  const pupilR = createSphereData(0.08, 8, 6, [0.22, 0.38, 0.44]);
  addPrimitiveToDoc(doc, scene, 'PupilL', pupilL.positions, pupilL.indices, [0.05, 0.05, 0.05], 0.1);
  addPrimitiveToDoc(doc, scene, 'PupilR', pupilR.positions, pupilR.indices, [0.05, 0.05, 0.05], 0.1);

  // White foam collar / throat bubbles (Frubbles)
  const foam1 = createSphereData(0.2, 10, 8, [0, -0.25, 0.35]);
  const foam2 = createSphereData(0.16, 10, 8, [-0.28, -0.2, 0.28]);
  const foam3 = createSphereData(0.16, 10, 8, [0.28, -0.2, 0.28]);
  const foam4 = createSphereData(0.22, 10, 8, [0, -0.2, -0.3]);
  addPrimitiveToDoc(doc, scene, 'Frubble1', foam1.positions, foam1.indices, [0.95, 0.98, 1.0], 0.6);
  addPrimitiveToDoc(doc, scene, 'Frubble2', foam2.positions, foam2.indices, [0.95, 0.98, 1.0], 0.6);
  addPrimitiveToDoc(doc, scene, 'Frubble3', foam3.positions, foam3.indices, [0.95, 0.98, 1.0], 0.6);
  addPrimitiveToDoc(doc, scene, 'Frubble4', foam4.positions, foam4.indices, [0.95, 0.98, 1.0], 0.6);

  await doc.transform(center(), prune(), dedup(), weld());
  return await io.writeBinary(doc);
}

/**
 * Generates a cute 3D model for Deerling (Nai).
 */
async function buildDeerlingModel() {
  const doc = new Document();
  const scene = doc.createScene('Scene');

  // Head and Torso (Pastel Pink / Spring Green accent)
  const head = createSphereData(0.42, 16, 12, [0, 0.28, 0.15]);
  addPrimitiveToDoc(doc, scene, 'Head', head.positions, head.indices, [0.96, 0.62, 0.72], 0.35);

  const body = createSphereData(0.4, 16, 12, [0, -0.15, -0.2]);
  addPrimitiveToDoc(doc, scene, 'Body', body.positions, body.indices, [0.98, 0.88, 0.78], 0.4);

  // Cute Long Ears
  const earL = createBoxData(0.12, 0.4, 0.08, [-0.28, 0.65, 0.05]);
  const earR = createBoxData(0.12, 0.4, 0.08, [0.28, 0.65, 0.05]);
  addPrimitiveToDoc(doc, scene, 'EarL', earL.positions, earL.indices, [0.96, 0.58, 0.68], 0.3);
  addPrimitiveToDoc(doc, scene, 'EarR', earR.positions, earR.indices, [0.96, 0.58, 0.68], 0.3);

  // Yellow Flower / Forehead Star
  const flower = createSphereData(0.14, 10, 8, [0, 0.6, 0.26]);
  addPrimitiveToDoc(doc, scene, 'Flower', flower.positions, flower.indices, [1.0, 0.86, 0.25], 0.2, 0.2);

  // Eyes
  const eyeL = createSphereData(0.09, 8, 6, [-0.2, 0.32, 0.48]);
  const eyeR = createSphereData(0.09, 8, 6, [0.2, 0.32, 0.48]);
  addPrimitiveToDoc(doc, scene, 'EyeL', eyeL.positions, eyeL.indices, [0.25, 0.15, 0.1], 0.1);
  addPrimitiveToDoc(doc, scene, 'EyeR', eyeR.positions, eyeR.indices, [0.25, 0.15, 0.1], 0.1);

  await doc.transform(center(), prune(), dedup(), weld());
  return await io.writeBinary(doc);
}

/**
 * Builds faceted Crystal Heart keepsake.
 */
async function buildCrystalHeart() {
  const doc = new Document();
  const scene = doc.createScene('Scene');

  // Gem heart geometry
  const p = [
    0, 0.6, 0.2,     // 0 top mid
    -0.5, 0.5, 0.1,  // 1 left lobe
    0.5, 0.5, 0.1,   // 2 right lobe
    -0.6, 0.1, 0.15, // 3 left outer
    0.6, 0.1, 0.15,  // 4 right outer
    0, -0.7, 0.2,    // 5 bottom tip
    0, 0.2, 0.4,     // 6 center front apex
    0, 0.2, -0.4,    // 7 center back apex
  ];
  const idx = [
    // Front facets
    0, 1, 6,
    0, 6, 2,
    1, 3, 6,
    2, 6, 4,
    3, 5, 6,
    4, 6, 5,
    // Back facets
    0, 7, 1,
    0, 2, 7,
    1, 7, 3,
    2, 4, 7,
    3, 7, 5,
    4, 5, 7,
  ];

  addPrimitiveToDoc(doc, scene, 'HeartGem', p, idx, [0.95, 0.28, 0.55], 0.1, 0.3);
  await doc.transform(center(), prune(), dedup(), weld());
  return await io.writeBinary(doc);
}

/**
 * Builds Origami Crane / Cosmic Star keepsake.
 */
async function buildOrigamiCrane() {
  const doc = new Document();
  const scene = doc.createScene('Scene');

  const p = [
    0, 0.6, 0,        // 0 top peak
    -0.8, 0.1, 0,     // 1 left wing tip
    0.8, 0.1, 0,      // 2 right wing tip
    0, 0, 0.7,        // 3 front beak
    0, -0.1, -0.7,    // 4 tail tip
    0, -0.5, 0,       // 5 bottom apex
  ];
  const idx = [
    0, 1, 3,
    0, 3, 2,
    0, 2, 4,
    0, 4, 1,
    5, 3, 1,
    5, 2, 3,
    5, 4, 2,
    5, 1, 4,
  ];

  addPrimitiveToDoc(doc, scene, 'OrigamiCrane', p, idx, [0.3, 0.88, 0.85], 0.2, 0.4);
  await doc.transform(center(), prune(), dedup(), weld());
  return await io.writeBinary(doc);
}

/**
 * Builds Memory Capsule keepsake.
 */
async function buildMemoryCapsule() {
  const doc = new Document();
  const scene = doc.createScene('Scene');

  const core = createSphereData(0.38, 16, 12, [0, 0, 0]);
  addPrimitiveToDoc(doc, scene, 'Core', core.positions, core.indices, [0.98, 0.85, 0.35], 0.1, 0.6);

  const ring1 = createBoxData(1.1, 0.08, 1.1, [0, 0, 0]);
  addPrimitiveToDoc(doc, scene, 'OrbitRing1', ring1.positions, ring1.indices, [0.85, 0.85, 0.95], 0.2, 0.8);

  const ring2 = createBoxData(1.0, 1.0, 0.08, [0, 0, 0]);
  addPrimitiveToDoc(doc, scene, 'OrbitRing2', ring2.positions, ring2.indices, [0.85, 0.85, 0.95], 0.2, 0.8);

  await doc.transform(center(), prune(), dedup(), weld());
  return await io.writeBinary(doc);
}

/**
 * Main synchronizer and GLB optimizer.
 */
export async function syncKeepsakeModels(options = {}) {
  const rootDir = process.cwd();
  const rawDir = options.rawDir || path.resolve(rootDir, 'models-raw');
  const outDir = options.outDir || path.resolve(rootDir, 'public/models/keepsakes');
  const companionsDir = options.companionsDir || path.resolve(rootDir, 'public/models/companions');
  const manifestPath = options.manifestPath || path.resolve(rootDir, 'src/data/keepsakes.json');

  // Ensure directories exist
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(companionsDir, { recursive: true });
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });

  // 1. Companion glb files
  const froakiePath = path.join(companionsDir, 'froakie.glb');
  if (!fs.existsSync(froakiePath)) {
    const bytes = await buildFroakieModel();
    fs.writeFileSync(froakiePath, bytes);
  }

  const deerlingPath = path.join(companionsDir, 'deerling.glb');
  if (!fs.existsSync(deerlingPath)) {
    const bytes = await buildDeerlingModel();
    fs.writeFileSync(deerlingPath, bytes);
  }

  // 2. Scan rawDir for user keepsakes
  const rawFiles = fs.readdirSync(rawDir).filter((f) => f.endsWith('.glb') || f.endsWith('.gltf'));

  if (rawFiles.length === 0) {
    // Generate fallback sample keepsakes if raw is empty
    const samples = [
      { name: 'crystal-heart.glb', builder: buildCrystalHeart },
      { name: 'origami-crane.glb', builder: buildOrigamiCrane },
      { name: 'memory-capsule.glb', builder: buildMemoryCapsule },
    ];

    for (const sample of samples) {
      const targetPath = path.join(outDir, sample.name);
      if (!fs.existsSync(targetPath)) {
        const bytes = await sample.builder();
        fs.writeFileSync(targetPath, bytes);
      }
    }
  } else {
    // Optimize each raw model into outDir
    for (const file of rawFiles) {
      const srcPath = path.join(rawDir, file);
      const outName = path.parse(file).name + '.glb';
      const targetPath = path.join(outDir, outName);

      const doc = await io.read(srcPath);
      await doc.transform(center(), prune(), dedup(), weld());
      const bytes = await io.writeBinary(doc);
      fs.writeFileSync(targetPath, bytes);
    }
  }

  // 3. Scan outDir and generate keepsakes.json manifest
  const outFiles = fs.readdirSync(outDir).filter((f) => f.endsWith('.glb')).sort();
  const N = outFiles.length;
  const goldenRatio = (1 + Math.sqrt(5)) / 2;

  const manifest = outFiles.map((file, i) => {
    const theta = (2 * Math.PI * i) / goldenRatio;
    const phi = Math.acos(1 - (2 * (i + 0.5)) / Math.max(1, N));
    const r = 2.8 + (i % 2) * 0.5;

    const x = Number((r * Math.sin(phi) * Math.cos(theta)).toFixed(3));
    const y = Number((r * Math.sin(phi) * Math.sin(theta)).toFixed(3));
    const z = Number((r * Math.cos(phi)).toFixed(3));

    const id = path.parse(file).name;
    return {
      id,
      url: `/models/keepsakes/${file}`,
      radius: 0.55,
      initialPosition: [x, y, z],
    };
  });

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}

// Direct execution from CLI
const isDirectCall = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectCall) {
  syncKeepsakeModels()
    .then((manifest) => {
      console.log(`Successfully synchronized ${manifest.length} keepsakes and companion models.`);
    })
    .catch((err) => {
      console.error('Error synchronizing models:', err);
      process.exit(1);
    });
}
