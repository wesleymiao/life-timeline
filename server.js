const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;
const PASSWORD = process.env.SITE_PASSWORD || 'wesley2026';
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.cookies?.auth_token;
  if (token) {
    try {
      const [hash, ts] = token.split('.');
      const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(PASSWORD + ts).digest('hex');
      if (hash === expected && Date.now() - parseInt(ts) < 30 * 24 * 3600 * 1000) {
        return next();
      }
    } catch {}
  }
  if (req.path === '/login' || req.path.startsWith('/api/login')) return next();
  if (req.path === '/favicon.ico') return res.status(204).end();
  return res.redirect('/login');
}

// Login page
app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wesley's Life Timeline - Login</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center}
.login-box{background:#fff;padding:3rem;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.2);max-width:400px;width:90%}
h1{font-size:1.5rem;margin-bottom:.5rem;color:#333}
p{color:#666;margin-bottom:2rem;font-size:.9rem}
input{width:100%;padding:12px 16px;border:2px solid #e0e0e0;border-radius:8px;font-size:1rem;outline:none;transition:border-color .2s}
input:focus{border-color:#667eea}
button{width:100%;padding:12px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;margin-top:1rem;transition:transform .1s}
button:hover{transform:scale(1.02)}
.error{color:#e74c3c;margin-top:.5rem;font-size:.9rem;display:none}
</style></head><body>
<div class="login-box">
<h1>🌟 Wesley's Life Timeline</h1>
<p>请输入密码访问</p>
<form id="f"><input type="password" name="password" placeholder="密码" autofocus>
<div class="error" id="err">密码错误</div>
<button type="submit">进入</button></form>
</div>
<script>
document.getElementById('f').onsubmit=async e=>{
  e.preventDefault();
  const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:e.target.password.value})});
  if(r.ok)location.href='/';
  else document.getElementById('err').style.display='block';
};
</script></body></html>`);
});

app.post('/api/login', (req, res) => {
  if (req.body.password === PASSWORD) {
    const ts = Date.now().toString();
    const hash = crypto.createHmac('sha256', TOKEN_SECRET).update(PASSWORD + ts).digest('hex');
    res.cookie('auth_token', `${hash}.${ts}`, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000, sameSite: 'lax' });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'wrong password' });
});

app.use(requireAuth);

// Static files
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/photos', express.static(path.join(__dirname, 'photos')));

// API endpoints
app.get('/api/days', (req, res) => {
  const daysDir = path.join(__dirname, 'data', 'days');
  if (!fs.existsSync(daysDir)) return res.json([]);
  const files = fs.readdirSync(daysDir).filter(f => f.endsWith('.json')).sort().reverse();
  const days = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(daysDir, f), 'utf-8'));
    return { date: data.date, photo_count: data.photo_count, summary: data.summary };
  });
  res.json(days);
});

app.get('/api/day/:date', (req, res) => {
  const file = path.join(__dirname, 'data', 'days', `${req.params.date}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf-8')));
});

app.get('/api/month/:month', (req, res) => {
  const daysDir = path.join(__dirname, 'data', 'days');
  if (!fs.existsSync(daysDir)) return res.json({ month: req.params.month, days: [] });
  const files = fs.readdirSync(daysDir).filter(f => f.startsWith(req.params.month)).sort();
  const days = files.map(f => JSON.parse(fs.readFileSync(path.join(daysDir, f), 'utf-8')));
  res.json({ month: req.params.month, days });
});

app.get('/api/week/:date', (req, res) => {
  const startDate = new Date(req.params.date);
  const daysDir = path.join(__dirname, 'data', 'days');
  if (!fs.existsSync(daysDir)) return res.json({ week_start: req.params.date, days: [] });
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const ds = d.toISOString().split('T')[0];
    const file = path.join(daysDir, `${ds}.json`);
    if (fs.existsSync(file)) days.push(JSON.parse(fs.readFileSync(file, 'utf-8')));
  }
  res.json({ week_start: req.params.date, days });
});

app.get('/api/summaries', (req, res) => {
  const summariesDir = path.join(__dirname, 'data', 'summaries');
  if (!fs.existsSync(summariesDir)) return res.json({ weeks: [], months: [] });
  const files = fs.readdirSync(summariesDir).filter(f => f.endsWith('.json'));
  const weeks = [], months = [];
  files.forEach(f => {
    const d = JSON.parse(fs.readFileSync(path.join(summariesDir, f), 'utf-8'));
    if (d.type === 'week') weeks.push(d);
    else if (d.type === 'month') months.push(d);
  });
  res.json({ weeks: weeks.sort((a,b) => b.period.localeCompare(a.period)), months: months.sort((a,b) => b.period.localeCompare(a.period)) });
});

// Comments API
const commentsFile = path.join(__dirname, 'data', 'comments.json');

function loadComments() {
  if (!fs.existsSync(commentsFile)) return {};
  return JSON.parse(fs.readFileSync(commentsFile, 'utf-8'));
}

function saveComments(comments) {
  fs.writeFileSync(commentsFile, JSON.stringify(comments, null, 2));
}

app.get('/api/comments/:date', (req, res) => {
  const comments = loadComments();
  res.json(comments[req.params.date] || []);
});

app.post('/api/comments/:date', (req, res) => {
  const { date } = req.params;
  const { photoIndex, text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });

  const comments = loadComments();
  if (!comments[date]) comments[date] = [];
  const comment = {
    id: Date.now().toString(36),
    photoIndex: photoIndex ?? null,
    text: text.trim(),
    created_at: new Date().toISOString(),
    processed: false
  };
  comments[date].push(comment);
  saveComments(comments);
  res.json(comment);
});

app.delete('/api/comments/:date/:id', (req, res) => {
  const { date, id } = req.params;
  const comments = loadComments();
  if (!comments[date]) return res.status(404).json({ error: 'not found' });
  comments[date] = comments[date].filter(c => c.id !== id);
  if (!comments[date].length) delete comments[date];
  saveComments(comments);
  res.json({ ok: true });
});

// Main SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Life Timeline running on port ${PORT}`));
