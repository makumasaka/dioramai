import { fireEvent, render, screen } from '@testing-library/react';
import type { ForwardedRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStarterScene } from '@dioramai/core';
import { useSceneStore } from '../store/sceneStore';
import { NodeMesh } from './NodeMesh';

interface TransformControlsTestRef {
  addEventListener: (
    name: 'dragging-changed',
    listener: (event: { value: boolean }) => void,
  ) => void;
  removeEventListener: (
    name: 'dragging-changed',
    listener: (event: { value: boolean }) => void,
  ) => void;
}

vi.mock('@react-three/drei', async () => {
  const React = await import('react');

  return {
    TransformControls: React.forwardRef(function TransformControls(
      _props: unknown,
      ref: ForwardedRef<TransformControlsTestRef>,
    ) {
      const listenerRef = React.useRef<((event: { value: boolean }) => void) | null>(
        null,
      );

      React.useImperativeHandle(ref, () => ({
        addEventListener: (_name, listener) => {
          listenerRef.current = listener;
        },
        removeEventListener: (_name, listener) => {
          if (listenerRef.current === listener) listenerRef.current = null;
        },
      }));

      return (
        <button
          type="button"
          data-testid="transform-controls"
          onClick={() => listenerRef.current?.({ value: false })}
        >
          Transform controls
        </button>
      );
    }),
    useGLTF: () => ({
      scene: {
        clone: () => ({ type: 'mock-gltf-scene' }),
      },
    }),
  };
});

vi.mock('./object3dTransform', () => ({
  transformPatchFromObject3D: () => ({ position: [6, 7, 8] }),
}));

describe('NodeMesh command adapter', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  let originalError: typeof console.error;

  beforeEach(() => {
    originalError = console.error;
    consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
      const message = args.map((arg) => String(arg)).join(' ');
      if (
        ['group', 'mesh', 'boxGeometry', 'meshStandardMaterial'].some((tag) =>
          message.includes(tag),
        )
      ) {
        return;
      }
      if (
        ['primitive'].some((tag) =>
          message.includes(tag),
        )
      ) {
        return;
      }
      if (
        ['castShadow', 'receiveShadow', 'emissiveIntensity', 'object'].some((prop) =>
          message.includes(prop),
        )
      ) {
        return;
      }
      originalError(...args);
    });
    useSceneStore.getState().reset();
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('selects the root group through SET_SELECTION without logging it', () => {
    const rootId = useSceneStore.getState().scene.rootId;
    const { container } = render(<NodeMesh nodeId={rootId} />);

    const group = container.querySelector('group');
    expect(group).not.toBeNull();
    fireEvent.click(group!);

    expect(useSceneStore.getState().scene.selection).toBe(rootId);
    expect(useSceneStore.getState().commandLog).toHaveLength(0);
    expect(screen.getByTestId('transform-controls')).toBeInTheDocument();
  });

  it('commits gizmo changes through UPDATE_TRANSFORM without treating object state as canonical before commit', () => {
    const childId = useSceneStore.getState().scene.nodes[
      useSceneStore.getState().scene.rootId
    ]!.children[0]!;
    useSceneStore.getState().select(childId);

    render(<NodeMesh nodeId={childId} />);
    expect(useSceneStore.getState().scene.nodes[childId]?.transform.position).toEqual([
      0,
      0.5,
      0,
    ]);
    expect(useSceneStore.getState().commandLog).toHaveLength(0);

    fireEvent.click(screen.getByTestId('transform-controls'));

    expect(useSceneStore.getState().scene.nodes[childId]?.transform.position).toEqual([
      6,
      7,
      8,
    ]);
    expect(useSceneStore.getState().commandLog.at(-1)?.command).toEqual({
      type: 'UPDATE_TRANSFORM',
      nodeId: childId,
      patch: { position: [6, 7, 8] },
    });
  });

  it('does not render hidden nodes or their children', () => {
    const scene = getStarterScene('default');
    const childId = scene.nodes[scene.rootId]!.children[0]!;
    const child = scene.nodes[childId]!;
    useSceneStore.getState().dispatch({
      type: 'REPLACE_SCENE',
      scene: {
        ...scene,
        nodes: {
          ...scene.nodes,
          [childId]: {
            ...child,
            visible: false,
          },
        },
      },
    });

    const { container } = render(
      <NodeMesh nodeId={childId}>
        <div data-testid="nested-child" />
      </NodeMesh>,
    );

    expect(container.querySelector('group')).toBeNull();
    expect(screen.queryByTestId('nested-child')).not.toBeInTheDocument();
  });

  it('renders safe GLB asset refs instead of the proxy mesh', () => {
    const scene = getStarterScene('default');
    const childId = scene.nodes[scene.rootId]!.children[0]!;
    const child = scene.nodes[childId]!;
    useSceneStore.getState().dispatch({
      type: 'REPLACE_SCENE',
      scene: {
        ...scene,
        nodes: {
          ...scene.nodes,
          [childId]: {
            ...child,
            assetRef: { kind: 'uri', uri: '/assets/imports/chair.glb' },
          },
        },
      },
    });

    const { container } = render(<NodeMesh nodeId={childId} />);

    expect(container.querySelector('primitive')).not.toBeNull();
    expect(container.querySelector('boxGeometry')).toBeNull();
  });

  it('keeps the proxy mesh for unsafe asset refs', () => {
    const scene = getStarterScene('default');
    const childId = scene.nodes[scene.rootId]!.children[0]!;
    const child = scene.nodes[childId]!;
    useSceneStore.getState().dispatch({
      type: 'REPLACE_SCENE',
      scene: {
        ...scene,
        nodes: {
          ...scene.nodes,
          [childId]: {
            ...child,
            assetRef: { kind: 'uri', uri: 'file:///Users/example/private.glb' },
          },
        },
      },
    });

    const { container } = render(<NodeMesh nodeId={childId} />);

    expect(container.querySelector('primitive')).toBeNull();
    expect(container.querySelector('boxGeometry')).not.toBeNull();
  });

  it('renders the asset (not proxy geometry) for inspect-only glTF hierarchy nodes', () => {
    const scene = getStarterScene('default');
    const childId = scene.nodes[scene.rootId]!.children[0]!;
    const child = scene.nodes[childId]!;
    useSceneStore.getState().dispatch({
      type: 'REPLACE_SCENE',
      scene: {
        ...scene,
        nodes: {
          ...scene.nodes,
          [childId]: {
            ...child,
            metadata: {
              ...child.metadata,
              renderMode: 'gltf-inspect-only',
            },
          },
        },
      },
    });

    const { container } = render(<NodeMesh nodeId={childId} />);

    // The group wrapper is always present
    expect(container.querySelector('group')).not.toBeNull();
    // Proxy box geometry must not render — asset takes precedence
    expect(container.querySelector('boxGeometry')).toBeNull();
  });
});
