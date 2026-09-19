import { useEffect, useState } from 'react';
import api from '../api';
import { usePresence } from '../context/PresenceContext';
import Select from '../components/Select';
import { getSocket } from '../socket';

const ROLE_OPTIONS = [
  { value: 'employee', label: 'Employee' },
  { value: 'admin', label: 'Admin' },
];

export default function AdminPanel() {
  const { isUserActive } = usePresence();
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
  useEffect(() => {
    refresh();
    const socket = getSocket();
    socket?.on('user-removed', refresh);
    return () => socket?.off('user-removed', refresh);
  }, []);

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

  async function deleteEmp(id) {
    if (!confirm('Remove this employee? This cannot be undone.')) return;
    try {
      await api.delete(`/api/admin/employees/${id}`);
      refresh();
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete this employee.');
    }
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
  const deptOptions = departments.map((d) => ({ value: d.id, label: d.name }));

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
          <div className="table-scroll">
            <table className="admin-table">
              <thead><tr><th>Name</th><th>Description</th><th></th></tr></thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td><td>{d.description}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="btn-danger btn-sm" onClick={() => deleteDept(d.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            <Select
              value={newEmp.departmentId}
              onChange={(v) => setNewEmp({ ...newEmp, departmentId: v })}
              options={deptOptions}
              placeholder="Department"
              ariaLabel="Department"
            />
            <Select
              value={newEmp.role}
              onChange={(v) => setNewEmp({ ...newEmp, role: v })}
              options={ROLE_OPTIONS}
              ariaLabel="Role"
            />
            <button type="submit">Add Employee</button>
          </form>

          {lastCreated && (
            <div className="callout">
              Created <strong>{lastCreated.name}</strong> ({lastCreated.email}) — temporary password: <code>{lastCreated.tempPassword}</code>
              <br />Share this with them securely; they should change it after first login.
            </div>
          )}

          <div className="table-scroll">
          <table className="admin-table">
            <thead><tr><th>Name</th><th>Position</th><th>Department</th><th>Phone</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}{e.role === 'admin' && <span className="status-pill accepted ml">admin</span>}</td>
                  <td>{e.position}</td>
                  <td>{deptName(e.departmentId)}</td>
                  <td>{e.phone}</td>
                  <td><span className={`status-pill ${isUserActive(e.id, e.isActive) ? 'accepted' : 'pending'}`}>{isUserActive(e.id, e.isActive) ? 'active' : 'offline'}</span></td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn-secondary btn-sm" onClick={() => openEdit(e)}>Edit</button>
                      <button type="button" className="btn-danger btn-sm" onClick={() => deleteEmp(e.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}

      {editing && editForm && (
        <div className="call-modal" onClick={() => setEditing(null)}>
          <div className="edit-modal-inner" onClick={(e) => e.stopPropagation()}>
            <h3>Edit {editing.name}</h3>
            <form className="profile-form flat" onSubmit={saveEdit}>
              {editErr && <div className="auth-error">{editErr}</div>}
              <div className="form-grid">
                <div className="form-field">
                  <label htmlFor="edit-name">Full name</label>
                  <input id="edit-name" value={editForm.name} onChange={(ev) => setEditForm({ ...editForm, name: ev.target.value })} required />
                </div>
                <div className="form-field">
                  <label htmlFor="edit-email">Email</label>
                  <input id="edit-email" type="email" value={editForm.email} onChange={(ev) => setEditForm({ ...editForm, email: ev.target.value })} required />
                </div>
                <div className="form-field">
                  <label htmlFor="edit-phone">Phone number</label>
                  <input id="edit-phone" value={editForm.phone} onChange={(ev) => setEditForm({ ...editForm, phone: ev.target.value })} />
                </div>
                <div className="form-field">
                  <label htmlFor="edit-empno">Employee No.</label>
                  <input id="edit-empno" value={editForm.employeeNumber} onChange={(ev) => setEditForm({ ...editForm, employeeNumber: ev.target.value })} />
                </div>
                <div className="form-field">
                  <label htmlFor="edit-position">Position</label>
                  <input id="edit-position" value={editForm.position} onChange={(ev) => setEditForm({ ...editForm, position: ev.target.value })} />
                </div>
                <div className="form-field">
                  <label id="edit-dept-label">Department</label>
                  <Select
                    value={editForm.departmentId}
                    onChange={(v) => setEditForm({ ...editForm, departmentId: v })}
                    options={deptOptions}
                    ariaLabel="Department"
                  />
                </div>
                <div className="form-field full">
                  <label>Role</label>
                  <Select
                    value={editForm.role}
                    onChange={(v) => setEditForm({ ...editForm, role: v })}
                    options={ROLE_OPTIONS}
                    ariaLabel="Role"
                  />
                </div>
                <div className="form-field full">
                  <label htmlFor="edit-password">
                    New password<span className="label-hint">(leave blank to keep current)</span>
                  </label>
                  <div className="password-field">
                    <input
                      id="edit-password"
                      type={showEditPw ? 'text' : 'password'}
                      value={editForm.newPassword}
                      onChange={(ev) => setEditForm({ ...editForm, newPassword: ev.target.value })}
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="eye-toggle"
                      tabIndex={-1}
                      aria-label={showEditPw ? 'Hide password' : 'Show password'}
                      onClick={() => setShowEditPw((v) => !v)}
                    >
                      {showEditPw ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.3 20.3 0 0 1 5.06-5.94M9.9 4.24A10.9 10.9 0 0 1 12 4c7 0 11 8 11 8a20.4 20.4 0 0 1-3.22 4.36M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <div className="edit-modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit">Save changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
