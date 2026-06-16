import { z } from 'zod';

export const Vec3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

export type Vec3 = z.infer<typeof Vec3Schema>;

/** Local TRS transform. Rotation is Euler XYZ order in radians. */
export const TransformSchema = z.object({
  position: Vec3Schema,
  rotation: Vec3Schema,
  scale: Vec3Schema,
});

export type Transform = z.infer<typeof TransformSchema>;

export const AssetRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('uri'), uri: z.string().min(1) }),
]);

export type AssetRef = z.infer<typeof AssetRefSchema>;

export const MaterialRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('token'), token: z.string().min(1) }),
]);

export type MaterialRef = z.infer<typeof MaterialRefSchema>;

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

export const MetadataSchema = z.record(JsonValueSchema);

export type Metadata = z.infer<typeof MetadataSchema>;

export const NodeTypeSchema = z.enum(['root', 'group', 'mesh', 'light', 'empty']);

export type NodeType = z.infer<typeof NodeTypeSchema>;

export const SemanticRoleSchema = z.enum([
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
]);

export type SemanticRole = z.infer<typeof SemanticRoleSchema>;

export const SemanticSourceSchema = z.enum(['manual', 'rule', 'agent', 'import']);

export type SemanticSource = z.infer<typeof SemanticSourceSchema>;

export const TraitSchema = z.enum([
  'seatable',
  'clickable',
  'focusable',
  'hoverable',
  'displayable',
  'navigable',
]);

export type Trait = z.infer<typeof TraitSchema>;

export const NodeSemanticsSchema = z
  .object({
    role: SemanticRoleSchema.optional(),
    groupId: z.string().min(1).optional(),
    traits: z.array(TraitSchema).optional(),
    label: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    confidence: z.number().finite().min(0).max(1).optional(),
    source: SemanticSourceSchema.optional(),
  })
  .strict();

export type NodeSemantics = z.infer<typeof NodeSemanticsSchema>;

export const SemanticGroupSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    role: SemanticRoleSchema,
    nodeIds: z.array(z.string().min(1)),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    metadata: MetadataSchema.optional(),
  })
  .strict();

export type SemanticGroup = z.infer<typeof SemanticGroupSchema>;

export const BehaviorTypeSchema = z.enum([
  'hover_highlight',
  'click_select',
  'focus_camera',
  'anchor_point',
  'show_info',
  'open_url',
  'rotate_idle',
  'scroll_reveal',
]);

export type BehaviorType = z.infer<typeof BehaviorTypeSchema>;

export const BehaviorDefinitionSchema = z
  .object({
    id: z.string().min(1),
    type: BehaviorTypeSchema,
    nodeIds: z.array(z.string().min(1)),
    params: MetadataSchema.optional(),
    label: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

export type BehaviorDefinition = z.infer<typeof BehaviorDefinitionSchema>;

export const DioramaiAssetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    kind: z.enum(['primitive', 'gltf', 'glb', 'splat', 'external']),
    uri: z.string().min(1).optional(),
    source: z.enum(['starter', 'upload', 'generator', 'manual']).optional(),
    generator: MetadataSchema.optional(),
    metadata: MetadataSchema.optional(),
  })
  .strict();

export type DioramaiAsset = z.infer<typeof DioramaiAssetSchema>;

export const InteractionBehaviorSchema = z
  .object({
    hoverHighlight: z.boolean().optional(),
    clickSelect: z.boolean().optional(),
    focusOnClick: z.boolean().optional(),
    info: z
      .object({
        title: z.string(),
        description: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type InteractionBehavior = z.infer<typeof InteractionBehaviorSchema>;

/** Hex color string, e.g. "#ffffff". */
export const ColorHexSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Expected a hex color like #ffffff');

/** Optional authored light. Direction (directional/spot) derives from node rotation. */
export const SceneLightSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ambient'),
    intensity: z.number().finite().optional(),
    color: ColorHexSchema.optional(),
  }),
  z.object({
    kind: z.literal('directional'),
    intensity: z.number().finite().optional(),
    color: ColorHexSchema.optional(),
    castShadow: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('point'),
    intensity: z.number().finite().optional(),
    color: ColorHexSchema.optional(),
    /** Maps to three.js distance (range); 0 / undefined = infinite. */
    distance: z.number().finite().nonnegative().optional(),
    decay: z.number().finite().nonnegative().optional(),
    castShadow: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('spot'),
    intensity: z.number().finite().optional(),
    color: ColorHexSchema.optional(),
    distance: z.number().finite().nonnegative().optional(),
    decay: z.number().finite().nonnegative().optional(),
    /** Cone half-angle in radians (three.js spotLight.angle), max PI/2. */
    angle: z.number().finite().positive().optional(),
    penumbra: z.number().finite().min(0).max(1).optional(),
    castShadow: z.boolean().optional(),
  }),
]);

