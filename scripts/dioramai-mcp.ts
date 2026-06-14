import { DEFAULT_BRIDGE_PORT } from '@dioramai/local-bridge';

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const port = Number(process.env.DIORAMAI_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT);
const bridgeUrl = `http://127.0.0.1:${port}`;

const objectSchema = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const sceneRef = {
  type: 'object',
  description: 'A Dioramai scene graph object.',
  additionalProperties: true,
};

const tools: ToolDefinition[] = [
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
      scene: sceneRef,
      dryRun: { type: 'boolean' },
    }),
  },
  {
    name: 'register_asset',
    description: 'Register a project-relative GLB/GLTF asset and add an asset-backed scene node.',
    inputSchema: objectSchema({
      workspaceRelativePath: { type: 'string' },
      path: { type: 'string' },
      name: { type: 'string' },
      importMode: {
        type: 'string',
        enum: ['hierarchy', 'shallow', 'single'],
        description: 'hierarchy is the default; shallow is a backward-compatible alias; single creates one opaque asset node.',
      },
      semanticRole: {
        type: 'string',
        enum: ['product', 'display', 'seating', 'lighting', 'light', 'environment', 'navigation', 'decor', 'container', 'unknown'],
      },
      parentId: { type: 'string' },
      dryRun: { type: 'boolean' },
    }),
  },
  {
    name: 'import_glb_asset',
    description: 'Alias for register_asset. Import a project-relative GLB/GLTF path as an asset-backed scene node.',
    inputSchema: objectSchema({
      path: { type: 'string' },
      workspaceRelativePath: { type: 'string' },
      name: { type: 'string' },
      importMode: {
        type: 'string',
        enum: ['hierarchy', 'shallow', 'single'],
        description: 'hierarchy is the default; shallow is a backward-compatible alias; single creates one opaque asset node.',
      },
      semanticRole: {
        type: 'string',
        enum: ['product', 'display', 'seating', 'lighting', 'light', 'environment', 'navigation', 'decor', 'container', 'unknown'],
      },
      parentId: { type: 'string' },
      dryRun: { type: 'boolean' },
    }),
  },
  {
    name: 'update_transform',
    description: 'Apply a deterministic UPDATE_TRANSFORM command for one node.',
    inputSchema: objectSchema({
      nodeId: { type: 'string' },
      patch: objectSchema({
        position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        scale: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      }),
      dryRun: { type: 'boolean' },
    }, ['nodeId', 'patch']),
  },
  {
    name: 'export_r3f',
    description: 'Export the shared scene to the project generated R3F sync module.',
    inputSchema: objectSchema({
      write: { type: 'boolean' },
    }),
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
    name: 'sync_code',
    description: 'Synchronize scene/code. Default writes code; use direction "fromCode" to reload the generated scene block.',
    inputSchema: objectSchema({
      direction: { type: 'string', enum: ['toCode', 'fromCode'] },
    }),
  },
];

const writeResponse = (id: JsonRpcId | undefined, result: unknown): void => {
  if (id === undefined) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
};

const writeError = (id: JsonRpcId | undefined, code: number, message: string): void => {
  if (id === undefined) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
};

const bridgeFetch = async (toolName: string, args: unknown): Promise<unknown> => {
  const response = await fetch(`${bridgeUrl}/tools/${encodeURIComponent(toolName)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.DIORAMAI_BRIDGE_TOKEN ? { 'x-dioramai-token': process.env.DIORAMAI_BRIDGE_TOKEN } : {}),
    },
    body: JSON.stringify(args ?? {}),
  });
  return response.json() as Promise<unknown>;
};

const ensureBridge = async (): Promise<void> => {
  try {
    const health = await fetch(`${bridgeUrl}/health`);
    if (health.ok) return;
  } catch {
    // The MCP adapter is intentionally a bridge proxy only.
  }
  throw new Error(`Dioramai MCP requires a running local bridge at ${bridgeUrl}. Start it with: npx dioramai dev`);
};

const toolResult = (payload: unknown) => {
  const isError = typeof payload === 'object' && payload !== null && 'ok' in payload && (payload as { ok: unknown }).ok === false;
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    isError,
  };
};

const handleRequest = async (request: JsonRpcRequest): Promise<void> => {
  switch (request.method) {
    case 'initialize':
      writeResponse(request.id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'dioramai',
          version: '0.1.0',
        },
      });
      return;
    case 'notifications/initialized':
      return;
    case 'ping':
      writeResponse(request.id, {});
      return;
    case 'tools/list':
      writeResponse(request.id, { tools });
      return;
    case 'tools/call': {
      const name = typeof request.params?.name === 'string' ? request.params.name : '';
      const args = request.params?.arguments ?? {};
      if (!tools.some((tool) => tool.name === name)) {
        writeResponse(request.id, toolResult({ ok: false, error: { code: 'TOOL_NOT_FOUND', message: `Unknown tool: ${name}` } }));
        return;
      }
      const payload = await bridgeFetch(name, args);
      writeResponse(request.id, toolResult(payload));
      return;
    }
    default:
      writeError(request.id, -32601, `Method not found: ${request.method}`);
  }
};

const run = async (): Promise<void> => {
  await ensureBridge();
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (line.length === 0) continue;
      void Promise.resolve()
        .then(() => handleRequest(JSON.parse(line) as JsonRpcRequest))
        .catch((error) => writeError(undefined, -32603, error instanceof Error ? error.message : String(error)));
    }
  });
};

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
