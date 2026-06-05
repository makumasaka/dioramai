export const DIORAMAI_MCP_TOOL_NAMES = [
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
