import type { SemanticGroup } from '@dioramai/schema';
import { buildR3fExportModel } from './sceneToR3fModel';
import { sanitizeIdentifier, wrapperNameForGroup } from './semanticMapper';
import { behaviorRequirementSummary } from './behaviorMapper';
import {
  escapeAttr,
  escapeComment,
  escapeStringLiteral,
  fmtNum,
  fmtVec,
  indent,
} from './jsxWriter';
import type {
  R3fBehaviorRequirement,
  R3fExportDiagnostic,
  R3fExportResult,
  R3fModuleExportOptions,
  R3fResolvedNode,
} from './types';
import type { Scene } from '@dioramai/schema';

type SafeGroupWrapper = {
  group: SemanticGroup;
  wrapperName: string;
  memberIds: string[];
};

const hasRequirement = (node: R3fResolvedNode, type: R3fBehaviorRequirement['type']): boolean =>
  node.behaviorRequirements.some((r) => r.type === type);

const infoRequirement = (node: R3fResolvedNode): R3fBehaviorRequirement | undefined =>
  node.behaviorRequirements.find((r) => r.type === 'show_info');

const needsSelectionState = (nodes: R3fResolvedNode[], mode: R3fModuleExportOptions['behaviorScaffold']): boolean =>
  mode === 'handlers' &&
  nodes.some((node) => hasRequirement(node, 'click_select') || hasRequirement(node, 'show_info'));

const needsHoverHandlers = (nodes: R3fResolvedNode[], mode: R3fModuleExportOptions['behaviorScaffold']): boolean =>
  mode === 'handlers' && nodes.some((node) => hasRequirement(node, 'hover_highlight'));

const needsFocusHandler = (nodes: R3fResolvedNode[], mode: R3fModuleExportOptions['behaviorScaffold']): boolean =>
  mode === 'handlers' && nodes.some((node) => hasRequirement(node, 'focus_camera'));

const unsupportedBehaviorTypes = [
  'anchor_point',
  'open_url',
  'rotate_idle',
  'scroll_reveal',
] as const;

const todoBehaviorsForNode = (node: R3fResolvedNode): string[] =>
  node.behaviorRequirements
    .filter((r) => unsupportedBehaviorTypes.includes(r.type as (typeof unsupportedBehaviorTypes)[number]))
    .map((r) => r.type);

const componentNamesForModel = (
  nodes: R3fResolvedNode[],
  semanticComponents: boolean,
): Set<string> => {
  const out = new Set<string>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    out.add(semanticComponents ? node.componentName : node.hasLight ? 'SceneLight' : node.showPlaceholderMesh ? 'SceneMesh' : 'SceneGroup');
  }
  return out;
};

const needsAssetLoader = (nodes: R3fResolvedNode[]): boolean =>
  nodes.some((node) => node.showAssetModel && typeof node.assetUri === 'string');

const safeWrapperMapFromScene = (
  root: R3fResolvedNode | null,
  groups: SemanticGroup[],
  diagnostics: R3fExportDiagnostic[],
): Map<string, SafeGroupWrapper> => {
  const byFirstMember = new Map<string, SafeGroupWrapper>();
  if (!root) return byFirstMember;

  const visit = (parent: R3fResolvedNode) => {
    const visibleChildIds = parent.children.map((child) => child.id);
    for (const group of groups) {
      const members = group.nodeIds.filter((id) => visibleChildIds.includes(id));
      if (members.length === 0 || members.length !== group.nodeIds.length) continue;
      const indices = members.map((id) => visibleChildIds.indexOf(id)).sort((a, b) => a - b);
      const first = indices[0] ?? -1;
      const contiguous = indices.every((idx, i) => idx === first + i);
      if (!contiguous) {
        diagnostics.push({
          level: 'info',
          code: 'semantic_group_not_contiguous',
          message: `Semantic group ${group.id} is not contiguous under parent ${parent.id}; exporter preserved scene child order and emitted comments instead of wrapping.`,
        });
        continue;
      }
      const firstId = visibleChildIds[first];
      if (!firstId || byFirstMember.has(firstId)) continue;
      byFirstMember.set(firstId, {
        group,
        wrapperName: wrapperNameForGroup(group.role, group.name),
        memberIds: visibleChildIds.slice(first, first + members.length),
      });
    }
    for (const child of parent.children) visit(child);
  };
  visit(root);
  return byFirstMember;
};

