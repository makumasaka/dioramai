export type {
  Vec3,
  Transform,
  SceneNode,
  Scene,
  NodeType,
  SceneLight,
  SceneEnvironment,
  SemanticRole,
  SemanticSource,
  Trait,
  NodeSemantics,
  SemanticGroup,
  BehaviorType,
  BehaviorDefinition,
  DioramaiAsset,
  InteractionBehavior,
  Metadata,
  JsonValue,
} from '@dioramai/schema';
export {
  serializeScene,
  parseSceneJson,
  cloneSceneFromJson,
  validateScene,
  cloneSceneImmutable,
  SceneLightSchema,
  SceneEnvironmentSchema,
  ColorHexSchema,
} from '@dioramai/schema';
export {
  createEmptyScene,
  createNode,
  createLightNode,
  createId,
  identityTransform,
  getNode,
  getChildren,
  getParent,
  isDescendant,
  collectSubtreeIds,
  getAncestorPath,
} from './scene';
export { getWorldMatrix, matrixToTransform } from './worldTransform';
export type { CreateNodeInput } from './scene';
export { applyCommand, applyCommandWithResult, applyReparent } from './commands';
export type { Command, CommandResult, EnvironmentPatch } from './commands';
export {
  mergeTransform,
  transformEqual,
  isEmptyPatch,
  vec3Equal,
} from './transform';
export type { TransformPatch } from './transform';
export { computeArrangement } from './layout';
export type { ArrangeLayout, ArrangeOptions } from './layout';
export {
  duplicateNodeInScene,
  collectSubtreeBfsOrder,
} from './duplicate';
export { summarizeCommand } from './commandLog';
export type { CommandSummary } from './commandLog';
export { replayCommands } from './replay';
export {
  getStarterScene,
  defaultFixtureScene,
  showroomScene,
  galleryScene,
  livingSpaceScene,
} from './fixtures';
export type { StarterKitId } from './fixtures';
export { CommandSchema, COMMAND_TYPES, COMMAND_SCHEMA_PARITY } from './commandSchema';
export { ok, err, issuesFromZod } from './result';
export type {
  CommandError,
  CommandErrorCode,
  CommandIssue,
  OkResult,
  ErrResult,
  Result,
} from './result';
