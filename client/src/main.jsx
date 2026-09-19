import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { PresenceProvider } from './context/PresenceContext.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  // Note: intentionally not wrapped in React.StrictMode. In dev, StrictMode
  // double-invokes effects (mount → cleanup → mount), which was opening a
  // socket.io connection, immediately disconnecting it, then reconnecting —
  // that's what produced the "WebSocket is closed before the connection is
  // established" console warning. It's dev-only noise (StrictMode itself
  // has no effect in production builds), but it also caused real duplicate
  // connect/disconnect churn, so it's cleaner left off entirely here.
  <BrowserRouter>
    <AuthProvider>
      <PresenceProvider>
        <App />
      </PresenceProvider>
    </AuthProvider>
  </BrowserRouter>
);
