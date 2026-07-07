import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandHistory } from './CommandHistory';
import { TreeView } from './TreeView';
import { Inspector } from './Inspector';
import { createNode } from '@dioramai/core';
import { useSceneStore } from '../store/sceneStore';

vi.mock('../viewport/Viewport', () => ({
  Viewport: () => <div data-testid="viewport-stub" />,
}));

// ─── CommandHistory ────────────────────────────────────────────────────────────

describe('CommandHistory', () => {
  beforeEach(() => {
    useSceneStore.getState().reset();
  });

  it('shows empty state when no commands have been dispatched', () => {
    render(<CommandHistory />);
    expect(screen.getByText('No commands yet.')).toBeInTheDocument();
    expect(screen.getByText('none')).toBeInTheDocument();
  });

  it('lists committed commands newest first with summaries', async () => {
    await act(() => {
      useSceneStore.getState().dispatch({
        type: 'UPDATE_TRANSFORM',
        nodeId: 'default-cube-1',
        patch: { position: [0, 1, 0] },
      });
    });

    render(<CommandHistory />);
    const history = screen.getByRole('region', { name: /command history/i });
    expect(within(history).getByText('UPDATE_TRANSFORM')).toBeInTheDocument();
    expect(within(history).getByText('1 step')).toBeInTheDocument();
  });

  it('does not list SET_SELECTION commands', async () => {
    await act(() => {
      useSceneStore.getState().select('default-cube-1');
    });

    render(<CommandHistory />);
    expect(screen.getByText('No commands yet.')).toBeInTheDocument();
  });
});

// ─── Inspector — tabs ──────────────────────────────────────────────────────────

describe('Inspector — tabs', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    useSceneStore.getState().reset();
  });

  it('renders Inspector and Advanced tabs', () => {
    render(<Inspector />);
    expect(screen.getByRole('button', { name: /inspector/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /advanced/i })).toBeInTheDocument();
  });

  it('Inspector tab is active by default', () => {
    render(<Inspector />);
    expect(screen.getByRole('button', { name: /^inspector$/i })).toHaveClass(
      'inspector-panel__tab--active',
    );
  });

  it('Advanced tab shows command history', async () => {
    render(<Inspector />);
    await user.click(screen.getByRole('button', { name: /advanced/i }));
    expect(screen.getByRole('region', { name: /command history/i })).toBeInTheDocument();
  });
});

// ─── Inspector — performance panel ─────────────────────────────────────────────

describe('Inspector — performance panel', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    useSceneStore.getState().reset();
  });

  const openAdvancedTab = async () => {
    render(<Inspector />);
    await user.click(screen.getByRole('button', { name: /advanced/i }));
  };

  it('shows the performance controls in the Advanced tab', async () => {
    await openAdvancedTab();
    expect(screen.getByText('Performance')).toBeInTheDocument();
    expect(screen.getByText('Shadows')).toBeInTheDocument();
    expect(screen.getByText('Render on demand')).toBeInTheDocument();
    expect(screen.getByText('Antialias')).toBeInTheDocument();
    expect(screen.getByText('GPU preference')).toBeInTheDocument();
  });

  it('keeps the pixel ratio slider range aligned with SceneRenderSettingsSchema (0.25–4)', async () => {
    await openAdvancedTab();
    const slider = screen.getByRole('slider', { name: /max pixel ratio/i });
    expect(slider).toHaveAttribute('min', '0.25');
    expect(slider).toHaveAttribute('max', '4');
  });

  it('dispatches UPDATE_RENDER_SETTINGS when toggling shadows', async () => {
    await openAdvancedTab();
    const shadowsRow = screen.getByText('Shadows').closest('.inspector__row');
    expect(shadowsRow).not.toBeNull();
    await user.click(within(shadowsRow as HTMLElement).getByRole('checkbox'));

    const lastCmd = useSceneStore.getState().commandLog.at(-1)?.command;
    expect(lastCmd?.type).toBe('UPDATE_RENDER_SETTINGS');
    if (lastCmd?.type === 'UPDATE_RENDER_SETTINGS') {
      expect(lastCmd.patch.shadows).toBe(false);
    }
    expect(useSceneStore.getState().scene.renderSettings?.shadows).toBe(false);
  });

  it('dispatches UPDATE_RENDER_SETTINGS when changing the pixel ratio slider', async () => {
    await openAdvancedTab();
    const slider = screen.getByRole('slider', { name: /max pixel ratio/i });
    fireEvent.change(slider, { target: { value: '1' } });

    const lastCmd = useSceneStore.getState().commandLog.at(-1)?.command;
    expect(lastCmd?.type).toBe('UPDATE_RENDER_SETTINGS');
    expect(useSceneStore.getState().scene.renderSettings?.maxPixelRatio).toBe(1);
  });
});