const emitImports = (needsState: boolean, includeAssetLoader: boolean): string => {
  const reactHooks = [
    needsState ? 'useState' : null,
    includeAssetLoader ? 'useMemo' : null,
  ].filter((hook): hook is string => hook !== null);
  const reactImports = reactHooks.length > 0
    ? `import { ${reactHooks.join(', ')} } from 'react';\nimport type { ReactNode } from 'react';\n`
    : `import type { ReactNode } from 'react';\n`;
  const assetImports = includeAssetLoader
    ? `import { useGLTF } from '@react-three/drei';\nimport { SkeletonUtils } from 'three-stdlib';\n`
    : '';
  return `${reactImports}import type { ThreeElements } from '@react-three/fiber';\n${assetImports}\n`;
};

const emitAssetModel = (): string =>
  `function AssetModel({ uri }: { uri: string }) {\n` +
  `  const gltf = useGLTF(uri);\n` +
  `  const object = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf.scene]);\n` +
  `  return <primitive object={object} />;\n` +
  `}\n\n`;

const emitSemanticNode = (): string =>
  `type SemanticNodeProps = Omit<ThreeElements['group'], 'children'> & {\n` +
  `  sourceId: string;\n` +
  `  semanticRole: string;\n` +
  `  renderMesh?: boolean;\n` +
  `  assetUri?: string;\n` +
  `  children?: ReactNode;\n` +
  `  onSelect?: () => void;\n` +
  `  onHoverStart?: () => void;\n` +
  `  onHoverEnd?: () => void;\n` +
  `};\n\n` +
  `function SemanticNode(props: SemanticNodeProps) {\n` +
  `  const { sourceId, semanticRole, renderMesh, assetUri, children, onSelect, onHoverStart, onHoverEnd, ...groupProps } = props;\n` +
  `  return (\n` +
  `    <group\n` +
  `      {...groupProps}\n` +
  `      userData={{ sourceId, semanticRole }}\n` +
  `      onPointerOver={onHoverStart}\n` +
  `      onPointerOut={onHoverEnd}\n` +
  `      onClick={onSelect}\n` +
  `    >\n` +
  `      {assetUri ? (\n` +
  `        <AssetModel uri={assetUri} />\n` +
  `      ) : renderMesh ? (\n` +
  `        <mesh castShadow receiveShadow>\n` +
  `          <boxGeometry args={[1, 1, 1]} />\n` +
  `          <meshStandardMaterial color="#9ca3af" />\n` +
  `        </mesh>\n` +
  `      ) : null}\n` +
  `      {children}\n` +
  `    </group>\n` +
  `  );\n` +
  `}\n\n` +
  `type SemanticComponentProps = Omit<SemanticNodeProps, 'semanticRole'>;\n\n`;

const roleForComponent = (name: string): string => {
  switch (name) {
    case 'Product':
      return 'product';
    case 'DisplaySurface':
      return 'display';
    case 'SeatingElement':
      return 'seating';
    case 'EnvironmentGroup':
      return 'environment';
    case 'NavigationMarker':
      return 'navigation';
    case 'DecorElement':
      return 'decor';
    case 'SceneSection':
      return 'container';
    default:
      return 'unknown';
  }
};

const emitComponent = (name: string): string => {
  if (name === 'SceneLight') {
    return (
      `function SceneLight(props: ThreeElements['group'] & { sourceId: string; lightKind: 'ambient' | 'directional' | 'point' | 'spot'; lightIntensity?: number; lightColor?: string; lightDistance?: number; lightDecay?: number; lightAngle?: number; lightPenumbra?: number; lightCastShadow?: boolean; children?: ReactNode }) {\n` +
      `  const { sourceId, lightKind, lightIntensity, lightColor, lightDistance, lightDecay, lightAngle, lightPenumbra, lightCastShadow, children, ...groupProps } = props;\n` +
      `  const color = lightColor ?? '#ffffff';\n` +
      `  return (\n` +
      `    <group {...groupProps} userData={{ sourceId, semanticRole: 'light' }}>\n` +
      `      {lightKind === 'ambient' ? (\n` +
      `        <ambientLight color={color} intensity={lightIntensity} />\n` +
      `      ) : lightKind === 'point' ? (\n` +
      `        <pointLight color={color} intensity={lightIntensity} distance={lightDistance} decay={lightDecay} castShadow={lightCastShadow} />\n` +
      `      ) : lightKind === 'spot' ? (\n` +
      `        <spotLight color={color} intensity={lightIntensity} distance={lightDistance} decay={lightDecay} angle={lightAngle} penumbra={lightPenumbra} castShadow={lightCastShadow} />\n` +
      `      ) : (\n` +
      `        <directionalLight color={color} intensity={lightIntensity} castShadow={lightCastShadow} />\n` +
      `      )}\n` +
      `      {children}\n` +
      `    </group>\n` +
      `  );\n` +
      `}\n\n`
    );
  }
  return (
    `function ${name}(props: SemanticComponentProps) {\n` +
    `  return <SemanticNode {...props} semanticRole="${roleForComponent(name)}" />;\n` +
    `}\n\n`
  );
};

