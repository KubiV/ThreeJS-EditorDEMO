import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const LOW_RATIO = 0.12;
const MEDIUM_RATIO = 0.45;
const MAX_FALLBACK_PREVIEW_TRIANGLES = 850;
const THUMBNAIL_WIDTH = 640;
const THUMBNAIL_HEIGHT = 384;
const THUMBNAIL_RENDER_SCALE = 2;
const numberPattern = /[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi;

const emptyBounds = () => ({
  min: [Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity],
  extremeFaces: new Set(),
  minFaces: [-1, -1, -1],
  maxFaces: [-1, -1, -1]
});

function includePoint(bounds, point, faceIndex) {
  point.forEach((value, axis) => {
    if (!Number.isFinite(value)) return;
    if (value < bounds.min[axis]) {
      bounds.min[axis] = value;
      bounds.minFaces[axis] = faceIndex;
    }
    if (value > bounds.max[axis]) {
      bounds.max[axis] = value;
      bounds.maxFaces[axis] = faceIndex;
    }
  });
}

function finalizeExtremeFaces(bounds) {
  [...bounds.minFaces, ...bounds.maxFaces].filter((index) => index >= 0).forEach((index) => bounds.extremeFaces.add(index));
  return bounds;
}

function isUsableBounds(bounds) {
  return bounds.min.every(Number.isFinite) && bounds.max.every(Number.isFinite);
}

function sampleIndexes(count, ratio = 1, required = new Set()) {
  if (!count) return [];
  const requested = Math.max(1, Math.min(count, Math.round(count * ratio)));
  const indexes = new Set(required);
  for (let index = 0; index < requested; index += 1) {
    indexes.add(Math.min(count - 1, Math.floor((index + 0.5) * count / requested)));
  }
  return [...indexes].filter((index) => index >= 0 && index < count).sort((a, b) => a - b);
}

function toTriangle(points) {
  if (points.length !== 9 || points.some((value) => !Number.isFinite(value))) return null;
  return points;
}

function asciiStlTriangles(source, callback) {
  const facets = /facet\b[\s\S]*?endfacet/gi;
  let match;
  let index = 0;
  while ((match = facets.exec(source))) {
    const values = [];
    const vertices = /vertex\s+([^\r\n]+)/gi;
    let vertex;
    while ((vertex = vertices.exec(match[0])) && values.length < 9) {
      const numbers = vertex[1].match(numberPattern) || [];
      if (numbers.length >= 3) values.push(...numbers.slice(0, 3).map(Number));
    }
    callback(toTriangle(values), index);
    index += 1;
  }
  return index;
}

function isBinaryStl(buffer) {
  if (buffer.length < 84) return false;
  const count = buffer.readUInt32LE(80);
  return 84 + count * 50 === buffer.length;
}

function binaryStlTriangle(buffer, index) {
  const offset = 84 + index * 50 + 12;
  const triangle = [];
  for (let value = 0; value < 9; value += 1) triangle.push(buffer.readFloatLE(offset + value * 4));
  return toTriangle(triangle);
}

function stlScan(source, binary) {
  const bounds = emptyBounds();
  const preview = [];
  const count = binary ? source.readUInt32LE(80) : asciiStlTriangles(source, () => {});
  const previewIndexes = new Set(sampleIndexes(count, Math.min(1, MAX_FALLBACK_PREVIEW_TRIANGLES / Math.max(count, 1))));
  const inspect = (triangle, index) => {
    if (!triangle) return;
    for (let point = 0; point < 3; point += 1) includePoint(bounds, triangle.slice(point * 3, point * 3 + 3), index);
    if (previewIndexes.has(index)) preview.push(triangle);
  };
  if (binary) {
    for (let index = 0; index < count; index += 1) inspect(binaryStlTriangle(source, index), index);
  } else {
    asciiStlTriangles(source, inspect);
  }
  return { count, bounds: finalizeExtremeFaces(bounds), preview };
}

function stlNormal(triangle) {
  const ax = triangle[3] - triangle[0];
  const ay = triangle[4] - triangle[1];
  const az = triangle[5] - triangle[2];
  const bx = triangle[6] - triangle[0];
  const by = triangle[7] - triangle[1];
  const bz = triangle[8] - triangle[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

/**
 * STL stores every triangle independently. Before simplifying it, we weld
 * identical vertices into an indexed mesh. Meshoptimizer can then collapse
 * real mesh edges; sampling whole triangles would leave disconnected specks.
 */
function createWeldedStlMesh(source, binary, weldTolerance) {
  const vertices = [];
  const indices = [];
  const vertexIds = new Map();
  const addVertex = (x, y, z) => {
    // STL often duplicates shared vertices with tiny decimal differences. A
    // scale-aware weld joins those seams without merging visible features.
    const point = [Math.fround(x), Math.fround(y), Math.fround(z)];
    const key = point.map((value) => Math.round(value / weldTolerance)).join(',');
    let id = vertexIds.get(key);
    if (id === undefined) {
      id = vertices.length / 3;
      vertexIds.set(key, id);
      vertices.push(...point);
    }
    return id;
  };
  const addTriangle = (triangle) => {
    if (!triangle) return;
    const a = addVertex(triangle[0], triangle[1], triangle[2]);
    const b = addVertex(triangle[3], triangle[4], triangle[5]);
    const c = addVertex(triangle[6], triangle[7], triangle[8]);
    if (a !== b && b !== c && c !== a) indices.push(a, b, c);
  };
  if (binary) {
    const count = source.readUInt32LE(80);
    for (let index = 0; index < count; index += 1) addTriangle(binaryStlTriangle(source, index));
  } else {
    asciiStlTriangles(source, addTriangle);
  }
  return { positions: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

function preserveMeshBounds(positions, indices, bounds) {
  if (!isUsableBounds(bounds) || !indices.length) return positions;
  const usedVertices = [...new Set(indices)];
  for (let axis = 0; axis < 3; axis += 1) {
    let minVertex = usedVertices[0];
    let maxVertex = usedVertices[0];
    usedVertices.forEach((vertex) => {
      if (positions[vertex * 3 + axis] < positions[minVertex * 3 + axis]) minVertex = vertex;
      if (positions[vertex * 3 + axis] > positions[maxVertex * 3 + axis]) maxVertex = vertex;
    });
    positions[minVertex * 3 + axis] = bounds.min[axis];
    positions[maxVertex * 3 + axis] = bounds.max[axis];
  }
  return positions;
}

async function simplifyIndexedMesh(mesh, ratio, bounds) {
  const sourceCount = mesh.indices.length;
  if (sourceCount < 12) return { ...mesh, positions: mesh.positions.slice() };
  await MeshoptSimplifier.ready;
  const targetCount = Math.max(3, Math.floor(sourceCount * ratio / 3) * 3);
  const [indices] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, targetCount, 0.01, []);
  const simplifiedIndices = indices.length ? indices : mesh.indices;
  return { ...mesh, positions: preserveMeshBounds(mesh.positions.slice(), simplifiedIndices, bounds), indices: simplifiedIndices };
}

async function writeSimplifiedStl(mesh, destination) {
  const triangleCount = Math.floor(mesh.indices.length / 3);
  const output = Buffer.alloc(84 + triangleCount * 50);
  Buffer.from('MediaWiki 3D editor generated connected LOD').copy(output, 0, 0, 80);
  output.writeUInt32LE(triangleCount, 80);
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const triangle = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = mesh.indices[triangleIndex * 3 + corner] * 3;
      triangle.push(mesh.positions[vertex], mesh.positions[vertex + 1], mesh.positions[vertex + 2]);
    }
    const offset = 84 + triangleIndex * 50;
    stlNormal(triangle).forEach((value, index) => output.writeFloatLE(value, offset + index * 4));
    triangle.forEach((value, index) => output.writeFloatLE(value, offset + 12 + index * 4));
    output.writeUInt16LE(0, offset + 48);
  }
  await fs.writeFile(destination, output);
  return triangleCount;
}

function parseObjFace(line) {
  return line.trim().split(/\s+/).slice(1).map((entry) => Number(entry.split('/')[0])).filter((value) => Number.isInteger(value));
}

function parseObjFaceTokens(line) {
  return line.trim().split(/\s+/).slice(1);
}

function resolveObjVertexIndex(index, count) {
  return index < 0 ? count + index : index - 1;
}

function objScan(source) {
  const vertices = [];
  const faceLines = [];
  const lines = source.split(/\r?\n/);
  const bounds = emptyBounds();
  lines.forEach((line, lineIndex) => {
    if (/^\s*v\s+/.test(line)) {
      const values = (line.match(numberPattern) || []).slice(0, 3).map(Number);
      if (values.length === 3) {
        vertices.push(values);
        includePoint(bounds, values, -1);
      }
    }
    if (/^\s*f\s+/.test(line)) faceLines.push({ lineIndex, vertices: parseObjFace(line), tokens: parseObjFaceTokens(line) });
  });
  const extremes = new Set();
  const extremeCoordinates = new Set([...bounds.min, ...bounds.max]);
  vertices.forEach((vertex, index) => {
    if (vertex.some((value) => extremeCoordinates.has(value))) extremes.add(index + 1);
  });
  faceLines.forEach((face, index) => {
    if (face.vertices.some((vertex) => extremes.has(vertex))) bounds.extremeFaces.add(index);
  });
  const preview = [];
  const previewIndexes = new Set(sampleIndexes(faceLines.length, Math.min(1, MAX_FALLBACK_PREVIEW_TRIANGLES / Math.max(faceLines.length, 1))));
  previewIndexes.forEach((index) => {
    const face = faceLines[index];
    if (!face || face.vertices.length < 3) return;
    for (let vertex = 1; vertex < face.vertices.length - 1; vertex += 1) {
      const triangle = [vertices[face.vertices[0] - 1], vertices[face.vertices[vertex] - 1], vertices[face.vertices[vertex + 1] - 1]].flat();
      if (triangle.length === 9 && triangle.every(Number.isFinite)) preview.push(triangle);
    }
  });
  return { lines, vertices, faceLines, bounds, preview };
}

function createIndexedObjMesh(scan) {
  const indices = [];
  const tokens = new Array(scan.vertices.length);
  scan.faceLines.forEach((face) => {
    const vertices = face.vertices.map((index) => resolveObjVertexIndex(index, scan.vertices.length));
    if (vertices.length < 3 || vertices.some((index) => index < 0 || index >= scan.vertices.length)) return;
    vertices.forEach((vertex, index) => { tokens[vertex] ||= face.tokens[index] || String(vertex + 1); });
    for (let vertex = 1; vertex < vertices.length - 1; vertex += 1) indices.push(vertices[0], vertices[vertex], vertices[vertex + 1]);
  });
  return { positions: new Float32Array(scan.vertices.flat()), indices: new Uint32Array(indices), tokens };
}

async function writeSimplifiedObj(scan, mesh, destination) {
  const firstMaterial = scan.lines.find((line) => /^\s*usemtl\s+/.test(line));
  const header = scan.lines.filter((line) => !/^\s*(?:f|usemtl)\s+/.test(line));
  const faces = [];
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const corners = [mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2]];
    if (corners.some((vertex) => !Number.isInteger(vertex))) continue;
    faces.push(`f ${corners.map((vertex) => mesh.tokens[vertex] || String(vertex + 1)).join(' ')}`);
  }
  await fs.writeFile(destination, `${header.join('\n')}\n${firstMaterial ? `${firstMaterial}\n` : ''}${faces.join('\n')}\n`, 'utf8');
  return faces.length;
}

