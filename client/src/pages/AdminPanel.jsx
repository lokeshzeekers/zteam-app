import { useEffect, useState } from 'react';
import api from '../api';

export default function AdminPanel() {
  const [tab, setTab] = useState('employees');
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [newDept, setNewDept] = useState({ name: '', description: '' });
  const [newEmp, setNewEmp] = useState({ name: '', email: '', phone: '', employeeNumber: '', position: '', departmentId: '', role: 'employee' });
  const [lastCreated, setLastCreated] = useState(null);
  const [editing, setEditing] = useState(null); // employee object being edited, or null
  const [editForm, setEditForm] = useState(null);
  const [showEditPw, setShowEditPw] = useState(false);
  const [editErr, setEditErr] = useState('');

  function refresh() {
    api.get('/api/admin/departments').then((r) => setDepartments(r.data.departments));
    api.get('/api/admin/employees').then((r) => setEmployees(r.data.employees));
  }
  useEffect(() => { refresh(); }, []);

  async function createDept(e) {
    e.preventDefault();
    if (!newDept.name) return;
    await api.post('/api/admin/departments', newDept);
    setNewDept({ name: '', description: '' });
    refresh();
  }

  async function deleteDept(id) {
    if (!confirm('Delete this department? Members must be reassigned first.')) return;
    try { await api.delete(`/api/admin/departments/${id}`); refresh(); }
    catch (err) { alert(err?.response?.data?.error || 'Failed to delete'); }
  }

  async function createEmp(e) {
    e.preventDefault();
    if (!newEmp.name || !newEmp.email || !newEmp.departmentId) return alert('Name, email and department are required');
    const { data } = await api.post('/api/admin/employees', { ...newEmp, departmentId: Number(newEmp.departmentId) });
    setLastCreated({ name: data.user.name, email: data.user.email, tempPassword: data.tempPassword });
    setNewEmp({ name: '', email: '', phone: '', employeeNumber: '', position: '', departmentId: '', role: 'employee' });
    refresh();
  }

  async function resetPassword(id) {
    const { data } = await api.post(`/api/admin/employees/${id}/reset-password`);
    alert(`New temporary password: ${data.tempPassword}`);
  }

  async function deleteEmp(id) {
    if (!confirm('Remove this employee? This cannot be undone.')) return;
    await api.delete(`/api/admin/employees/${id}`);
    refresh();
  }

  function openEdit(emp) {
    setEditing(emp);
    setEditErr('');
    setShowEditPw(false);
    setEditForm({
      name: emp.name, email: emp.email, phone: emp.phone || '',
      employeeNumber: emp.employeeNumber || '', position: emp.position || '',
      departmentId: emp.departmentId, role: emp.role, newPassword: '',
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    setEditErr('');
    try {
      const body = { ...editForm, departmentId: Number(editForm.departmentId) };
      if (!body.newPassword) delete body.newPassword;
      await api.put(`/api/admin/employees/${editing.id}`, body);
      setEditing(null);
      refresh();
    } catch (err) {
      setEditErr(err?.response?.data?.error || 'Could not save changes');
    }
  }

  const deptName = (id) => departments.find((d) => d.id === id)?.name || '—';

  return (
    <div className="panel">
      <h2>Admin Panel</h2>
      <div className="tabs">
        <button className={tab === 'employees' ? 'active' : ''} onClick={() => setTab('employees')}>Employees</button>
        <button className={tab === 'departments' ? 'active' : ''} onClick={() => setTab('departments')}>Departments</button>
      </div>

      {tab === 'departments' && (
        <>
          <form className="inline-form" onSubmit={createDept}>
            <input placeholder="Department name" value={newDept.name} onChange={(e) => setNewDept({ ...newDept, name: e.target.value })} />
            <input placeholder="Description" value={newDept.description} onChange={(e) => setNewDept({ ...newDept, description: e.target.value })} />
            <button type="submit">Add Department</button>
          </form>
          <table className="admin-table">
            <thead><tr><th>Name</th><th>Description</th><th></th></tr></thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td><td>{d.description}</td>
                  <td><button className="btn-reject" onClick={() => deleteDept(d.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tab === 'employees' && (
        <>
          <form className="inline-form wrap" onSubmit={createEmp}>
            <input placeholder="Full name" value={newEmp.name} onChange={(e) => setNewEmp({ ...newEmp, name: e.target.value })} />
            <input placeholder="Email" value={newEmp.email} onChange={(e) => setNewEmp({ ...newEmp, email: e.target.value })} />
            <input placeholder="Phone number" value={newEmp.phone} onChange={(e) => setNewEmp({ ...newEmp, phone: e.target.value })} />
            <input placeholder="Employee No." value={newEmp.employeeNumber} onChange={(e) => setNewEmp({ ...newEmp, employeeNumber: e.target.value })} />
            <input placeholder="Position" value={newEmp.position} onChange={(e) => setNewEmp({ ...newEmp, position: e.target.value })} />
            <select value={newEmp.departmentId} onChange={(e) => setNewEmp({ ...newEmp, departmentId: e.target.value })}>
              <option value="">Department</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={newEmp.role} onChange={(e) => setNewEmp({ ...newEmp, role: e.target.value })}>
              <option value="employee">Employee</option>
              <option value="admin">Admin</option>
            </select>
            <button type="submit">Add Employee</button>
          </form>

          {lastCreated && (
            <div className="callout">
              Created <strong>{lastCreated.name}</strong> ({lastCreated.email}) — temporary password: <code>{lastCreated.tempPassword}</code>
              <br />Share this with them securely; they should change it after first login.
            </div>
          )}

          <table className="admin-table">
            <thead><tr><th>Name</th><th>Position</th><th>Department</th><th>Phone</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td>{e.name} {e.role === 'admin' && <span className="status-pill accepted">admin</span>}</td>
                  <td>{e.position}</td>
                  <td>{deptName(e.departmentId)}</td>
                  <td>{e.phone}</td>
                  <td><span className={`status-pill ${e.isActive ? 'accepted' : 'pending'}`}>{e.isActive ? 'active' : 'offline'}</span></td>
                  <td>
                    <button onClick={() => openEdit(e)}>Edit</button>
                    <button onClick={() => resetPassword(e.id)}>Reset PW</button>
                    <button className="btn-reject" onClick={() => deleteEmp(e.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {editing && editForm && (
        <div className="call-modal" onClick={() => setEditing(null)}>
          <div className="edit-modal-inner" onClick={(e) => e.stopPropagation()}>
            <h3>Edit {editing.name}</h3>
            <form className="profile-form flat" onSubmit={saveEdit}>
              {editErr && <div className="auth-error">{editErr}</div>}
              <label>Full name</label>
              <input value={editForm.name} onChange={(ev) => setEditForm({ ...editForm, name: ev.target.value })} required />
              <label>Email</label>
              <input type="email" value={editForm.email} onChange={(ev) => setEditForm({ ...editForm, email: ev.target.value })} required />
              <label>Phone number</label>
              <input value={editForm.phone} onChange={(ev) => setEditForm({ ...editForm, phone: ev.target.value })} />
              <label>Employee No.</label>
              <input value={editForm.employeeNumber} onChange={(ev) => setEditForm({ ...editForm, employeeNumber: ev.target.value })} />
              <label>Position</label>
              <input value={editForm.position} onChange={(ev) => setEditForm({ ...editForm, position: ev.target.value })} />
              <label>Department</label>
              <select value={editForm.departmentId} onChange={(ev) => setEditForm({ ...editForm, departmentId: ev.target.value })}>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <label>Role</label>
              <select value={editForm.role} onChange={(ev) => setEditForm({ ...editForm, role: ev.target.value })}>
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
              <label>New password <span className="muted small">(leave blank to keep current)</span></label>
              <div className="password-field">
                <input
                  type={showEditPw ? 'text' : 'password'}
                  value={editForm.newPassword}
                  onChange={(ev) => setEditForm({ ...editForm, newPassword: ev.target.value })}
                  placeholder="••••••••"
                />
                <button type="button" className="eye-toggle" tabIndex={-1} onClick={() => setShowEditPw((s) => !s)}>
                  {showEditPw ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.3 20.3 0 0 1 5.06-5.94M9.9 4.24A10.9 10.9 0 0 1 12 4c7 0 11 8 11 8a20.4 20.4 0 0 1-3.22 4.36M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
              <div className="edit-modal-actions">
                <button type="button" className="btn-reject" onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit">Save changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
