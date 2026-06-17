import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { collectRuntimeNodes, RuntimeView } from './runtimeView';
import { useSceneStore } from '../store/sceneStore';

describe('collectRuntimeNodes', () => {
  beforeEach(() => {
    useSceneStore.getState().reset();
  });

  it('excludes nodes without role or behaviors', () => {
    const scene = useSceneStore.getState().scene;
    expect(collectRuntimeNodes(scene)).toHaveLength(0);
  });

  it('includes nodes with semantic role', () => {
    act(() => {
      useSceneStore.getState().dispatch({
        type: 'SET_NODE_SEMANTICS',
        nodeIds: ['default-cube-1'],
        semantics: { role: 'product' },
      });
    });
    const nodes = collectRuntimeNodes(useSceneStore.getState().scene);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.node.id).toBe('default-cube-1');
    expect(nodes[0]?.role).toBe('product');
  });

  it('includes nodes with behavior refs', () => {
    act(() => {
      useSceneStore.getState().dispatch({
        type: 'ADD_BEHAVIOR',
        behavior: {
          id: 'beh-hover-1',
          type: 'hover_highlight',
          nodeIds: ['default-cube-1'],
        },
      });
    });
    const nodes = collectRuntimeNodes(useSceneStore.getState().scene);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.activeBehaviors).toHaveLength(1);
  });
});

describe('RuntimeView', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    useSceneStore.getState().reset();
  });

  it('shows empty state when no interactive nodes exist', () => {
    render(
      <RuntimeView
        scene={useSceneStore.getState().scene}
        selectedId={null}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByText(/no interactive nodes yet/i)).toBeInTheDocument();
  });

  it('lists interactive nodes and dispatches selection on click', async () => {
    act(() => {
      useSceneStore.getState().dispatch({
        type: 'SET_NODE_SEMANTICS',
        nodeIds: ['default-cube-1'],
        semantics: { role: 'product' },
      });
    });

    const onSelect = vi.fn();
    render(
      <RuntimeView
        scene={useSceneStore.getState().scene}
        selectedId={null}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText('Cube 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cube 1/i }));
    expect(onSelect).toHaveBeenCalledWith('default-cube-1');
  });
});
