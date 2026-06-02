import { z } from 'zod';
import type {
  DioramaiAsset,
  BehaviorDefinition,
  Scene,
  SemanticGroup,
  SemanticRole,
} from '@dioramai/schema';
import { SemanticRoleSchema } from '@dioramai/schema';
import type { Command } from '@dioramai/core';
import { ingestAsset as planIngestAsset } from '@dioramai/ingestion';
import {
  type ArrangeLayout,
  type ArrangeOptions,
} from '@dioramai/core';
import {
  createAgentSession,
  type AgentSession,
  type ActionLogEntry,
  type ApplyCommandOptions,
  type ApplyCommandResult,
  type CommandBatchResult,
  type ExportSceneResult,
} from './session';
import {
  err,
  issuesFromZod,
  ok,
  type AgentResult,
} from './errors';

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const validationError = (message: string, error: z.ZodError) =>
  err({
    code: 'VALIDATION_ERROR',
    message,
    issues: issuesFromZod(error),
  });

const DryRunOptionSchema = z
  .object({
    dryRun: z.boolean().optional(),
  })
  .strict();

const CommandOptionSchema = z
  .object({
    dryRun: z.boolean().optional(),
    source: z.enum(['agent', 'system', 'user']).optional(),
  })
  .strict();

export const StructureSceneInputSchema = DryRunOptionSchema.extend({
  preset: z.literal('showroom').optional(),
});

export type StructureSceneInput = z.infer<typeof StructureSceneInputSchema>;

export const MakeInteractiveInputSchema = DryRunOptionSchema.extend({
  targetRole: SemanticRoleSchema.optional(),
});

export type MakeInteractiveInput = z.infer<typeof MakeInteractiveInputSchema>;

const ArrangeOptionsSchema = z
  .object({
    spacing: z.number().finite().optional(),
    cols: z.number().int().positive().optional(),
    radius: z.number().finite().optional(),
    axis: z.enum(['x', 'y', 'z']).optional(),
  })
  .strict();

export const ArrangeNodesInputSchema = DryRunOptionSchema.extend({
  nodeIds: z.array(z.string().min(1)).optional(),
  role: SemanticRoleSchema.optional(),
  layout: z.enum(['line', 'grid', 'circle']),
  options: ArrangeOptionsSchema.optional(),
}).refine((input) => input.nodeIds !== undefined || input.role !== undefined, {
  message: 'arrangeNodes requires nodeIds or role',
});

export type ArrangeNodesInput = z.infer<typeof ArrangeNodesInputSchema>;

export const ExportR3FInputSchema = z
  .object({
    includeStudioLights: z.boolean().optional(),
    includeLights: z.boolean().optional(),
    mode: z.enum(['fragment', 'module']).optional(),
    componentName: z.string().min(1).optional(),
    semanticComponents: z.boolean().optional(),
    behaviorScaffold: z.enum(['none', 'comments', 'handlers']).optional(),
    includeUserData: z.boolean().optional(),
  })
  .strict();

export type ExportR3FInput = z.infer<typeof ExportR3FInputSchema>;

