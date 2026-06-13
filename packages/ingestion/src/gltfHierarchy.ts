import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { createNode, type Command, type SceneNode, type Transform } from '@dioramai/core';

type GltfNode = {
  name?: string;
  children?: number[];
  mesh?: number;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
};

type GltfDocument = {
  asset?: {
    version?: string;
  };
  scene?: number;
  scenes?: Array<{
    name?: string;
    nodes?: number[];
  }>;
  nodes?: GltfNode[];
  meshes?: unknown[];
};

export type GltfHierarchyOptions = {
  assetId: string;
  assetUri?: string;
  parentNodeId: string;
  maxNodes?: number;
};

export type GltfHierarchyPlan = {
  commands: Command[];
  warnings: string[];
  nodeCount: number;
};

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const DEFAULT_MAX_HIERARCHY_NODES = 1000;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toVec3 = (value: unknown, fallback: Transform['position']): Transform['position'] => {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  const vec = value.slice(0, 3);
  if (!vec.every(isFiniteNumber)) return fallback;
  return [vec[0], vec[1], vec[2]];
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const quaternionToEulerXyz = (value: unknown): Transform['rotation'] => {
  if (!Array.isArray(value) || value.length < 4 || !value.slice(0, 4).every(isFiniteNumber)) {
    return [0, 0, 0];
  }

  let [x, y, z, w] = value.slice(0, 4) as [number, number, number, number];
  const length = Math.hypot(x, y, z, w);
  if (length === 0) return [0, 0, 0];
  x /= length;
  y /= length;
  z /= length;
  w /= length;

  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinrCosp, cosrCosp);

  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1
    ? Math.sign(sinp) * Math.PI / 2
    : Math.asin(sinp);

  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(sinyCosp, cosyCosp);

  return [roll, pitch, yaw];
};

const matrixToTransform = (
  matrix: unknown,
  warnings: string[],
  nodeLabel: string,
): Transform | null => {
  if (!Array.isArray(matrix) || matrix.length !== 16 || !matrix.every(isFiniteNumber)) {
    warnings.push(`glTF node ${nodeLabel} has an invalid matrix transform; using identity transform.`);
    return null;
  }

  const m = matrix as number[];
  const sx = Math.hypot(m[0] ?? 0, m[1] ?? 0, m[2] ?? 0);
  const sy = Math.hypot(m[4] ?? 0, m[5] ?? 0, m[6] ?? 0);
  const sz = Math.hypot(m[8] ?? 0, m[9] ?? 0, m[10] ?? 0);
  const safeSx = sx === 0 ? 1 : sx;
  const safeSy = sy === 0 ? 1 : sy;
  const safeSz = sz === 0 ? 1 : sz;

  const m11 = (m[0] ?? 1) / safeSx;
  const m12 = (m[4] ?? 0) / safeSy;
  const m13 = (m[8] ?? 0) / safeSz;
  const m22 = (m[5] ?? 1) / safeSy;
  const m23 = (m[9] ?? 0) / safeSz;
  const m32 = (m[6] ?? 0) / safeSy;
  const m33 = (m[10] ?? 1) / safeSz;

  const y = Math.asin(clamp(m13, -1, 1));
  const [x, z] = Math.abs(m13) < 0.9999999
    ? [Math.atan2(-m23, m33), Math.atan2(-m12, m11)]
    : [Math.atan2(m32, m22), 0];

  return {
    position: [m[12] ?? 0, m[13] ?? 0, m[14] ?? 0],
    rotation: [x, y, z],
    scale: [sx, sy, sz],
  };
};

const transformForNode = (
  node: GltfNode,
  warnings: string[],
  nodeLabel: string,
): Transform => {
  const matrixTransform = node.matrix !== undefined
    ? matrixToTransform(node.matrix, warnings, nodeLabel)
    : null;
  if (matrixTransform) return matrixTransform;
  return {
    position: toVec3(node.translation, [0, 0, 0]),
    rotation: quaternionToEulerXyz(node.rotation),
    scale: toVec3(node.scale, [1, 1, 1]),
  };
};

const parseGlbJson = (bytes: Buffer): GltfDocument => {
  if (bytes.byteLength < 20) throw new Error('GLB is too small to contain a JSON chunk.');
  const magic = bytes.readUInt32LE(0);
  if (magic !== GLB_MAGIC) throw new Error('Invalid GLB magic header.');
  const version = bytes.readUInt32LE(4);
  if (version !== 2) throw new Error(`Unsupported GLB version ${version}; expected 2.`);
  const declaredLength = bytes.readUInt32LE(8);
  const totalLength = Math.min(declaredLength, bytes.byteLength);

  let offset = 12;
  while (offset + 8 <= totalLength) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > bytes.byteLength) throw new Error('GLB chunk length exceeds file size.');
    if (chunkType === GLB_JSON_CHUNK) {
      const json = bytes.subarray(chunkStart, chunkEnd).toString('utf8').replace(/\0+$/g, '').trim();
      return JSON.parse(json) as GltfDocument;
    }
    offset = chunkEnd;
  }

  throw new Error('GLB does not contain a JSON scene chunk.');
};

const readGltfDocument = async (localPath: string): Promise<GltfDocument> => {
  const bytes = await readFile(localPath);
  const ext = extname(localPath).toLowerCase();
  if (ext === '.glb') return parseGlbJson(bytes);
  if (ext === '.gltf') return JSON.parse(bytes.toString('utf8')) as GltfDocument;
  throw new Error('Expected a .glb or .gltf file for hierarchy introspection.');
};

