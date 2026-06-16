import { useState, useEffect, useRef } from 'react';
import { useSceneStore } from '../store/sceneStore';
import {
  getParent,
  createId,
  type TransformPatch,
  type Vec3,
  type SemanticRole,
  type SceneLight,
  type SceneEnvironment,
  type BehaviorDefinition,
  type BehaviorType,
  type NodeSemantics,
  type JsonValue,
} from '@dioramai/core';
import {
  fetchBridgeHdriAssets,
  postBridgeImportHdriAsset,
  type HdriAssetEntry,
} from '../bridge/bridgeClient';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

const toDeg = (v: Vec3): Vec3 => [v[0] * RAD_TO_DEG, v[1] * RAD_TO_DEG, v[2] * RAD_TO_DEG];
const toRad = (v: Vec3): Vec3 => [v[0] * DEG_TO_RAD, v[1] * DEG_TO_RAD, v[2] * DEG_TO_RAD];
const round = (n: number): number => Math.round(n * 1000) / 1000;

interface Vec3EditorProps {
  label: string;
  value: Vec3;
  step?: number;
  onChange: (next: Vec3) => void;
}

const AXIS_LABELS = ['x', 'y', 'z'] as const;

function Vec3Editor({ label, value, step = 0.1, onChange }: Vec3EditorProps) {
  const handleAxis = (axis: 0 | 1 | 2) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const parsed = raw === '' || raw === '-' ? 0 : Number(raw);
    if (Number.isNaN(parsed)) return;
    const next: Vec3 = [value[0], value[1], value[2]];
    next[axis] = parsed;
    onChange(next);
  };
  return (
    <div className="vec3-editor">
      <span className="vec3-editor__label">{label}</span>
      <div className="vec3-editor__inputs">
        {AXIS_LABELS.map((axisLabel, i) => (
          <label key={axisLabel} className="vec3-editor__field">
            <span className={`vec3-editor__axis vec3-editor__axis--${axisLabel}`}>{axisLabel}</span>
            <input
              type="number"
              step={step}
              value={Number.isFinite(value[i]) ? round(value[i]) : 0}
              onChange={handleAxis(i as 0 | 1 | 2)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

const NODE_ROLES: SemanticRole[] = [
  'product', 'display', 'seating', 'lighting', 'light',
  'environment', 'navigation', 'decor', 'container', 'unknown',
];

const BEHAVIOR_ROWS: { type: BehaviorType; label: string }[] = [
  { type: 'hover_highlight', label: 'Hover highlight' },
  { type: 'click_select',    label: 'Click select' },
  { type: 'focus_camera',    label: 'Focus camera' },
  { type: 'show_info',       label: 'Show info' },
  { type: 'open_url',        label: 'Open URL' },
  { type: 'rotate_idle',     label: 'Rotate idle' },
  { type: 'scroll_reveal',   label: 'Scroll reveal' },
  { type: 'anchor_point',    label: 'Anchor point' },
];

// ─── Per-type behavior params ───────────────────────────────────────────────

type ParamField = { key: string; label: string; placeholder?: string; type: 'text' | 'number' };

const BEHAVIOR_PARAMS: Partial<Record<BehaviorType, ParamField[]>> = {
  hover_highlight: [
    { key: 'color',     label: 'Color',     placeholder: '#38bdf8', type: 'text' },
    { key: 'intensity', label: 'Intensity', placeholder: '0.3',     type: 'number' },
  ],
  focus_camera: [
    { key: 'distance', label: 'Distance', placeholder: '4',   type: 'number' },
    { key: 'duration', label: 'Duration', placeholder: '0.6', type: 'number' },
  ],
  show_info: [
    { key: 'title',       label: 'Title',       placeholder: 'Product name', type: 'text' },
    { key: 'description', label: 'Description', placeholder: 'Short description', type: 'text' },
  ],
  anchor_point: [
    { key: 'label', label: 'Label', placeholder: 'sit', type: 'text' },
  ],
  open_url: [
    { key: 'url', label: 'URL', placeholder: 'https://...', type: 'text' },
  ],
  rotate_idle: [
    { key: 'speed', label: 'Speed', placeholder: '1',   type: 'number' },
    { key: 'axis',  label: 'Axis',  placeholder: 'y',   type: 'text' },
  ],
  scroll_reveal: [
    { key: 'start', label: 'Start', placeholder: '0',   type: 'number' },
    { key: 'end',   label: 'End',   placeholder: '1',   type: 'number' },
  ],
};

// Flatten behavior.params (Record<string,JsonValue>) to string map for editing
const paramsToStrings = (params: Record<string, JsonValue> | undefined): Record<string, string> => {
  if (!params) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = v == null ? '' : String(v);
  }
  return out;
};

// Rebuild params object from string map, coercing numbers where the field type says so
const stringsToParams = (
  fields: ParamField[],
  values: Record<string, string>,
): Record<string, JsonValue> => {
  const out: Record<string, JsonValue> = {};
  for (const field of fields) {
    const raw = values[field.key];
    if (raw === undefined || raw === '') continue;
    out[field.key] = field.type === 'number' ? Number(raw) : raw;
  }
  return out;
};

interface BehaviorParamsEditorProps {
  behavior: BehaviorDefinition;
  onUpdate: (params: Record<string, JsonValue>) => void;
}

function BehaviorParamsEditor({ behavior, onUpdate }: BehaviorParamsEditorProps) {
  const fields = BEHAVIOR_PARAMS[behavior.type];
  const [values, setValues] = useState<Record<string, string>>(() =>
    paramsToStrings(behavior.params),
  );

  if (!fields || fields.length === 0) return null;

  const handleBlur = () => {
    onUpdate(stringsToParams(fields, values));
  };

  return (
    <div className="behavior-params">
      {fields.map((field) => (
        <label key={field.key} className="behavior-params__field">
          <span className="behavior-params__key">{field.label}</span>
          <input
            type={field.type === 'number' ? 'number' : 'text'}
            className="behavior-params__input"
            placeholder={field.placeholder}
            value={values[field.key] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            onBlur={handleBlur}
          />
        </label>
      ))}
    </div>
  );
}

// ─── Behavior controls ───────────────────────────────────────────────────────

interface BehaviorControlsProps {
  nodeId: string;
  behaviorDefs: BehaviorDefinition[];
  legacyHover: boolean;
  legacyClick: boolean;
}

function BehaviorControls({ nodeId, behaviorDefs, legacyHover, legacyClick }: BehaviorControlsProps) {
  const dispatch = useSceneStore((s) => s.dispatch);

  const defByType = (type: BehaviorType): BehaviorDefinition | undefined =>
    behaviorDefs.find((b) => b.type === type);

  const hasType = (type: BehaviorType): boolean => {
    if (type === 'hover_highlight' && legacyHover) return true;
    if (type === 'click_select' && legacyClick) return true;
    return Boolean(defByType(type));
  };

  const addBehavior = (type: BehaviorType) => {
    dispatch({
      type: 'ADD_BEHAVIOR',
      behavior: { id: `${nodeId}-${type}-${createId()}`, type, nodeIds: [nodeId] },
    });
  };

  const removeBehavior = (type: BehaviorType) => {
    const def = defByType(type);
    if (def) dispatch({ type: 'REMOVE_BEHAVIOR', behaviorId: def.id });
  };

  const updateParams = (def: BehaviorDefinition, params: Record<string, JsonValue>) => {
    dispatch({
      type: 'ADD_BEHAVIOR',
      behavior: { ...def, params },
    });
  };

  return (
    <div className="behavior-controls">
      {BEHAVIOR_ROWS.map(({ type, label }) => {
        const active = hasType(type);
        const def = defByType(type);
        return (
          <div key={type} className="behavior-controls__item">
            <div className="behavior-controls__row">
              <span className="behavior-controls__label">{label}</span>
              {active ? (
                <button
                  type="button"
                  className="behavior-controls__btn behavior-controls__btn--remove"
                  onClick={() => removeBehavior(type)}
                >
                  Remove
                </button>
              ) : (
                <button
                  type="button"
                  className="behavior-controls__btn behavior-controls__btn--add"
                  onClick={() => addBehavior(type)}
                >
                  Add
                </button>
              )}
            </div>
            {active && def ? (
              <BehaviorParamsEditor
                key={def.id}
                behavior={def}
                onUpdate={(params) => updateParams(def, params)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ─── Semantics editor ────────────────────────────────────────────────────────

interface SemanticEditorProps {
  nodeId: string;
  semantics: NodeSemantics | undefined;
  currentRole: SemanticRole;
}

function SemanticEditor({ nodeId, semantics, currentRole }: SemanticEditorProps) {
  const dispatch = useSceneStore((s) => s.dispatch);

  // These local edit buffers are seeded once per mount. The component is keyed
  // by nodeId at the call site (<SemanticEditor key={selectedId} />), so React
  // remounts it on selection change and these initializers re-run with the new
  // node's semantics — no syncing effect needed.
  const [tagsInput, setTagsInput] = useState(() => (semantics?.tags ?? []).join(', '));
  const [labelInput, setLabelInput] = useState(() => semantics?.label ?? '');
  const [descInput, setDescInput] = useState(() => semantics?.description ?? '');

  const setRole = (role: SemanticRole) => {
    dispatch({ type: 'SET_NODE_SEMANTICS', nodeIds: [nodeId], semantics: { role } });
  };

  const commitTags = () => {
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    dispatch({ type: 'SET_NODE_SEMANTICS', nodeIds: [nodeId], semantics: { tags: tags.length > 0 ? tags : undefined } });
  };

  const commitLabel = () => {
    dispatch({ type: 'SET_NODE_SEMANTICS', nodeIds: [nodeId], semantics: { label: labelInput.trim() || undefined } });
  };

  const commitDesc = () => {
    dispatch({ type: 'SET_NODE_SEMANTICS', nodeIds: [nodeId], semantics: { description: descInput.trim() || undefined } });
  };

  return (
    <>
      <div className="inspector__row inspector__row--role">
        <span className="inspector__key">Role</span>
        <select
          className="inspector__role-select"
          value={currentRole}
          onChange={(e) => setRole(e.target.value as SemanticRole)}
        >
          {NODE_ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      <div className="inspector__row">
        <span className="inspector__key">Tags</span>
        <input
          type="text"
          className="inspector__input"
          value={tagsInput}
          placeholder="tag1, tag2"
          onChange={(e) => setTagsInput(e.target.value)}
          onBlur={commitTags}
        />
      </div>

      <div className="inspector__row">
        <span className="inspector__key">Label</span>
        <input
          type="text"
          className="inspector__input"
          value={labelInput}
          placeholder="optional label"
          onChange={(e) => setLabelInput(e.target.value)}
          onBlur={commitLabel}
        />
      </div>

      <div className="inspector__row inspector__row--wrap">
        <span className="inspector__key">Description</span>
        <textarea
          className="inspector__textarea"
          value={descInput}
          placeholder="optional description"
          rows={2}
          onChange={(e) => setDescInput(e.target.value)}
          onBlur={commitDesc}
        />
      </div>
    </>
  );
}

// ─── Light editor ────────────────────────────────────────────────────────────

const LIGHT_KINDS: SceneLight['kind'][] = ['ambient', 'directional', 'point', 'spot'];

/** Builds a light of the target kind, carrying over shared fields. */
const lightForKind = (kind: SceneLight['kind'], prev: SceneLight | undefined): SceneLight => {
  const intensity = prev?.intensity;
  const color = prev?.color;
  const base = {
    ...(intensity !== undefined ? { intensity } : {}),
    ...(color !== undefined ? { color } : {}),
  };
  switch (kind) {
    case 'ambient':
      return { kind: 'ambient', ...base };
    case 'directional':
      return { kind: 'directional', ...base };
    case 'point':
      return { kind: 'point', distance: 0, decay: 2, ...base };
    case 'spot':
      return { kind: 'spot', distance: 0, decay: 2, angle: Math.PI / 6, penumbra: 0, ...base };
  }
};

interface LightEditorProps {
  nodeId: string;
  light: SceneLight;
}

function LightEditor({ nodeId, light }: LightEditorProps) {
  const dispatch = useSceneStore((s) => s.dispatch);

  const commit = (next: SceneLight) => {
    dispatch({ type: 'UPDATE_LIGHT', nodeId, light: next });
  };

  const patch = (changes: Partial<SceneLight>) => {
    commit({ ...light, ...changes } as SceneLight);
  };

  const isPointOrSpot = light.kind === 'point' || light.kind === 'spot';

  return (
    <section className="inspector__section">
      <div className="inspector__section-title">Light</div>

      <div className="inspector__row">
        <span className="inspector__key">Type</span>
        <select
          className="inspector__role-select"
          value={light.kind}
          onChange={(e) => commit(lightForKind(e.target.value as SceneLight['kind'], light))}
        >
          {LIGHT_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>

      <div className="inspector__row">
        <span className="inspector__key">Color</span>
        <input
          type="color"
          className="inspector__color"
          value={light.color ?? '#ffffff'}
          onChange={(e) => patch({ color: e.target.value })}
        />
      </div>

      <div className="inspector__row">
        <span className="inspector__key">Intensity</span>
        <input
          type="number"
          step={0.1}
          min={0}
          className="inspector__input"
          value={light.intensity ?? 1}
          onChange={(e) => patch({ intensity: Number(e.target.value) })}
        />
      </div>

      {isPointOrSpot ? (
        <>
          <div className="inspector__row">
            <span className="inspector__key">Range</span>
            <input
              type="number"
              step={0.5}
              min={0}
              className="inspector__input"
              value={light.distance ?? 0}
              onChange={(e) => patch({ distance: Number(e.target.value) })}
            />
          </div>
          <div className="inspector__row">
            <span className="inspector__key">Decay</span>
            <input
              type="number"
              step={0.1}
              min={0}
              className="inspector__input"
              value={light.decay ?? 2}
              onChange={(e) => patch({ decay: Number(e.target.value) })}
            />
          </div>
        </>
      ) : null}

      {light.kind === 'spot' ? (
        <>
          <div className="inspector__row">
            <span className="inspector__key">Cone (deg)</span>
            <input
              type="number"
              step={1}
              min={1}
              max={90}
              className="inspector__input"
              value={round((light.angle ?? Math.PI / 6) * RAD_TO_DEG)}
              onChange={(e) =>
                patch({ angle: Math.max(0.0001, Math.min(Math.PI / 2, Number(e.target.value) * DEG_TO_RAD)) })
              }
            />
          </div>
          <div className="inspector__row">
            <span className="inspector__key">Penumbra</span>
            <input
              type="number"
              step={0.05}
              min={0}
              max={1}
              className="inspector__input"
              value={light.penumbra ?? 0}
              onChange={(e) => patch({ penumbra: Math.max(0, Math.min(1, Number(e.target.value))) })}
            />
          </div>
        </>
      ) : null}

      {light.kind !== 'ambient' ? (
        <div className="inspector__row">
          <span className="inspector__key">Cast shadow</span>
          <input
            type="checkbox"
            checked={light.castShadow ?? false}
            onChange={(e) => patch({ castShadow: e.target.checked })}
          />
        </div>
      ) : null}
    </section>
  );
}

// ─── Environment panel ───────────────────────────────────────────────────────

const EMPTY_ENVIRONMENT: SceneEnvironment = { enabled: false, showBackground: false };

function EnvironmentPanel() {
  const dispatch = useSceneStore((s) => s.dispatch);
  const bridgeConnected = useSceneStore((s) => s.bridgeConnected);
  const environment = useSceneStore((s) => s.scene.environment) ?? EMPTY_ENVIRONMENT;
  const [hdriList, setHdriList] = useState<HdriAssetEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshHdriList = () => {
    if (!bridgeConnected) return;
    void fetchBridgeHdriAssets()
      .then((result) => {
        if (result.ok) setHdriList(result.data.files);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    refreshHdriList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeConnected]);

  const patch = (changes: Partial<SceneEnvironment>) => {
    dispatch({ type: 'UPDATE_ENVIRONMENT', patch: changes });
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const result = await postBridgeImportHdriAsset(file);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      patch({ hdriUri: result.data.uri, enabled: true });
      refreshHdriList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="inspector__section">
      <div className="inspector__section-title">Environment (HDRI)</div>

      <div className="inspector__row">
        <span className="inspector__key">Enable</span>
        <input
          type="checkbox"
          checked={environment.enabled ?? false}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
      </div>

      <div className="inspector__row">
        <span className="inspector__key">Show background</span>
        <input
          type="checkbox"
          checked={environment.showBackground ?? false}
          onChange={(e) => patch({ showBackground: e.target.checked })}
        />
      </div>

      <div className="inspector__row">
        <span className="inspector__key">Intensity</span>
        <input
          type="number"
          step={0.1}
          min={0}
          className="inspector__input"
          value={environment.intensity ?? 1}
          onChange={(e) => patch({ intensity: Number(e.target.value) })}
        />
      </div>

      <div className="inspector__row">
        <span className="inspector__key">Rotation (deg)</span>
        <input
          type="number"
          step={1}
          className="inspector__input"
          value={round((environment.rotationY ?? 0) * RAD_TO_DEG)}
          onChange={(e) => patch({ rotationY: Number(e.target.value) * DEG_TO_RAD })}
        />
      </div>

      <div className="inspector__row">
        <span className="inspector__key">HDRI</span>
        <select
          className="inspector__role-select"
          value={environment.hdriUri ?? ''}
          onChange={(e) => patch({ hdriUri: e.target.value || undefined })}
          disabled={!bridgeConnected}
        >
          <option value="">(none)</option>
          {environment.hdriUri && !hdriList.some((h) => h.uri === environment.hdriUri) ? (
            <option value={environment.hdriUri}>{environment.hdriUri}</option>
          ) : null}
          {hdriList.map((h) => (
            <option key={h.uri} value={h.uri}>{h.name}</option>
          ))}
        </select>
      </div>

      <div className="inspector__row inspector__row--wrap">
        <input
          ref={fileInputRef}
          type="file"
          accept=".hdr,.exr"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="behavior-controls__btn behavior-controls__btn--add"
          disabled={!bridgeConnected || busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {busy ? 'Uploading…' : 'Add HDRI…'}
        </button>
      </div>

      {!bridgeConnected ? (
        <p className="inspector__hint">Connect a local bridge to add or list HDRIs.</p>
      ) : null}
      {error ? <p className="inspector__hint inspector__warning">{error}</p> : null}
    </section>
  );
}

// ─── Main Inspector ─────────────────────────────────────────────────────────

export function Inspector() {
  const scene = useSceneStore((s) => s.scene);
  const dispatch = useSceneStore((s) => s.dispatch);
  const selectedId = scene.selection;
  const node = selectedId ? scene.nodes[selectedId] : null;

  if (!node || !selectedId) {
    return (
      <aside className="inspector">
        <div className="inspector__header">Inspector</div>
        <div className="inspector__empty">
          <p>No node selected.</p>
          <p className="inspector__hint">
            Select a node in the outline or click a mesh in the viewport.
          </p>
        </div>
        <EnvironmentPanel />
      </aside>
    );
  }

  const parent = getParent(scene, selectedId);
  const isRoot = selectedId === scene.rootId;

  const update = (patch: TransformPatch) => {
    dispatch({ type: 'UPDATE_TRANSFORM', nodeId: selectedId, patch });
  };

  const rotationDeg = toDeg(node.transform.rotation);
  const semantics = node.semantics;
  const semanticGroupId = semantics?.groupId ?? node.semanticGroupId;
  const semanticGroup = semanticGroupId ? scene.semanticGroups?.[semanticGroupId] : undefined;
  const behaviorDefinitions = (node.behaviorRefs ?? [])
    .map((id) => scene.behaviors?.[id])
    .filter((b): b is BehaviorDefinition => Boolean(b));

  const currentRole: SemanticRole = semantics?.role ?? node.semanticRole ?? 'unknown';
  const hiddenAssetUri = !node.visible && node.assetRef?.kind === 'uri'
    ? node.assetRef.uri
    : null;

  return (
    <aside className="inspector">
      <div className="inspector__header">Inspector</div>

      {hiddenAssetUri ? (
        <section className="inspector__section inspector__warning">
          <div className="inspector__section-title">Hidden Asset</div>
          <p className="inspector__description">
            This GLB/GLTF node is in the canonical scene but is set to not visible.
          </p>
          <div className="inspector__row">
            <span className="inspector__key">Asset</span>
            <span className="inspector__value inspector__value--mono" title={hiddenAssetUri}>
              {hiddenAssetUri}
            </span>
          </div>
        </section>
      ) : null}

      {/* Light */}
      {node.light || node.type === 'light' ? (
        <LightEditor
          key={`${selectedId}-light`}
          nodeId={selectedId}
          light={node.light ?? { kind: 'directional' }}
        />
      ) : null}

      {/* Semantics */}
      <section className="inspector__section">
        <div className="inspector__section-title">Semantics</div>
        <SemanticEditor
          key={selectedId}
          nodeId={selectedId}
          semantics={semantics}
          currentRole={currentRole}
        />
        {semanticGroup ? (
          <div className="inspector__row">
            <span className="inspector__key">Group</span>
            <span className="inspector__value inspector__value--mono">
              {semanticGroup.name}
            </span>
          </div>
        ) : null}
      </section>

      {/* Behaviors */}
      <section className="inspector__section">
        <div className="inspector__section-title">Behaviors</div>
        <BehaviorControls
          nodeId={selectedId}
          behaviorDefs={behaviorDefinitions}
          legacyHover={Boolean(node.behaviors?.hoverHighlight)}
          legacyClick={Boolean(node.behaviors?.clickSelect)}
        />
      </section>

      {/* Node identity */}
      <section className="inspector__section inspector__section--muted">
        <div className="inspector__section-title">Node</div>
        <div className="inspector__row">
          <span className="inspector__key">Name</span>
          <span className="inspector__value">{node.name}</span>
        </div>
        <div className="inspector__row">
          <span className="inspector__key">ID</span>
          <span className="inspector__value inspector__value--mono" title={node.id}>
            {node.id.slice(0, 8)}
          </span>
        </div>
        <div className="inspector__row">
          <span className="inspector__key">Parent</span>
          <span className="inspector__value inspector__value--mono">
            {isRoot ? '-' : parent ? `${parent.name} (${parent.id.slice(0, 8)})` : '-'}
          </span>
        </div>
        <div className="inspector__row">
          <span className="inspector__key">Type</span>
          <span className="inspector__value">{node.type}</span>
        </div>
        <div className="inspector__row">
          <span className="inspector__key">Visible</span>
          <span className="inspector__value">{node.visible ? 'Yes' : 'No'}</span>
        </div>
      </section>

      {/* Transform */}
      <section className="inspector__section">
        <div className="inspector__section-title">Transform</div>
        <Vec3Editor
          label="Position"
          value={node.transform.position}
          step={0.1}
          onChange={(position) => update({ position })}
        />
        <Vec3Editor
          label="Rotation (deg)"
          value={rotationDeg}
          step={1}
          onChange={(deg) => update({ rotation: toRad(deg) })}
        />
        <Vec3Editor
          label="Scale"
          value={node.transform.scale}
          step={0.1}
          onChange={(scale) => update({ scale })}
        />
      </section>
    </aside>
  );
}
