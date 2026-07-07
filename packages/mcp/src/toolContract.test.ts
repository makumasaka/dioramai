import { describe, expect, it } from 'vitest';
import {
  DIORAMAI_MCP_FORBIDDEN_CAPABILITIES,
  DIORAMAI_MCP_TOOL_DEFINITIONS,
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
      'update_environment',
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

  it('provides exactly one stdio tool definition per contract tool name', () => {
    const definitionNames = DIORAMAI_MCP_TOOL_DEFINITIONS.map((tool) => tool.name);
    expect([...definitionNames].sort()).toEqual([...DIORAMAI_MCP_TOOL_NAMES].sort());
    expect(new Set(definitionNames).size).toBe(definitionNames.length);
  });

  it('gives every stdio tool definition a description and object input schema', () => {
    for (const tool of DIORAMAI_MCP_TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });
});