function gltfScan(document, { includeAllTriangles = false } = {}) {
  const bounds = emptyBounds();
  const preview = [];
  let count = 0;
  const root = document.getRoot();
  const instances = [];
  const scene = root.listScenes()[0];
  if (scene) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (mesh) instances.push({ mesh, matrix: node.getWorldMatrix() });
    });
  } else {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    root.listMeshes().forEach((mesh) => instances.push({ mesh, matrix: identity }));
  }
  const transformPoint = (positions, index, matrix) => {
    const x = positions[index * 3];
    const y = positions[index * 3 + 1];
    const z = positions[index * 3 + 2];
    const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] || 1;
    return [
      (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
      (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
      (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w
    ];
  };
  instances.forEach(({ mesh, matrix }) => mesh.listPrimitives().forEach((primitive) => {
    const position = primitive.getAttribute('POSITION');
    if (!position) return;
    const positions = position.getArray();
    const indices = primitive.getIndices()?.getArray();
    const vertexCount = positions.length / 3;
    const triangleCount = Math.floor((indices ? indices.length : vertexCount) / 3);
    count += triangleCount;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      includePoint(bounds, transformPoint(positions, vertex, matrix), -1);
    }
    const sample = includeAllTriangles
      ? 1
      : Math.max(1, Math.ceil(triangleCount / Math.max(1, Math.floor(MAX_FALLBACK_PREVIEW_TRIANGLES / Math.max(instances.length, 1)))));
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += sample) {
      const triangle = [];
      for (let corner = 0; corner < 3; corner += 1) {
        const index = indices ? indices[triangleIndex * 3 + corner] : triangleIndex * 3 + corner;
        triangle.push(...transformPoint(positions, index, matrix));
      }
      if (triangle.every(Number.isFinite)) preview.push(triangle);
    }
  }));
  return { count, bounds, preview };
}

