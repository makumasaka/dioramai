import { describe, expect, it } from 'vitest';
import {
  DIORAMAI_MCP_FORBIDDEN_CAPABILITIES,
  DIORAMAI_MCP_TOOL_NAMES,
} from './index';

describe('Dioramai MCP P0 tool contract', () => {
  it('keeps MCP as a narrow local-bridge control plane', () => {
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
  });

  it('does not expose generation, shell, filesystem, or generic mutation tools', () => {
    for (const forbidden of DIORAMAI_MCP_FORBIDDEN_CAPABILITIES) {
      expect(DIORAMAI_MCP_TOOL_NAMES).not.toContain(forbidden);
    }
  });
});
