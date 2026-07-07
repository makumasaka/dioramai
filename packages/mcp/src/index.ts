export const DIORAMAI_MCP_TOOL_NAMES = [
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
] as const;

export type DioramaiMcpToolName = typeof DIORAMAI_MCP_TOOL_NAMES[number];

export const DIORAMAI_MCP_FORBIDDEN_CAPABILITIES = [
  'shell',
  'read_file',
  'write_file',
  'apply_command',
  'apply_command_batch',
  'generate_asset',
  'generate_and_ingest_asset',
] as const;

/**
 * MCP tool definition shape shared by the stdio proxies (`scripts/dioramai-mcp.ts`
 * and the `dioramai mcp` CLI subcommand). Kept as plain JSON Schema so the
 * definitions can be returned directly from `tools/list`.
 */
export type DioramaiMcpToolDefinition = {
  name: DioramaiMcpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
};

const objectSchema = (
  properties: Record<string, unknown> = {},
  required: string[] = [],
): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const vector3Schema = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };

const importModeSchema = {
  type: 'string',
  enum: ['hierarchy', 'shallow', 'single'],
  description:
    'hierarchy is the default; shallow is a backward-compatible alias; single creates one opaque asset node.',
};

const semanticRoleSchema = {
  type: 'string',
  enum: [
    'product',
    'display',
    'seating',
    'lighting',
    'light',
    'environment',
    'navigation',
    'decor',
    'container',
    'unknown',
  ],
};

const registerAssetProperties = {
  workspaceRelativePath: { type: 'string' },
  path: { type: 'string' },
  name: { type: 'string' },
  importMode: importModeSchema,
  semanticRole: semanticRoleSchema,
  parentId: { type: 'string' },
  dryRun: { type: 'boolean' },
};

/**
 * Canonical stdio tool definitions. Every name in
 * {@link DIORAMAI_MCP_TOOL_NAMES} must have exactly one definition here; the
 * contract test enforces this so the proxies cannot drift from the bridge.
 */
export const DIORAMAI_MCP_TOOL_DEFINITIONS: readonly DioramaiMcpToolDefinition[] = [
  {
    name: 'get_project_status',
    description: 'Return the local Dioramai bridge project status and configured safe paths.',
    inputSchema: objectSchema(),
  },
  {
    name: 'get_scene',
    description: 'Return the active Dioramai bridge scene.',
    inputSchema: objectSchema(),
  },
  {
    name: 'load_scene',
    description: 'Replace the shared bridge scene from JSON text or a parsed scene graph.',
    inputSchema: objectSchema({
      json: { type: 'string' },
      scene: { type: 'object', description: 'A Dioramai scene graph object.', additionalProperties: true },
      dryRun: { type: 'boolean' },
    }),
  },
  {
    name: 'register_asset',
    description: 'Register a project-relative GLB/GLTF asset and add an asset-backed scene node.',
    inputSchema: objectSchema(registerAssetProperties),
  },
  {
    name: 'import_glb_asset',
    description: 'Alias for register_asset. Import a project-relative GLB/GLTF path as an asset-backed scene node.',
    inputSchema: objectSchema(registerAssetProperties),
  },
  {
    name: 'update_transform',
    description: 'Apply a deterministic UPDATE_TRANSFORM command for one node.',
    inputSchema: objectSchema(
      {
        nodeId: { type: 'string' },
        patch: objectSchema({
          position: vector3Schema,
          rotation: vector3Schema,
          scale: vector3Schema,
        }),
        dryRun: { type: 'boolean' },
      },
      ['nodeId', 'patch'],
    ),
  },
  {
    name: 'update_environment',
    description: 'Apply a deterministic UPDATE_ENVIRONMENT command for scene-level HDRI lighting.',
    inputSchema: objectSchema(
      {
        patch: objectSchema({
          hdriUri: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
          enabled: { type: 'boolean' },
          showBackground: { type: 'boolean' },
          intensity: { type: 'number', minimum: 0 },
          rotationY: { type: 'number' },
          backgroundColor: { type: 'string' },
        }),
        dryRun: { type: 'boolean' },
      },
      ['patch'],
    ),
  },
  {
    name: 'set_node_semantics',
    description: 'Apply a deterministic SET_NODE_SEMANTICS command to tag nodes with role, label, tags, or description.',
    inputSchema: objectSchema(
      {
        nodeIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        semantics: objectSchema({
          role: semanticRoleSchema,
          label: { type: 'string' },
          description: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        }),
        dryRun: { type: 'boolean' },
      },
      ['nodeIds', 'semantics'],
    ),
  },
  {
    name: 'add_behavior',
    description: 'Apply a deterministic ADD_BEHAVIOR command attaching an interaction behavior to nodes.',
    inputSchema: objectSchema(
      {
        behavior: objectSchema(
          {
            id: { type: 'string' },
            type: {
              type: 'string',
              enum: [
                'hover_highlight',
                'click_select',
                'focus_camera',
                'anchor_point',
                'show_info',
                'open_url',
                'rotate_idle',
                'scroll_reveal',
              ],
            },
            nodeIds: { type: 'array', items: { type: 'string' } },
            params: { type: 'object', additionalProperties: true },
            label: { type: 'string' },
            description: { type: 'string' },
          },
          ['id', 'type', 'nodeIds'],
        ),
        dryRun: { type: 'boolean' },
      },
      ['behavior'],
    ),
  },
  {
    name: 'remove_behavior',
    description: 'Apply a deterministic REMOVE_BEHAVIOR command removing a behavior by id.',
    inputSchema: objectSchema(
      {
        behaviorId: { type: 'string' },
        dryRun: { type: 'boolean' },
      },
      ['behaviorId'],
    ),
  },
  {
    name: 'write_scene_to_file',
    description: 'Write the current canonical scene to the generated R3F module and scene JSON file.',
    inputSchema: objectSchema(),
  },
  {
    name: 'reload_scene_from_file',
    description: 'Reload canonical scene state from the generated R3F scene block or scene JSON file.',
    inputSchema: objectSchema(),
  },
  {
    name: 'export_r3f',
    description: 'Export the shared scene to the project generated R3F sync module.',
    inputSchema: objectSchema({
      write: { type: 'boolean' },
    }),
  },
  {
    name: 'sync_code',
    description: 'Synchronize scene/code. Default writes code; use direction "fromCode" to reload the generated scene block.',
    inputSchema: objectSchema({
      direction: { type: 'string', enum: ['toCode', 'fromCode'] },
    }),
  },
];

export type BridgeMcpClientOptions = {
  bridgeUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
};

export type BridgeMcpClient = {
  bridgeUrl: string;
  callTool: (name: DioramaiMcpToolName, args?: unknown) => Promise<unknown>;
};

export const isDioramaiMcpToolName = (value: string): value is DioramaiMcpToolName =>
  DIORAMAI_MCP_TOOL_NAMES.includes(value as DioramaiMcpToolName);

export const createBridgeMcpClient = (
  options: BridgeMcpClientOptions = {},
): BridgeMcpClient => {
  const bridgeUrl = (options.bridgeUrl ?? 'http://127.0.0.1:7777').replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    bridgeUrl,
    async callTool(name, args = {}) {
      const response = await fetchImpl(`${bridgeUrl}/tools/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.token ? { 'x-dioramai-token': options.token } : {}),
        },
        body: JSON.stringify(args),
      });
      return response.json() as Promise<unknown>;
    },
  };
};