function projectPoint(point) {
  return [point[0] * 0.82 - point[2] * 0.82, point[1] - (point[0] + point[2]) * 0.34, point[0] * 0.27 + point[1] * 0.15 + point[2] * 0.27];
}

function finiteVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every((coordinate) => Number.isFinite(Number(coordinate)))
    ? value.map(Number)
    : undefined;
}

function finiteQuaternion(value) {
  return Array.isArray(value) && value.length === 4 && value.every((coordinate) => Number.isFinite(Number(coordinate)))
    && value.some((coordinate) => Number(coordinate) !== 0)
    ? value.map(Number)
    : undefined;
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return length > 1e-9 ? vector.map((value) => value / length) : undefined;
}

function subtract(left, right) {
  return left.map((value, axis) => value - right[axis]);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ];
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function rotatePoint(point, quaternion) {
  if (!quaternion) return point;
  const [x, y, z, w] = quaternion;
  const [px, py, pz] = point;
  const ix = w * px + y * pz - z * py;
  const iy = w * py + z * px - x * pz;
  const iz = w * pz + x * py - y * px;
  const iw = -x * px - y * py - z * pz;
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x
  ];
}

function thumbnailProjector({ camera, orientation } = {}) {
  const quaternion = finiteQuaternion(orientation?.quaternion || orientation);
  const position = finiteVector(camera?.position);
  const target = finiteVector(camera?.target);
  if (!position || !target) {
    return (point) => projectPoint(rotatePoint(point, quaternion));
  }
  const towardCamera = normalize(subtract(position, target));
  if (!towardCamera) return (point) => projectPoint(rotatePoint(point, quaternion));
  // Preserve an upright image whenever possible. For top/bottom views the
  // ordinary Y-up vector is parallel to the camera direction, so use Z-up.
  const right = normalize(cross([0, 1, 0], towardCamera)) || normalize(cross([0, 0, 1], towardCamera));
  const up = right && normalize(cross(towardCamera, right));
  if (!right || !up) return (point) => projectPoint(rotatePoint(point, quaternion));
  return (point) => {
    const rotated = rotatePoint(point, quaternion);
    return [dot(rotated, right), dot(rotated, up), dot(rotated, towardCamera)];
  };
}

