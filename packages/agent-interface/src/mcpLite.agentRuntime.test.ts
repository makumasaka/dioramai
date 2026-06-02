import { describe, expect, it } from 'vitest';
import { showroomScene } from '@dioramai/core';
import { cloneSceneFromJson, parseSceneJson, serializeScene, type Scene } from '@dioramai/schema';
import type { AgentError } from './errors';
import { createMcpLiteRuntime } from './mcpLite';
import { createAgentSession } from './session';

const expectOk = <T>(result: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected AgentResult ok');
  return result.data;
};

const expectErr = <T>(
  result: { ok: true; data: T } | { ok: false; error: AgentError },
): AgentError => {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected error result');
  return result.error;
};

/** Narrow agent error shape without importing AgentError (parity with runtimeContract). */
const expectCommandRejected = (
  result: { ok: true; data: unknown } | { ok: false; error: { code?: string; message?: string } },
): void => {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe('COMMAND_REJECTED');
};

const initialShowroom = (): Scene => cloneSceneFromJson(showroomScene);

describe('MCP-lite agent runtime — read safety', () => {
  it('getSemanticGroups returns a detached clone; mutations do not affect session', () => {
    const rt = createMcpLiteRuntime(showroomScene);
    expectOk(rt.structureScene({ preset: 'showroom' }));

    const first = expectOk(rt.getSemanticGroups()).semanticGroups;
    const display = first.display_area;
    expect(display).toBeDefined();
    display!.name = 'Tampered';
    (display as { hacked?: boolean }).hacked = true;

    const second = expectOk(rt.getSemanticGroups()).semanticGroups;
    expect(second.display_area?.name).toBe('Display Area');
    expect((second.display_area as { hacked?: boolean }).hacked).toBeUndefined();
  });

  it('getBehaviors returns a detached clone; mutations do not affect session', () => {
    const rt = createMcpLiteRuntime(showroomScene);
    expectOk(rt.structureScene());
    expectOk(rt.makeInteractive({ targetRole: 'product' }));

    const first = expectOk(rt.getBehaviors()).behaviors;
    const key = Object.keys(first)[0];
    expect(key).toBeTruthy();
    first[key!]!.label = 'Tampered';

    const second = expectOk(rt.getBehaviors()).behaviors;
    expect(second[key!]?.label).not.toBe('Tampered');
  });
});

describe('MCP-lite agent runtime — single command', () => {
  it('dryRunCommand on a valid semantic command does not mutate session and logs preview', () => {
    const session = createAgentSession(showroomScene);
    const before = serializeScene(expectOk(session.getScene()).scene);
    const preview = expectOk(
      session.dryRunCommand({ type: 'STRUCTURE_SCENE', preset: 'showroom' }),
    );
    expect(preview.dryRun).toBe(true);
    expect(preview.changed).toBe(true);
    expect(preview.scene.semanticGroups?.display_area).toBeDefined();
    expect(serializeScene(expectOk(session.getScene()).scene)).toBe(before);
    expect(expectOk(session.getActionLog()).entries).toEqual([
      expect.objectContaining({ type: 'command', dryRun: true, changed: true }),
    ]);
  });

  it('applyCommand persists STRUCTURE_SCENE through the reducer', () => {
    const session = createAgentSession(showroomScene);
    const applied = expectOk(session.applyCommand({ type: 'STRUCTURE_SCENE', preset: 'showroom' }));
    expect(applied.dryRun).toBe(false);
    expect(expectOk(session.getScene()).scene.semanticGroups?.display_area).toBeDefined();
  });

  it('rejects invalid payloads before reducer entry (schema)', () => {
    const session = createAgentSession(showroomScene);
    const before = serializeScene(expectOk(session.getScene()).scene);
    const err = expectErr(
      session.applyCommand({
        type: 'SET_NODE_SEMANTICS',
        nodeIds: ['product_01'],
        semantics: { role: 'not-a-real-role' as 'product' },
      }),
    );
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(serializeScene(expectOk(session.getScene()).scene)).toBe(before);
  });

  it('returns COMMAND_REJECTED for semantic commands that fail command contract', () => {
    const session = createAgentSession(showroomScene);
    const rejected = session.applyCommand({
      type: 'ASSIGN_TO_SEMANTIC_GROUP',
      groupId: 'missing-group',
      nodeIds: ['product_01'],
    });
    expectCommandRejected(rejected);
    if (!rejected.ok) {
      expect(rejected.error.message).toContain('ASSIGN_TO_SEMANTIC_GROUP');
    }
  });

  it('applyCommand(..., { dryRun: true }) previews without persisting', () => {
    const session = createAgentSession(showroomScene);
    const preview = expectOk(
      session.applyCommand({ type: 'STRUCTURE_SCENE', preset: 'showroom' }, { dryRun: true }),
    );
    expect(preview.dryRun).toBe(true);
    expect(expectOk(session.getScene()).scene.semanticGroups).toBeUndefined();
  });
});