export type SceneLight = z.infer<typeof SceneLightSchema>;

/** Scene-level image-based lighting / environment configuration. */
export const SceneEnvironmentSchema = z.object({
  /** Project-relative public URI of the HDRI/EXR, e.g. "/assets/hdri/quarry_cloudy_1k.hdr". */
  hdriUri: z.string().min(1).optional(),
  /** When false, the HDRI is not applied (editor and deployed site). */
  enabled: z.boolean().default(true),
  /** When true, the HDRI is shown as the visible background/skybox. */
  showBackground: z.boolean().default(false),
  /** Environment lighting intensity multiplier. */
  intensity: z.number().finite().nonnegative().optional(),
  /** Y-axis rotation of the environment in radians. */
  rotationY: z.number().finite().optional(),
  /** Solid background color used when showBackground is false. */
  backgroundColor: ColorHexSchema.optional(),
});

export type SceneEnvironment = z.infer<typeof SceneEnvironmentSchema>;

const SceneNodeBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  children: z.array(z.string()),
  transform: TransformSchema,
  assetRef: AssetRefSchema.optional(),
  materialRef: MaterialRefSchema.optional(),
  light: SceneLightSchema.optional(),
});

export const SceneNodeSchema = SceneNodeBaseSchema.extend({
  type: NodeTypeSchema,
  visible: z.boolean(),
  metadata: MetadataSchema,
  semantics: NodeSemanticsSchema.optional(),
  behaviorRefs: z.array(z.string().min(1)).optional(),
  locked: z.boolean().optional(),
  semanticRole: SemanticRoleSchema.optional(),
  semanticGroupId: z.string().min(1).optional(),
  behaviors: InteractionBehaviorSchema.optional(),
});

const LegacySceneNodeSchema = SceneNodeBaseSchema.extend({
  type: NodeTypeSchema.optional(),
  visible: z.boolean().default(true),
  metadata: MetadataSchema.default({}),
});

export type SceneNode = z.infer<typeof SceneNodeSchema>;

type GraphShape = {
  rootId: string;
  nodes: Record<string, { id: string; children: string[] }>;
  selection: string | null;
};

const graphStructuralRefinements = (
  val: GraphShape,
  ctx: z.RefinementCtx,
) => {
  const { rootId, nodes, selection } = val;
  const ids = new Set(Object.keys(nodes));

  if (!ids.has(rootId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'rootId missing from nodes' });
    return;
  }

  for (const [id, node] of Object.entries(nodes)) {
    if (node.id !== id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `node key/id mismatch for ${id}`,
      });
    }
    const seenChild = new Set<string>();
    for (const c of node.children) {
      if (seenChild.has(c)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate child ref ${c} on node ${id}`,
        });
      }
      seenChild.add(c);
      if (!ids.has(c)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `missing child ${c} on node ${id}`,
        });
      }
    }
  }

  const root = nodes[rootId];
  if (!root || root.id !== rootId) return;

  for (const [, node] of Object.entries(nodes)) {
    if (node.children.includes(rootId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'root cannot appear as a child',
      });
    }
  }

  const parentOf = new Map<string, string>();
  for (const [pid, node] of Object.entries(nodes)) {
    for (const c of node.children) {
      if (parentOf.has(c)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `multiple parents for child ${c}`,
        });
      }
      parentOf.set(c, pid);
    }
  }

  parentOf.delete(rootId);

  for (const id of ids) {
    if (id === rootId) continue;
    if (!parentOf.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `orphan node ${id}`,
      });
    }
  }

  const visited = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (visited.has(id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `cycle or duplicate visit at ${id}` });
      return;
    }
    visited.add(id);
    const n = nodes[id];
    if (!n) continue;
    for (const c of n.children) stack.push(c);
  }

  for (const id of ids) {
    if (!visited.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unreachable node ${id}`,
      });
    }
  }

  if (selection !== null && !ids.has(selection)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'selection references missing node',
    });
  }
};

const graphRootTypeRefinement = (
  val: { rootId: string; nodes: Record<string, SceneNode> },
  ctx: z.RefinementCtx,
) => {
  const root = val.nodes[val.rootId];
  if (root && root.type !== 'root') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'rootId node must have type root',
    });
  }
  for (const [id, node] of Object.entries(val.nodes)) {
    if (id !== val.rootId && node.type === 'root') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `non-root node ${id} cannot have type root`,
      });
    }
  }
};

