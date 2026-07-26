import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const LOW_RATIO = 0.12;
const MEDIUM_RATIO = 0.45;
const MAX_FALLBACK_PREVIEW_TRIANGLES = 850;
const MAX_THUMBNAIL_TRIANGLES = 2200;
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

function trianglesFromIndexedMesh(mesh) {
  const triangles = [];
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const triangle = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = mesh.indices[index + corner] * 3;
      triangle.push(mesh.positions[vertex], mesh.positions[vertex + 1], mesh.positions[vertex + 2]);
    }
    if (triangle.every(Number.isFinite)) triangles.push(triangle);
  }
  return triangles;
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
  document.getRoot().listMeshes().forEach((mesh) => mesh.listPrimitives().forEach((primitive) => {
    const position = primitive.getAttribute('POSITION');
    if (!position) return;
    const positions = position.getArray();
    const indices = primitive.getIndices()?.getArray();
    const vertexCount = positions.length / 3;
    const triangleCount = Math.floor((indices ? indices.length : vertexCount) / 3);
    const start = count;
    count += triangleCount;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      includePoint(bounds, [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]], -1);
    }
    const sample = includeAllTriangles
      ? 1
      : Math.max(1, Math.ceil(triangleCount / Math.max(1, Math.floor(MAX_FALLBACK_PREVIEW_TRIANGLES / Math.max(document.getRoot().listMeshes().length, 1)))));
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += sample) {
      const triangle = [];
      for (let corner = 0; corner < 3; corner += 1) {
        const index = indices ? indices[triangleIndex * 3 + corner] : triangleIndex * 3 + corner;
        triangle.push(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
      }
      if (triangle.every(Number.isFinite)) preview.push(triangle);
    }
    // The thumbnail does not need exact extreme-face membership. glTF simplification
    // preserves its original scene bounds, including node transforms.
    if (start < 0) bounds.extremeFaces.add(start);
  }));
  return { count, bounds, preview };
}

function projectPoint(point) {
  return [point[0] * 0.82 - point[2] * 0.82, point[1] - (point[0] + point[2]) * 0.34, point[0] * 0.27 + point[1] * 0.15 + point[2] * 0.27];
}

function renderThumbnail(triangles, bounds) {
  const width = 640;
  const height = 384;
  if (!triangles.length || !isUsableBounds(bounds)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Náhled 3D modelu"/>`;
  }
  const projected = triangles.map((triangle) => {
    const points = [0, 3, 6].map((offset) => projectPoint(triangle.slice(offset, offset + 3)));
    const normal = stlNormal(triangle);
    const light = Math.max(0.25, normal[0] * -0.35 + normal[1] * 0.72 + normal[2] * 0.6);
    return { depth: points.reduce((sum, point) => sum + point[2], 0) / 3, light, points };
  });
  const allPoints = projected.flatMap((triangle) => triangle.points);
  const minX = Math.min(...allPoints.map((point) => point[0]));
  const maxX = Math.max(...allPoints.map((point) => point[0]));
  const minY = Math.min(...allPoints.map((point) => point[1]));
  const maxY = Math.max(...allPoints.map((point) => point[1]));
  const scale = Math.min((width - 28) / Math.max(maxX - minX, 1e-9), (height - 28) / Math.max(maxY - minY, 1e-9));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  projected.forEach((triangle) => {
    triangle.points = triangle.points.map(([x, y]) => [width / 2 + (x - centerX) * scale, height / 2 - (y - centerY) * scale]);
  });
  projected.sort((a, b) => a.depth - b.depth);
  const polygons = projected.map(({ points, light }) => {
    const shade = Math.round(83 + Math.min(light, 1.45) * 67);
    return `<path d="M${points.map((point) => point.map((value) => value.toFixed(1)).join(',')).join('L')}Z" fill="rgb(${shade},${Math.min(shade + 36, 210)},${Math.min(shade + 52, 224)})" stroke="#52798b" stroke-opacity=".16" stroke-width=".45"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Náhled 3D modelu">${polygons}</svg>`;
}

async function statInfo(filePath, triangles) {
  const { size } = await fs.stat(filePath);
  return { bytes: size, ...(Number.isFinite(triangles) ? { triangles } : {}) };
}

/**
 * Creates upload-time LOD files and an SVG thumbnail. The simplification keeps
 * model coordinates intact, so annotations and stored camera positions remain
 * reusable across Small, Medium and Original.
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
  let thumbnailTriangles;

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
      const thumbnailRatio = Math.min(1, MAX_THUMBNAIL_TRIANGLES / Math.max(mesh.indices.length / 3, 1));
      const [smallMesh, mediumMesh, thumbnailMesh] = await Promise.all([
        simplifyIndexedMesh(mesh, LOW_RATIO, scan.bounds),
        simplifyIndexedMesh(mesh, MEDIUM_RATIO, scan.bounds),
        simplifyIndexedMesh(mesh, thumbnailRatio, scan.bounds)
      ]);
      thumbnailTriangles = trianglesFromIndexedMesh(thumbnailMesh);
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
      const thumbnailRatio = Math.min(1, MAX_THUMBNAIL_TRIANGLES / Math.max(mesh.indices.length / 3, 1));
      const [smallMesh, mediumMesh, thumbnailMesh] = await Promise.all([
        simplifyIndexedMesh(mesh, LOW_RATIO, scan.bounds),
        simplifyIndexedMesh(mesh, MEDIUM_RATIO, scan.bounds),
        simplifyIndexedMesh(mesh, thumbnailRatio, scan.bounds)
      ]);
      thumbnailTriangles = trianglesFromIndexedMesh(thumbnailMesh);
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
      scan = gltfScan(previewDocument);
      const thumbnailRatio = Math.min(1, MAX_THUMBNAIL_TRIANGLES / Math.max(scan.count, 1));
      const thumbnailDocument = await io.read(sourcePath);
      await thumbnailDocument.transform(simplify({ simplifier: MeshoptSimplifier, ratio: thumbnailRatio, error: 0.005 }));
      thumbnailTriangles = gltfScan(thumbnailDocument, { includeAllTriangles: true }).preview;
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

  await fs.writeFile(path.join(outputDirectory, output.thumbnailFile), renderThumbnail(thumbnailTriangles || scan.preview, scan.bounds), 'utf8');
  return output;
}