const emitWrapperComponent = (name: string): string =>
  `function ${name}({ children }: { children: ReactNode }) {\n` +
  `  return <group name="${escapeAttr(name)}">{children}</group>;\n` +
  `}\n\n`;

const nodeComment = (node: R3fResolvedNode): string => {
  const parts = [`${node.id} - ${node.node.name}`];
  if (node.role) parts.push(`role=${node.role}`);
  if (node.groupId) parts.push(`group=${node.groupId}`);
  const tags = node.node.semantics?.tags;
  if (tags && tags.length > 0) parts.push(`tags=${tags.join(',')}`);
  const label = node.node.semantics?.label;
  if (label) parts.push(`label=${label}`);
  if (node.traits.length > 0) parts.push(`traits=${node.traits.join(',')}`);
  if (node.node.materialRef?.kind === 'token') parts.push(`material=${node.node.materialRef.token}`);
  if (node.node.assetRef?.kind === 'uri') parts.push('asset=uri');
  const behaviors = behaviorRequirementSummary(node.behaviorRequirements);
  if (behaviors) parts.push(`behaviors=${behaviors}`);
  return parts.map(escapeComment).join(' | ');
};

const emitInfoPlaceholder = (node: R3fResolvedNode, depth: number): string => {
  const info = infoRequirement(node);
  if (!info) return '';
  const title = info.title ?? node.node.name;
  const description = info.description ? `: ${info.description}` : '';
  const ind = indent(depth);
  return (
    `${ind}{selectedId === '${escapeStringLiteral(node.id)}' ? (\n` +
    `${ind}  <>{/* TODO: render info panel for ${escapeComment(title)}${escapeComment(description)}. */}</>\n` +
    `${ind}) : null}\n`
  );
};

const emitEventProps = (
  node: R3fResolvedNode,
  depth: number,
  mode: R3fModuleExportOptions['behaviorScaffold'],
): string => {
  if (mode !== 'handlers') return '';
  const ind = indent(depth);
  let out = '';
  if (hasRequirement(node, 'hover_highlight')) {
    out += `${ind}onHoverStart={() => handleHoverStart('${escapeStringLiteral(node.id)}')}\n`;
    out += `${ind}onHoverEnd={() => handleHoverEnd('${escapeStringLiteral(node.id)}')}\n`;
  }
  const click = hasRequirement(node, 'click_select');
  const focus = hasRequirement(node, 'focus_camera');
  if (click && focus) {
    out +=
      `${ind}onSelect={() => {\n` +
      `${ind}  handleSelect('${escapeStringLiteral(node.id)}');\n` +
      `${ind}  handleFocusCamera('${escapeStringLiteral(node.id)}');\n` +
      `${ind}}}\n`;
  } else if (click) {
    out += `${ind}onSelect={() => handleSelect('${escapeStringLiteral(node.id)}')}\n`;
  } else if (focus) {
    out += `${ind}onSelect={() => handleFocusCamera('${escapeStringLiteral(node.id)}')}\n`;
  }
  return out;
};

