import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Command, SceneNode } from '@dioramai/core';
import { planGltfHierarchyFromFile } from './gltfHierarchy';

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'dioramai-gltf-lights-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const writeGltf = async (name: string, gltf: Record<string, unknown>): Promise<string> => {
  const path = join(workDir, name);
  await writeFile(path, JSON.stringify(gltf), 'utf8');
  return path;
};

const addedNodes = (commands: Command[]): SceneNode[] =>
  commands
    .filter((command): command is Extract<Command, { type: 'ADD_NODE' }> => command.type === 'ADD_NODE')
    .map((command) => command.node);

describe('planGltfHierarchyFromFile KHR_lights_punctual', () => {
  it('imports directional, point, and spot punctual lights as light nodes', async () => {
    const path = await writeGltf('lights.gltf', {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0, 1, 2] }],
      nodes: [
        {
          name: 'Sun',
          translation: [0, 5, 0],
          extensions: { KHR_lights_punctual: { light: 0 } },
        },
        {
          name: 'Bulb',
          translation: [1, 2, 3],
          extensions: { KHR_lights_punctual: { light: 1 } },
        },
        {
          name: 'Spot',
          translation: [0, 4, 0],
          extensions: { KHR_lights_punctual: { light: 2 } },
        },
      ],
      extensions: {
        KHR_lights_punctual: {
          lights: [
            { type: 'directional', color: [1, 1, 1], intensity: 3 },
            { type: 'point', color: [1, 0, 0], intensity: 10, range: 12 },
            {
              type: 'spot',
              color: [0, 1, 0],
              intensity: 5,
              range: 8,
              spot: { innerConeAngle: 0.1, outerConeAngle: 0.5 },
            },
          ],
        },
      },
    });

    const plan = await planGltfHierarchyFromFile(path, {
      assetId: 'asset-lights',
      parentNodeId: 'root',
    });

    const nodes = addedNodes(plan.commands);
    expect(nodes).toHaveLength(3);

    const [sun, bulb, spot] = nodes;
    expect(sun?.type).toBe('light');
    expect(sun?.light).toEqual({ kind: 'directional', intensity: 3, color: '#ffffff' });

    expect(bulb?.type).toBe('light');
    expect(bulb?.light).toEqual({ kind: 'point', intensity: 10, color: '#ff0000', distance: 12 });

    expect(spot?.type).toBe('light');
    expect(spot?.light).toEqual({
      kind: 'spot',
      intensity: 5,
      color: '#00ff00',
      distance: 8,
      angle: 0.5,
    });
    expect(spot?.semantics?.tags).toContain('gltf-light');
    expect(spot?.metadata.gltfLightType).toBe('spot');
  });

  it('keeps mesh node typing when no punctual light is referenced', async () => {
    const path = await writeGltf('mesh.gltf', {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'Cube', mesh: 0 }],
      meshes: [{ name: 'CubeMesh', primitives: [{}] }],
    });

    const plan = await planGltfHierarchyFromFile(path, {
      assetId: 'asset-mesh',
      parentNodeId: 'root',
    });

    const [cube] = addedNodes(plan.commands);
    expect(cube?.type).toBe('mesh');
    expect(cube?.light).toBeUndefined();
  });

  it('falls back to a non-light node for unsupported light types', async () => {
    const path = await writeGltf('ambient.gltf', {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'Weird', extensions: { KHR_lights_punctual: { light: 0 } } }],
      extensions: {
        KHR_lights_punctual: { lights: [{ type: 'area', intensity: 1 }] },
      },
    });

    const plan = await planGltfHierarchyFromFile(path, {
      assetId: 'asset-weird',
      parentNodeId: 'root',
    });

    const [node] = addedNodes(plan.commands);
    expect(node?.type).toBe('empty');
    expect(node?.light).toBeUndefined();
    expect(plan.warnings.some((warning) => warning.includes('unsupported punctual light type'))).toBe(true);
  });
});