describe('MCP-lite agent runtime — batch command', () => {
  it('dryRunCommandBatch does not mutate session', () => {
    const session = createAgentSession(showroomScene);
    const before = serializeScene(expectOk(session.getScene()).scene);
    const batch = [
      { type: 'STRUCTURE_SCENE' as const, preset: 'showroom' as const },
      { type: 'MAKE_INTERACTIVE' as const, targetRole: 'product' as const },
    ];
    const preview = expectOk(session.dryRunCommandBatch(batch));
    expect(preview.dryRun).toBe(true);
    expect(preview.changed).toBe(true);
    expect(serializeScene(expectOk(session.getScene()).scene)).toBe(before);
    expect(expectOk(session.getActionLog()).entries).toEqual([
      expect.objectContaining({ type: 'command_batch', dryRun: true, changed: true }),
    ]);
  });

  it('applyCommandBatch applies commands in order with per-item results', () => {
    const session = createAgentSession(showroomScene);
    const batch = [
      { type: 'STRUCTURE_SCENE' as const, preset: 'showroom' as const },
      { type: 'MAKE_INTERACTIVE' as const, targetRole: 'product' as const },
    ];
    const applied = expectOk(session.applyCommandBatch(batch));
    expect(applied.errors).toEqual([]);
    expect(applied.appliedCommandCount).toBe(2);
    expect(applied.results.map((r) => r.summary.title)).toEqual([
      'Structure scene',
      'Make interactive',
    ]);
    expect(expectOk(session.getScene()).scene.behaviors?.product_click_select).toBeDefined();
  });

  it('batch failure rolls back: no partial commit, appliedCommandCount 0, scene unchanged', () => {
    const session = createAgentSession(showroomScene);
    const beforeSig = serializeScene(expectOk(session.getScene()).scene);
    const failed = expectOk(
      session.applyCommandBatch([
        { type: 'STRUCTURE_SCENE', preset: 'showroom' },
        { type: 'DELETE_NODE', nodeId: 'missing-node' },
      ]),
    );
    expect(failed.errors).toHaveLength(1);
    expect(failed.errors[0]?.index).toBe(1);
    expect(failed.changed).toBe(false);
    expect(failed.appliedCommandCount).toBe(0);
    expect(failed.failedCommandIndex).toBe(1);
    expect(serializeScene(expectOk(session.getScene()).scene)).toBe(beforeSig);
  });

  it('deterministic batch with DUPLICATE_NODE idMap: two runs from same initial yield identical JSON', () => {
    const batch = [
      { type: 'STRUCTURE_SCENE' as const, preset: 'showroom' as const },
      { type: 'MAKE_INTERACTIVE' as const, targetRole: 'product' as const },
      {
        type: 'DUPLICATE_NODE' as const,
        nodeId: 'product_01',
        includeSubtree: false,
        idMap: { product_01: 'product_01_mcp_dup' },
      },
    ];

    const run = (): string => {
      const session = createAgentSession(initialShowroom());
      expectOk(session.applyCommandBatch(batch));
      return expectOk(session.exportScene({ format: 'json' })).content;
    };

    expect(run()).toBe(run());
  });
});

describe('MCP-lite agent runtime — demo workflow (messy showroom)', () => {
  it('load → structure → interact → arrange(role=product) → R3F includes semantic/behavior scaffolding', () => {
    const rt = createMcpLiteRuntime();
    expectOk(
      rt.applyCommand({
        type: 'REPLACE_SCENE',
        scene: initialShowroom(),
      }),
    );

    expectOk(rt.structureScene({ preset: 'showroom' }));
    const groups = expectOk(rt.getSemanticGroups()).semanticGroups;
    expect(Object.keys(groups).length).toBeGreaterThan(0);
    expect(groups.display_area?.nodeIds.length).toBeGreaterThan(0);

    expectOk(rt.makeInteractive({ targetRole: 'product' }));
    const behaviors = expectOk(rt.getBehaviors()).behaviors;
    expect(Object.keys(behaviors).length).toBeGreaterThan(0);
    expect(behaviors.product_click_select).toBeDefined();

    expectOk(
      rt.arrangeNodes({
        role: 'product',
        layout: 'grid',
        options: { cols: 3, spacing: 1.2 },
      }),
    );

    const r3f = expectOk(
      rt.exportR3F({
        semanticComponents: true,
        behaviorScaffold: 'handlers',
        mode: 'module',
        componentName: 'McpLiteDemo',
      }),
    );
    expect(r3f.content).toMatch(/semantic|Semantic|SEMANTIC/i);
    expect(r3f.content).toMatch(/behavior|Behavior|handleHover|handleSelect/i);
    expect(r3f.content).not.toContain('commandLog');
    expect(r3f.content).not.toContain('actionLog');
  });
});