function thumbnailTriangleCount(source) {
  if (Array.isArray(source)) return source.length;
  return Math.floor((source?.indices?.length || 0) / 3);
}

function forEachThumbnailTriangle(source, callback) {
  if (Array.isArray(source)) {
    source.forEach(callback);
    return;
  }
  const positions = source?.positions;
  const indices = source?.indices;
  if (!positions || !indices) return;
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = indices[index + corner] * 3;
      triangle.push(positions[vertex], positions[vertex + 1], positions[vertex + 2]);
    }
    if (triangle.every(Number.isFinite)) callback(triangle);
  }
}

async function renderThumbnail(source, bounds, view = {}) {
  const width = THUMBNAIL_WIDTH;
  const height = THUMBNAIL_HEIGHT;
  if (!thumbnailTriangleCount(source) || !isUsableBounds(bounds)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Náhled 3D modelu"/>`;
  }
  const rasterWidth = width * THUMBNAIL_RENDER_SCALE;
  const rasterHeight = height * THUMBNAIL_RENDER_SCALE;
  const project = thumbnailProjector(view);
  const orientation = finiteQuaternion(view.orientation?.quaternion || view.orientation);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  forEachThumbnailTriangle(source, (triangle) => {
    for (let offset = 0; offset < 9; offset += 3) {
      const [x, y] = project(triangle.slice(offset, offset + 3));
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  });
  const padding = 28 * THUMBNAIL_RENDER_SCALE;
  const scale = Math.min(
    (rasterWidth - padding) / Math.max(maxX - minX, 1e-9),
    (rasterHeight - padding) / Math.max(maxY - minY, 1e-9)
  );
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const pixels = Buffer.alloc(rasterWidth * rasterHeight * 4);
  const depthBuffer = new Float32Array(rasterWidth * rasterHeight);
  depthBuffer.fill(-Infinity);

  forEachThumbnailTriangle(source, (triangle) => {
    const points = [0, 3, 6].map((offset) => {
      const [x, y, depth] = project(triangle.slice(offset, offset + 3));
      return [rasterWidth / 2 + (x - centerX) * scale, rasterHeight / 2 - (y - centerY) * scale, depth];
    });
    const denominator = (points[1][1] - points[2][1]) * (points[0][0] - points[2][0])
      + (points[2][0] - points[1][0]) * (points[0][1] - points[2][1]);
    if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-9) return;
    const startX = Math.max(0, Math.floor(Math.min(points[0][0], points[1][0], points[2][0])));
    const endX = Math.min(rasterWidth - 1, Math.ceil(Math.max(points[0][0], points[1][0], points[2][0])));
    const startY = Math.max(0, Math.floor(Math.min(points[0][1], points[1][1], points[2][1])));
    const endY = Math.min(rasterHeight - 1, Math.ceil(Math.max(points[0][1], points[1][1], points[2][1])));
    const normal = stlNormal([0, 3, 6].flatMap((offset) => rotatePoint(triangle.slice(offset, offset + 3), orientation)));
    const light = Math.max(0.25, normal[0] * -0.35 + normal[1] * 0.72 + normal[2] * 0.6);
    const shade = Math.round(83 + Math.min(light, 1.45) * 67);
    const red = shade;
    const green = Math.min(shade + 36, 210);
    const blue = Math.min(shade + 52, 224);
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const sampleX = x + 0.5;
        const sampleY = y + 0.5;
        const a = ((points[1][1] - points[2][1]) * (sampleX - points[2][0])
          + (points[2][0] - points[1][0]) * (sampleY - points[2][1])) / denominator;
        const b = ((points[2][1] - points[0][1]) * (sampleX - points[2][0])
          + (points[0][0] - points[2][0]) * (sampleY - points[2][1])) / denominator;
        const c = 1 - a - b;
        if (a < -1e-7 || b < -1e-7 || c < -1e-7) continue;
        const depth = a * points[0][2] + b * points[1][2] + c * points[2][2];
        const pixelIndex = y * rasterWidth + x;
        if (depth <= depthBuffer[pixelIndex]) continue;
        depthBuffer[pixelIndex] = depth;
        const offset = pixelIndex * 4;
        pixels[offset] = red;
        pixels[offset + 1] = green;
        pixels[offset + 2] = blue;
        pixels[offset + 3] = 255;
      }
    }
  });

  const png = await sharp(pixels, { raw: { width: rasterWidth, height: rasterHeight, channels: 4 } })
    .resize(width, height, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Náhled 3D modelu"><image width="${width}" height="${height}" href="data:image/png;base64,${png.toString('base64')}"/></svg>`;
}

