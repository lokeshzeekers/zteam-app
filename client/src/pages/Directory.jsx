import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function Directory() {
  const [departments, setDepartments] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/directory/departments').then((r) => setDepartments(r.data.departments));
  }, []);

  return (
    <div className="panel">
      <h2>Departments</h2>
      {departments.length === 0 && (
        <div className="empty-state">
          <p><strong>No departments yet</strong></p>
          <p className="muted">Ask your admin to set up departments.</p>
        </div>
      )}
      <div className="member-grid">
        {departments.map((d) => (
          <div className="member-card" key={d.id} onClick={() => navigate(`/department/${d.id}`)} role="button" tabIndex={0}>
            <div className="avatar online" style={{ background: '#2f6feb' }}>{d.name[0].toUpperCase()}</div>
            <div className="member-name">{d.name}</div>
            {d.description && <div className="muted small">{d.description}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
