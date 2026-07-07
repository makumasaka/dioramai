import { describe, expect, it } from 'vitest';
import { applyCommand, createNode, defaultFixtureScene } from '@dioramai/core';
import { parseSceneJson, serializeScene, type Scene } from '@dioramai/schema';
import {
  DIORAMAI_GENERATED_MARKER,
  DIORAMAI_SCENE_BLOCK_END,
  DIORAMAI_SCENE_BLOCK_START,
  exportSceneToR3fSyncModule,
  extractSceneJsonFromR3fSyncModule,
  parseSceneFromR3fSyncModule,
} from './syncModule';

describe('R3F sync module export', () => {
  it('embeds a parseable canonical scene block and stable node identity metadata', () => {
    const result = exportSceneToR3fSyncModule(defaultFixtureScene, {
      includeStudioLights: true,
    });

    expect(result.code).toContain(DIORAMAI_GENERATED_MARKER);
    expect(result.code).toContain(DIORAMAI_SCENE_BLOCK_START);
    expect(result.code).toContain(DIORAMAI_SCENE_BLOCK_END);
    expect(result.code).toContain('export const dioramaiScene = (');
    expect(result.code).toContain('userData={{ dioramaiId: node.id, sourceId: node.id }}');
    expect(result.code).toContain('export function DioramaiScene()');

    const json = extractSceneJsonFromR3fSyncModule(result.code);
    expect(json).toBe(serializeScene(defaultFixtureScene));
    expect(parseSceneJson(json ?? '')).toEqual(defaultFixtureScene);
  });

  it('roundtrips edits to the embedded scene block without evaluating code', () => {
    const module = exportSceneToR3fSyncModule(defaultFixtureScene).code;
    const edited = module.replace(
      '"position": [\n            0,\n            0.5,\n            0\n          ]',
      '"position": [\n            7,\n            8,\n            9\n          ]',
    );

    const parsed = parseSceneFromR3fSyncModule(edited);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scene.nodes['default-cube-1']?.transform.position).toEqual([7, 8, 9]);
  });

  it('emits GLB runtime scaffolding while preserving canonical asset refs', () => {
    const product = createNode({
      id: 'product',
      name: 'Product',
      assetRef: { kind: 'uri', uri: '/assets/dioramai/product.glb' },
    });
    const root = createNode({
      id: 'root',
      name: 'Root',
      type: 'root',
      children: [product.id],
    });
    const scene: Scene = {
      rootId: root.id,
      selection: null,
      nodes: {
        [root.id]: root,
        [product.id]: product,
      },
      assets: {
        product: {
          id: 'product',
          name: 'Product',
          kind: 'glb',
          uri: '/assets/dioramai/product.glb',
          source: 'manual',
        },
      },
    };

    const out = exportSceneToR3fSyncModule(scene).code;

    expect(out).toContain("import { Environment, useGLTF } from '@react-three/drei';");
    expect(out).toContain("import { SkeletonUtils } from 'three-stdlib';");
    expect(out).toContain('useLayoutEffect');
    expect(out).toContain('function AssetModel');
    expect(out).toContain('SkeletonUtils.clone(gltf.scene)');
    expect(out).toContain('function collectGltfNodeProjections');
    expect(out).toContain('applyGltfNodeProjections(object, projections)');
    expect(out).toContain('/assets/dioramai/product.glb');
    expect(parseSceneFromR3fSyncModule(out)).toEqual({
      ok: true,
      scene,
      json: serializeScene(scene),
    });
  });

  it('returns structured parse errors for missing or invalid scene blocks', () => {
    expect(parseSceneFromR3fSyncModule('export const nope = 1')).toEqual({
      ok: false,
      error: {
        code: 'SCENE_BLOCK_NOT_FOUND',
        message: 'Generated Dioramai scene block was not found.',
      },
    });

    const invalid =
      `${DIORAMAI_SCENE_BLOCK_START}\n` +
      `{"format":"dioramai-scene","version":2,"data":{"rootId":"missing","nodes":{}}}\n` +
      `${DIORAMAI_SCENE_BLOCK_END}`;

    expect(parseSceneFromR3fSyncModule(invalid)).toEqual({
      ok: false,
      error: {
        code: 'SCENE_BLOCK_INVALID',
        message: 'Generated Dioramai scene block failed JSON parsing or schema validation.',
      },
    });
  });

  it('is deterministic after canonical transform commands', () => {
    const transformed = applyCommand(defaultFixtureScene, {
      type: 'UPDATE_TRANSFORM',
      nodeId: 'default-cube-1',
      patch: { position: [2, 3, 4] },
    });

    expect(exportSceneToR3fSyncModule(transformed).code).toBe(
      exportSceneToR3fSyncModule(transformed).code,
    );
  });

  it('emits performance canvas props and roundtrips render settings', () => {
    const scene: Scene = {
      ...defaultFixtureScene,
      renderSettings: {
        maxPixelRatio: 1.5,
        shadows: false,
        shadowMapSize: 512,
        renderOnDemand: true,
        antialias: false,
        powerPreference: 'high-performance',
      },
    };

    const out = exportSceneToR3fSyncModule(scene).code;

    expect(out).toContain('export const dioramaiCanvasProps');
    expect(out).toContain('dioramaiRenderSettings.maxPixelRatio ?? 2');
    expect(out).toContain("dioramaiRenderSettings.renderOnDemand ? 'demand' : 'always'");
    expect(out).toContain('shadow-mapSize={dioramaiShadowMapSize}');

    const parsed = parseSceneFromR3fSyncModule(out);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scene.renderSettings).toEqual(scene.renderSettings);
  });

  it('emits canvas props even when render settings are absent', () => {
    const out = exportSceneToR3fSyncModule(defaultFixtureScene).code;
    expect(out).toContain('export const dioramaiCanvasProps');
  });

  it('emits light runtime scaffolding and a gated Environment, roundtripping lights + environment', () => {
    const spot = createNode({
      id: 'spot',
      name: 'Spot',
      type: 'light',
      transform: { position: [2, 4, 2] },
      light: {
        kind: 'spot',
        intensity: 3,
        color: '#ffaa00',
        distance: 10,
        angle: 0.5,
        penumbra: 0.2,
        castShadow: true,
      },
    });
    const root = createNode({ id: 'root', name: 'Root', type: 'root', children: [spot.id] });
    const scene: Scene = {
      rootId: root.id,
      selection: null,
      nodes: { [root.id]: root, [spot.id]: spot },
      environment: {
        hdriUri: '/assets/hdri/quarry_cloudy_1k.hdr',
        enabled: true,
        showBackground: true,
        intensity: 1.2,
        rotationY: 0.5,
      },
    };

    const out = exportSceneToR3fSyncModule(scene, { includeStudioLights: true }).code;

    expect(out).toContain("import { Environment, useGLTF } from '@react-three/drei';");
    expect(out).toContain('function DioramaiLightView');
    expect(out).toContain('function DioramaiEnvironmentView');
    expect(out).toContain('<spotLight');
    expect(out).toContain('environmentActive');

    const parsed = parseSceneFromR3fSyncModule(out);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scene.nodes.spot?.light).toEqual(spot.light);
    expect(parsed.scene.environment).toEqual(scene.environment);
  });
});