async function statInfo(filePath, triangles) {
  const { size } = await fs.stat(filePath);
  return { bytes: size, ...(Number.isFinite(triangles) ? { triangles } : {}) };
}

async function thumbnailSourceFromModel({ sourcePath, originalFile }) {
  const extension = path.extname(originalFile).toLowerCase();
  if (extension === '.stl') {
    const source = await fs.readFile(sourcePath);
    const binary = isBinaryStl(source);
    const scan = stlScan(binary ? source : source.toString('utf8'), binary);
    const largestDimension = Math.max(...scan.bounds.max.map((value, axis) => value - scan.bounds.min[axis]), 1);
    return {
      source: createWeldedStlMesh(binary ? source : source.toString('utf8'), binary, largestDimension * 1e-7),
      bounds: scan.bounds
    };
  }
  if (extension === '.obj') {
    const scan = objScan(await fs.readFile(sourcePath, 'utf8'));
    return { source: createIndexedObjMesh(scan), bounds: scan.bounds };
  }
  if (extension === '.glb' || extension === '.gltf') {
    const document = await new NodeIO().read(sourcePath);
    const scan = gltfScan(document, { includeAllTriangles: true });
    return { source: scan.preview, bounds: scan.bounds };
  }
  throw new Error('Náhled lze vytvořit pouze pro formát STL, OBJ, GLTF nebo GLB.');
}

/** Re-renders an existing thumbnail without touching the uploaded model or its LOD variants. */
export async function regenerateModelThumbnail({ sourcePath, outputPath, originalFile, camera, orientation }) {
  const { source, bounds } = await thumbnailSourceFromModel({ sourcePath, originalFile });
  await fs.writeFile(outputPath, await renderThumbnail(source, bounds, { camera, orientation }), 'utf8');
}

/**
 * Creates upload-time LOD files and an SVG-wrapped raster thumbnail rendered
 * from the original geometry. LOD simplification keeps model coordinates intact,
 * so annotations and stored camera positions remain reusable across variants.
 */
