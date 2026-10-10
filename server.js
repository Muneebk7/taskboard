require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false, saveUninitialized: false,
}));

const auth = (req, res, next) =>
  req.session.uid ? next() : res.status(401).json({ error: 'Please log in first' });
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e); res.status(500).json({ error: 'Server error' });
});

// health check: also proves the database is reachable
app.get('/health', wrap(async (req, res) => {
  const [[r]] = await db.q('SELECT COUNT(*) AS users FROM users');
  res.json({ status: 'ok', database: 'connected', users: r.users });
}));

// ---- Module 1: accounts ----
app.post('/api/register', wrap(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ error: 'Name, email and a password of 6+ characters are required' });
  const [dup] = await db.q('SELECT id FROM users WHERE email=?', [email]);
  if (dup.length) return res.status(409).json({ error: 'Email already registered' });
  const hash = await bcrypt.hash(password, 10);
  const [r] = await db.q('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)', [name, email, hash]);
  req.session.uid = r.insertId;
  res.status(201).json({ id: r.insertId, name, email });
}));
app.post('/api/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await db.q('SELECT * FROM users WHERE email=?', [email]);
  if (!rows.length || !(await bcrypt.compare(password || '', rows[0].password_hash)))
    return res.status(401).json({ error: 'Wrong email or password' });
  req.session.uid = rows[0].id;
  res.json({ id: rows[0].id, name: rows[0].name, email });
}));
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', auth, wrap(async (req, res) => {
  const [[u]] = await db.q('SELECT id,name,email FROM users WHERE id=?', [req.session.uid]);
  res.json(u);
}));

// ---- Module 2: projects ----
app.get('/api/projects', auth, wrap(async (req, res) => {
  const [rows] = await db.q(
    `SELECT p.*, COUNT(t.id) AS task_count FROM projects p
     LEFT JOIN tasks t ON t.project_id=p.id WHERE p.user_id=? GROUP BY p.id ORDER BY p.id DESC`,
    [req.session.uid]);
  res.json(rows);
}));
app.post('/api/projects', auth, wrap(async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  const [r] = await db.q('INSERT INTO projects (user_id,name,description) VALUES (?,?,?)',
    [req.session.uid, name, description || null]);
  res.status(201).json({ id: r.insertId, name, description });
}));
app.delete('/api/projects/:id', auth, wrap(async (req, res) => {
  const [r] = await db.q('DELETE FROM projects WHERE id=? AND user_id=?', [req.params.id, req.session.uid]);
  r.affectedRows ? res.json({ ok: true }) : res.status(404).json({ error: 'Project not found' });
}));

// ---- Module 3: tasks ----
app.get('/api/tasks', auth, wrap(async (req, res) => {
  const args = [req.session.uid];
  let sql = 'SELECT * FROM tasks WHERE user_id=?';
  if (req.query.project_id) { sql += ' AND project_id=?'; args.push(req.query.project_id); }
  if (req.query.status) { sql += ' AND status=?'; args.push(req.query.status); }
  const [rows] = await db.q(sql + ' ORDER BY id DESC', args);
  res.json(rows);
}));
app.post('/api/tasks', auth, wrap(async (req, res) => {
  const { project_id, title, due_date } = req.body;
  if (!project_id || !title) return res.status(400).json({ error: 'Project and title are required' });
  const [p] = await db.q('SELECT id FROM projects WHERE id=? AND user_id=?', [project_id, req.session.uid]);
  if (!p.length) return res.status(404).json({ error: 'Project not found' });
  const [r] = await db.q('INSERT INTO tasks (project_id,user_id,title,due_date) VALUES (?,?,?,?)',
    [project_id, req.session.uid, title, due_date || null]);
  res.status(201).json({ id: r.insertId, project_id, title, status: 'todo' });
}));
app.put('/api/tasks/:id', auth, wrap(async (req, res) => {
  const { status, title } = req.body;
  if (status && !['todo', 'doing', 'done'].includes(status))
    return res.status(400).json({ error: 'Status must be todo, doing or done' });
  const [r] = await db.q(
    'UPDATE tasks SET status=COALESCE(?,status), title=COALESCE(?,title) WHERE id=? AND user_id=?',
    [status || null, title || null, req.params.id, req.session.uid]);
  r.affectedRows ? res.json({ ok: true }) : res.status(404).json({ error: 'Task not found' });
}));
app.delete('/api/tasks/:id', auth, wrap(async (req, res) => {
  const [r] = await db.q('DELETE FROM tasks WHERE id=? AND user_id=?', [req.params.id, req.session.uid]);
  r.affectedRows ? res.json({ ok: true }) : res.status(404).json({ error: 'Task not found' });
}));

const port = process.env.PORT || 3000;
db.init().then(() => {
  app.listen(port, '0.0.0.0', () => console.log('TaskBoard running on port ' + port));
}).catch(e => { console.error('Database setup failed:', e.message); process.exit(1); });
