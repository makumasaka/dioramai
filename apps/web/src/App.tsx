import './App.css';
import { useCallback, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { BridgeSession } from './bridge/BridgeSession';
import { CodePane } from './ui/CodePane';
import { CommandTimeline } from './ui/CommandTimeline';
import { Inspector } from './ui/Inspector';
import { Onboarding } from './ui/Onboarding';
import { Toolbar } from './ui/Toolbar';
import { TreeView } from './ui/TreeView';
import { useKeyboardShortcuts } from './ui/useKeyboardShortcuts';
import { useSceneStore } from './store/sceneStore';
import { Viewport } from './viewport/Viewport';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

type DragAxis = 'y-code' | 'y-timeline' | 'x-tree' | 'x-inspector';

interface PanelSizes {
  codePaneH: number;
  timelineH: number;
  treeW: number;
  inspectorW: number;
}

const INITIAL_SIZES: PanelSizes = { codePaneH: 220, timelineH: 160, treeW: 260, inspectorW: 300 };
const LIMITS = { codePaneH: [60, 700], timelineH: [40, 500], treeW: [120, 600], inspectorW: [160, 700] } as const;

function useDragResize() {
  const [sizes, setSizes] = useState<PanelSizes>(INITIAL_SIZES);
  const snapRef = useRef<PanelSizes>(INITIAL_SIZES);

  const startDrag = useCallback((axis: DragAxis, e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    snapRef.current = { ...sizes };

    const cursor = axis.startsWith('y') ? 'row-resize' : 'col-resize';
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY;
      const dx = ev.clientX - startX;
      const s = snapRef.current;
      setSizes((prev) => {
        switch (axis) {
          case 'y-code':      return { ...prev, codePaneH:   clamp(s.codePaneH   - dy, LIMITS.codePaneH[0],   LIMITS.codePaneH[1]) };
          case 'y-timeline':  return { ...prev, timelineH:   clamp(s.timelineH   - dy, LIMITS.timelineH[0],   LIMITS.timelineH[1]) };
          case 'x-tree':      return { ...prev, treeW:       clamp(s.treeW       + dx, LIMITS.treeW[0],       LIMITS.treeW[1]) };
          case 'x-inspector': return { ...prev, inspectorW:  clamp(s.inspectorW  - dx, LIMITS.inspectorW[0],  LIMITS.inspectorW[1]) };
        }
      });
    };

    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sizes]);

  return { sizes, startDrag };
}

function DragHandle({ axis, onMouseDown }: { axis: 'x' | 'y'; onMouseDown: (e: ReactMouseEvent) => void }) {
  return (
    <div
      className={`drag-handle drag-handle--${axis}`}
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
    />
  );
}

function Editor() {
  useKeyboardShortcuts();
  const { sizes, startDrag } = useDragResize();
  const { codePaneH, timelineH, treeW, inspectorW } = sizes;

  return (
    <div className="app">
      <Toolbar />
      <div
        className="editor-body"
        style={{ gridTemplateRows: `minmax(0, 1fr) 5px ${codePaneH}px 5px ${timelineH}px` }}
      >
        <main
          className="main"
          style={{ gridTemplateColumns: `${treeW}px 5px minmax(0, 1fr) 5px ${inspectorW}px` }}
        >
          <TreeView />
          <DragHandle axis="x" onMouseDown={(e) => startDrag('x-tree', e)} />
          <Viewport />
          <DragHandle axis="x" onMouseDown={(e) => startDrag('x-inspector', e)} />
          <Inspector />
        </main>
        <DragHandle axis="y" onMouseDown={(e) => startDrag('y-code', e)} />
        <CodePane />
        <DragHandle axis="y" onMouseDown={(e) => startDrag('y-timeline', e)} />
        <CommandTimeline />
      </div>
    </div>
  );
}

function App() {
  const bridgeConnected = useSceneStore((s) => s.bridgeConnected);
  const bridgeConnecting = useSceneStore((s) => s.bridgeConnecting);
  const bridgeEnabled = useSceneStore((s) => s.bridgeEnabled);
  const bridgeSessionKey = useSceneStore((s) => s.bridgeSessionKey);

  const showOnboarding = bridgeEnabled && !bridgeConnecting && !bridgeConnected;

  return (
    <>
      <BridgeSession key={bridgeSessionKey} />
      <div className={showOnboarding ? 'editor-host editor-host--obscured' : 'editor-host'}>
        <Editor />
      </div>
      {showOnboarding && <Onboarding />}
    </>
  );
}

export default App;