const emitNodeProps = (
  node: R3fResolvedNode,
  propDepth: number,
  mode: R3fModuleExportOptions['behaviorScaffold'],
): string => {
  const ind = indent(propDepth);
  let out = `${ind}sourceId="${escapeAttr(node.id)}"\n`;
  out += `${ind}name="${escapeAttr(node.node.name)}"\n`;
  out += `${ind}position={${fmtVec(node.node.transform.position)}}\n`;
  out += `${ind}rotation={${fmtVec(node.node.transform.rotation)}}\n`;
  out += `${ind}scale={${fmtVec(node.node.transform.scale)}}\n`;
  if (node.showPlaceholderMesh) out += `${ind}renderMesh\n`;
  if (node.showAssetModel && node.assetUri) {
    out += `${ind}assetUri="${escapeAttr(node.assetUri)}"\n`;
  }
  if (node.hasLight && node.node.light) {
    const light = node.node.light;
    out += `${ind}lightKind="${light.kind}"\n`;
    if (light.intensity !== undefined) {
      out += `${ind}lightIntensity={${fmtNum(light.intensity)}}\n`;
    }
    if (light.color !== undefined) {
      out += `${ind}lightColor="${escapeAttr(light.color)}"\n`;
    }
    if ((light.kind === 'point' || light.kind === 'spot') && light.distance !== undefined) {
      out += `${ind}lightDistance={${fmtNum(light.distance)}}\n`;
    }
    if ((light.kind === 'point' || light.kind === 'spot') && light.decay !== undefined) {
      out += `${ind}lightDecay={${fmtNum(light.decay)}}\n`;
    }
    if (light.kind === 'spot' && light.angle !== undefined) {
      out += `${ind}lightAngle={${fmtNum(light.angle)}}\n`;
    }
    if (light.kind === 'spot' && light.penumbra !== undefined) {
      out += `${ind}lightPenumbra={${fmtNum(light.penumbra)}}\n`;
    }
    if (light.kind !== 'ambient' && light.castShadow === true) {
      out += `${ind}lightCastShadow\n`;
    }
  }
  out += emitEventProps(node, propDepth, mode);
  return out;
};

const emitNode = (
  node: R3fResolvedNode,
  depth: number,
  options: Required<Pick<R3fModuleExportOptions, 'behaviorScaffold' | 'semanticComponents'>>,
  wrappersByFirstMember: Map<string, SafeGroupWrapper>,
  wrapperMembersToSkip: Set<string>,
): string => {
  if (wrapperMembersToSkip.has(node.id)) return '';
  const ind = indent(depth);
  const componentName = node.parentId === null
    ? 'group'
    : options.semanticComponents
      ? node.componentName
      : node.hasLight
        ? 'SceneLight'
        : node.showPlaceholderMesh || node.showAssetModel
          ? 'SceneMesh'
          : 'SceneGroup';
  let out = `${ind}{/* ${nodeComment(node)} */}\n`;
  const unsupported = todoBehaviorsForNode(node);
  for (const behavior of unsupported) {
    out += `${ind}{/* TODO: ${behavior} is scaffolded as a developer hook; no runtime behavior is generated. */}\n`;
  }

  if (node.parentId === null) {
    out += `${ind}<group name="${escapeAttr(node.node.name)}" position={${fmtVec(node.node.transform.position)}} rotation={${fmtVec(node.node.transform.rotation)}} scale={${fmtVec(node.node.transform.scale)}}>\n`;
  } else {
    out += `${ind}<${componentName}\n`;
    out += emitNodeProps(node, depth + 1, options.behaviorScaffold);
    if (node.children.length === 0) {
      out += `${ind}/>\n`;
      out += emitInfoPlaceholder(node, depth);
      return out;
    }
    out += `${ind}>\n`;
  }

  for (let i = 0; i < node.children.length; i += 1) {
    const child = node.children[i] as R3fResolvedNode;
    const wrapper = wrappersByFirstMember.get(child.id);
    if (wrapper) {
      out += `${indent(depth + 1)}{/* Semantic group: ${escapeComment(wrapper.group.id)} | role=${wrapper.group.role} | nodes=${wrapper.memberIds.join(',')} */}\n`;
      out += `${indent(depth + 1)}<${wrapper.wrapperName}>\n`;
      const skipped = new Set(wrapper.memberIds.slice(1));
      for (const memberId of wrapper.memberIds) {
        const member = node.children.find((candidate) => candidate.id === memberId);
        if (member) {
          out += emitNode(member, depth + 2, options, wrappersByFirstMember, new Set());
        }
      }
      out += `${indent(depth + 1)}</${wrapper.wrapperName}>\n`;
      for (const memberId of skipped) wrapperMembersToSkip.add(memberId);
      continue;
    }
    out += emitNode(child, depth + 1, options, wrappersByFirstMember, wrapperMembersToSkip);
  }

  out += node.parentId === null ? `${ind}</group>\n` : `${ind}</${componentName}>\n`;
  out += emitInfoPlaceholder(node, depth);
  return out;
};

