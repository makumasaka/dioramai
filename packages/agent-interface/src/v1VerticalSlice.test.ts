import { describe, expect, it } from 'vitest';
import { parseSceneJson } from '@dioramai/schema';
import { createMcpLiteRuntime } from './mcpLite';

const expectOk = <T>(result: { ok: true; data: T } | { ok: false; error: { message: string } }): T => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
};

describe('V1 vertical slice workflow', () => {
  it('runs ingest -> structure -> interactive -> arrange -> export', () => {
    const runtime = createMcpLiteRuntime();

    const ingested = expectOk(runtime.ingestAsset({
      kind: 'local',
      localPath: '/tmp/chair.glb',
      format: 'glb',
      uri: '/assets/models/chair.glb',
    }));
    expect(ingested.appliedCommandCount).toBe(2);
    expect(ingested.errors).toEqual([]);

    const structured = expectOk(runtime.structureScene({ preset: 'showroom' }));
    expect(structured.changed).toBe(true);

    const interactive = expectOk(runtime.makeInteractive({ targetRole: 'product' }));
    expect(interactive.changed).toBe(true);

    const arranged = expectOk(runtime.arrangeNodes({
      role: 'product',
      layout: 'line',
      options: { spacing: 1.25, axis: 'x' },
    }));
    expect(arranged.changed).toBe(true);

    const exported = expectOk(runtime.exportR3F({
      mode: 'module',
      componentName: 'ChairScene',
      behaviorScaffold: 'handlers',
      semanticComponents: true,
    }));
    expect(exported.content).toContain('useGLTF');
    expect(exported.content).toContain('/assets/models/chair.glb');
    expect(exported.content).toContain('function Product');
    expect(exported.content).toContain('handleSelect');
    expect(exported.content).toContain('ChairScene');

    const exportedJson = expectOk(runtime.exportJSON());
    const parsed = parseSceneJson(exportedJson.content);
    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    expect(parsed.assets).toBeDefined();
    expect(Object.keys(parsed.assets ?? {})).toHaveLength(1);

    const stableContent = exported.content.replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,
      '<scene-id>',
    );
    expect(stableContent).toMatchSnapshot();
  });
});
