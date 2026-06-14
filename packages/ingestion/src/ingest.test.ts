import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCommand, createEmptyScene } from '@dioramai/core';
import { ingestAsset, ingestAssetWithHierarchy } from './ingest';

const createTestGlb = (gltf: Record<string, unknown>): Buffer => {
  const json = Buffer.from(JSON.stringify(gltf), 'utf8');
  const padding = Buffer.alloc((4 - (json.byteLength % 4)) % 4, 0x20);
  const jsonChunk = Buffer.concat([json, padding]);
  const totalLength = 12 + 8 + jsonChunk.byteLength;
  const buffer = Buffer.alloc(totalLength);
  buffer.writeUInt32LE(0x46546c67, 0);
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(totalLength, 8);
  buffer.writeUInt32LE(jsonChunk.byteLength, 12);
  buffer.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(buffer, 20);
  return buffer;
};

describe('ingestAsset', () => {
  it('returns replayable commands and warnings for local assets', () => {
    const result = ingestAsset(
      {
        id: 'asset-chair',
        format: 'glb',
        localPath: '/tmp/chair.glb',
        uri: '/assets/dioramai/chair.glb',
        source: 'manual',
      },
      { parentId: 'root', nodeId: 'chair-node' },
    );

    expect(result.warnings).toEqual([]);
    expect(result.commands.map((command) => command.type)).toEqual([
      'REGISTER_ASSET',
      'ADD_NODE',
    ]);
  });

  it('can be reduced into a valid scene using core commands', () => {
    const initial = createEmptyScene();
    const result = ingestAsset(
      {
        format: 'glb',
        localPath: '/tmp/chair.glb',
        uri: '/assets/dioramai/chair.glb',
        source: 'manual',
      },
      { parentId: initial.rootId },
    );

    const next = result.commands.reduce((scene, command) => applyCommand(scene, command), initial);
    const addedNodeId = Object.keys(next.nodes).find((id) => id !== initial.rootId);
    expect(addedNodeId).toBeDefined();
    expect(next.assets).toBeDefined();
    expect(Object.values(next.assets ?? {}).length).toBe(1);
    expect(next.nodes[addedNodeId as string]?.semantics?.role).toBe('product');
    expect(next.nodes[addedNodeId as string]?.semantics?.source).toBe('import');
    expect(next.nodes[addedNodeId as string]?.metadata.source).toBe('manual');
    expect(next.nodes[addedNodeId as string]?.metadata.provider).toBe('manual');
  });

  it('warns and returns no commands for invalid local path input', () => {
    const result = ingestAsset({
      localPath: '',
      format: 'glb',
    });
    expect(result.commands).toEqual([]);
    expect(result.warnings).toEqual(['ingestAsset requires a non-empty localPath']);
  });

  it('adds inspectable GLB hierarchy nodes when requested', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dioramai-gltf-'));
    const glbPath = join(dir, 'planets.glb');
    await writeFile(glbPath, createTestGlb({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'Planet', children: [1, 2], translation: [1, 2, 3] },
        { name: 'Ring', mesh: 0 },
        { name: 'Moon 1', mesh: 1, translation: [0.5, 0, 0], scale: [0.2, 0.2, 0.2] },
      ],
      meshes: [{}, {}],
    }));

    try {
      const initial = createEmptyScene();
      const result = await ingestAssetWithHierarchy(
        {
          id: 'asset-planets',
          format: 'glb',
          localPath: glbPath,
          uri: '/assets/dioramai/planets.glb',
          source: 'manual',
        },
        {
          parentId: initial.rootId,
          nodeId: 'planets-node',
          includeHierarchy: true,
        },
      );

      expect(result.warnings).toEqual([]);
      expect(result.commands.map((command) => command.type)).toEqual([
        'REGISTER_ASSET',
        'ADD_NODE',
        'ADD_NODE',
        'ADD_NODE',
        'ADD_NODE',
      ]);

      const next = result.commands.reduce((scene, command) => applyCommand(scene, command), initial);
      expect(next.nodes['planets-node']?.children).toEqual(['planets-node-gltf-0-planet']);
      expect(next.nodes['planets-node-gltf-0-planet']?.type).toBe('group');
      expect(next.nodes['planets-node-gltf-0-planet']?.transform.position).toEqual([1, 2, 3]);
      expect(next.nodes['planets-node-gltf-0-planet']?.children).toEqual([
        'planets-node-gltf-1-ring',
        'planets-node-gltf-2-moon-1',
      ]);
      expect(next.nodes['planets-node-gltf-1-ring']?.type).toBe('mesh');
      expect(next.nodes['planets-node-gltf-1-ring']?.metadata).toMatchObject({
        source: 'gltf',
        assetId: 'asset-planets',
        gltfMeshIndex: 0,
        renderMode: 'gltf-inspect-only',
      });
      expect(next.nodes['planets-node-gltf-2-moon-1']?.transform.scale).toEqual([
        0.2,
        0.2,
        0.2,
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves skin and bone hierarchy details for animated GLBs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dioramai-gltf-skin-'));
    const glbPath = join(dir, 'android.glb');
    await writeFile(glbPath, createTestGlb({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'Armature', children: [1, 2] },
        { name: 'char1', mesh: 0, skin: 0 },
        { name: 'Hips', children: [3] },
        { name: 'Spine', children: [4] },
        { name: 'Head' },
      ],
      meshes: [{
        name: 'Android Body',
        primitives: [{ material: 0 }, { material: 1 }],
      }],
      materials: [{ name: 'Armor Orange' }, { name: 'Body White' }],
      skins: [{
        name: 'Android Rig',
        skeleton: 2,
        joints: [2, 3, 4],
      }],
    }));

    try {
      const initial = createEmptyScene();
      const result = await ingestAssetWithHierarchy(
        {
          id: 'asset-android',
          format: 'glb',
          localPath: glbPath,
          uri: '/assets/dioramai/android.glb',
          source: 'manual',
        },
        {
          parentId: initial.rootId,
          nodeId: 'android-node',
          includeHierarchy: true,
        },
      );

      expect(result.warnings).toEqual([]);
      const next = result.commands.reduce((scene, command) => applyCommand(scene, command), initial);

      expect(next.nodes['android-node']?.children).toEqual([
        'android-node-gltf-0-armature',
      ]);
      expect(next.nodes['android-node-gltf-0-armature']?.children).toEqual([
        'android-node-gltf-1-char1',
        'android-node-gltf-2-hips',
      ]);
      expect(next.nodes['android-node-gltf-1-char1']?.metadata).toMatchObject({
        gltfMeshIndex: 0,
        gltfMeshName: 'Android Body',
        gltfPrimitiveCount: 2,
        gltfMaterialIndexes: [0, 1],
        gltfMaterialNames: ['Armor Orange', 'Body White'],
        gltfSkinIndex: 0,
        renderMode: 'gltf-inspect-only',
      });
      expect(next.nodes['android-node-gltf-1-char1']?.semantics?.tags).toEqual([
        'gltf-node',
        'gltf-mesh',
        'gltf-skinned-mesh',
      ]);
      expect(next.nodes['android-node-gltf-2-hips']?.metadata).toMatchObject({
        gltfJointIndex: 0,
        gltfSkinOwnerIndex: 0,
        gltfSkinName: 'Android Rig',
      });
      expect(next.nodes['android-node-gltf-2-hips']?.semantics?.tags).toEqual([
        'gltf-node',
        'gltf-joint',
        'gltf-bone',
      ]);
      expect(next.nodes['android-node-gltf-4-head']?.semantics?.tags).toEqual([
        'gltf-node',
        'gltf-joint',
        'gltf-bone',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