describe('MCP-lite agent runtime — replay determinism', () => {
  const replayBatch = (): readonly [
    { type: 'STRUCTURE_SCENE'; preset: 'showroom' },
    { type: 'MAKE_INTERACTIVE'; targetRole: 'product' },
    {
      type: 'ARRANGE_NODES';
      nodeIds: string[];
      layout: 'grid';
      options: { cols: number; spacing: number };
    },
  ] => [
    { type: 'STRUCTURE_SCENE', preset: 'showroom' },
    { type: 'MAKE_INTERACTIVE', targetRole: 'product' },
    {
      type: 'ARRANGE_NODES',
      nodeIds: ['product_01', 'product_02', 'product_03'],
      layout: 'grid',
      options: { cols: 3, spacing: 1 },
    },
  ];

  it('same batch from same initial scene yields identical canonical JSON twice', () => {
    const runJson = (): string => {
      const rt = createMcpLiteRuntime(initialShowroom());
      expectOk(rt.applyCommandBatch([...replayBatch()]));
      return expectOk(rt.exportJSON()).content;
    };
    const a = runJson();
    const b = runJson();
    expect(a).toBe(b);
    expect(parseSceneJson(a)).toEqual(parseSceneJson(b));
  });

  it('R3F module output is stable for the replay batch (snapshot)', () => {
    const runR3f = (): string => {
      const rt = createMcpLiteRuntime(initialShowroom());
      expectOk(rt.applyCommandBatch([...replayBatch()]));
      return expectOk(
        rt.exportR3F({
          mode: 'module',
          componentName: 'ReplayShowroom',
          semanticComponents: true,
          behaviorScaffold: 'handlers',
        }),
      ).content;
    };
    expect(runR3f()).toMatchSnapshot();
  });
});

describe('MCP-lite agent runtime — safety surface', () => {
  const forbiddenRuntimeKeys = [
    'filesystem',
    'fs',
    'shell',
    'exec',
    'spawn',
    'child_process',
    'zustand',
    'useSceneStore',
    'eval',
    '__proto__',
  ];

  it('McpLiteRuntime exposes only the typed MCP-lite surface (no fs/shell/zustand-style hooks)', () => {
    const rt = createMcpLiteRuntime(showroomScene);
    const keys = Object.keys(rt).sort();
    expect(keys).toEqual([
      'applyCommand',
      'applyCommandBatch',
      'arrangeNodes',
      'dryRunCommand',
      'dryRunCommandBatch',
      'exportJSON',
      'exportR3F',
      'exportScene',
      'getActionLog',
      'getBehaviors',
      'getScene',
      'getSelection',
      'getSemanticGroups',
      'ingestAsset',
      'makeInteractive',
      'structureScene',
    ]);
    for (const ban of forbiddenRuntimeKeys) {
      expect(keys).not.toContain(ban);
    }
  });

  it('underlying AgentSession has no filesystem/shell/eval-style accessors', () => {
    const session = createAgentSession(showroomScene);
    const keys = Object.keys(session).sort();
    for (const ban of forbiddenRuntimeKeys) {
      expect(keys).not.toContain(ban);
    }
    expect(keys).toEqual([
      'applyCommand',
      'applyCommandBatch',
      'dryRunCommand',
      'dryRunCommandBatch',
      'exportScene',
      'getActionLog',
      'getCommandLog',
      'getScene',
      'getSelection',
      'loadScene',
    ]);
  });

  it('exported helpers are typed reducers / exporters, not arbitrary JS runners', () => {
    const rt = createMcpLiteRuntime(showroomScene);
    for (const fn of [
      rt.getScene,
      rt.getSemanticGroups,
      rt.getBehaviors,
      rt.applyCommand,
      rt.exportR3F,
    ]) {
      expect(fn.name).not.toMatch(/^eval$|^Function$/);
    }
  });
});
