import { z } from 'zod';
import type { Command } from './commands';
import {
  BehaviorDefinitionSchema,
  DioramaiAssetSchema,
  SceneGraphSchema,
  SceneLightSchema,
  SceneNodeSchema,
  SemanticGroupSchema,
  SemanticRoleSchema,
  NodeSemanticsSchema,
  Vec3Schema,
} from '@dioramai/schema';

export const COMMAND_TYPES = [
  'ADD_NODE',
  'DELETE_NODE',
  'UPDATE_TRANSFORM',
  'STRUCTURE_SCENE',
  'MAKE_INTERACTIVE',
  'CREATE_SEMANTIC_GROUP',
  'ASSIGN_TO_SEMANTIC_GROUP',
  'SET_NODE_SEMANTICS',
  'ADD_BEHAVIOR',
  'REMOVE_BEHAVIOR',
  'DUPLICATE_NODE',
  'SET_PARENT',
  'ARRANGE_NODES',
  'REGISTER_ASSET',
  'SET_SELECTION',
  'REPLACE_SCENE',
  'UPDATE_LIGHT',
  'UPDATE_ENVIRONMENT',
  'SET_NODE_VISIBLE',
] as const satisfies readonly Command['type'][];

type CommandTypeParity = Record<Command['type'], true>;

export const COMMAND_SCHEMA_PARITY: CommandTypeParity = {
  ADD_NODE: true,
  DELETE_NODE: true,
  UPDATE_TRANSFORM: true,
  STRUCTURE_SCENE: true,
  MAKE_INTERACTIVE: true,
  CREATE_SEMANTIC_GROUP: true,
  ASSIGN_TO_SEMANTIC_GROUP: true,
  SET_NODE_SEMANTICS: true,
  ADD_BEHAVIOR: true,
  REMOVE_BEHAVIOR: true,
  DUPLICATE_NODE: true,
  SET_PARENT: true,
  ARRANGE_NODES: true,
  REGISTER_ASSET: true,
  SET_SELECTION: true,
  REPLACE_SCENE: true,
  UPDATE_LIGHT: true,
  UPDATE_ENVIRONMENT: true,
  SET_NODE_VISIBLE: true,
};

const TransformPatchSchema = z
  .object({
    position: Vec3Schema.optional(),
    rotation: Vec3Schema.optional(),
    scale: Vec3Schema.optional(),
  })
  .strict()
  .refine(
    (p) =>
      p.position !== undefined ||
      p.rotation !== undefined ||
      p.scale !== undefined,
    { message: 'patch must include at least one of position, rotation, scale' },
  );

/** Patch shape for UPDATE_ENVIRONMENT: all fields optional, no defaults applied. */
const EnvironmentPatchSchema = z
  .object({
    hdriUri: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    showBackground: z.boolean().optional(),
    intensity: z.number().finite().nonnegative().optional(),
    rotationY: z.number().finite().optional(),
    backgroundColor: z
      .string()
      .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
      .optional(),
  })
  .strict();

const ArrangeLayoutSchema = z.enum(['line', 'grid', 'circle']);

const ArrangeOptionsSchema = z
  .object({
    spacing: z.number().finite().optional(),
    cols: z.number().int().positive().optional(),
    radius: z.number().finite().optional(),
    axis: z.enum(['x', 'y', 'z']).optional(),
  })
  .strict();

/**
 * Zod mirror of {@link Command} for validating untrusted agent/MCP payloads
 * before they reach the core reducer.
 *
 * Convention: any future core command union change must update this file,
 * docs/COMMANDS.md, core command tests, and command schema tests.
 */
export const CommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('ADD_NODE'),
      parentId: z.string().min(1),
      node: SceneNodeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('DELETE_NODE'),
      nodeId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('UPDATE_TRANSFORM'),
      nodeId: z.string().min(1),
      patch: TransformPatchSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('STRUCTURE_SCENE'),
      preset: z.literal('showroom'),
    })
    .strict(),
  z
    .object({
      type: z.literal('MAKE_INTERACTIVE'),
      targetRole: SemanticRoleSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('CREATE_SEMANTIC_GROUP'),
      group: SemanticGroupSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('ASSIGN_TO_SEMANTIC_GROUP'),
      groupId: z.string().min(1),
      nodeIds: z.array(z.string().min(1)),
    })
    .strict(),
  z
    .object({
      type: z.literal('SET_NODE_SEMANTICS'),
      nodeIds: z.array(z.string().min(1)),
      semantics: NodeSemanticsSchema.partial(),
    })
    .strict(),
  z
    .object({
      type: z.literal('ADD_BEHAVIOR'),
      behavior: BehaviorDefinitionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('REMOVE_BEHAVIOR'),
      behaviorId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('DUPLICATE_NODE'),
      nodeId: z.string().min(1),
      includeSubtree: z.boolean(),
      newParentId: z.string().min(1).optional(),
      idMap: z.record(z.string().min(1), z.string().min(1)).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('SET_PARENT'),
      nodeId: z.string().min(1),
      parentId: z.string().min(1),
      preserveWorldTransform: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('ARRANGE_NODES'),
      nodeIds: z.array(z.string().min(1)),
      layout: ArrangeLayoutSchema,
      options: ArrangeOptionsSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('REGISTER_ASSET'),
      asset: DioramaiAssetSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('REPLACE_SCENE'),
      scene: SceneGraphSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('SET_SELECTION'),
      nodeId: z.string().min(1).nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('UPDATE_LIGHT'),
      nodeId: z.string().min(1),
      light: SceneLightSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('UPDATE_ENVIRONMENT'),
      patch: EnvironmentPatchSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('SET_NODE_VISIBLE'),
      nodeId: z.string().min(1),
      visible: z.boolean(),
    })
    .strict(),
]) as z.ZodType<Command>;