export const IngestAssetInputSchema = z
  .object({
    kind: z.literal('local'),
    localPath: z.string().min(1),
    format: z.enum(['glb', 'gltf']),
    id: z.string().min(1).optional(),
    uri: z.string().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
    parentId: z.string().min(1).optional(),
    nodeId: z.string().min(1).optional(),
    nodeName: z.string().min(1).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

export type IngestAssetInput = z.infer<typeof IngestAssetInputSchema>;

export type IngestAssetResult = CommandBatchResult & {
  warnings: string[];
  assets?: DioramaiAsset[];
};

export const McpLiteExportSceneInputSchema = z
  .object({
    format: z.enum(['json', 'r3f']),
    options: ExportR3FInputSchema.optional(),
  })
  .strict();

export type McpLiteExportSceneInput = z.infer<typeof McpLiteExportSceneInputSchema>;

export interface McpLiteRuntimeOptions {}

export type AgentRuntimeOptions = McpLiteRuntimeOptions;

export type McpLiteRuntime = {
  getScene(): AgentResult<{ scene: Scene }>;
  getSemanticGroups(): AgentResult<{ semanticGroups: Record<string, SemanticGroup> }>;
  getBehaviors(): AgentResult<{ behaviors: Record<string, BehaviorDefinition> }>;
  getSelection(): AgentResult<{ selection: string | null }>;
  getActionLog(): AgentResult<{ entries: ActionLogEntry[] }>;
  dryRunCommand(input: unknown): AgentResult<ApplyCommandResult>;
  applyCommand(input: unknown, options?: unknown): AgentResult<ApplyCommandResult>;
  dryRunCommandBatch(input: unknown): AgentResult<CommandBatchResult>;
  applyCommandBatch(input: unknown, options?: unknown): AgentResult<CommandBatchResult>;
  ingestAsset(input: unknown): AgentResult<IngestAssetResult>;
  structureScene(input?: unknown): AgentResult<ApplyCommandResult>;
  makeInteractive(input?: unknown): AgentResult<ApplyCommandResult>;
  arrangeNodes(input: unknown): AgentResult<ApplyCommandResult>;
  exportScene(input: unknown): AgentResult<ExportSceneResult>;
  exportR3F(input?: unknown): AgentResult<ExportSceneResult>;
  exportJSON(): AgentResult<ExportSceneResult>;
};

export type AgentRuntime = McpLiteRuntime;

const commandResult = (
  runtime: AgentSession,
  command: Command,
  dryRun: boolean | undefined,
): AgentResult<ApplyCommandResult> =>
  dryRun === true
    ? runtime.dryRunCommand(command)
    : runtime.applyCommand(command, { source: 'agent' });

const commandBatchResult = (
  runtime: AgentSession,
  commands: Command[],
  dryRun: boolean | undefined,
): AgentResult<CommandBatchResult> =>
  dryRun === true
    ? runtime.dryRunCommandBatch(commands)
    : runtime.applyCommandBatch(commands, { source: 'agent' });

const nodeIdsForRole = (scene: Scene, role: SemanticRole): string[] =>
  Object.values(scene.nodes)
    .filter((node) => node.id !== scene.rootId)
    .filter((node) => node.semantics?.role === role || node.semanticRole === role)
    .map((node) => node.id);

const parseCommandOptions = (
  input: unknown,
): AgentResult<ApplyCommandOptions> => {
  const parsed = CommandOptionSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return validationError('Invalid command options payload', parsed.error);
  }
  return ok(parsed.data);
};

export const createMcpLiteRuntime = (
  initialScene?: Scene,
  options: McpLiteRuntimeOptions = {},
): McpLiteRuntime => {
  const runtime = createAgentSession(initialScene);

  return {
    getScene() {
      return runtime.getScene();
    },

    getSemanticGroups() {
      const scene = runtime.getScene();
      if (!scene.ok) return scene;
      return ok({
        semanticGroups: cloneJson(scene.data.scene.semanticGroups ?? {}),
      });
    },

    getBehaviors() {
      const scene = runtime.getScene();
      if (!scene.ok) return scene;
      return ok({
        behaviors: cloneJson(scene.data.scene.behaviors ?? {}),
      });
    },

    getSelection() {
      return runtime.getSelection();
    },

    getActionLog() {
      return runtime.getActionLog();
    },

    dryRunCommand(input: unknown) {
      return runtime.dryRunCommand(input);
    },

    applyCommand(input: unknown, options?: unknown) {
      const parsedOptions = parseCommandOptions(options);
      if (!parsedOptions.ok) return parsedOptions;
      return runtime.applyCommand(input, {
        source: parsedOptions.data.source ?? 'agent',
        dryRun: parsedOptions.data.dryRun,
      });
    },

    dryRunCommandBatch(input: unknown) {
      return runtime.dryRunCommandBatch(input);
    },

    applyCommandBatch(input: unknown, options?: unknown) {
      const parsedOptions = parseCommandOptions(options);
      if (!parsedOptions.ok) return parsedOptions;
      return runtime.applyCommandBatch(input, {
        source: parsedOptions.data.source ?? 'agent',
        dryRun: parsedOptions.data.dryRun,
      });
    },

    ingestAsset(input: unknown) {
      const parsed = IngestAssetInputSchema.safeParse(input);
      if (!parsed.success) {
        return validationError('Invalid ingestAsset payload', parsed.error);
      }

      const sceneResult = runtime.getScene();
      if (!sceneResult.ok) return sceneResult;
      const parentId = parsed.data.parentId ?? sceneResult.data.scene.rootId;

      const ingestion = planIngestAsset(
        {
          localPath: parsed.data.localPath,
          format: parsed.data.format,
          ...(parsed.data.id !== undefined ? { id: parsed.data.id } : {}),
          ...(parsed.data.uri !== undefined ? { uri: parsed.data.uri } : {}),
          ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata } : {}),
        },
        {
          parentId,
          nodeId: parsed.data.nodeId,
          nodeName: parsed.data.nodeName,
        },
      );

      const batch = commandBatchResult(runtime, ingestion.commands, parsed.data.dryRun);
      if (!batch.ok) return batch;
      return ok({
        ...batch.data,
        warnings: ingestion.warnings,
        ...(ingestion.assets !== undefined ? { assets: ingestion.assets } : {}),
      });
    },

    structureScene(input: unknown = {}) {
      const parsed = StructureSceneInputSchema.safeParse(input ?? {});
      if (!parsed.success) {
        return validationError('Invalid structureScene payload', parsed.error);
      }
      return commandResult(
        runtime,
        { type: 'STRUCTURE_SCENE', preset: parsed.data.preset ?? 'showroom' },
        parsed.data.dryRun,
      );
    },

    makeInteractive(input: unknown = {}) {
      const parsed = MakeInteractiveInputSchema.safeParse(input ?? {});
      if (!parsed.success) {
        return validationError('Invalid makeInteractive payload', parsed.error);
      }
      return commandResult(
        runtime,
        {
          type: 'MAKE_INTERACTIVE',
          ...(parsed.data.targetRole !== undefined ? { targetRole: parsed.data.targetRole } : {}),
        },
        parsed.data.dryRun,
      );
    },

    arrangeNodes(input: unknown) {
      const parsed = ArrangeNodesInputSchema.safeParse(input);
      if (!parsed.success) {
        return validationError('Invalid arrangeNodes payload', parsed.error);
      }
      let nodeIds = parsed.data.nodeIds;
      if (nodeIds === undefined) {
        const scene = runtime.getScene();
        if (!scene.ok) return scene;
        nodeIds = nodeIdsForRole(scene.data.scene, parsed.data.role as SemanticRole);
      }
      return commandResult(
        runtime,
        {
          type: 'ARRANGE_NODES',
          nodeIds,
          layout: parsed.data.layout as ArrangeLayout,
          ...(parsed.data.options !== undefined
            ? { options: parsed.data.options as ArrangeOptions }
            : {}),
        },
        parsed.data.dryRun,
      );
    },

    exportScene(input: unknown) {
      const parsed = McpLiteExportSceneInputSchema.safeParse(input);
      if (!parsed.success) {
        return validationError('Invalid exportScene payload', parsed.error);
      }
      if (parsed.data.format === 'json') {
        return runtime.exportScene({ format: 'json' });
      }
      return runtime.exportScene({ format: 'r3f', r3f: parsed.data.options ?? {} });
    },

    exportR3F(input: unknown = {}) {
      const parsed = ExportR3FInputSchema.safeParse(input ?? {});
      if (!parsed.success) {
        return validationError('Invalid exportR3F payload', parsed.error);
      }
      return runtime.exportScene({ format: 'r3f', r3f: parsed.data });
    },

    exportJSON() {
      return runtime.exportScene({ format: 'json' });
    },
  };
};

export const createAgentRuntime = (
  initialScene?: Scene,
  options: AgentRuntimeOptions = {},
): AgentRuntime => createMcpLiteRuntime(initialScene, options);
