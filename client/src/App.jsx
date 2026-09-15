import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Inbox from './pages/Inbox';
import Requests from './pages/Requests';
import DepartmentMembers from './pages/DepartmentMembers';
import AdminPanel from './pages/AdminPanel';
import Profile from './pages/Profile';
import Layout, { ChatRoute } from './components/Layout';

function Protected({ children, adminOnly }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Layout /></Protected>}>
        <Route index element={<Inbox />} />
        <Route path="requests" element={<Requests />} />
        <Route path="department/:id" element={<DepartmentMembers />} />
        <Route path="chat/:userId" element={<ChatRoute />} />
        <Route path="profile" element={<Profile />} />
        <Route path="admin" element={<Protected adminOnly><AdminPanel /></Protected>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