const childIndexSet = (nodes: GltfNode[]): Set<number> => {
  const out = new Set<number>();
  for (const node of nodes) {
    for (const child of node.children ?? []) {
      if (Number.isInteger(child)) out.add(child);
    }
  }
  return out;
};

const sceneRootIndices = (gltf: GltfDocument, nodes: GltfNode[]): number[] => {
  const sceneIndex = Number.isInteger(gltf.scene) ? gltf.scene as number : 0;
  const sceneRoots = gltf.scenes?.[sceneIndex]?.nodes;
  if (Array.isArray(sceneRoots) && sceneRoots.length > 0) {
    return sceneRoots.filter((index) => Number.isInteger(index) && nodes[index] !== undefined);
  }

  const children = childIndexSet(nodes);
  const roots = nodes
    .map((_node, index) => index)
    .filter((index) => !children.has(index));
  return roots.length > 0 ? roots : nodes.map((_node, index) => index);
};

const sanitizeIdPart = (value: string): string => {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return sanitized.length > 0 ? sanitized : 'node';
};

const uniqueNodeId = (
  parentNodeId: string,
  gltfNodeIndex: number,
  name: string,
  used: Set<string>,
): string => {
  const base = `${parentNodeId}-gltf-${gltfNodeIndex}-${sanitizeIdPart(name)}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
};

const validChildrenForNode = (
  nodes: GltfNode[],
  node: GltfNode,
  nodeLabel: string,
  warnings: string[],
): number[] => {
  const out: number[] = [];
  for (const child of node.children ?? []) {
    if (!Number.isInteger(child) || nodes[child] === undefined) {
      warnings.push(`glTF node ${nodeLabel} references missing child ${String(child)}; skipping it.`);
      continue;
    }
    out.push(child);
  }
  return out;
};

export const planGltfHierarchyFromFile = async (
  localPath: string,
  options: GltfHierarchyOptions,
): Promise<GltfHierarchyPlan> => {
  const warnings: string[] = [];
  const gltf = await readGltfDocument(localPath);
  const nodes = gltf.nodes ?? [];
  if (nodes.length === 0) {
    return {
      commands: [],
      warnings: ['GLB hierarchy introspection found no glTF nodes.'],
      nodeCount: 0,
    };
  }

  const commands: Command[] = [];
  const usedIds = new Set<string>([options.parentNodeId]);
  const visited = new Set<number>();
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_HIERARCHY_NODES;
  let limitWarningEmitted = false;

  const visit = (
    gltfNodeIndex: number,
    parentId: string,
    gltfPath: string,
    stack: Set<number>,
  ): void => {
    if (commands.length >= maxNodes) {
      if (!limitWarningEmitted) {
        warnings.push(`GLB hierarchy introspection stopped after ${maxNodes} nodes.`);
        limitWarningEmitted = true;
      }
      return;
    }
    if (stack.has(gltfNodeIndex)) {
      warnings.push(`glTF hierarchy contains a cycle at node ${gltfNodeIndex}; skipping recursive child.`);
      return;
    }
    if (visited.has(gltfNodeIndex)) {
      warnings.push(`glTF node ${gltfNodeIndex} is referenced more than once; keeping the first occurrence.`);
      return;
    }

    const gltfNode = nodes[gltfNodeIndex];
    if (!gltfNode) {
      warnings.push(`glTF node ${gltfNodeIndex} is missing; skipping it.`);
      return;
    }

    const name = gltfNode.name?.trim() || `glTF Node ${gltfNodeIndex}`;
    const nodeId = uniqueNodeId(options.parentNodeId, gltfNodeIndex, name, usedIds);
    const children = validChildrenForNode(nodes, gltfNode, `${gltfNodeIndex} (${name})`, warnings);
    const type: SceneNode['type'] = gltfNode.mesh !== undefined
      ? 'mesh'
      : children.length > 0
        ? 'group'
        : 'empty';

    commands.push({
      type: 'ADD_NODE',
      parentId,
      node: createNode({
        id: nodeId,
        name,
        type,
        transform: transformForNode(gltfNode, warnings, `${gltfNodeIndex} (${name})`),
        metadata: {
          source: 'gltf',
          assetId: options.assetId,
          ...(options.assetUri !== undefined ? { assetUri: options.assetUri } : {}),
          gltfNodeIndex,
          gltfNodeName: name,
          gltfPath,
          renderMode: 'gltf-inspect-only',
          transformSource: gltfNode.matrix !== undefined ? 'matrix' : 'trs',
          ...(gltfNode.mesh !== undefined ? { gltfMeshIndex: gltfNode.mesh } : {}),
        },
        semantics: {
          source: 'import',
          tags: gltfNode.mesh !== undefined ? ['gltf-mesh'] : ['gltf-node'],
        },
      }),
    });

    visited.add(gltfNodeIndex);
    const nextStack = new Set(stack);
    nextStack.add(gltfNodeIndex);
    children.forEach((childIndex, childSlot) => {
      visit(childIndex, nodeId, `${gltfPath}/${childSlot}`, nextStack);
    });
  };

  sceneRootIndices(gltf, nodes).forEach((rootIndex, rootSlot) => {
    visit(rootIndex, options.parentNodeId, `scene:${gltf.scene ?? 0}/${rootSlot}`, new Set());
  });

  return {
    commands,
    warnings,
    nodeCount: commands.length,
  };
};