// ─── TreeView ──────────────────────────────────────────────────────────────────

describe('TreeView', () => {
  beforeEach(() => {
    useSceneStore.getState().reset();
  });

  it('renders outline header and scene hierarchy without Runtime tab', () => {
    render(<TreeView />);
    expect(screen.getByText('Outline')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /runtime/i })).not.toBeInTheDocument();
    expect(screen.getByText('Cube 1')).toBeInTheDocument();
  });

  it('collapses and expands nested node layers without changing scene history', async () => {
    const user = userEvent.setup();
    const rootId = useSceneStore.getState().scene.rootId;
    useSceneStore.getState().dispatch({
      type: 'ADD_NODE',
      parentId: rootId,
      node: createNode({ id: 'parent-group', name: 'Parent Group', type: 'group' }),
    });
    useSceneStore.getState().dispatch({
      type: 'ADD_NODE',
      parentId: 'parent-group',
      node: createNode({ id: 'nested-mesh', name: 'Nested Mesh', type: 'mesh' }),
    });
    const logLength = useSceneStore.getState().commandLog.length;

    render(<TreeView />);

    expect(screen.getByText('Nested Mesh')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Collapse Parent Group' }));
    expect(screen.queryByText('Nested Mesh')).not.toBeInTheDocument();
    expect(useSceneStore.getState().commandLog).toHaveLength(logLength);

    await user.click(screen.getByRole('button', { name: 'Expand Parent Group' }));
    expect(screen.getByText('Nested Mesh')).toBeInTheDocument();
    expect(useSceneStore.getState().commandLog).toHaveLength(logLength);
  });

  it('reparents nodes by dragging a row onto a new parent row', () => {
    const rootId = useSceneStore.getState().scene.rootId;
    useSceneStore.getState().dispatch({
      type: 'ADD_NODE',
      parentId: rootId,
      node: createNode({ id: 'target-group', name: 'Target Group', type: 'group' }),
    });

    render(<TreeView />);

    const draggedRow = screen.getByText('Cube 1').closest('.tree-row');
    const targetRow = screen.getByText('Target Group').closest('.tree-row');
    expect(draggedRow).not.toBeNull();
    expect(targetRow).not.toBeNull();

    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn((type: string, value: string) => values.set(type, value)),
      getData: vi.fn((type: string) => values.get(type) ?? ''),
    };

    fireEvent.dragStart(draggedRow!, { dataTransfer });
    fireEvent.dragOver(targetRow!, { dataTransfer });
    fireEvent.drop(targetRow!, { dataTransfer });

    const scene = useSceneStore.getState().scene;
    expect(scene.nodes['target-group']?.children).toContain('default-cube-1');
    expect(scene.nodes[rootId]?.children).not.toContain('default-cube-1');
    expect(scene.selection).toBe('default-cube-1');
    expect(useSceneStore.getState().commandLog.at(-1)?.command.type).toBe('SET_PARENT');
  });
});

// ─── Inspector — behavior controls ────────────────────────────────────────────

