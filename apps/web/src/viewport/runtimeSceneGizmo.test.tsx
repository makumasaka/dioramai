import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStarterScene } from '@dioramai/core';
import { RuntimeScene } from '@dioramai/r3f-bridge';

// Captures every `object` prop TransformControls is rendered with so we can
// assert it is the live Object3D instance rather than a RefObject. Passing a
// RefObject is a regression: drei reads `ref.current` once and never
// re-attaches, leaving the gizmo bound to a stale, detached group.
const capturedObjects: unknown[] = [];
const skeletonClone = vi.hoisted(() =>
  vi.fn((object: unknown) => ({ type: 'skeleton-safe-clone', source: object })),
);

vi.mock('@react-three/drei', async () => {
  const React = await import('react');

  return {
    TransformControls: React.forwardRef(function TransformControls(
      props: { object?: unknown },
      _ref: unknown,
    ) {
      capturedObjects.push(props.object);
      return <div data-testid="transform-controls" />;
    }),
    useGLTF: () => ({
      scene: {
        clone: () => ({ type: 'mock-gltf-scene' }),
      },
    }),
  };
});

vi.mock('three-stdlib', () => ({
  SkeletonUtils: {
    clone: skeletonClone,
  },
}));

describe('RuntimeScene gizmo attachment', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  let originalError: typeof console.error;

  beforeEach(() => {
    capturedObjects.length = 0;
    skeletonClone.mockClear();
    originalError = console.error;
    consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
      const message = args.map((arg) => String(arg)).join(' ');
      const noisy = [
        'group',
        'mesh',
        'boxGeometry',
        'meshStandardMaterial',
        'primitive',
        'castShadow',
        'receiveShadow',
        'emissiveIntensity',
        'object',
        'userData',
      ];
      if (noisy.some((tag) => message.includes(tag))) return;
      originalError(...args);
    });
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('uses a skeleton-safe clone for GLB asset nodes', () => {
    const scene = getStarterScene('default');
    const childId = scene.nodes[scene.rootId]!.children[0]!;
    const child = scene.nodes[childId]!;

    const { container } = render(
      <RuntimeScene
        scene={{
          ...scene,
          nodes: {
            ...scene.nodes,
            [childId]: {
              ...child,
              assetRef: { kind: 'uri', uri: '/assets/imports/android.glb' },
            },
          },
        }}
        selectedId={childId}
        gizmoMode="translate"
        onCommand={() => undefined}
        onSelect={() => undefined}
      />,
    );

    expect(container.querySelector('primitive')).not.toBeNull();
    expect(skeletonClone).toHaveBeenCalled();
  });

  it('passes the live group instance (not a RefObject) to TransformControls', () => {
    const scene = getStarterScene('default');
    const childId = scene.nodes[scene.rootId]!.children[0]!;

    const { container } = render(
      <RuntimeScene
        scene={scene}
        selectedId={childId}
        gizmoMode="translate"
        onCommand={() => undefined}
        onSelect={() => undefined}
      />,
    );

    const groups = container.querySelectorAll('group');
    // Root group + selected child group
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const childGroup = groups[1];

    expect(capturedObjects.length).toBeGreaterThan(0);
    const lastObject = capturedObjects.at(-1);

    // Must be the rendered group element itself, never a { current } ref box.
    expect(lastObject).toBe(childGroup);
    expect(Object.prototype.hasOwnProperty.call(lastObject, 'current')).toBe(false);
  });

  it('does not render TransformControls until the group instance exists', () => {
    const scene = getStarterScene('default');
    const childId = scene.nodes[scene.rootId]!.children[0]!;

    render(
      <RuntimeScene
        scene={scene}
        selectedId={childId}
        gizmoMode="translate"
        onCommand={() => undefined}
        onSelect={() => undefined}
      />,
    );

    // Every render of TransformControls must have a concrete object.
    for (const object of capturedObjects) {
      expect(object).not.toBeNull();
      expect(object).not.toBeUndefined();
    }
  });
});
