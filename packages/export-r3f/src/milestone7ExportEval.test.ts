import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  getStarterScene,
  type Command,
  type StarterKitId,
} from '@dioramai/core';
import { parseSceneJson, serializeScene, type Scene } from '@dioramai/schema';
import {
  exportSceneToR3fJsx,
  exportSceneToR3fModule,
} from './r3f';

type IntentFixture = {
  id: string;
  startingSceneId: StarterKitId;
  commands: Command[];
  expectedErrors: unknown[];
  exportChecks: {
    jsonNodeIds: string[];
    r3fContains: string[];
  };
};

const fixtureDir = new URL('../../../docs/evals/fixtures/m7/intents/', import.meta.url);

const fixtures = readdirSync(fixtureDir)
  .filter((fileName) => fileName.endsWith('.json'))
  .sort()
  .map(
    (fileName) =>
      JSON.parse(readFileSync(new URL(fileName, fixtureDir), 'utf8')) as IntentFixture,
  )
  .filter((fixture) => fixture.expectedErrors.length === 0);

const fixtureCases = fixtures.map((fixture) => [fixture.id, fixture] as const);

const applyAll = (initial: Scene, commands: Command[]): Scene =>
  commands.reduce((s, c) => applyCommand(s, c), initial);

describe('Milestone 7 export eval', () => {
  it.each(fixtureCases)('%s exports deterministic JSON after agent batch apply', (_id, fixture) => {
    const scene = applyAll(getStarterScene(fixture.startingSceneId), fixture.commands);

    const content = serializeScene(scene);
    const parsed = parseSceneJson(content);

    expect(parsed).not.toBeNull();
    expect(serializeScene(parsed!)).toBe(content);
    for (const nodeId of fixture.exportChecks.jsonNodeIds) {
      expect(parsed?.nodes[nodeId], `${fixture.id} missing ${nodeId}`).toBeDefined();
    }
  });

  it.each(fixtureCases)('%s exports stable JSON snapshot after agent batch apply', (id, fixture) => {
    const scene = applyAll(getStarterScene(fixture.startingSceneId), fixture.commands);

    expect(serializeScene(scene)).toMatchSnapshot(id);
  });

  it.each(fixtureCases)('%s exports deterministic R3F after agent batch apply', (_id, fixture) => {
    const scene = applyAll(getStarterScene(fixture.startingSceneId), fixture.commands);

    const content = exportSceneToR3fJsx(scene, { includeStudioLights: true });

    for (const needle of fixture.exportChecks.r3fContains) {
      expect(content).toContain(needle);
    }
    expect(content).toMatchSnapshot(fixture.id);
  });

  it('exports a structured R3F module for an interactive showroom agent flow', () => {
    const scene = applyAll(getStarterScene('showroom'), [
      { type: 'STRUCTURE_SCENE', preset: 'showroom' },
      { type: 'MAKE_INTERACTIVE', targetRole: 'product' },
    ]);

    const content = exportSceneToR3fModule(scene, {
      componentName: 'InteractiveShowroom',
      includeStudioLights: true,
    }).code;

    expect(content).toContain('export function InteractiveShowroom()');
    expect(content).toContain('function Product');
    expect(content).toContain('function DisplaySurface');
    expect(content).toContain('handleSelect');
    expect(content).toContain('handleHoverStart');
    expect(content).not.toContain('command_batch');
    expect(content).toMatchSnapshot('interactive showroom module');
  });

  describe('hierarchy and local transforms', () => {
    it('emits living-space children in scene-graph order with the moved table local transform', () => {
      const fixture = fixtures.find((f) => f.id === '003-living-transform-export');
      expect(fixture, '003-living-transform-export fixture missing').toBeDefined();
      const scene = applyAll(getStarterScene(fixture!.startingSceneId), fixture!.commands);

      const r3f = exportSceneToR3fJsx(scene, {});

      expect(r3f).toContain(
        '<group name="Coffee table" position={[0.95, 0.32, 0.1]} rotation={[0, 0.2, 0]} scale={[1.1, 0.12, 0.65]}>',
      );
      expect(r3f.indexOf('living-floor')).toBeLessThan(r3f.indexOf('living-furniture-group'));
      expect(r3f.indexOf('living-sofa')).toBeLessThan(r3f.indexOf('living-table'));
      expect(r3f.indexOf('living-table')).toBeLessThan(r3f.indexOf('living-lamp'));
    });

    it('keeps duplicated showroom display after the original in the R3F output', () => {
      const fixture = fixtures.find((f) => f.id === '002-showroom-duplicate-focus');
      expect(fixture, '002-showroom-duplicate-focus fixture missing').toBeDefined();
      const scene = applyAll(getStarterScene(fixture!.startingSceneId), fixture!.commands);

      const r3f = exportSceneToR3fJsx(scene, {});

      expect(r3f.indexOf('display_table ')).toBeLessThan(r3f.indexOf('display_table-copy'));
      expect(r3f).toContain(
        '<group name="Display Table (copy)" position={[3, 0.28, 0]} rotation={[0, -0.12, 0]} scale={[1.8, 0.35, 0.9]}>',
      );
    });
  });

  describe('hidden, light, and root transform behavior', () => {
    it('omits agent-added hidden subtrees and their descendants from the R3F output', () => {
      const scene = applyAll(getStarterScene('default'), [
        {
          type: 'ADD_NODE',
          parentId: 'default-root',
          node: {
            id: 'agent-hidden-branch',
            name: 'Agent Hidden',
            type: 'group',
            children: [],
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            visible: false,
            metadata: {},
          },
        },
        {
          type: 'ADD_NODE',
          parentId: 'agent-hidden-branch',
          node: {
            id: 'agent-hidden-leaf',
            name: 'Agent Hidden Leaf',
            type: 'mesh',
            children: [],
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            visible: true,
            metadata: {},
          },
        },
      ]);

      const r3f = exportSceneToR3fJsx(scene, {});
      expect(r3f).not.toContain('Agent Hidden');
      expect(r3f).not.toContain('agent-hidden-branch');
      expect(r3f).not.toContain('agent-hidden-leaf');

      const json = serializeScene(scene);
      const parsed = parseSceneJson(json);
      expect(parsed?.nodes['agent-hidden-branch']?.visible).toBe(false);
      expect(parsed?.nodes['agent-hidden-leaf']?.visible).toBe(true);

      expect(r3f).toMatchSnapshot('agent hidden subtree');
    });

    it('emits ambient and directional primitives for agent-added light nodes', () => {
      const scene = applyAll(getStarterScene('default'), [
        {
          type: 'ADD_NODE',
          parentId: 'default-root',
          node: {
            id: 'agent-ambient',
            name: 'Agent Ambient',
            type: 'light',
            children: [],
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            visible: true,
            metadata: {},
            light: { kind: 'ambient', intensity: 0.42 },
          },
        },
        {
          type: 'ADD_NODE',
          parentId: 'default-root',
          node: {
            id: 'agent-directional',
            name: 'Agent Sun',
            type: 'light',
            children: [],
            transform: { position: [4, 8, 5], rotation: [0, 0, 0], scale: [1, 1, 1] },
            visible: true,
            metadata: {},
            light: { kind: 'directional', intensity: 1.2, castShadow: true },
          },
        },
      ]);

      const r3f = exportSceneToR3fJsx(scene, {});
      expect(r3f).toContain('<ambientLight intensity={0.42} />');
      expect(r3f).toContain('<directionalLight intensity={1.2} castShadow />');
      expect(r3f).toContain(
        '<group name="Agent Sun" position={[4, 8, 5]} rotation={[0, 0, 0]} scale={[1, 1, 1]}>',
      );

      const parsedScene = parseSceneJson(serializeScene(scene));
      expect(parsedScene?.nodes['agent-ambient']?.light).toEqual({
        kind: 'ambient',
        intensity: 0.42,
      });
      expect(parsedScene?.nodes['agent-directional']?.light).toEqual({
        kind: 'directional',
        intensity: 1.2,
        castShadow: true,
      });

      expect(r3f).toMatchSnapshot('agent light nodes');
    });

    it('reflects an agent-driven UPDATE_TRANSFORM on the root in the root R3F group', () => {
      const scene = applyAll(getStarterScene('default'), [
        {
          type: 'UPDATE_TRANSFORM',
          nodeId: 'default-root',
          patch: {
            position: [10, 0, 0],
            rotation: [0, 0.5, 0],
            scale: [1.5, 1.5, 1.5],
          },
        },
      ]);

      const r3f = exportSceneToR3fJsx(scene, {});
      expect(r3f).toContain(
        '<group name="Root" position={[10, 0, 0]} rotation={[0, 0.5, 0]} scale={[1.5, 1.5, 1.5]}>',
      );
      expect(r3f.indexOf('default-root')).toBeLessThan(r3f.indexOf('default-cube-1'));

      const parsedRoot = parseSceneJson(serializeScene(scene))?.nodes['default-root'];
      expect(parsedRoot?.transform.position).toEqual([10, 0, 0]);
      expect(parsedRoot?.transform.rotation).toEqual([0, 0.5, 0]);
      expect(parsedRoot?.transform.scale).toEqual([1.5, 1.5, 1.5]);

      expect(r3f).toMatchSnapshot('agent root transform');
    });
  });

  describe('export exclusions after command apply', () => {
    const buildScene = () => {
      const scene = applyAll(getStarterScene('living'), [
        {
          type: 'UPDATE_TRANSFORM',
          nodeId: 'living-table',
          patch: { position: [0.95, 0.32, 0.1], rotation: [0, 0.2, 0] },
        },
        { type: 'SET_SELECTION', nodeId: 'living-table' },
      ]);
      expect(
        scene.nodes['living-table']?.transform.position,
        'commands must have been applied for the leak check',
      ).toEqual([0.95, 0.32, 0.1]);
      return scene;
    };

    it('R3F export excludes editor state, command log, action log, and filesystem paths', () => {
      const scene = buildScene();
      const r3f = exportSceneToR3fJsx(scene, { includeStudioLights: true });

      const forbidden = [
        '"selection"',
        '"sequence"',
        '"operation"',
        '"source"',
        '"changed"',
        'command_batch',
        'UPDATE_TRANSFORM',
        'SET_SELECTION',
        'living-table"',
        '/Users/',
        'file:///',
        'dryRun',
        'appliedCommandCount',
        'failedCommandIndex',
      ];
      for (const needle of forbidden) {
        expect(r3f, `R3F export leaked "${needle}"`).not.toContain(needle);
      }
    });

    it('JSON export excludes command log entries, action log fields, and filesystem paths', () => {
      const scene = buildScene();
      const json = serializeScene(scene);

      const forbidden = [
        '"sequence"',
        '"operation"',
        '"source"',
        '"agent"',
        '"command_batch"',
        'UPDATE_TRANSFORM',
        'SET_SELECTION',
        'appliedCommandCount',
        'failedCommandIndex',
        'dryRun',
        '/Users/',
        'file:///',
      ];
      for (const needle of forbidden) {
        expect(json, `JSON export leaked "${needle}"`).not.toContain(needle);
      }

      const parsed = JSON.parse(json) as {
        format: string;
        version: number;
        data: Record<string, unknown>;
      };
      expect(Object.keys(parsed).sort()).toEqual(['data', 'format', 'version']);
      expect(Object.keys(parsed.data).sort()).toEqual(['nodes', 'rootId', 'selection']);
    });
  });
});