describe('Inspector — behavior controls', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    useSceneStore.getState().reset();
    useSceneStore.getState().select('default-cube-1');
  });

  it('shows Add buttons for hover highlight and click select when no behaviors present', () => {
    render(<Inspector />);

    const addButtons = screen.getAllByRole('button', { name: /add/i });
    expect(addButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('Add hover highlight dispatches ADD_BEHAVIOR with hover_highlight type', async () => {
    render(<Inspector />);

    const addButtons = screen.getAllByRole('button', { name: /add/i });
    await user.click(addButtons[0]!);

    const log = useSceneStore.getState().commandLog;
    const lastCmd = log.at(-1)?.command;
    expect(lastCmd?.type).toBe('ADD_BEHAVIOR');
    if (lastCmd?.type === 'ADD_BEHAVIOR') {
      expect(lastCmd.behavior.type).toBe('hover_highlight');
      expect(lastCmd.behavior.nodeIds).toContain('default-cube-1');
    }
  });

  it('switches from Add to Remove after ADD_BEHAVIOR for hover', async () => {
    render(<Inspector />);

    const addBtns = screen.getAllByRole('button', { name: /add/i });
    await user.click(addBtns[0]!);

    expect(await screen.findAllByRole('button', { name: /remove/i })).toHaveLength(1);
  });

  it('Remove button dispatches REMOVE_BEHAVIOR', async () => {
    await act(() => {
      useSceneStore.getState().dispatch({
        type: 'ADD_BEHAVIOR',
        behavior: {
          id: 'beh-hover-test',
          type: 'hover_highlight',
          nodeIds: ['default-cube-1'],
        },
      });
    });

    render(<Inspector />);

    const removeBtns = screen.getAllByRole('button', { name: /remove/i });
    await user.click(removeBtns[0]!);

    const log = useSceneStore.getState().commandLog;
    const lastCmd = log.at(-1)?.command;
    expect(lastCmd?.type).toBe('REMOVE_BEHAVIOR');
    if (lastCmd?.type === 'REMOVE_BEHAVIOR') {
      expect(lastCmd.behaviorId).toBe('beh-hover-test');
    }
  });

  it('role selector dispatches SET_NODE_SEMANTICS with selected role', async () => {
    render(<Inspector />);

    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'display');

    const log = useSceneStore.getState().commandLog;
    const lastCmd = log.at(-1)?.command;
    expect(lastCmd?.type).toBe('SET_NODE_SEMANTICS');
    if (lastCmd?.type === 'SET_NODE_SEMANTICS') {
      expect(lastCmd.semantics.role).toBe('display');
      expect(lastCmd.nodeIds).toContain('default-cube-1');
    }
  });

  it('tags input dispatches SET_NODE_SEMANTICS with parsed tags on blur', async () => {
    render(<Inspector />);

    const tagsInput = screen.getByPlaceholderText(/tag1, tag2/i);
    await user.clear(tagsInput);
    await user.type(tagsInput, 'hero, outdoor, featured');
    await user.tab();

    const log = useSceneStore.getState().commandLog;
    const lastCmd = log.at(-1)?.command;
    expect(lastCmd?.type).toBe('SET_NODE_SEMANTICS');
    if (lastCmd?.type === 'SET_NODE_SEMANTICS') {
      expect(lastCmd.semantics.tags).toEqual(['hero', 'outdoor', 'featured']);
      expect(lastCmd.nodeIds).toContain('default-cube-1');
    }
  });

  it('label input dispatches SET_NODE_SEMANTICS with label on blur', async () => {
    render(<Inspector />);

    const labelInput = screen.getByPlaceholderText(/optional label/i);
    await user.clear(labelInput);
    await user.type(labelInput, 'Oak Chair');
    await user.tab();

    const log = useSceneStore.getState().commandLog;
    const lastCmd = log.at(-1)?.command;
    expect(lastCmd?.type).toBe('SET_NODE_SEMANTICS');
    if (lastCmd?.type === 'SET_NODE_SEMANTICS') {
      expect(lastCmd.semantics.label).toBe('Oak Chair');
    }
  });

  it('description textarea dispatches SET_NODE_SEMANTICS with description on blur', async () => {
    render(<Inspector />);

    const descInput = screen.getByPlaceholderText(/optional description/i);
    await user.clear(descInput);
    await user.type(descInput, 'Handcrafted piece');
    await user.tab();

    const log = useSceneStore.getState().commandLog;
    const lastCmd = log.at(-1)?.command;
    expect(lastCmd?.type).toBe('SET_NODE_SEMANTICS');
    if (lastCmd?.type === 'SET_NODE_SEMANTICS') {
      expect(lastCmd.semantics.description).toBe('Handcrafted piece');
    }
  });

  it('show_info params editor dispatches ADD_BEHAVIOR with title param on blur', async () => {
    await act(() => {
      useSceneStore.getState().dispatch({
        type: 'ADD_BEHAVIOR',
        behavior: { id: 'beh-info-ui', type: 'show_info', nodeIds: ['default-cube-1'] },
      });
    });

    render(<Inspector />);

    const titleInput = screen.getByPlaceholderText(/product name/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Oak Chair');
    await user.tab();

    const log = useSceneStore.getState().commandLog;
    const lastCmd = log.at(-1)?.command;
    expect(lastCmd?.type).toBe('ADD_BEHAVIOR');
    if (lastCmd?.type === 'ADD_BEHAVIOR') {
      expect(lastCmd.behavior.id).toBe('beh-info-ui');
      expect(lastCmd.behavior.params?.title).toBe('Oak Chair');
    }
  });

  it('open_url params editor dispatches ADD_BEHAVIOR with url param on blur', async () => {
    await act(() => {
      useSceneStore.getState().dispatch({
        type: 'ADD_BEHAVIOR',
        behavior: { id: 'beh-url-ui', type: 'open_url', nodeIds: ['default-cube-1'] },
      });
    });

    render(<Inspector />);

    const urlInput = screen.getByPlaceholderText(/https:\/\//i);
    await user.clear(urlInput);
    await user.type(urlInput, 'https://example.com');
    await user.tab();

    const log = useSceneStore.getState().commandLog;
    const lastCmd = log.at(-1)?.command;
    expect(lastCmd?.type).toBe('ADD_BEHAVIOR');
    if (lastCmd?.type === 'ADD_BEHAVIOR') {
      expect(lastCmd.behavior.id).toBe('beh-url-ui');
      expect(lastCmd.behavior.params?.url).toBe('https://example.com');
    }
  });
});