export async function createModelArtifacts({ sourcePath, outputDirectory, originalFile }) {
  const extension = path.extname(originalFile).toLowerCase();
  const stem = path.basename(originalFile, extension);
  const output = {
    variantFiles: { original: originalFile },
    variantInfo: {},
    thumbnailFile: 'thumbnail.svg',
    generation: { status: 'ready' }
  };
  let scan = { count: undefined, bounds: emptyBounds(), preview: [] };
  let thumbnailSource;

  try {
    if (extension === '.stl') {
      const source = await fs.readFile(sourcePath);
      const binary = isBinaryStl(source);
      scan = stlScan(binary ? source : source.toString('utf8'), binary);
      const small = `${stem}.small.stl`;
      const medium = `${stem}.medium.stl`;
      const largestDimension = Math.max(...scan.bounds.max.map((value, axis) => value - scan.bounds.min[axis]), 1);
      const weldTolerance = largestDimension * 1e-7;
      const mesh = createWeldedStlMesh(binary ? source : source.toString('utf8'), binary, weldTolerance);
      thumbnailSource = mesh;
      const [smallMesh, mediumMesh] = await Promise.all([
        simplifyIndexedMesh(mesh, LOW_RATIO, scan.bounds),
        simplifyIndexedMesh(mesh, MEDIUM_RATIO, scan.bounds)
      ]);
      const [smallTriangles, mediumTriangles] = await Promise.all([
        writeSimplifiedStl(smallMesh, path.join(outputDirectory, small)),
        writeSimplifiedStl(mediumMesh, path.join(outputDirectory, medium))
      ]);
      output.variantFiles = { original: originalFile, medium, small };
      output.variantInfo = {
        original: await statInfo(sourcePath, scan.count),
        medium: await statInfo(path.join(outputDirectory, medium), mediumTriangles),
        small: await statInfo(path.join(outputDirectory, small), smallTriangles)
      };
    } else if (extension === '.obj') {
      const source = await fs.readFile(sourcePath, 'utf8');
      scan = objScan(source);
      const small = `${stem}.small.obj`;
      const medium = `${stem}.medium.obj`;
      const mesh = createIndexedObjMesh(scan);
      thumbnailSource = mesh;
      const [smallMesh, mediumMesh] = await Promise.all([
        simplifyIndexedMesh(mesh, LOW_RATIO, scan.bounds),
        simplifyIndexedMesh(mesh, MEDIUM_RATIO, scan.bounds)
      ]);
      const [smallTriangles, mediumTriangles] = await Promise.all([
        writeSimplifiedObj(scan, smallMesh, path.join(outputDirectory, small)),
        writeSimplifiedObj(scan, mediumMesh, path.join(outputDirectory, medium))
      ]);
      output.variantFiles = { original: originalFile, medium, small };
      output.variantInfo = {
        original: await statInfo(sourcePath, scan.faceLines.length),
        medium: await statInfo(path.join(outputDirectory, medium), mediumTriangles),
        small: await statInfo(path.join(outputDirectory, small), smallTriangles)
      };
    } else if (extension === '.glb' || extension === '.gltf') {
      const io = new NodeIO();
      const previewDocument = await io.read(sourcePath);
      scan = gltfScan(previewDocument, { includeAllTriangles: true });
      thumbnailSource = scan.preview;
      const small = `${stem}.small.glb`;
      const medium = `${stem}.medium.glb`;
      for (const [file, ratio] of [[small, LOW_RATIO], [medium, MEDIUM_RATIO]]) {
        const document = await io.read(sourcePath);
        await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.005 }));
        await io.write(path.join(outputDirectory, file), document);
      }
      output.variantFiles = { original: originalFile, medium, small };
      output.variantInfo = {
        original: await statInfo(sourcePath, scan.count),
        medium: await statInfo(path.join(outputDirectory, medium)),
        small: await statInfo(path.join(outputDirectory, small))
      };
    } else {
      output.generation = { status: 'unsupported', message: 'Pro tento formát nelze vytvořit varianty.' };
    }
  } catch (error) {
    output.generation = { status: 'partial', message: `Varianty se nepodařilo vytvořit: ${error.message}` };
    output.variantFiles = { original: originalFile };
    output.variantInfo = { original: await statInfo(sourcePath, scan.count) };
  }

  await fs.writeFile(path.join(outputDirectory, output.thumbnailFile), await renderThumbnail(thumbnailSource || scan.preview, scan.bounds), 'utf8');
  return output;
}
