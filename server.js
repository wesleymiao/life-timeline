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

// Data directory: use Azure persistent storage (/home) if available, else local
const DATA_BASE = fs.existsSync('/home') ? '/home' : __dirname;
const DATA_DIR = path.join(DATA_BASE, 'data');
const PHOTOS_DIR = path.join(DATA_BASE, 'photos');

// Static files
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/photos', express.static(PHOTOS_DIR));

// City extraction from photo addresses
const CITY_MAP = {
  '浦东新区': '上海', '上海市': '上海', '黄浦区': '上海', '徐汇区': '上海', '静安区': '上海',
  '长宁区': '上海', '普陀区': '上海', '虹口区': '上海', '杨浦区': '上海', '闵行区': '上海',
  '宝山区': '上海', '嘉定区': '上海', '松江区': '上海', '青浦区': '上海', '奉贤区': '上海', '金山区': '上海', '崇明区': '上海',
  '吴中区': '苏州', '相城区': '苏州', '苏州工业园区': '苏州', '姑苏区': '苏州', '虎丘区': '苏州', '吴江区': '苏州', '昆山': '苏州',
  '香港': '香港',
  '朝阳区': '北京', '海淀区': '北京', '东城区': '北京', '西城区': '北京', '丰台区': '北京', '北京市': '北京',
};

function extractCity(address) {
  if (!address) return null;
  const first = address.split(',')[0].trim();
  return CITY_MAP[first] || first;
}

function extractDayCities(data) {
  const cities = new Set();
  (data.photos || []).filter(p => !p.hidden).forEach(p => {
    const city = extractCity(p.metadata?.address);
    if (city) cities.add(city);
  });
  return [...cities];
}

// API endpoints
let _citiesCache = null;
let _citiesCacheTime = 0;

app.get('/api/cities', (req, res) => {
  const now = Date.now();
  if (_citiesCache && now - _citiesCacheTime < DAYS_CACHE_TTL) return res.json(_citiesCache);
  const daysDir = path.join(DATA_DIR, 'days');
  if (!fs.existsSync(daysDir)) return res.json([]);
  const cityCount = {};
  fs.readdirSync(daysDir).filter(f => f.endsWith('.json')).forEach(f => {
    const data = JSON.parse(fs.readFileSync(path.join(daysDir, f), 'utf-8'));
    (data.photos || []).filter(p => !p.hidden).forEach(p => {
      const city = extractCity(p.metadata?.address);
      if (city) cityCount[city] = (cityCount[city] || 0) + 1;
    });
  });
  const cities = Object.entries(cityCount).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  _citiesCache = cities;
  _citiesCacheTime = now;
  res.json(cities);
});

// Cache for /api/days — regenerated when day files change
let _daysCache = null;
let _daysCacheTime = 0;
const DAYS_CACHE_TTL = 60000; // 1 minute

function getDaysData() {
  const now = Date.now();
  if (_daysCache && now - _daysCacheTime < DAYS_CACHE_TTL) return _daysCache;
  const daysDir = path.join(DATA_DIR, 'days');
  if (!fs.existsSync(daysDir)) return [];
  const files = fs.readdirSync(daysDir).filter(f => f.endsWith('.json')).sort().reverse();
  const days = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(daysDir, f), 'utf-8'));
    return { date: data.date, photo_count: (data.photos || []).filter(p => !p.hidden).length, summary: data.summary, cities: extractDayCities(data) };
  });
  _daysCache = days;
  _daysCacheTime = now;
  return days;
}

app.get('/api/days', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const days = getDaysData();
  if (req.query.page) {
    const start = (page - 1) * limit;
    const slice = days.slice(start, start + limit);
    return res.json({ days: slice, total: days.length, page, limit, hasMore: start + limit < days.length });
  }
  // Legacy: return all days for backward compatibility
  res.json(days);
});

