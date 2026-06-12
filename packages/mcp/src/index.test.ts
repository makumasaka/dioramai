import { describe, expect, it, vi } from 'vitest';
import {
  createBridgeMcpClient,
  DIORAMAI_MCP_FORBIDDEN_CAPABILITIES,
  DIORAMAI_MCP_TOOL_NAMES,
  isDioramaiMcpToolName,
} from './index';

describe('@dioramai/mcp bridge-only surface', () => {
  it('exposes only the narrow local-bridge MCP tools', () => {
    expect(DIORAMAI_MCP_TOOL_NAMES).toEqual([
      'get_project_status',
      'get_scene',
      'load_scene',
      'register_asset',
      'import_glb_asset',
      'update_transform',
      'set_node_semantics',
      'add_behavior',
      'remove_behavior',
      'write_scene_to_file',
      'reload_scene_from_file',
      'export_r3f',
      'sync_code',
    ]);
    expect(DIORAMAI_MCP_FORBIDDEN_CAPABILITIES).toContain('apply_command');
    expect(DIORAMAI_MCP_FORBIDDEN_CAPABILITIES).toContain('generate_asset');
    expect(isDioramaiMcpToolName('update_transform')).toBe(true);
    expect(isDioramaiMcpToolName('apply_command')).toBe(false);
  });

  it('forwards tool calls to the local bridge without filesystem access', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { status: 'ok' } })));
    const client = createBridgeMcpClient({
      bridgeUrl: 'http://127.0.0.1:7777/',
      token: 'pair',
      fetchImpl,
    });

    await expect(client.callTool('get_project_status')).resolves.toEqual({
      ok: true,
      data: { status: 'ok' },
    });
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:7777/tools/get_project_status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dioramai-token': 'pair',
      },
      body: '{}',
    });
  });
});
