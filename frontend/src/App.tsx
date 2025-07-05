import { useCompanionStatus } from './hooks/useCompanionStatus';
import ConnectionStatus from './components/ConnectionStatus/ConnectionStatus';
import Previewer from './components/Previewer/Previewer';
import './App.css';

function App() {
  const { status, isPolling } = useCompanionStatus();

  if (status === 'disconnected') {
    return <ConnectionStatus isPolling={isPolling} />;
  }

  return <Previewer />;
}

export default App;