app.get('/api/day/:date', (req, res) => {
  const file = path.join(DATA_DIR, 'days', `${req.params.date}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf-8')));
});

app.get('/api/month/:month', (req, res) => {
  const daysDir = path.join(DATA_DIR, 'days');
  if (!fs.existsSync(daysDir)) return res.json({ month: req.params.month, days: [] });
  const files = fs.readdirSync(daysDir).filter(f => f.startsWith(req.params.month)).sort();
  const days = files.map(f => JSON.parse(fs.readFileSync(path.join(daysDir, f), 'utf-8')));
  res.json({ month: req.params.month, days });
});

app.get('/api/week/:date', (req, res) => {
  const startDate = new Date(req.params.date);
  const daysDir = path.join(DATA_DIR, 'days');
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
  const summariesDir = path.join(DATA_DIR, 'summaries');
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
const commentsFile = path.join(DATA_DIR, 'comments.json');

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

// Get all unprocessed comments across all dates
app.get('/api/comments-unprocessed', (req, res) => {
  const comments = loadComments();
  const result = {};
  for (const [date, clist] of Object.entries(comments)) {
    const unprocessed = clist.filter(c => !c.processed);
    if (unprocessed.length) result[date] = unprocessed;
  }
  res.json(result);
});

// Mark comments as processed
app.post('/api/comments-mark-processed', (req, res) => {
  const { ids } = req.body; // array of { date, id }
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  const comments = loadComments();
  for (const item of ids) {
    const { date, id } = item;
    const clist = comments[date];
    if (clist) {
      const c = clist.find(x => x.id === id);
      if (c) {
        c.processed = true;
        if (item.reply) c.reply = item.reply;
      }
    }
  }
  saveComments(comments);
  res.json({ ok: true, marked: ids.length });
});

// Hide/unhide a photo (triggers summary regeneration via comment system)
app.post('/api/day/:date/hide-photo', (req, res) => {
  const { date } = req.params;
  const { photoIndex, hidden } = req.body;
  if (photoIndex === undefined) return res.status(400).json({ error: 'photoIndex required' });
  const file = path.join(DATA_DIR, 'days', `${date}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'day not found' });
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!data.photos || photoIndex >= data.photos.length) return res.status(400).json({ error: 'invalid photoIndex' });
  const hide = hidden !== false;
  data.photos[photoIndex].hidden = hide;
  data.photo_count = data.photos.filter(p => !p.hidden).length;
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  _daysCache = null; _citiesCache = null; // Invalidate caches
  // Add a system comment to trigger summary regeneration
  const comments = loadComments();
  if (!comments[date]) comments[date] = [];
  const action = hide ? '隐藏' : '恢复';
  const desc = data.photos[photoIndex].analysis?.description || `照片${photoIndex + 1}`;
  comments[date].push({
    id: Date.now().toString(36),
    photoIndex: null,
    text: `[系统] 用户${action}了照片${photoIndex + 1}（${desc.slice(0, 30)}）`,
    created_at: new Date().toISOString(),
    processed: false,
    system: true
  });
  saveComments(comments);
  res.json({ ok: true, hidden: hide });
});

// Write/update day data (used by agent after processing)
app.put('/api/day/:date', (req, res) => {
  const { date } = req.params;
  const data = req.body;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'invalid data' });
  const daysDir = path.join(DATA_DIR, 'days');
  if (!fs.existsSync(daysDir)) fs.mkdirSync(daysDir, { recursive: true });
  fs.writeFileSync(path.join(daysDir, `${date}.json`), JSON.stringify(data, null, 2));
  _daysCache = null; _citiesCache = null; // Invalidate caches
  res.json({ ok: true });
});

// Write/update summary (week or month)
app.put('/api/summary/:type/:period', (req, res) => {
  const { type, period } = req.params;
  if (!['week', 'month'].includes(type)) return res.status(400).json({ error: 'type must be week or month' });
  const data = req.body;
  const summariesDir = path.join(DATA_DIR, 'summaries');
  if (!fs.existsSync(summariesDir)) fs.mkdirSync(summariesDir, { recursive: true });
  fs.writeFileSync(path.join(summariesDir, `${type}-${period}.json`), JSON.stringify(data, null, 2));
  res.json({ ok: true });
});

// Main SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Life Timeline running on port ${PORT}`));
