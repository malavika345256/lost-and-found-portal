const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();
const server = createServer(app);
const PORT = Number(process.env.PORT || 3000);
const MONGO_URI = process.env.MONGODB_URI || (process.env.NODE_ENV === 'production' ? '' : 'mongodb://127.0.0.1:27017/lost_found_portal');
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_SAME_SITE = ['strict','lax','none'].includes(String(process.env.COOKIE_SAME_SITE || 'lax').toLowerCase()) ? String(process.env.COOKIE_SAME_SITE || 'lax').toLowerCase() : 'lax';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true' || (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production') || COOKIE_SAME_SITE === 'none';
const COOKIE_OPTIONS = { httpOnly: true, sameSite: COOKIE_SAME_SITE, secure: COOKIE_SECURE, maxAge: 7 * 86400000 };
app.disable('x-powered-by');
// A 5 MB image expands to about 6.7 MB when carried as a base64 JSON value.
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use((req, res, next) => {
  const origin = process.env.FRONTEND_ORIGIN;
  if (origin && req.headers.origin === origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); }
  res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204); next();
});

const schema = (definition) => new mongoose.Schema(definition, { timestamps: true, strict: true });
const User = mongoose.model('User', schema({ name: { type: String, required: true, trim: true, maxlength: 100 }, email: { type: String, required: true, unique: true, lowercase: true, trim: true }, passwordHash: { type: String, required: true, select: false }, role: { type: String, enum: ['user', 'admin'], default: 'user' } }));
const io = new Server(server, { cors: process.env.FRONTEND_ORIGIN ? { origin: process.env.FRONTEND_ORIGIN, credentials: true } : undefined });
io.use(async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie || '';
    const token = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith('portalToken='))?.slice('portalToken='.length);
    if (!token || !JWT_SECRET) return next(new Error('Authentication required.'));
    const payload = jwt.verify(decodeURIComponent(token), JWT_SECRET);
    const user = await User.findById(payload.sub).select('_id role');
    if (!user || user.role !== 'user') return next(new Error('Student access required.'));
    socket.data.userId = String(user._id);
    next();
  } catch { next(new Error('Invalid or expired session.')); }
});
io.on('connection', socket => socket.join(`student:${socket.data.userId}`));
const Item = mongoose.model('Item', schema({ itemName: { type: String, required: true, trim: true, maxlength: 120 }, description: { type: String, required: true, trim: true, maxlength: 2000 }, category: { type: String, required: true, trim: true, maxlength: 80 }, location: { type: String, required: true, trim: true, maxlength: 160 }, date: { type: Date, required: true }, type: { type: String, enum: ['lost', 'found'], required: true }, status: { type: String, enum: ['pending', 'approved', 'resolved', 'rejected'], default: 'pending' }, recoveryStatus: { type: String, enum: ['open', 'claim_pending', 'returned'] }, reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, image: { type: String, default: '' }, privateVerification: { type: String, trim: true, maxlength: 1000 }, privateContact: { name: { type: String, trim: true, maxlength: 100 }, contact: { type: String, trim: true, maxlength: 160 } }, handover: { type: String, trim: true, maxlength: 500 }, claimantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], approvedClaim: { type: mongoose.Schema.Types.ObjectId, ref: 'Claim' }, returnedAt: Date }));
const Claim = mongoose.model('Claim', schema({ item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true }, lostReport: { type: mongoose.Schema.Types.ObjectId, ref: 'Item' }, claimant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, details: { type: String, required: true, trim: true, maxlength: 2000 }, proof: { type: String, trim: true, maxlength: 1000 }, proofRequest: { type: String, trim: true, maxlength: 500 }, status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }, decisionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, decidedAt: Date, decisionReason: { type: String, trim: true, maxlength: 500 } }));
const Conversation = mongoose.model('Conversation', schema({ item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true }, participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }], lastMessageAt: Date }));
const Message = mongoose.model('Message', schema({ conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true }, sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, body: { type: String, required: true, trim: true, maxlength: 4000 }, readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }] }));
const Notification = mongoose.model('Notification', schema({ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, type: { type: String, required: true }, text: { type: String, required: true, maxlength: 300 }, link: String, reports: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Item' }], dedupeKey: String, readAt: Date }));
Notification.schema.index({ user: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
const PotentialMatch = mongoose.model('PotentialMatch', schema({ lostReport: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true }, foundReport: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true }, score: { type: Number, required: true }, dedupeKey: { type: String, required: true, unique: true } }));
const ContactMessage = mongoose.model('ContactMessage', schema({ name: { type: String, required: true, trim: true, maxlength: 100 }, email: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 }, subject: { type: String, required: true, trim: true, maxlength: 120 }, message: { type: String, required: true, trim: true, maxlength: 3000 } }));

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const safeUser = (u) => ({ id: u._id, name: u.name, email: u.email, role: u.role });
function tokenFrom(req) { return req.cookies.portalToken || (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); }
const auth = asyncRoute(async (req, res, next) => {
  if (!JWT_SECRET) return res.status(503).json({ message: 'Authentication is not configured. Set JWT_SECRET.' });
  const token = tokenFrom(req); if (!token) return res.status(401).json({ message: 'Authentication required.' });
  try { const payload = jwt.verify(token, JWT_SECRET); const user = await User.findById(payload.sub); if (!user) return res.status(401).json({ message: 'Account not found.' }); req.user = user; next(); }
  catch { return res.status(401).json({ message: 'Invalid or expired session.' }); }
});
const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ message: 'Administrator access required.' });
const studentOnly = (req, res, next) => req.user.role === 'user' ? next() : res.status(403).json({ message: 'Student access required.' });
const STUDENT_EMAIL_DOMAIN = 'ced.alliance.edu.in';
const ITEM_CATEGORIES = new Set(['College ID Card','Laptop','Mobile Phone','Tablet','Charger and Electronics Accessories','Headphones and Earbuds','Wallet and Purse','Keys','Backpack and Handbag','Books and Notebooks','Documents and Certificates','Exam Hall Ticket','University Access Card','Student Bus Pass','Water Bottle','Lunch Box','Watch','Jewellery','Clothing','Spectacles','Calculator','USB Drive and Storage Devices','Sports Equipment','Other','Electronics','Documents','Wallet','Bag','Bags','Accessories','Books']);
const ID_CARD_CATEGORIES = new Set(['College ID Card','University Access Card']);
const CATEGORY_ALIASES = {
  'Wallet and Purse':['Wallet'], 'Backpack and Handbag':['Bag','Bags'], 'Books and Notebooks':['Books'],
  'Documents and Certificates':['Documents']
};
const isIdentityCardItem = item => ID_CARD_CATEGORIES.has(item.category) || /\b(?:college|student|university)\s+(?:id|identity|access)(?:\s+card)?\b|\b(?:id|identity|access)\s+card\b/i.test(item.itemName || '');
function publicItem(item) {
  const result = item.toObject ? item.toObject() : { ...item };
  delete result.privateContact; delete result.handover; delete result.privateVerification;
  delete result.claimantIds; delete result.approvedClaim; delete result.returnedAt;
  if (isIdentityCardItem(result)) {
    result.itemName = result.category;
    result.description = 'An identification card was reported. Submit private ownership details through the claim process for administrator review.';
    result.image = '';
    delete result.reporter;
  }
  return result;
}
const itemWithoutPrivateVerification = item => { const result = item.toObject ? item.toObject() : { ...item }; delete result.privateVerification; delete result.claimantIds; delete result.approvedClaim; return result; };
const validEmail = (email) => typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
const validStudentEmail = (email) => validEmail(email) && email.trim().toLowerCase().endsWith(`@${STUDENT_EMAIL_DOMAIN}`);
const issueLogin = (res, user) => { const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d' }); res.cookie('portalToken', token, COOKIE_OPTIONS); res.json({ message: 'Login successful.', user: safeUser(user) }); };
const requireStudentPage = asyncRoute(async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  if (!JWT_SECRET) return res.redirect('/login.html');
  const token = tokenFrom(req);
  if (!token) return res.redirect('/login.html');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) return res.redirect('/login.html');
    if (user.role !== 'user') return res.redirect('/admin.html');
    req.user = user;
    next();
  } catch {
    res.clearCookie('portalToken', { httpOnly: true, sameSite: COOKIE_SAME_SITE, secure: COOKIE_SECURE });
    return res.redirect('/login.html');
  }
});
const serveStudentPage = (req, res) => res.sendFile(path.join(__dirname, req.path.slice(1)));
const requireAdminPageOrShowLogin = asyncRoute(async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  const token = tokenFrom(req);
  if (!token || !JWT_SECRET) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) return next();
    if (user.role !== 'admin') return res.redirect('/index.html');
    req.user = user;
    next();
  } catch {
    res.clearCookie('portalToken', { httpOnly: true, sameSite: COOKIE_SAME_SITE, secure: COOKIE_SECURE });
    next();
  }
});
const validId = (id) => mongoose.isValidObjectId(id);
const rx = (value) => new RegExp(String(value).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
function safeImageData(data) {
  if (!data) return true;
  if (typeof data !== 'string' || data.length > 7 * 1024 * 1024) return false;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(data);
  if (!match) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024 || bytes.toString('base64') !== match[2]) return false;
  if (match[1] === 'png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (match[1] === 'jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (match[1] === 'gif') return bytes.subarray(0, 4).toString() === 'GIF8';
  return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
}
const notify = async (user, type, text, link = '') => {
  const notification = await Notification.create({ user, type, text, link });
  io.to(`student:${user}`).emit('notification', notification.toObject());
  return notification;
};
const matchWords = value => String(value || '').toLowerCase().replace(/\b(id|card|item|thing|the|and|with|for|from|near|found|lost)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(word => word.length > 1);
function textSimilarity(a, b) {
  const left = new Set(matchWords(a)), right = new Set(matchWords(b));
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter(word => right.has(word)).length;
  return (2 * shared) / (left.size + right.size);
}
function categoryMatches(a, b) {
  const left = String(a || '').toLowerCase(), right = String(b || '').toLowerCase();
  if (left === right) return true;
  return (CATEGORY_ALIASES[left] || []).some(alias => alias.toLowerCase() === right) || (CATEGORY_ALIASES[right] || []).some(alias => alias.toLowerCase() === left);
}
function matchScore(incoming, candidate) {
  const specificWords = (value, category) => {
    const categoryWords = new Set(matchWords(category));
    return matchWords(value).filter(word => !categoryWords.has(word)).join(' ');
  };
  const name = textSimilarity(specificWords(incoming.itemName, incoming.category), specificWords(candidate.itemName, candidate.category));
  const details = textSimilarity(specificWords(incoming.description, incoming.category), specificWords(candidate.description, candidate.category));
  const category = categoryMatches(incoming.category, candidate.category) ? 1 : textSimilarity(incoming.category, candidate.category);
  const location = textSimilarity(incoming.location, candidate.location);
  const days = Math.abs(new Date(incoming.date) - new Date(candidate.date)) / 86400000;
  if (days > 60 || (!category && name < 0.45) || (name < 0.2 && details < 0.28)) return 0;
  return category * 0.32 + name * 0.4 + details * 0.16 + location * 0.07 + Math.max(0, 1 - days / 60) * 0.05;
}
async function findAndNotifyMatches(item) {
  const candidates = await Item.find({ type: item.type === 'lost' ? 'found' : 'lost', status: { $ne: 'rejected' }, recoveryStatus: { $ne: 'returned' }, _id: { $ne: item._id } });
  for (const candidate of candidates) {
    if (matchScore(item, candidate) < 0.43) continue;
    const lost = item.type === 'lost' ? item : candidate;
    const found = item.type === 'found' ? item : candidate;
    const pair = [String(lost._id), String(found._id)].sort().join(':');
    const score = matchScore(item, candidate);
    try { await PotentialMatch.updateOne({ dedupeKey: `match:${pair}` }, { $setOnInsert: { lostReport: lost._id, foundReport: found._id, score, dedupeKey: `match:${pair}` } }, { upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; }
    const makeMatchNotification = async (user, other, owned) => {
      let created = false;
      try {
        const result = await Notification.updateOne(
          { user, dedupeKey: `match:${pair}` },
          { $setOnInsert: { user, type: 'possible_match', text: `Possible Match Found! A ${other.type} item may match your ${owned.type} item: ${other.itemName}. Review the report and contact the student who reported it.`, link: `search.html?item=${other._id}`, reports: [lost._id, found._id], dedupeKey: `match:${pair}` } },
          { upsert: true }
        );
        created = result.upsertedCount === 1;
      } catch (error) { if (error.code !== 11000) throw error; }
      if (created) {
        const notification = await Notification.findOne({ user, dedupeKey: `match:${pair}` }).lean();
        if (notification) io.to(`student:${user}`).emit('notification', notification);
      }
    };
    if (String(lost.reporter) === String(found.reporter)) await makeMatchNotification(lost.reporter, found, lost);
    else await Promise.all([makeMatchNotification(lost.reporter, found, lost), makeMatchNotification(found.reporter, lost, found)]);
  }
}
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

app.use((req,res,next)=>{if(/^\/(?:node_modules|\.git|scripts|postman)(?:\/|$)/i.test(req.path)||/^\/(?:\.env|server\.js|package(?:-lock)?\.json)$/i.test(req.path))return res.sendStatus(404);next();});
app.get('/', (req, res) => res.redirect(302, '/login.html'));
app.get(['/index.html', '/dashboard.html', '/lost.html', '/found.html', '/search.html', '/history.html', '/contact.html', '/map.html', '/matches.html'], requireStudentPage, serveStudentPage);
app.get('/admin.html', requireAdminPageOrShowLogin, (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.use(express.static(__dirname, { index: false, setHeaders: (res, filePath) => { if (/\.(?:html)$/i.test(filePath) || /[\\/]campus-map\.js$/i.test(filePath)) res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate'); } }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));
app.post('/api/contact', auth, studentOnly, authLimit, asyncRoute(async (req,res)=>{const {name,email,subject,message}=req.body||{};if(![name,email,subject,message].every(v=>typeof v==='string'&&v.trim()))return res.status(400).json({message:'Name, email, subject, and message are required.'});if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({message:'Enter a valid email.'});await ContactMessage.create({name,email,subject,message});res.status(201).json({message:'Your message was submitted.'});}));

app.post('/api/auth/register', authLimit, asyncRoute(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (![name, email, password].every(v => typeof v === 'string' && v.trim())) return res.status(400).json({ message: 'Name, email, and password are required.' });
  if (!validEmail(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  if (!validStudentEmail(email)) return res.status(400).json({ message: 'Use your official Alliance University student email ending in @ced.alliance.edu.in.' });
  if (password.length < 8 || name.trim().length > 100) return res.status(400).json({ message: 'Name must be at most 100 characters and password must be at least 8 characters.' });
  const normalized = email.trim().toLowerCase(); if (await User.exists({ email: normalized })) return res.status(409).json({ message: 'An account with this email already exists.' });
  const user = await User.create({ name: name.trim(), email: normalized, passwordHash: await bcrypt.hash(password, 12) });
  return res.status(201).json({ message: 'Registration successful.', user: safeUser(user) });
}));
app.post('/api/auth/login', authLimit, asyncRoute(async (req, res) => {
  const { email, password } = req.body || {}; if (!email || typeof password !== 'string' || !password) return res.status(400).json({ message: 'Email and password are required.' });
  if (!validEmail(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  if (!validStudentEmail(email)) return res.status(400).json({ message: 'Use your official Alliance University student email ending in @ced.alliance.edu.in.' });
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
  if (!user || user.role !== 'user' || !await bcrypt.compare(password, user.passwordHash)) return res.status(401).json({ message: 'Invalid college email or password.' });
  issueLogin(res, user);
}));
app.post('/api/admin/auth/login', authLimit, asyncRoute(async (req,res)=>{const {email,password}=req.body||{};if(typeof password!=='string'||!password||!email)return res.status(400).json({message:'Admin email and password are required.'});if(!validEmail(email))return res.status(400).json({message:'Enter a valid email address.'});const user=await User.findOne({email:String(email).trim().toLowerCase()}).select('+passwordHash');if(!user||user.role!=='admin'||!await bcrypt.compare(password,user.passwordHash))return res.status(401).json({message:'Invalid admin email or password.'});issueLogin(res,user);}));
app.post('/api/auth/logout', (req, res) => { res.clearCookie('portalToken', { httpOnly: true, sameSite: COOKIE_SAME_SITE, secure: COOKIE_SECURE }); res.json({ message: 'Logged out.' }); });
app.get('/api/auth/me', auth, (req, res) => res.json({ user: safeUser(req.user) }));

app.get('/api/items', auth, studentOnly, asyncRoute(async (req, res) => {
  if (String(req.query.status || '').toLowerCase() === 'rejected') return res.json({ items: [] });
  const filter = { status: { $ne: 'rejected' } };
  for (const key of ['location', 'type', 'status', 'recoveryStatus']) if (req.query[key]) filter[key] = rx(req.query[key]);
  if (req.query.category) {
    const category = String(req.query.category).trim();
    filter.category = { $in: [category, ...(CATEGORY_ALIASES[category] || [])].map(rx) };
  }
  if (req.query.q) { const q = rx(req.query.q); filter.$or = [{ itemName: q }, { description: q }]; }
  if (req.query.dateFrom || req.query.dateTo) { filter.date = {}; if (req.query.dateFrom && !Number.isNaN(Date.parse(req.query.dateFrom))) filter.date.$gte = new Date(req.query.dateFrom); if (req.query.dateTo && !Number.isNaN(Date.parse(req.query.dateTo))) filter.date.$lte = new Date(req.query.dateTo); }
  const items = await Item.find(filter).select('-privateContact -handover -privateVerification').populate('reporter', 'name').sort({ createdAt: -1 }).limit(200); res.json({ items: items.map(publicItem) });
}));
app.get('/api/map/lost-items', auth, studentOnly, asyncRoute(async (req, res) => {
  const query = req.query || {};
  const parseDate = (value, key) => {
    if (value === undefined || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return res.status(400).json({ message: `${key} must use YYYY-MM-DD format.` });
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return res.status(400).json({ message: `${key} is not a valid date.` });
    return parsed;
  };
  const dateFrom = parseDate(query.dateFrom, 'dateFrom'); if (res.headersSent) return;
  const dateTo = parseDate(query.dateTo, 'dateTo'); if (res.headersSent) return;
  if (dateFrom && dateTo && dateFrom > dateTo) return res.status(400).json({ message: 'dateFrom must be on or before dateTo.' });
  // The map describes active reports only. A returned/recovered report is no
  // longer an active lost-item report, even if its review status is approved.
  const allowedStatuses = ['pending', 'approved'];
  const status = String(query.status || 'all').trim().toLowerCase();
  if (status !== 'all' && !allowedStatuses.includes(status)) return res.status(400).json({ message: 'Status must be pending, approved, or all.' });
  const category = String(query.category || 'all').trim();
  const activeReportFilter = { type: 'lost', status: { $in: allowedStatuses }, recoveryStatus: { $ne: 'returned' } };
  const existingCategories = await Item.distinct('category', { ...activeReportFilter, category: { $type: 'string' } });
  const categoryValues = [...new Set([...ITEM_CATEGORIES, ...existingCategories])];
  const matchedCategory = category.toLowerCase() === 'all' ? null : categoryValues.find(value => value.toLowerCase() === category.toLowerCase());
  if (category.toLowerCase() !== 'all' && !matchedCategory) return res.status(400).json({ message: 'Choose a valid item category.' });
  const match = { ...activeReportFilter };
  if (dateFrom || dateTo) {
    match.date = {};
    if (dateFrom) match.date.$gte = dateFrom;
    if (dateTo) { const until = new Date(dateTo); until.setUTCDate(until.getUTCDate() + 1); match.date.$lt = until; }
  }
  if (matchedCategory) {
    const aliases = CATEGORY_ALIASES[matchedCategory] || Object.entries(CATEGORY_ALIASES).filter(([, values]) => values.some(value => value.toLowerCase() === matchedCategory.toLowerCase())).map(([canonical]) => canonical);
    const categories = [matchedCategory, ...aliases];
    match.category = { $in: categories.map(value => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) };
  }
  // Status applies to the active report counts and rankings. Resolved reports
  // are summarized separately so the active lost-item total remains accurate.
  const resolvedMatch = { type: 'lost', status: 'resolved' };
  if (match.date) resolvedMatch.date = match.date;
  if (match.category) resolvedMatch.category = match.category;
  if (status !== 'all') match.status = status;
  const resolvedReportCount = await Item.countDocuments(resolvedMatch);
  const grouped = await Item.aggregate([{ $match: match }, { $group: { _id: { location: '$location', category: '$category' }, count: { $sum: 1 } } }]);
  const locationAliases = new Map(['Library','Central Library','Library Block','Cafeteria','Academic Block','Classroom','Computer Lab','Sports Ground','Parking Area','Hostel','University Bus','Administrative Office','Student Affairs Office','Alfresco'].map(name => [name.toLowerCase(), name]));
  const locations = new Map(); const categoryTotals = new Map(); let missingLocationReports = 0; let totalReports = 0;
  for (const row of grouped) {
    const count = row.count || 0; totalReports += count;
    const itemCategory = typeof row._id.category === 'string' && row._id.category.trim() ? row._id.category.trim() : 'Uncategorized';
    categoryTotals.set(itemCategory, (categoryTotals.get(itemCategory) || 0) + count);
    const raw = typeof row._id.location === 'string' ? row._id.location.trim().replace(/\s+/g, ' ') : '';
    if (!raw) { missingLocationReports += count; continue; }
    const key = raw.toLowerCase(); const name = locationAliases.get(key) || raw;
    if (!locations.has(key)) locations.set(key, { name, reportCount: 0, categoryCounts: new Map() });
    const entry = locations.get(key); entry.reportCount += count;
    entry.categoryCounts.set(itemCategory, (entry.categoryCounts.get(itemCategory) || 0) + count);
  }
  const summaries = [...locations.values()].map(entry => ({ name: entry.name, reportCount: entry.reportCount, categories: [...entry.categoryCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)), items: [] })).sort((a, b) => b.reportCount - a.reportCount || a.name.localeCompare(b.name));
  const namedReports = await Item.find({ ...match, location: { $type: 'string', $ne: '' } }).select('_id itemName category date status location').sort({ date: -1, createdAt: -1 }).lean();
  const summaryByLocation = new Map(summaries.map(location => [location.name.toLowerCase(), location]));
  for (const report of namedReports) {
    const key = report.location.trim().replace(/\s+/g, ' ').toLowerCase();
    const alias = locationAliases.get(key) || report.location.trim().replace(/\s+/g, ' ');
    const location = summaryByLocation.get(alias.toLowerCase());
    if (location) location.items.push({ id: String(report._id), itemName: publicItem(report).itemName, category: report.category, date: report.date, status: report.status });
  }
  const commonCategories = [...categoryTotals].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5);
  res.json({ summary: { totalReports, mostFrequentLocation: summaries[0]?.name || '', mostFrequentCount: summaries[0]?.reportCount || 0, locationCount: summaries.length, missingLocationReports, resolvedReportCount, commonCategories }, locations: summaries, categoryOptions: [...new Set(categoryValues)].sort((a, b) => a.localeCompare(b)) });
}));
app.get('/api/matches', auth, studentOnly, asyncRoute(async (req, res) => {
  const reportIds = await Item.find({ reporter: req.user.id }).distinct('_id');
  if (!reportIds.length) return res.json({ matches: [] });
  const fields = 'itemName description category location date type status recoveryStatus reporter';
  const records = await PotentialMatch.find({ $or: [{ lostReport: { $in: reportIds } }, { foundReport: { $in: reportIds } }] })
    .populate('lostReport', fields).populate('foundReport', fields).sort({ createdAt: -1 }).lean();
  const matches = records.filter(match => match.lostReport && match.foundReport).map(match => {
    const statusOf = item => item.recoveryStatus === 'returned' || item.status === 'resolved' ? 'Resolved' : item.status === 'rejected' ? 'Unavailable' : '';
    const statuses = [statusOf(match.lostReport), statusOf(match.foundReport)];
    const status = statuses.includes('Resolved') ? 'Resolved' : statuses.includes('Unavailable') ? 'Unavailable' : 'Possible match';
    const lostItem = publicItem(match.lostReport), foundItem = publicItem(match.foundReport);
    delete lostItem.reporter; delete foundItem.reporter;
    const contactItemId = String(match.lostReport.reporter) === req.user.id ? match.foundReport._id : String(match.foundReport.reporter) === req.user.id ? match.lostReport._id : null;
    return { _id: match._id, score: match.score, createdAt: match.createdAt, status, lostItem, foundItem, contactItemId };
  });
  res.json({ matches });
}));
app.get('/api/items/:id', auth, studentOnly, asyncRoute(async (req, res) => { if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid item ID.' }); const item = await Item.findOne({ _id: req.params.id, status: { $ne: 'rejected' } }).select('-privateContact -handover -privateVerification').populate('reporter', 'name'); if (!item) return res.status(404).json({ message: 'Item not found.' }); res.json({ item: publicItem(item) }); }));
const createReport = async (req, res, forcedType) => {
  const b = req.body || {}; const type = forcedType || String(b.type || '').toLowerCase();
  if (!['lost', 'found'].includes(type) || !['itemName','description','category','location','date'].every(k => typeof b[k] === 'string' && b[k].trim())) return res.status(400).json({ message: 'Type, item name, description, category, location, and date are required.' });
  const category = b.category.trim();
  if (!ITEM_CATEGORIES.has(category)) return res.status(400).json({ message: 'Select a supported item category.' });
  if (Number.isNaN(Date.parse(b.date))) return res.status(400).json({ message: 'Date must be a valid date.' });
  if (b.privateVerification !== undefined && (typeof b.privateVerification !== 'string' || b.privateVerification.length > 1000)) return res.status(400).json({ message: 'Private verification details must be at most 1000 characters.' });
  const cardReport = isIdentityCardItem({ category, itemName: b.itemName.trim() });
  if (cardReport && b.image) return res.status(400).json({ message: 'For card privacy, do not upload an ID or access card image. Use the private verification field and administrator-reviewed claims.' });
  if (!safeImageData(b.image)) return res.status(400).json({ message: 'Image must be a valid JPG, JPEG, PNG, or WEBP file no larger than 5 MB.' });
  const item = await Item.create({ itemName: b.itemName.trim(), description: b.description.trim(), category, location: b.location.trim(), date: new Date(b.date), type, status: 'pending', recoveryStatus: 'open', reporter: req.user.id, image: b.image || '', privateVerification: cardReport ? (b.privateVerification || '').trim() : '', privateContact: { name: b.contactName || req.user.name, contact: b.contact || '' }, handover: b.handover || '' });
  await findAndNotifyMatches(item);
  res.status(201).json({ message: 'Report submitted.', item: itemWithoutPrivateVerification(item) });
};
app.post('/api/items', auth, studentOnly, asyncRoute((req,res) => createReport(req,res)));
app.post('/api/reports/lost', auth, studentOnly, asyncRoute((req,res) => createReport(req,res,'lost')));
app.post('/api/reports/found', auth, studentOnly, asyncRoute((req,res) => createReport(req,res,'found')));
app.patch('/api/items/:id', auth, asyncRoute(async (req, res) => { if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid item ID.' }); const item = await Item.findById(req.params.id); if (!item) return res.status(404).json({ message: 'Item not found.' }); if (req.user.role !== 'admin' && String(item.reporter) !== req.user.id) return res.status(403).json({ message: 'You can only update your own reports.' }); const body=req.body||{}; if(body.category!==undefined&&!ITEM_CATEGORIES.has(String(body.category).trim()))return res.status(400).json({message:'Select a supported item category.'}); if(body.type!==undefined&&!['lost','found'].includes(body.type))return res.status(400).json({message:'Type must be lost or found.'}); if(body.status!==undefined&&!['pending','approved','resolved','rejected'].includes(body.status))return res.status(400).json({message:'Invalid report review status.'}); const allowed = req.user.role === 'admin' ? ['itemName','description','category','location','date','type','status'] : ['itemName','description','category','location','date']; for (const k of allowed) if (body[k] !== undefined) item[k] = body[k]; await item.save(); if (['itemName','description','category','location','date','type'].some(k => body[k] !== undefined)) await findAndNotifyMatches(item); res.json({ item: req.user.role === 'admin' ? item : itemWithoutPrivateVerification(item) }); }));
app.delete('/api/items/:id', auth, asyncRoute(async (req, res) => { if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid item ID.' }); const item = await Item.findById(req.params.id); if (!item) return res.status(404).json({ message: 'Item not found.' }); if (req.user.role !== 'admin' && String(item.reporter) !== req.user.id) return res.status(403).json({ message: 'You can only delete your own reports.' }); const convIds=await Conversation.find({item:item.id}).distinct('_id'); await Promise.all([Claim.deleteMany({item:item.id}),Message.deleteMany({conversation:{$in:convIds}}),Conversation.deleteMany({item:item.id})]); await item.deleteOne(); res.json({ message: 'Report deleted.' }); }));

app.post('/api/claims', auth, studentOnly, asyncRoute(async (req, res) => {
  const { itemId, proof } = req.body || {};
  const details = req.body?.reason ?? req.body?.details;
  if (!validId(itemId)) return res.status(400).json({ message: 'A valid itemId is required.' });
  if (typeof details !== 'string' || details.trim().length < 10 || details.length > 2000) return res.status(400).json({ message: 'Provide 10 to 2000 characters explaining why you can identify the item.' });
  if (proof !== undefined && (typeof proof !== 'string' || proof.length > 1000)) return res.status(400).json({ message: 'Proof must be at most 1000 characters.' });
  const item = await Item.findById(itemId);
  if (!item || item.type !== 'found' || ['resolved','rejected'].includes(item.status) || item.recoveryStatus === 'returned') return res.status(404).json({ message: 'Claimable found item not found.' });
  if (String(item.reporter) === req.user.id) return res.status(400).json({ message: 'You cannot claim your own report.' });
  if (await Claim.exists({ item: itemId, claimant: req.user.id })) return res.status(409).json({ message: 'You have already submitted a claim for this report.' });

  // $addToSet is the per-item atomic duplicate guard, including simultaneous submissions.
  const reserved = await Item.findOneAndUpdate(
    { _id: itemId, type: 'found', recoveryStatus: { $ne: 'returned' }, claimantIds: { $ne: req.user._id } },
    { $addToSet: { claimantIds: req.user._id }, $set: { recoveryStatus: 'claim_pending' } },
    { new: true, projection: { _id: 1 } }
  );
  if (!reserved) return res.status(409).json({ message: 'You have already submitted a claim for this report, or the item has already been returned.' });

  try {
    const ownLost = await Item.find({ reporter: req.user.id, type: 'lost', status: { $ne: 'rejected' }, recoveryStatus: { $ne: 'returned' } });
    const bestLost = ownLost.map(report => ({ report, score: matchScore(item, report) })).sort((a,b) => b.score-a.score)[0];
    const claim = await Claim.create({ item: itemId, lostReport: bestLost && bestLost.score >= 0.43 ? bestLost.report._id : undefined, claimant: req.user.id, details: details.trim(), proof, status: 'pending' });
    await Promise.allSettled([notify(item.reporter, 'claim', `A student submitted a claim for ${item.itemName}.`, 'admin.html')]);
    res.status(201).json({ message: 'Claim submitted for administrator verification.', claim: { id: claim.id, item: claim.item, status: claim.status, createdAt: claim.createdAt } });
  } catch (error) {
    await Item.updateOne({ _id: itemId, approvedClaim: { $exists: false } }, { $pull: { claimantIds: req.user._id } });
    if (!(await Claim.exists({ item: itemId, status: 'pending' }))) await Item.updateOne({ _id: itemId, recoveryStatus: 'claim_pending' }, { $set: { recoveryStatus: 'open' } });
    throw error;
  }
}));
app.get('/api/claims/my', auth, studentOnly, asyncRoute(async (req,res) => res.json({ claims: await Claim.find({ claimant: req.user.id }).populate('item','itemName category location date type status recoveryStatus').sort({createdAt:-1}) })));
app.patch('/api/claims/:id/proof', auth, studentOnly, asyncRoute(async(req,res)=>{if(!validId(req.params.id))return res.status(400).json({message:'Invalid claim ID.'});const proof=String((req.body||{}).proof||'').trim();if(!proof||proof.length>1000)return res.status(400).json({message:'Proof is required and must be at most 1000 characters.'});const claim=await Claim.findOne({_id:req.params.id,claimant:req.user.id,status:'pending'}).populate('item','itemName reporter');if(!claim)return res.status(404).json({message:'Pending claim not found.'});claim.proof=proof;claim.proofRequest='';await claim.save();await notify(claim.item.reporter,'claim_proof',`A claimant provided additional proof for ${claim.item.itemName}.`,'admin.html');res.json({message:'Additional proof submitted.',claim:{id:claim.id,status:claim.status}});}));
app.get('/api/claims/item/:itemId', auth, adminOnly, asyncRoute(async (req,res) => { if (!validId(req.params.itemId)) return res.status(400).json({message:'Invalid item ID.'}); const item=await Item.findById(req.params.itemId).select('itemName category location date type recoveryStatus'); if (!item) return res.status(404).json({message:'Item not found.'}); res.json({item,claims:await Claim.find({item:item.id}).populate('claimant','name email').populate('decisionBy','name email').sort({createdAt:1})}); }));
app.patch('/api/claims/:id/status', auth, adminOnly, asyncRoute(async (req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid claim ID.' });
  const status = req.body?.status;
  const reasonInput = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ message: 'Status must be approved or rejected.' });
  if (reasonInput.length > 500) return res.status(400).json({ message: 'Decision reason must be at most 500 characters.' });
  const claim = await Claim.findById(req.params.id).populate('item','itemName type recoveryStatus').populate('lostReport','_id reporter recoveryStatus');
  if (!claim || !claim.item) return res.status(404).json({ message: 'Claim not found.' });
  if (claim.status !== 'pending') return res.status(409).json({ message: 'This claim has already received a decision.' });
  if (String(claim.claimant?._id || claim.claimant) === req.user.id) return res.status(403).json({ message: 'Administrators cannot decide their own claims.' });
  if (claim.item.type !== 'found') return res.status(400).json({ message: 'Only claims for found items can be decided.' });
  const decidedAt = new Date();

  if (status === 'rejected') {
    const decisionReason = reasonInput || 'Rejected after administrator review.';
    const rejected = await Claim.findOneAndUpdate(
      { _id: claim._id, status: 'pending' },
      { $set: { status: 'rejected', decisionBy: req.user._id, decidedAt, decisionReason } },
      { new: true }
    );
    if (!rejected) return res.status(409).json({ message: 'This claim has already received a decision.' });
    if (!(await Claim.exists({ item: claim.item._id, status: 'pending' }))) await Item.updateOne({ _id: claim.item._id, recoveryStatus: 'claim_pending' }, { $set: { recoveryStatus: 'open' } });
    await notify(rejected.claimant, 'claim_decision', 'Your claim for ' + claim.item.itemName + ' was rejected. Reason: ' + decisionReason, 'history.html');
    return res.json({ message: 'Claim rejected.', claim: rejected });
  }

  const decisionReason = reasonInput || 'Approved after administrator verification.';
  if (claim.item.recoveryStatus === 'returned' || await Claim.exists({ item: claim.item._id, status: 'approved', _id: { $ne: claim._id } })) return res.status(409).json({ message: 'Another claim has already been approved or this item has already been returned.' });
  const priorRecoveryStatus = claim.item.recoveryStatus;
  // This single-document compare-and-set serializes approval attempts for this item.
  const itemWon = await Item.findOneAndUpdate(
    { _id: claim.item._id, type: 'found', recoveryStatus: { $ne: 'returned' }, approvedClaim: { $in: [null] } },
    { $set: { recoveryStatus: 'returned', approvedClaim: claim._id, returnedAt: decidedAt } },
    { new: true, projection: { _id: 1 } }
  );
  if (!itemWon) return res.status(409).json({ message: 'Another claim has already been approved or this item has already been returned.' });

  const approved = await Claim.findOneAndUpdate(
    { _id: claim._id, status: 'pending' },
    { $set: { status: 'approved', decisionBy: req.user._id, decidedAt, decisionReason } },
    { new: true }
  );
  if (!approved) {
    const rollback = { $unset: { approvedClaim: 1, returnedAt: 1 } };
    rollback.$set = { recoveryStatus: (await Claim.exists({ item: claim.item._id, status: 'pending' })) ? (priorRecoveryStatus || 'open') : 'open' };
    await Item.updateOne({ _id: claim.item._id, approvedClaim: claim._id }, rollback);
    return res.status(409).json({ message: 'This claim received another decision before approval could finish.' });
  }

  if (claim.lostReport && String(claim.lostReport.reporter) === String(claim.claimant._id || claim.claimant)) await Item.updateOne({ _id: claim.lostReport._id, reporter: claim.claimant._id || claim.claimant }, { $set: { recoveryStatus: 'returned' } });
  const competing = await Claim.find({ item: claim.item._id, _id: { $ne: claim._id }, status: 'pending' });
  const losingReason = 'Another claimant was approved for this item after administrator verification.';
  await Claim.updateMany(
    { item: claim.item._id, _id: { $ne: claim._id }, status: 'pending' },
    { $set: { status: 'rejected', decisionBy: req.user._id, decidedAt, decisionReason: losingReason } }
  );
  await Promise.allSettled([
    notify(approved.claimant, 'claim_decision', 'Your claim for ' + claim.item.itemName + ' was approved. The item is marked returned.', 'history.html'),
    ...competing.map(other => notify(other.claimant, 'claim_decision', 'Your claim for ' + claim.item.itemName + ' was rejected because another claimant was approved.', 'history.html'))
  ]);
  res.json({ message: 'Claim approved and item marked returned. Remaining pending claims were rejected.', claim: approved });
}));
app.patch('/api/claims/:id/request-proof',auth,adminOnly,asyncRoute(async(req,res)=>{if(!validId(req.params.id))return res.status(400).json({message:'Invalid claim ID.'});const request=String((req.body||{}).request||'').trim();if(request.length<5||request.length>500)return res.status(400).json({message:'Proof request must be between 5 and 500 characters.'});const claim=await Claim.findById(req.params.id).populate('item','itemName');if(!claim||claim.status!=='pending')return res.status(404).json({message:'Pending claim not found.'});claim.proofRequest=request;await claim.save();await notify(claim.claimant,'proof_request',`An administrator requested more proof for ${claim.item.itemName}: ${request}`,'history.html');res.json({message:'Additional proof requested.',claim});}));

app.post('/api/conversations', auth, studentOnly, asyncRoute(async (req,res) => { const {itemId}=req.body||{}; if(!validId(itemId)) return res.status(400).json({message:'Valid itemId required.'}); const item=await Item.findById(itemId); if(!item) return res.status(404).json({message:'Item not found.'}); if(String(item.reporter)===req.user.id) return res.status(400).json({message:'Conversation is for interested users; the report owner cannot start it with themselves.'}); let conv=await Conversation.findOne({item:itemId,participants:{$all:[req.user.id,item.reporter]},$expr:{$eq:[{$size:'$participants'},2]}}); if(!conv) conv=await Conversation.create({item:itemId,participants:[req.user.id,item.reporter]}); res.status(201).json({conversation:conv}); }));
app.get('/api/conversations', auth, studentOnly, asyncRoute(async(req,res)=>{const conversations=await Conversation.find({participants:req.user.id}).populate('item','itemName type').populate('participants','name').sort({lastMessageAt:-1,updatedAt:-1});const counts=await Message.aggregate([{$match:{conversation:{$in:conversations.map(c=>c._id)},sender:{$ne:req.user._id},readBy:{$ne:req.user._id}}},{$group:{_id:'$conversation',count:{$sum:1}}}]);const unread=new Map(counts.map(c=>[String(c._id),c.count]));res.json({conversations:conversations.map(c=>({...c.toObject(),unreadCount:unread.get(String(c._id))||0}))});}));
app.get('/api/conversations/:id/messages', auth, studentOnly, asyncRoute(async(req,res)=>{if(!validId(req.params.id))return res.status(400).json({message:'Invalid conversation ID.'}); const c=await Conversation.findById(req.params.id);if(!c)return res.status(404).json({message:'Conversation not found.'});if(!c.participants.some(p=>String(p)===req.user.id))return res.status(403).json({message:'Not a conversation participant.'}); const messages=await Message.find({conversation:c.id}).populate('sender','name').sort({createdAt:1}); await Message.updateMany({conversation:c.id,sender:{$ne:req.user.id},readBy:{$ne:req.user.id}},{$addToSet:{readBy:req.user.id}});res.json({messages});}));
app.post('/api/conversations/:id/messages', auth, studentOnly, asyncRoute(async(req,res)=>{if(!validId(req.params.id))return res.status(400).json({message:'Invalid conversation ID.'}); const c=await Conversation.findById(req.params.id);if(!c)return res.status(404).json({message:'Conversation not found.'});if(!c.participants.some(p=>String(p)===req.user.id))return res.status(403).json({message:'Not a conversation participant.'});const body=String((req.body||{}).body||'').trim();if(!body)return res.status(400).json({message:'Message body required.'});const message=await Message.create({conversation:c.id,sender:req.user.id,body,readBy:[req.user.id]});c.lastMessageAt=new Date();await c.save();for(const p of c.participants)if(String(p)!==req.user.id)await notify(p,'message','You have a new item conversation message.',`history.html?conversation=${c.id}`);res.status(201).json({message});}));

app.get('/api/notifications',auth,studentOnly,asyncRoute(async(req,res)=>{const [notifications,unreadCount]=await Promise.all([Notification.find({user:req.user.id}).populate('reports','itemName category location date type status recoveryStatus').sort({createdAt:-1}).limit(100),Notification.countDocuments({user:req.user.id,readAt:null})]);res.json({notifications,unreadCount});}));
app.patch('/api/notifications/:id/read',auth,studentOnly,asyncRoute(async(req,res)=>{if(!validId(req.params.id))return res.status(400).json({message:'Invalid notification ID.'});const n=await Notification.findOneAndUpdate({_id:req.params.id,user:req.user.id},{readAt:new Date()},{new:true});if(!n)return res.status(404).json({message:'Notification not found.'});res.json({notification:n});}));

app.post('/api/chatbot/message', auth, studentOnly, asyncRoute(async (req,res) => {
  const message = req.body?.message;
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({message:'Enter a message for the Lost & Found Assistant.'});
  if (message.length > 1000) return res.status(413).json({message:'Please keep chatbot messages under 1000 characters.'});
  const text = message.trim(); const lower = text.toLowerCase();
  let answer = 'I can help you report, search, or claim a campus item. Tell me what you need, or choose one of the suggestions.';
  let links = [{label:'Search Items',href:'search.html'},{label:'Report Lost',href:'lost.html'}]; let items = [];
  if (/report.*lost|lost.*report|lost an item/.test(lower)) { answer='Open Report Lost, add the item name, category, date and campus location, and describe identifying details. Reports are reviewed before appearing to other students.'; links=[{label:'Report Lost',href:'lost.html'}]; }
  else if (/report.*found|found.*report|found an item/.test(lower)) { answer='Open Report Found and enter the item details, where and when it was found, and where it is being kept. Do not publish sensitive identifying information.'; links=[{label:'Report Found',href:'found.html'}]; }
  else if (/college.*id|id card|university access card/.test(lower)) { const cardReports=await Item.find({status:{$ne:'rejected'},category:{$in:[rx('College ID Card'),rx('University Access Card')]}}).select('-privateContact -handover -privateVerification').sort({createdAt:-1}).limit(5);items=cardReports.map(item=>{const p=publicItem(item);return {_id:p._id,itemName:p.itemName,category:p.category,location:p.location,date:p.date,type:p.type,recoveryStatus:p.recoveryStatus};});answer=/lost|missing/.test(lower) ? 'For a lost College ID Card, submit a lost report with the date, campus location, and general card or holder details. Do not include the full ID number, barcode, or QR contents. Check notifications and contact Student Affairs if the card may have been handed in.' : 'Search current College ID Card reports and review possible matches below. To claim a found card, provide private ownership details through the claim form; an administrator must verify it. Do not share a full ID number, barcode, or QR contents in the public report.';if(items.length)answer+=` I found ${items.length} current card report${items.length===1?'':'s'}.`;else answer+=' I found no current card reports.';links=[{label:/lost|missing/.test(lower)?'Report Lost':'Search Items',href:/lost|missing/.test(lower)?'lost.html':'search.html'},{label:'Contact Student Affairs',href:'contact.html'}]; }
  else if (/claim|recover|collect|verification|return/.test(lower)) { answer='Open the found report and submit private identifying details using Claim. An administrator reviews the claim and may request proof. An item is marked returned only after approval; a possible match alone does not recover it.'; links=[{label:'Search Items',href:'search.html'},{label:'My Reports and Claims',href:'history.html'}]; }
  else if (/notification|matching|match|matches/.test(lower)) {
    const notices = await Notification.find({user:req.user.id,type:'possible_match'}).sort({createdAt:-1}).limit(5).select('text link reports createdAt readAt');
    answer = notices.length ? `I found ${notices.length} saved possible-match notification${notices.length===1?'':'s'}. Open Notifications on your dashboard or My Reports to review them. These are suggestions only; official claim verification is still required.` : 'There are no saved possible-match notifications for your account yet. New opposite-type reports are checked automatically. You can also search current reports.';
    links=[{label:'Dashboard and Notifications',href:'dashboard.html'},{label:'Search Items',href:'search.html'}];
  } else if (/administrator|admin|contact|help desk/.test(lower)) { answer='Use the Contact page to send the administration a message. For in-person assistance, visit Student Affairs Office. Claim decisions and return verification are handled by authorized administrators.';links=[{label:'Contact Administrator',href:'contact.html'}]; }
  else {
    const words = lower.replace(/\b(i|me|my|is|the|a|an|to|for|of|in|on|at|where|what|show|find|search|item|items|have|lost|found|please|can|you|do|how|about|matching|matches)\b/g,' ').match(/[a-z0-9]+/g)||[];
    const term = [...new Set(words.filter(w=>w.length>2))].sort((a,b)=>b.length-a.length)[0];
    if (term) {
      const query=rx(term);
      const found=await Item.find({status:{$ne:'rejected'},$or:[{itemName:query},{category:query},{description:query},{location:query}]}).select('-privateContact -handover -privateVerification').sort({createdAt:-1}).limit(5);
      items=found.map(item=>{const p=publicItem(item);return {_id:p._id,itemName:p.itemName,category:p.category,location:p.location,date:p.date,type:p.type,recoveryStatus:p.recoveryStatus};});
      answer=items.length ? `I found ${items.length} report${items.length===1?'':'s'} that may relate to “${term}”. Check the details in Search Items; only public report information is shown here.` : `I could not find a current report related to “${term}”. Try Search Items with another name, category, or campus location, or submit a lost report.`;
      links=[{label:'Search Items',href:`search.html?q=${encodeURIComponent(term)}`},{label:'Report Lost',href:'lost.html'}];
    }
  }
  res.json({answer,links,items,guidance:'This assistant provides guidance only. Official claim verification by the portal administrator is still required.'});
}));

app.get('/api/dashboard',auth,studentOnly,asyncRoute(async(req,res)=>{const [reports,claims,conversations,notifications]=await Promise.all([Item.find({reporter:req.user.id}).select('-privateVerification -claimantIds -approvedClaim').sort({createdAt:-1}),Claim.find({claimant:req.user.id}).populate('item','itemName type status recoveryStatus').populate('lostReport','itemName type recoveryStatus').sort({createdAt:-1}),Conversation.find({participants:req.user.id}).populate('item','itemName type').sort({updatedAt:-1}),Notification.find({user:req.user.id}).populate('reports','itemName category location date type status recoveryStatus').sort({createdAt:-1}).limit(100)]);res.json({reports,claims,conversations,notifications});}));
app.get('/api/admin/dashboard',auth,adminOnly,asyncRoute(async(req,res)=>res.json({users:await User.countDocuments(),reports:await Item.countDocuments(),lost:await Item.countDocuments({type:'lost'}),found:await Item.countDocuments({type:'found'}),pendingClaims:await Claim.countDocuments({status:'pending'}),pendingReports:await Item.countDocuments({status:'pending'}),contactMessages:await ContactMessage.countDocuments()})));
app.get('/api/admin/users',auth,adminOnly,asyncRoute(async(req,res)=>res.json({users:await User.find().select('name email role createdAt').sort({createdAt:-1})})));
app.patch('/api/admin/users/:id/role',auth,adminOnly,asyncRoute(async(req,res)=>{if(!validId(req.params.id))return res.status(400).json({message:'Invalid user ID.'});const role=(req.body||{}).role;if(!['user','admin'].includes(role))return res.status(400).json({message:'Role must be user or admin.'});if(String(req.user.id)===req.params.id&&role!=='admin')return res.status(400).json({message:'You cannot remove your own administrator role.'});const user=await User.findByIdAndUpdate(req.params.id,{role},{new:true}).select('name email role');if(!user)return res.status(404).json({message:'User not found.'});res.json({user});}));
app.get('/api/admin/claims', auth, adminOnly, asyncRoute(async (req,res) => {
  const claims = await Claim.find().populate('item','itemName category location date type status recoveryStatus').populate('claimant','name email').populate('decisionBy','name email').sort({ createdAt: -1 });
  const counts = await Claim.aggregate([{ $group: { _id: '$item', count: { $sum: 1 } } }]);
  const claimantCounts = new Map(counts.map(row => [String(row._id), row.count]));
  res.json({ claims: claims.map(claim => ({ ...claim.toObject(), claimantCount: claimantCounts.get(String(claim.item?._id)) || 0 })) });
}));
app.get('/api/admin/reports',auth,adminOnly,asyncRoute(async(req,res)=>res.json({reports:await Item.find().populate('reporter','name email').sort({createdAt:-1})})));
app.get('/api/admin/contact-messages',auth,adminOnly,asyncRoute(async(req,res)=>res.json({messages:await ContactMessage.find().sort({createdAt:-1}).limit(200)})));

app.use('/api', (req,res)=>res.status(404).json({message:'API endpoint not found.'}));
app.use((err,req,res,next)=>{ console.error(err); if(err.type==='entity.too.large')return res.status(413).json({message:'Request is too large. Images must be 5 MB or smaller.'}); if(err.name==='ValidationError')return res.status(400).json({message:err.message}); if(err.code===11000)return res.status(409).json({message:'An account with this email already exists.'}); res.status(500).json({message:'Internal server error.'}); });

async function start(){ if(!JWT_SECRET){console.error('JWT_SECRET must be set in .env');process.exit(1);} if(!MONGO_URI){console.error('MONGODB_URI must be set in production.');process.exit(1);} await mongoose.connect(MONGO_URI); await Promise.all([Notification.createIndexes(),PotentialMatch.createIndexes()]); console.log(`MongoDB connected: ${mongoose.connection.name}`); server.listen(PORT,'0.0.0.0',()=>console.log(`Portal listening on port ${PORT}`)); }
if(require.main===module) start().catch(err=>{console.error('Startup failed:',err.message);process.exit(1);});
module.exports={app,server,io,start,models:{User,Item,Claim,Conversation,Message,Notification,PotentialMatch,ContactMessage}};
