import { SceneGraphSchema, type Scene } from './schemas';

export const validateScene = (scene: unknown): scene is Scene =>
  SceneGraphSchema.safeParse(scene).success;

/** Returns a parsed scene graph or null if validation fails. */
export const parseSceneGraph = (scene: unknown): Scene | null => {
  const r = SceneGraphSchema.safeParse(scene);
  return r.success ? r.data : null;
};

export const cloneSceneImmutable = (scene: Scene): Scene => ({
  rootId: scene.rootId,
  selection: scene.selection,
  nodes: { ...scene.nodes },
  ...(scene.semanticGroups !== undefined ? { semanticGroups: { ...scene.semanticGroups } } : {}),
  ...(scene.behaviors !== undefined ? { behaviors: { ...scene.behaviors } } : {}),
  ...(scene.assets !== undefined ? { assets: { ...scene.assets } } : {}),
  ...(scene.materials !== undefined ? { materials: { ...scene.materials } } : {}),
  ...(scene.environment !== undefined ? { environment: { ...scene.environment } } : {}),
  ...(scene.renderSettings !== undefined ? { renderSettings: { ...scene.renderSettings } } : {}),
  ...(scene.layoutMetadata !== undefined ? { layoutMetadata: { ...scene.layoutMetadata } } : {}),
  ...(scene.metadata !== undefined ? { metadata: { ...scene.metadata } } : {}),
});
