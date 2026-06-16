import type { Metadata, SceneLight, Vec3 } from '@dioramai/schema';

const DEFAULT_TORUS_ARGS = [0.45, 0.035, 16, 48] as const;

export const torusArgsFromMetadata = (metadata: Metadata | undefined): [number, number, number, number] => {
  const raw = metadata?.dioramaiTorusArgs;
  if (!Array.isArray(raw) || raw.length < 4) return [...DEFAULT_TORUS_ARGS];
  const nums = raw.slice(0, 4).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
  if (nums.some((n) => n === null)) return [...DEFAULT_TORUS_ARGS];
  return nums as [number, number, number, number];
};

/**
 * Stable numeric formatting. Integers render without a decimal point; finite
 * non-integers use the default `String` representation. JSON.stringify already
 * normalises `-0` to `0`, and `String(-0) === '0'`, so deterministic byte
 * output is preserved.
 */
export const fmtNum = (n: number): string => String(n);

export const fmtVec = (v: Vec3): string =>
  `[${fmtNum(v[0])}, ${fmtNum(v[1])}, ${fmtNum(v[2])}]`;

export const indent = (depth: number): string => '  '.repeat(depth);

export const escapeAttr = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');

export const escapeStringLiteral = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');

export const escapeComment = (s: string): string => s.replace(/\*\//g, '* /');

/** Neutral primitive proxy used for `mesh` nodes. Keeps export readable. */
export const placeholderMesh = (baseIndent: string): string =>
  `${baseIndent}<mesh castShadow receiveShadow>\n` +
  `${baseIndent}  <boxGeometry args={[1, 1, 1]} />\n` +
  `${baseIndent}  <meshStandardMaterial color="#9ca3af" />\n` +
  `${baseIndent}</mesh>\n`;

/**
 * R3F placeholder mesh driven by optional `metadata.dioramaiProxyMesh` /
 * `dioramaiTorusArgs` so lightweight authored geometry (e.g. Saturn-style rings)
 * round-trips through fragment export.
 */
export const proxyPlaceholderMesh = (baseIndent: string, metadata: Metadata | undefined): string => {
  if (metadata?.dioramaiProxyMesh !== 'torus') return placeholderMesh(baseIndent);
  const [r, tube, radialSegments, tubularSegments] = torusArgsFromMetadata(metadata);
  return (
    `${baseIndent}<mesh castShadow receiveShadow>\n` +
    `${baseIndent}  <torusGeometry args={[${fmtNum(r)}, ${fmtNum(tube)}, ${radialSegments}, ${tubularSegments}]} />\n` +
    `${baseIndent}  <meshStandardMaterial color="#c4b5fd" />\n` +
    `${baseIndent}</mesh>\n`
  );
};

export const emitLight = (light: SceneLight, baseIndent: string): string => {
  const parts: string[] = [];
  if (light.color !== undefined) parts.push(`color="${escapeAttr(light.color)}"`);
  if (light.intensity !== undefined) parts.push(`intensity={${fmtNum(light.intensity)}}`);

  if (light.kind === 'ambient') {
    const tail = parts.length > 0 ? ` ${parts.join(' ')}` : '';
    return `${baseIndent}<ambientLight${tail} />\n`;
  }
  if (light.kind === 'point') {
    if (light.distance !== undefined) parts.push(`distance={${fmtNum(light.distance)}}`);
    if (light.decay !== undefined) parts.push(`decay={${fmtNum(light.decay)}}`);
    if (light.castShadow === true) parts.push('castShadow');
    return `${baseIndent}<pointLight ${parts.join(' ')} />\n`;
  }
  if (light.kind === 'spot') {
    if (light.distance !== undefined) parts.push(`distance={${fmtNum(light.distance)}}`);
    if (light.decay !== undefined) parts.push(`decay={${fmtNum(light.decay)}}`);
    if (light.angle !== undefined) parts.push(`angle={${fmtNum(light.angle)}}`);
    if (light.penumbra !== undefined) parts.push(`penumbra={${fmtNum(light.penumbra)}}`);
    if (light.castShadow === true) parts.push('castShadow');
    return `${baseIndent}<spotLight ${parts.join(' ')} />\n`;
  }
  // directional
  if (light.castShadow === true) parts.push('castShadow');
  const tail = parts.length > 0 ? ` ${parts.join(' ')}` : '';
  return `${baseIndent}<directionalLight${tail} />\n`;
};

export const attr = (name: string, value: string | undefined): string =>
  value === undefined ? '' : ` ${name}="${escapeAttr(value)}"`;