const emitHandlers = (
  nodes: R3fResolvedNode[],
  mode: R3fModuleExportOptions['behaviorScaffold'],
): string => {
  if (mode !== 'handlers') return '';
  let out = '';
  if (needsSelectionState(nodes, mode)) {
    out += `  const [selectedId, setSelectedId] = useState<string | null>(null);\n\n`;
    out += `  const handleSelect = (id: string) => {\n`;
    out += `    setSelectedId(id);\n`;
    out += `  };\n\n`;
  }
  if (needsHoverHandlers(nodes, mode)) {
    out += `  const handleHoverStart = (id: string) => {\n`;
    out += `    // TODO: highlight object with this source id.\n`;
    out += `    void id;\n`;
    out += `  };\n\n`;
    out += `  const handleHoverEnd = (id: string) => {\n`;
    out += `    // TODO: clear highlight for this source id.\n`;
    out += `    void id;\n`;
    out += `  };\n\n`;
  }
  if (needsFocusHandler(nodes, mode)) {
    out += `  const handleFocusCamera = (id: string) => {\n`;
    out += `    // TODO: move or retarget the app camera for this source id.\n`;
    out += `    void id;\n`;
    out += `  };\n\n`;
  }
  return out;
};

const emitStudioLights = (include: boolean): string =>
  include
    ? `      {/* Studio fill - not from scene graph */}\n` +
      `      <ambientLight intensity={0.4} />\n` +
      `      <directionalLight castShadow position={[5, 8, 5]} intensity={1.1} />\n`
    : '';

const renderModule = (
  scene: Scene,
  options: R3fModuleExportOptions,
): R3fExportResult => {
  const model = buildR3fExportModel(scene);
  const behaviorScaffold = options.behaviorScaffold ?? 'handlers';
  const semanticComponents = options.semanticComponents ?? true;
  const componentName = sanitizeIdentifier(options.componentName ?? 'DioramaiScene', 'DioramaiScene');
  const diagnostics = [...model.diagnostics];
  const wrappersByFirstMember = safeWrapperMapFromScene(
    model.root,
    model.semanticGroups.map((g) => g.group),
    diagnostics,
  );
  const wrapperComponentNames = new Set(
    Array.from(wrappersByFirstMember.values()).map((wrapper) => wrapper.wrapperName),
  );
  const componentNames = componentNamesForModel(model.nodesInOrder, semanticComponents);
  for (const wrapperName of wrapperComponentNames) componentNames.add(wrapperName);
  const needsState = needsSelectionState(model.nodesInOrder, behaviorScaffold);
  const includeAssetLoader = needsAssetLoader(model.nodesInOrder);
  let code = `/* eslint-disable */\n`;
  code += `/* Auto-generated by Dioramai R3F bridge. Review TODOs before shipping. */\n`;
  code += emitImports(needsState, includeAssetLoader);
  if (includeAssetLoader) code += emitAssetModel();
  code += emitSemanticNode();
  for (const name of Array.from(componentNames).filter((name) => !wrapperComponentNames.has(name)).sort()) {
    code += emitComponent(name);
  }
  for (const name of Array.from(wrapperComponentNames).sort()) {
    code += emitWrapperComponent(name);
  }
  code += `export function ${componentName}() {\n`;
  const handlers = emitHandlers(model.nodesInOrder, behaviorScaffold);
  code += handlers;
  code += `  return (\n`;
  code += `    <>\n`;
  code += emitStudioLights(options.includeStudioLights === true || options.includeLights === true);
  if (model.semanticGroups.length > 0) {
    for (const group of model.semanticGroups) {
      code += `      {/* Semantic group: ${escapeComment(group.group.id)} | role=${group.group.role} | nodes=${group.memberIds.join(',')} */}\n`;
    }
  }
  if (model.root) {
    code += emitNode(
      model.root,
      3,
      { behaviorScaffold, semanticComponents },
      wrappersByFirstMember,
      new Set(),
    );
  }
  code += `    </>\n`;
  code += `  );\n`;
  code += `}\n`;
  return { code, diagnostics };
};

export const exportSceneToR3fModule = (
  scene: Scene,
  options: R3fModuleExportOptions = {},
): R3fExportResult => renderModule(scene, options);
