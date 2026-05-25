import './App.css';
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

function Editor() {
  useKeyboardShortcuts();

  return (
    <div className="app">
      <Toolbar />
      <div className="editor-body">
        <main className="main">
          <TreeView />
          <Viewport />
          <Inspector />
        </main>
        <CodePane />
        <CommandTimeline />
      </div>
    </div>
  );
}

function App() {
  const bridgeConnected = useSceneStore((s) => s.bridgeConnected);
  const bridgeConnecting = useSceneStore((s) => s.bridgeConnecting);
  const bridgeEnabled = useSceneStore((s) => s.bridgeEnabled);

  const showOnboarding = bridgeEnabled && !bridgeConnecting && !bridgeConnected;

  return (
    <>
      <BridgeSession />
      {showOnboarding ? <Onboarding /> : <Editor />}
    </>
  );
}

export default App;
