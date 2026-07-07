import { describe, expect, it } from 'vitest';
import {
  parseSceneJson,
  SCENE_DATA_VERSION,
  SCENE_DOCUMENT_FORMAT,
  SCENE_DOCUMENT_LEGACY_FORMAT,
  SCENE_LEGACY_DATA_VERSION,
  serializeScene,
  validateScene,
  type Scene,
  type Transform,
} from './index';

const transform: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

const canonicalScene = (): Scene => ({
  rootId: 'root',
  selection: null,
  nodes: {
    root: {
      id: 'root',
      name: 'Root',
      type: 'root',
      children: ['mesh'],
      transform,
      visible: true,
      metadata: {},
    },
    mesh: {
      id: 'mesh',
      name: 'Mesh',
      type: 'mesh',
      children: [],
      transform,
      visible: true,
      metadata: {},
    },
  },
});

const legacyDocument = (data: unknown): string =>
  JSON.stringify({
    format: SCENE_DOCUMENT_LEGACY_FORMAT,
    version: SCENE_LEGACY_DATA_VERSION,
    data,
  });

describe('scene JSON contract', () => {
  it('exports only canonical v2 scene documents', () => {
    const text = serializeScene(canonicalScene());
    const doc = JSON.parse(text) as { format: string; version: number };

    expect(doc.format).toBe(SCENE_DOCUMENT_FORMAT);
    expect(doc.version).toBe(SCENE_DATA_VERSION);
    expect(doc.version).toBe(2);
  });

  it('roundtrips optional render settings', () => {
    const scene: Scene = {
      ...canonicalScene(),
      renderSettings: {
        maxPixelRatio: 1.5,
        shadows: false,
        shadowMapSize: 512,
        renderOnDemand: true,
        antialias: false,
        powerPreference: 'low-power',
      },
    };

    const parsed = parseSceneJson(serializeScene(scene));
    expect(parsed?.renderSettings).toEqual(scene.renderSettings);
    expect(validateScene(scene)).toBe(true);
  });

  it('rejects unknown render settings fields', () => {
    const doc = JSON.parse(serializeScene(canonicalScene())) as {
      data: Record<string, unknown>;
    };
    doc.data.renderSettings = { turbo: true };
    expect(parseSceneJson(JSON.stringify(doc))).toBeNull();
  });

  it('parses v2 documents that still use the pre-rebrand format id', () => {
    const text = JSON.stringify({
      format: SCENE_DOCUMENT_LEGACY_FORMAT,
      version: SCENE_DATA_VERSION,
      data: canonicalScene(),
    });
    const parsed = parseSceneJson(text);
    expect(parsed).not.toBeNull();
    expect(validateScene(parsed!)).toBe(true);
  });

  it('migrates v1 documents with legacy type, visibility, and metadata defaults', () => {
    const parsed = parseSceneJson(
      legacyDocument({
        rootId: 'root',
        nodes: {
          root: {
            id: 'root',
            name: 'Root',
            children: ['group', 'light-node', 'leaf'],
            transform,
          },
          group: {
            id: 'group',
            name: 'Group',
            children: ['child'],
            transform,
          },
          child: {
            id: 'child',
            name: 'Child',
            children: [],
            transform,
          },
          'light-node': {
            id: 'light-node',
            name: 'Light',
            children: [],
            transform,
            light: { kind: 'ambient' },
          },
          leaf: {
            id: 'leaf',
            name: 'Leaf',
            children: [],
            transform,
          },
        },
      }),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.nodes.root?.type).toBe('root');
    expect(parsed?.nodes.group?.type).toBe('group');
    expect(parsed?.nodes['light-node']?.type).toBe('light');
    expect(parsed?.nodes.leaf?.type).toBe('mesh');
    expect(parsed?.nodes.leaf?.visible).toBe(true);
    expect(parsed?.nodes.leaf?.metadata).toEqual({});
    expect(validateScene(parsed)).toBe(true);
  });

  it('migrates legacy bare scenes through the compatibility path', () => {
    const parsed = parseSceneJson(
      JSON.stringify({
        rootId: 'root',
        nodes: {
          root: {
            id: 'root',
            name: 'Root',
            children: [],
            transform,
          },
        },
      }),
    );

    expect(parsed?.rootId).toBe('root');
    expect(parsed?.selection).toBe(null);
    expect(parsed?.nodes.root?.type).toBe('root');
    expect(validateScene(parsed)).toBe(true);
  });

  it('validates and roundtrips semantic and behavior metadata', () => {
    const scene = canonicalScene();
    scene.semanticGroups = {
      display_area: {
        id: 'display_area',
        name: 'Display Area',
        role: 'display',
        nodeIds: ['mesh'],
        tags: ['showroom'],
      },
    };
    scene.behaviors = {
      mesh_hover: {
        id: 'mesh_hover',
        type: 'hover_highlight',
        nodeIds: ['mesh'],
        label: 'Hover highlight',
      },
    };
    scene.layoutMetadata = { preset: 'showroom-grid' };
    scene.nodes.mesh = {
      ...scene.nodes.mesh!,
      semantics: {
        role: 'product',
        groupId: 'display_area',
        traits: ['clickable', 'hoverable', 'displayable'],
        label: 'Mesh product',
        source: 'manual',
      },
      behaviorRefs: ['mesh_hover'],
      semanticRole: 'product',
      semanticGroupId: 'display_area',
      behaviors: {
        hoverHighlight: true,
        clickSelect: true,
        focusOnClick: true,
        info: {
          title: 'Mesh',
          description: 'Interactive product placeholder.',
        },
      },
    };

    const parsed = parseSceneJson(serializeScene(scene));

    expect(parsed?.nodes.mesh?.semanticRole).toBe('product');
    expect(parsed?.nodes.mesh?.semantics?.label).toBe('Mesh product');
    expect(parsed?.nodes.mesh?.semantics?.traits).toEqual([
      'clickable',
      'hoverable',
      'displayable',
    ]);
    expect(parsed?.nodes.mesh?.behaviorRefs).toEqual(['mesh_hover']);
    expect(parsed?.semanticGroups?.display_area?.nodeIds).toEqual(['mesh']);
    expect(parsed?.behaviors?.mesh_hover?.type).toBe('hover_highlight');
    expect(parsed?.layoutMetadata).toEqual({ preset: 'showroom-grid' });
    expect(parsed?.nodes.mesh?.semanticGroupId).toBe('display_area');
    expect(parsed?.nodes.mesh?.behaviors).toEqual(scene.nodes.mesh.behaviors);
    expect(validateScene(parsed)).toBe(true);
  });

  it('roundtrips point/spot lights with color, range, and cone angle', () => {
    const scene = canonicalScene();
    scene.nodes.spot = {
      id: 'spot',
      name: 'Spot Light',
      type: 'light',
      children: [],
      transform,
      visible: true,
      metadata: {},
      light: {
        kind: 'spot',
        intensity: 2.5,
        color: '#ffaa00',
        distance: 12,
        decay: 2,
        angle: 0.5,
        penumbra: 0.3,
        castShadow: true,
      },
    };
    scene.nodes.point = {
      id: 'point',
      name: 'Point Light',
      type: 'light',
      children: [],
      transform,
      visible: true,
      metadata: {},
      light: { kind: 'point', intensity: 1.2, color: '#00ffcc', distance: 8 },
    };
    scene.nodes.root = {
      ...scene.nodes.root!,
      children: [...scene.nodes.root!.children, 'spot', 'point'],
    };

    const parsed = parseSceneJson(serializeScene(scene));

    expect(parsed?.nodes.spot?.light).toEqual(scene.nodes.spot.light);
    expect(parsed?.nodes.point?.light).toEqual(scene.nodes.point.light);
    expect(validateScene(parsed)).toBe(true);
  });

  it('roundtrips scene-level environment configuration', () => {
    const scene = canonicalScene();
    scene.environment = {
      hdriUri: '/assets/hdri/quarry_cloudy_1k.hdr',
      enabled: true,
      showBackground: true,
      intensity: 1.4,
      rotationY: 1.57,
      backgroundColor: '#101015',
    };

    const parsed = parseSceneJson(serializeScene(scene));

    expect(parsed?.environment).toEqual(scene.environment);
    expect(validateScene(parsed)).toBe(true);
  });

  it('rejects invalid hex colors on lights', () => {
    const scene = canonicalScene();
    scene.nodes.mesh = {
      ...scene.nodes.mesh!,
      type: 'light',
      light: { kind: 'point', color: 'orange' as unknown as `#${string}` },
    };
    expect(validateScene(scene)).toBe(false);
  });

  it('rejects v2 documents with missing required node contract fields', () => {
    const parsed = parseSceneJson(
      JSON.stringify({
        format: SCENE_DOCUMENT_FORMAT,
        version: SCENE_DATA_VERSION,
        data: {
          rootId: 'root',
          selection: null,
          nodes: {
            root: {
              id: 'root',
              name: 'Root',
              children: [],
              transform,
            },
          },
        },
      }),
    );

    expect(parsed).toBeNull();
  });

  it('enforces root node type exclusivity in canonical scenes', () => {
    const rootIsMesh = canonicalScene();
    rootIsMesh.nodes.root = { ...rootIsMesh.nodes.root, type: 'mesh' };

    const childIsRoot = canonicalScene();
    childIsRoot.nodes.mesh = { ...childIsRoot.nodes.mesh, type: 'root' };

    expect(validateScene(rootIsMesh)).toBe(false);
    expect(validateScene(childIsRoot)).toBe(false);
  });
});