const semanticAndBehaviorRefinements = (
  val: {
    nodes: Record<string, SceneNode>;
    semanticGroups?: Record<string, SemanticGroup>;
    behaviors?: Record<string, BehaviorDefinition>;
  },
  ctx: z.RefinementCtx,
) => {
  const ids = new Set(Object.keys(val.nodes));
  for (const [groupId, group] of Object.entries(val.semanticGroups ?? {})) {
    if (group.id !== groupId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `semantic group key/id mismatch for ${groupId}`,
      });
    }
    for (const nodeId of group.nodeIds) {
      if (!ids.has(nodeId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `semantic group ${groupId} references missing node ${nodeId}`,
        });
      }
    }
  }
  const behaviorIds = new Set(Object.keys(val.behaviors ?? {}));
  for (const [behaviorId, behavior] of Object.entries(val.behaviors ?? {})) {
    if (behavior.id !== behaviorId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `behavior key/id mismatch for ${behaviorId}`,
      });
    }
    for (const nodeId of behavior.nodeIds) {
      if (!ids.has(nodeId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `behavior ${behaviorId} references missing node ${nodeId}`,
        });
      }
    }
  }
  for (const [nodeId, node] of Object.entries(val.nodes)) {
    if (node.semantics?.groupId && !(node.semantics.groupId in (val.semanticGroups ?? {}))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `node ${nodeId} references missing semantic group ${node.semantics.groupId}`,
      });
    }
    for (const behaviorId of node.behaviorRefs ?? []) {
      if (!behaviorIds.has(behaviorId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `node ${nodeId} references missing behavior ${behaviorId}`,
        });
      }
    }
  }
};

const currentGraphRefinements = (
  val: {
    rootId: string;
    nodes: Record<string, SceneNode>;
    selection: string | null;
    semanticGroups?: Record<string, SemanticGroup>;
    behaviors?: Record<string, BehaviorDefinition>;
  },
  ctx: z.RefinementCtx,
) => {
  graphStructuralRefinements(val, ctx);
  graphRootTypeRefinement(val, ctx);
  semanticAndBehaviorRefinements(val, ctx);
};

const SceneGraphBaseSchema = z.object({
  rootId: z.string().min(1),
  nodes: z.record(z.string(), SceneNodeSchema),
  selection: z.string().nullable().default(null),
  semanticGroups: z.record(z.string(), SemanticGroupSchema).optional(),
  behaviors: z.record(z.string(), BehaviorDefinitionSchema).optional(),
  assets: z.record(z.string(), DioramaiAssetSchema).optional(),
  materials: z.record(z.string(), MetadataSchema).optional(),
  environment: SceneEnvironmentSchema.optional(),
  layoutMetadata: MetadataSchema.optional(),
  metadata: MetadataSchema.optional(),
});

const LegacySceneGraphBaseSchema = z.object({
  rootId: z.string().min(1),
  nodes: z.record(z.string(), LegacySceneNodeSchema),
  selection: z.string().nullable().default(null),
});

export const SceneGraphSchema = SceneGraphBaseSchema.superRefine(currentGraphRefinements);

export type Scene = z.infer<typeof SceneGraphSchema>;

/** Canonical on-disk / interchange format id (post-rebrand). */
export const SCENE_DOCUMENT_FORMAT = 'dioramai-scene' as const;
/** Legacy format id; still accepted by {@link SceneDocumentSchema} for parse/migration. */
export const SCENE_DOCUMENT_LEGACY_FORMAT = 'diorama-scene' as const;
export const SCENE_LEGACY_DATA_VERSION = 1 as const;
export const SCENE_DATA_VERSION = 2 as const;

const SceneDocumentFormatSchema = z.union([
  z.literal(SCENE_DOCUMENT_FORMAT),
  z.literal(SCENE_DOCUMENT_LEGACY_FORMAT),
]);

export const SceneDocumentSchema = z.object({
  format: SceneDocumentFormatSchema,
  version: z.literal(SCENE_DATA_VERSION),
  data: SceneGraphSchema,
});

export type SceneDocument = z.infer<typeof SceneDocumentSchema>;

export const LegacySceneGraphSchema = LegacySceneGraphBaseSchema.superRefine(
  graphStructuralRefinements,
);

export const LegacySceneDocumentSchema = z.object({
  format: SceneDocumentFormatSchema,
  version: z.literal(SCENE_LEGACY_DATA_VERSION),
  data: LegacySceneGraphSchema,
});
