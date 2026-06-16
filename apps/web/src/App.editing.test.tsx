import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseSceneJson } from '@dioramai/core';
import App from './App';
import { useSceneStore } from './store/sceneStore';

vi.mock('./viewport/Viewport', () => ({
  Viewport: () => <div data-testid="viewport-stub" />,
}));

const expandTimeline = async (user: ReturnType<typeof userEvent.setup>) => {
  const toggleBtn = screen.getByTitle('Expand command timeline');
  await user.click(toggleBtn);
};

const treeCubeButton = (): HTMLElement => {
  const btn = screen
    .getAllByRole('button')
    .find(
      (b) =>
        (b.textContent ?? '').includes('Cube 1') &&
        !(b.textContent ?? '').includes('(copy)'),
    );
  if (!btn) throw new Error('expected default tree row for Cube 1');
  return btn;
};

describe('App — core editing flows (component)', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    useSceneStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('keeps deferred semantic/demo actions out of the primary MVP toolbar', () => {
    const { container } = render(<App />);

    // The combobox check guards the primary toolbar against deferred semantic
    // controls; environment/light comboboxes legitimately live in the Inspector.
    const toolbar = container.querySelector('.toolbar') as HTMLElement;
    expect(toolbar).not.toBeNull();
    expect(within(toolbar).queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load kit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Structure Scene' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make Interactive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Arrange Products' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Line' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grid' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Circle' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'To root' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dup tree' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy GLB Into Project' })).toBeInTheDocument();
  });

  it('selects default cube and edits position from the inspector', async () => {
    render(<App />);

    await user.click(treeCubeButton());

    const inspector = screen.getByRole('complementary');
    const spinbuttons = within(inspector).getAllByRole('spinbutton');
    expect(spinbuttons.length).toBeGreaterThanOrEqual(3);

    await user.clear(spinbuttons[0]!);
    await user.type(spinbuttons[0]!, '2.25');
    await user.tab();

    const cube = useSceneStore.getState().scene.nodes['default-cube-1'];
    expect(cube?.transform.position[0]).toBeCloseTo(2.25, 2);
  });

  it('selects, edits, logs UPDATE_TRANSFORM, then undo/redoes the scene change', async () => {
    render(<App />);

    await user.click(treeCubeButton());

    const inspector = screen.getByRole('complementary');
    const spinbuttons = within(inspector).getAllByRole('spinbutton');
    await user.clear(spinbuttons[1]!);
    await user.type(spinbuttons[1]!, '3.5');
    await user.tab();

    await expandTimeline(user);
    const commandLog = screen.getByRole('region', { name: /command timeline/i });
    await waitFor(() => {
      expect(within(commandLog).getAllByText('UPDATE_TRANSFORM').length).toBeGreaterThan(0);
    });
    expect(useSceneStore.getState().commandLog.at(-1)?.command).toEqual({
      type: 'UPDATE_TRANSFORM',
      nodeId: 'default-cube-1',
      patch: { position: [0, 3.5, 0] },
    });
    expect(useSceneStore.getState().scene.nodes['default-cube-1']?.transform.position).toEqual([
      0,
      3.5,
      0,
    ]);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(useSceneStore.getState().scene.nodes['default-cube-1']?.transform.position).toEqual([
      0,
      0.5,
      0,
    ]);

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(useSceneStore.getState().scene.nodes['default-cube-1']?.transform.position).toEqual([
      0,
      3.5,
      0,
    ]);
  });

  it('shows timeline rows for structural edits but not selection', async () => {
    render(<App />);

    const root = useSceneStore.getState().scene.rootId;
    await user.click(treeCubeButton());
    await expandTimeline(user);
    const commandLog = screen.getByRole('region', { name: /command timeline/i });
    expect(within(commandLog).getByText('No commands yet.')).toBeInTheDocument();

    await act(() => {
      useSceneStore.getState().dispatch({
        type: 'UPDATE_TRANSFORM',
        nodeId: useSceneStore.getState().scene.nodes[root]!.children[0]!,
        patch: { position: [0, 0.9, 0] },
      });
    });
    await waitFor(() => {
      expect(within(commandLog).queryByText('No commands yet.')).not.toBeInTheDocument();
      expect(within(commandLog).getByText('UPDATE_TRANSFORM')).toBeInTheDocument();
    });
  });

  it('edits UPDATE_TRANSFORM parameters in timeline and recomputes scene', async () => {
    render(<App />);
    await user.click(treeCubeButton());

    const inspector = screen.getByRole('complementary');
    const spinbuttons = within(inspector).getAllByRole('spinbutton');
    await user.clear(spinbuttons[0]!);
    await user.type(spinbuttons[0]!, '3');
    await user.tab();

    await expandTimeline(user);
    const timeline = screen.getByRole('region', { name: /command timeline/i });
    const positionX = within(timeline).getByRole('spinbutton', { name: /position x/i });
    await user.clear(positionX);
    await user.type(positionX, '6');

    const recompute = within(timeline).getByRole('button', {
      name: /recompute/i,
    });
    expect(recompute).not.toBeDisabled();
    await user.click(recompute);

    expect(useSceneStore.getState().scene.nodes['default-cube-1']?.transform.position[0]).toBe(6);
  });

  it('preserves command log and undo history when clearing the scene', async () => {
    render(<App />);

    await act(() => {
      useSceneStore.getState().dispatch({
        type: 'UPDATE_TRANSFORM',
        nodeId: 'default-cube-1',
        patch: { position: [0, 1.5, 0] },
      });
    });
    expect(useSceneStore.getState().commandLog).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Clear Scene' }));

    const scene = useSceneStore.getState().scene;
    expect(Object.keys(scene.nodes)).toHaveLength(1);
    expect(scene.nodes[scene.rootId]?.type).toBe('root');
    expect(scene.nodes[scene.rootId]?.children).toHaveLength(0);
    expect(scene.nodes['default-cube-1']).toBeUndefined();
    expect(useSceneStore.getState().commandLog).toHaveLength(1);
    expect(useSceneStore.getState().past.length).toBeGreaterThan(0);
    expect(useSceneStore.getState().future).toHaveLength(0);
  });

  it('exports edited canonical scene state through JSON and R3F UI actions', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:scene-json');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<App />);
    await user.click(treeCubeButton());

    const inspector = screen.getByRole('complementary');
    const spinbuttons = within(inspector).getAllByRole('spinbutton');
    await user.clear(spinbuttons[0]!);
    await user.type(spinbuttons[0]!, '1.75');
    await user.tab();

    await user.click(screen.getByRole('button', { name: 'JSON' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    const parsed = parseSceneJson(await blob.text());
    expect(parsed?.nodes['default-cube-1']?.transform.position).toEqual([1.75, 0.5, 0]);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:scene-json');

    await user.click(screen.getByRole('button', { name: 'R3F' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]?.[0]).toContain('position={[1.75, 0.5, 0]}');
    expect(writeText.mock.calls[0]?.[0]).toContain('Studio fill - not from scene graph');
  });
});
