import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandTimeline } from './CommandTimeline';
import { TreeView } from './TreeView';
import { Inspector } from './Inspector';
import { useSceneStore } from '../store/sceneStore';

vi.mock('../viewport/Viewport', () => ({
  Viewport: () => <div data-testid="viewport-stub" />,
}));

// ─── CommandTimeline ───────────────────────────────────────────────────────────

describe('CommandTimeline — collapsed drawer', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    useSceneStore.getState().reset();
  });

  it('renders in collapsed state by default — body cards are not shown', () => {
    render(<CommandTimeline />);

    const region = screen.getByRole('region', { name: /command timeline/i });
    expect(region).toBeInTheDocument();
    expect(screen.queryByText('No commands yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('UPDATE_TRANSFORM')).not.toBeInTheDocument();
  });

  it('shows compact step count in the collapsed bar', () => {
    render(<CommandTimeline />);
    expect(screen.getByText(/none/i)).toBeInTheDocument();
  });

  it('expand toggle opens the body and shows empty message', async () => {
    render(<CommandTimeline />);

    const toggle = screen.getByTitle('Expand command timeline');
    await user.click(toggle);

    expect(screen.getByText('No commands yet.')).toBeInTheDocument();
  });

  it('expand toggle changes aria-expanded attribute', async () => {
    render(<CommandTimeline />);

    const toggle = screen.getByTitle('Expand command timeline');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('Recompute button is not visible when there are no edited commands', () => {
    render(<CommandTimeline />);
    expect(screen.queryByRole('button', { name: /recompute/i })).not.toBeInTheDocument();
  });

  it('Recompute button is visible in the collapsed bar when editedCount > 0', async () => {
    render(<CommandTimeline />);

    await act(() => {
      useSceneStore.getState().dispatch({
        type: 'UPDATE_TRANSFORM',
        nodeId: 'default-cube-1',
        patch: { position: [0, 1, 0] },
      });
    });

    const toggle = screen.getByTitle('Expand command timeline');
    await user.click(toggle);

    const timeline = screen.getByRole('region', { name: /command timeline/i });
    const posX = within(timeline).getByRole('spinbutton', { name: /position x/i });
    await user.clear(posX);
    await user.type(posX, '5');

    await user.click(toggle);

    expect(screen.getByRole('button', { name: /recompute/i })).toBeInTheDocument();
  });
});

// ─── TreeView — Runtime tab ────────────────────────────────────────────────────

describe('TreeView — Runtime tab', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    useSceneStore.getState().reset();
  });

  it('renders Outline and Runtime tabs', () => {
    render(<TreeView />);
    expect(screen.getByRole('button', { name: /outline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /runtime/i })).toBeInTheDocument();
  });

  it('Outline tab is active by default', () => {
    render(<TreeView />);
    const outline = screen.getByRole('button', { name: /outline/i });
    expect(outline).toHaveClass('tree-view__tab--active');
  });

  it('Runtime tab shows empty state when no interactive nodes exist', async () => {
    render(<TreeView />);
    await user.click(screen.getByRole('button', { name: /runtime/i }));
    expect(screen.getByText(/no interactive nodes yet/i)).toBeInTheDocument();
  });

  it('interactive nodes with behaviorRefs appear in Runtime tab', async () => {
    await act(() => {
      const { dispatch } = useSceneStore.getState();
      dispatch({
        type: 'SET_NODE_SEMANTICS',
        nodeIds: ['default-cube-1'],
        semantics: { role: 'product' },
      });
      dispatch({
        type: 'ADD_BEHAVIOR',
        behavior: {
          id: 'beh-hover-1',
          type: 'hover_highlight',
          nodeIds: ['default-cube-1'],
        },
      });
    });

    render(<TreeView />);
    await user.click(screen.getByRole('button', { name: /runtime/i }));

    expect(screen.getByText('Cube 1')).toBeInTheDocument();
    expect(screen.getAllByText(/hover/i).length).toBeGreaterThan(0);
  });

  it('nodes without role or behaviorRefs are excluded from Runtime tab', async () => {
    render(<TreeView />);
    await user.click(screen.getByRole('button', { name: /runtime/i }));

    expect(screen.queryByText('Cube 1')).not.toBeInTheDocument();
  });

  it('clicking a Runtime node row dispatches selection', async () => {
    await act(() => {
      useSceneStore.getState().dispatch({
        type: 'SET_NODE_SEMANTICS',
        nodeIds: ['default-cube-1'],
        semantics: { role: 'product' },
      });
    });

    render(<TreeView />);
    await user.click(screen.getByRole('button', { name: /runtime/i }));

    const cubeBtn = screen.getByRole('button', { name: /cube 1/i });
    await user.click(cubeBtn);

    expect(useSceneStore.getState().scene.selection).toBe('default-cube-1');
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
