import type { Vec3 } from './types';
import {
  LegacySceneDocumentSchema,
  LegacySceneGraphSchema,
  SCENE_DATA_VERSION,
  SCENE_DOCUMENT_FORMAT,
  SceneDocumentSchema,
  SceneGraphSchema,
  type NodeType,
  type Scene,
  type SceneNode,
} from './schemas';

/** Deterministic JSON: sorted object keys at every depth (arrays keep order). */
export const stableStringify = (value: unknown, space = 2): string => {
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(norm);
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = norm(o[k]);
    return out;
  };
  return JSON.stringify(norm(value), null, space);
};

/**
 * Canonical JSON export: `dioramai-scene` document wrapper, version tag, and
 * {@link stableStringify} so object keys sort lexicographically at every depth
 * (arrays such as `children` keep graph order).
 */
export const serializeScene = (scene: Scene): string => {
  const doc = {
    format: SCENE_DOCUMENT_FORMAT,
    version: SCENE_DATA_VERSION,
    data: scene,
  };
  return stableStringify(doc);
};

type LegacyScene = Omit<Scene, 'nodes'> & {
  nodes: Record<string, Omit<SceneNode, 'type'> & { type?: NodeType }>;
};

const inferLegacyNodeType = (
  id: string,
  rootId: string,
  node: Omit<SceneNode, 'type'> & { type?: NodeType },
): NodeType => {
  if (id === rootId) return 'root';
  if (node.type !== undefined) return node.type;
  if (node.light !== undefined) return 'light';
  if (node.children.length > 0) return 'group';
  return 'mesh';
};

const migrateLegacyScene = (scene: LegacyScene): Scene | null => {
  const migrated = {
    ...scene,
    nodes: Object.fromEntries(
      Object.entries(scene.nodes).map(([id, node]) => [
        id,
        {
          ...node,
          type: inferLegacyNodeType(id, scene.rootId, node),
        },
      ]),
    ),
  };

  const current = SceneGraphSchema.safeParse(migrated);
  return current.success ? current.data : null;
};

export const parseSceneJson = (text: string): Scene | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    const doc = SceneDocumentSchema.safeParse(parsed);
    if (doc.success) return cloneSceneFromJson(doc.data.data);

    /*
     * Legacy support is intentionally limited to this documented migration path:
     * v1 document wrappers and pre-wrapper bare scene graphs are parsed with
     * legacy Zod schemas, default type/visible/metadata, then rewritten to the
     * current canonical root type contract.
     */
    const legacyDoc = LegacySceneDocumentSchema.safeParse(parsed);
    if (legacyDoc.success) {
      const migrated = migrateLegacyScene(legacyDoc.data.data);
      return migrated ? cloneSceneFromJson(migrated) : null;
    }

    const legacyBare = LegacySceneGraphSchema.safeParse(parsed);
    if (legacyBare.success) {
      const migrated = migrateLegacyScene(legacyBare.data);
      return migrated ? cloneSceneFromJson(migrated) : null;
    }
    return null;
  } catch {
    return null;
  }
};

/** Deep-clone a validated scene so callers cannot mutate shared fixture graphs. */
export const cloneSceneFromJson = (scene: Scene): Scene => ({
  rootId: scene.rootId,
  selection: scene.selection,
  ...(scene.semanticGroups !== undefined
    ? {
        semanticGroups: Object.fromEntries(
          Object.entries(scene.semanticGroups).map(([id, group]) => [
            id,
            {
              ...group,
              nodeIds: [...group.nodeIds],
              ...(group.tags !== undefined ? { tags: [...group.tags] } : {}),
              ...(group.metadata !== undefined ? { metadata: { ...group.metadata } } : {}),
            },
          ]),
        ),
      }
    : {}),
  ...(scene.behaviors !== undefined
    ? {
        behaviors: Object.fromEntries(
          Object.entries(scene.behaviors).map(([id, behavior]) => [
            id,
            {
              ...behavior,
              nodeIds: [...behavior.nodeIds],
              ...(behavior.params !== undefined ? { params: { ...behavior.params } } : {}),
            },
          ]),
        ),
      }
    : {}),
  ...(scene.assets !== undefined
    ? {
        assets: Object.fromEntries(
          Object.entries(scene.assets).map(([id, asset]) => [
            id,
            {
              ...asset,
              ...(asset.generator !== undefined ? { generator: { ...asset.generator } } : {}),
              ...(asset.metadata !== undefined ? { metadata: { ...asset.metadata } } : {}),
            },
          ]),
        ),
      }
    : {}),
  ...(scene.materials !== undefined
    ? {
        materials: Object.fromEntries(
          Object.entries(scene.materials).map(([id, material]) => [id, { ...material }]),
        ),
      }
    : {}),
  ...(scene.environment !== undefined
    ? { environment: { ...scene.environment } }
    : {}),
  ...(scene.renderSettings !== undefined
    ? { renderSettings: { ...scene.renderSettings } }
    : {}),
  ...(scene.layoutMetadata !== undefined
    ? { layoutMetadata: { ...scene.layoutMetadata } }
    : {}),
  ...(scene.metadata !== undefined ? { metadata: { ...scene.metadata } } : {}),
  nodes: Object.fromEntries(
    Object.entries(scene.nodes).map(([id, node]) => [
      id,
      {
        ...node,
        children: [...node.children],
        transform: {
          position: [...node.transform.position] as Vec3,
          rotation: [...node.transform.rotation] as Vec3,
          scale: [...node.transform.scale] as Vec3,
        },
        type: node.type,
        visible: node.visible,
        metadata: { ...node.metadata },
        ...(node.semantics !== undefined
          ? {
              semantics: {
                ...node.semantics,
                ...(node.semantics.traits !== undefined
                  ? { traits: [...node.semantics.traits] }
                  : {}),
                ...(node.semantics.tags !== undefined ? { tags: [...node.semantics.tags] } : {}),
              },
            }
          : {}),
        ...(node.behaviorRefs !== undefined ? { behaviorRefs: [...node.behaviorRefs] } : {}),
        ...(node.locked !== undefined ? { locked: node.locked } : {}),
        ...(node.semanticRole !== undefined ? { semanticRole: node.semanticRole } : {}),
        ...(node.semanticGroupId !== undefined ? { semanticGroupId: node.semanticGroupId } : {}),
        ...(node.behaviors !== undefined
          ? {
              behaviors: {
                ...node.behaviors,
                ...(node.behaviors.info !== undefined
                  ? { info: { ...node.behaviors.info } }
                  : {}),
              },
            }
          : {}),
        ...(node.assetRef !== undefined ? { assetRef: node.assetRef } : {}),
        ...(node.materialRef !== undefined ? { materialRef: node.materialRef } : {}),
        ...(node.light !== undefined ? { light: node.light } : {}),
      },
    ]),
  ),
});
