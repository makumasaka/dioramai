import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandHistory } from './CommandHistory';
import { TreeView } from './TreeView';
import { Inspector } from './Inspector';
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
