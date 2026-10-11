import 'dotenv/config';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { ExpressPeerServer } from 'peer';
import { GridFSBucket, MongoClient, ObjectId } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const prod = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
const port = Number(process.env.PORT || process.env.SERVER_PORT || 8787);
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'box';
const jwtSecret = process.env.JWT_SECRET || (!prod ? 'box-local-dev-change-me' : '');
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || '';
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() ||
  (!prod ? `http://localhost:${port}/api/auth/google/callback` : '');
const googleReady = !!(googleClientId && googleClientSecret && googleRedirectUri);
const googleCallbackOrigin = googleRedirectUri ? new URL(googleRedirectUri).origin : '';
const configuredAppOrigin = process.env.APP_URL?.trim()
  ? new URL(process.env.APP_URL.trim()).origin
  : '';
const googleOAuth = googleReady
  ? new OAuth2Client(googleClientId, googleClientSecret, googleRedirectUri)
  : null;
const googleStateCookie = 'box_google_oauth_state';

if (googleReady && configuredAppOrigin && configuredAppOrigin !== googleCallbackOrigin) {
  console.warn(
    `[Box] APP_URL (${configuredAppOrigin}) ne correspond pas à l’origine OAuth (${googleCallbackOrigin}). ` +
    'Le retour Google utilisera l’origine OAuth afin que le cookie de session soit envoyé à l’API.',
  );
}
const peerKey = 'peerjs';
const peerConcurrentLimit = Math.max(50, Math.min(10_000, Number(process.env.PEER_CONCURRENT_LIMIT) || 2_000));

if (prod && !existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('[Box] Build de production introuvable. Fournissez le dossier dist/ précompilé avant npm start.');
  process.exit(1);
}
if (!mongoUri) {
  console.error('[Box] MONGODB_URI manquant. Copiez .env.example vers .env, renseignez une URI Atlas avec un mot de passe renouvelé, puis lancez node server/index.mjs.');
  process.exit(1);
}
if (!jwtSecret) {
  console.error('[Box] JWT_SECRET manquant. Ajoutez une valeur aleatoire longue dans .env.');
  process.exit(1);
}

const mongo = new MongoClient(mongoUri, {
  maxPoolSize: 20,
  minPoolSize: 2,
  maxIdleTimeMS: 45_000,
  serverSelectionTimeoutMS: 8_000,
  retryReads: true,
  retryWrites: true,
});
try {
  await mongo.connect();
} catch (error) {
  console.error('[Box] Connexion MongoDB impossible. Verifiez MONGODB_URI, les droits de l utilisateur et la liste d acces IP Atlas.');
  console.error(error?.message || error);
  process.exit(1);
}
const db = mongo.db(dbName);
const users = db.collection('users');
const friendships = db.collection('friendships');
const matches = db.collection('matches');
const avatars = new GridFSBucket(db, { bucketName: 'avatars', chunkSizeBytes: 128 * 1024 });

try {
  await Promise.all([
    users.createIndex({ emailLower: 1 }, { unique: true }),
    users.createIndex({ usernameLower: 1 }, { unique: true }),
    users.createIndex(
      { googleSub: 1 },
      { unique: true, partialFilterExpression: { googleSub: { $type: 'string' } } },
    ),
    friendships.createIndex({ requesterId: 1, addresseeId: 1 }, { unique: true }),
    friendships.createIndex({ addresseeId: 1, status: 1 }),
    matches.createIndex({ playerIds: 1, createdAt: -1 }),
  ]);
} catch (error) {
  console.error('[Box] Initialisation MongoDB impossible. Verifiez les droits de creation d index sur la base box.');
  console.error(error?.message || error);
  await mongo.close();
  process.exit(1);
}

const app = express();
const server = createServer(app);
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false, // WebRTC endpoints are configured at the host level.
  }),
);
app.use(
  cors({
    origin(origin, cb) {
      const allowed = (process.env.APP_ORIGINS || 'http://localhost:5173,http://localhost:4173,http://localhost:8787')
        .split(',')
        .map((s) => s.trim());
      const localDev = !prod && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '');
      cb(null, !origin || localDev || allowed.includes(origin));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '300kb' }));
app.use(cookieParser());

const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 25, standardHeaders: true });
const apiLimiter = rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true });
app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME = /^[a-zA-Z0-9_-]{3,14}$/;
const LANGUAGES = new Set(['fr', 'en', 'es', 'de', 'pt']);

function cleanText(value, max = 60) {
  return String(value || '').trim().replace(/[<>]/g, '').slice(0, max);
}
function avatarUrl(user) {
  return user.avatarId
    ? `/api/users/${user._id}/avatar?v=${user.avatarVersion || 1}`
    : (user.googleAvatar || '');
}
function publicUser(user) {
  return {
    id: String(user._id),
    email: user.email,
    username: user.username,
    displayName: user.displayName || user.username,
    avatarUrl: avatarUrl(user),
    hasPassword: !!user.passwordHash,
    preferences: {
      language: user.preferences?.language || 'fr',
      sound: user.preferences?.sound ?? true,
      reducedMotion: user.preferences?.reducedMotion ?? false,
      friendRequests: user.preferences?.friendRequests ?? true,
      game: user.preferences?.game || { size: 5, turnLimit: 10, difficulty: 'sharp', playerCount: 2 },
    },
    stats: {
      games: user.stats?.games || 0,
      wins: user.stats?.wins || 0,
      boxes: user.stats?.boxes || 0,
    },
    createdAt: user.createdAt,
  };
}
function friendUser(user) {
  return {
    id: String(user._id),
    username: user.username,
    displayName: user.displayName || user.username,
    avatarUrl: avatarUrl(user),
    stats: publicUser(user).stats,
  };
}
function issueSession(res, userId) {
  const token = jwt.sign({ sub: String(userId), type: 'session' }, jwtSecret, {
    expiresIn: '14d',
    issuer: 'box-by-plag',
    audience: 'box-web',
  });
  res.cookie('box_session', token, {
    httpOnly: true,
    secure: prod,
    // Lax lets the session survive Google's top-level OAuth callback redirect.
    sameSite: 'lax',
    path: '/',
    maxAge: 14 * 24 * 60 * 60 * 1000,
  });
}
async function requireUser(req, res, next) {
  try {
    const raw = req.cookies.box_session;
    if (!raw) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const payload = jwt.verify(raw, jwtSecret, {
      issuer: 'box-by-plag',
      audience: 'box-web',
    });
    req.userId = new ObjectId(payload.sub);
    const user = await users.findOne({ _id: req.userId });
    if (!user) return res.status(401).json({ error: 'INVALID_SESSION' });
    req.user = user;
    next();
  } catch {
    res.clearCookie('box_session', { path: '/', sameSite: 'lax', secure: prod });
    res.status(401).json({ error: 'INVALID_SESSION' });
  }
}
function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
async function saveAvatarBuffer(userId, buffer, contentType, oldId) {
  const stream = avatars.openUploadStream(`avatar-${userId}`, {
    metadata: { userId, contentType },
  });
  await new Promise((resolve, reject) => {
    Readable.from(buffer).pipe(stream).on('finish', resolve).on('error', reject);
  });
  if (oldId) avatars.delete(oldId).catch(() => {});
  return stream.id;
}

function timingSafeStringEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function googleCallbackUrl(status) {
  // The session cookie is host-scoped, so return to the same public origin that
  // received Google's callback. APP_URL is only a fallback without OAuth config.
  const appOrigin = googleCallbackOrigin || configuredAppOrigin || `http://localhost:${port}`;
  const target = new URL('/', appOrigin);
  target.searchParams.set('oauth', status);
  return target.toString();
}

function googleProfilePicture(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function findGoogleEmail(email) {
  return users.findOne({
    $or: [
      { emailLower: email },
      // Also finds older Google accounts created before emailLower was indexed.
      { $expr: { $eq: [{ $toLower: { $ifNull: ['$email', ''] } }, email] } },
    ],
  });
}

async function linkGoogleAccount(user, profile, email) {
  if (user.googleSub && user.googleSub !== profile.sub) {
    throw new Error('GOOGLE_ACCOUNT_CONFLICT');
  }
  const now = new Date();
  const displayName = cleanText(profile.name, 40);
  const picture = googleProfilePicture(profile.picture);
  const set = {
    googleSub: profile.sub,
    authProvider: user.passwordHash ? 'google+password' : 'google',
    emailLower: String(user.email || email).toLowerCase(),
    updatedAt: now,
  };
  if (!user.displayName && displayName) set.displayName = displayName;
  if (!user.usernameLower && user.username) set.usernameLower = user.username.toLowerCase();
  if (picture) set.googleAvatar = picture;
  try {
    const result = await users.updateOne(
      {
        _id: user._id,
        $or: [{ googleSub: { $exists: false } }, { googleSub: profile.sub }],
      },
      { $set: set },
    );
    if (!result.matchedCount) throw new Error('GOOGLE_ACCOUNT_CONFLICT');
  } catch (error) {
    if (error?.code === 11000) throw new Error('GOOGLE_ACCOUNT_CONFLICT');
    throw error;
  }
  return users.findOne({ _id: user._id });
}

async function uniqueGoogleUsername(email) {
  const stem = email
    .split('@')[0]
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 14);
  const base = USERNAME.test(stem) ? stem : 'player';
  if (!(await users.findOne({ usernameLower: base.toLowerCase() }))) return base;
  const prefix = (USERNAME.test(stem) ? stem : 'player').slice(0, 9).replace(/[_-]+$/g, '') || 'player';
  for (let i = 0; i < 8; i++) {
    const candidate = `${prefix}_${randomBytes(2).toString('hex')}`;
    if (!(await users.findOne({ usernameLower: candidate.toLowerCase() }))) return candidate;
  }
  throw new Error('GOOGLE_USERNAME_ALLOCATION_FAILED');
}

async function findOrCreateGoogleUser(profile) {
  const email = String(profile.email || '').trim().toLowerCase();
  if (!profile.sub || !EMAIL.test(email) || profile.email_verified !== true) {
    throw new Error('GOOGLE_EMAIL_NOT_VERIFIED');
  }
  const byGoogleId = await users.findOne({ googleSub: profile.sub });
  if (byGoogleId) return linkGoogleAccount(byGoogleId, profile, email);

  const byEmail = await findGoogleEmail(email);
  if (byEmail) return linkGoogleAccount(byEmail, profile, email);

  const now = new Date();
  const displayName = cleanText(profile.name, 40);
  const picture = googleProfilePicture(profile.picture);
  for (let i = 0; i < 8; i++) {
    const username = await uniqueGoogleUsername(email);
    const user = {
      email,
      emailLower: email,
      username,
      usernameLower: username.toLowerCase(),
      displayName: displayName || username,
      googleSub: profile.sub,
      authProvider: 'google',
      ...(picture ? { googleAvatar: picture } : {}),
      preferences: { language: 'fr', sound: true, reducedMotion: false, friendRequests: true },
      stats: { games: 0, wins: 0, boxes: 0 },
      createdAt: now,
      updatedAt: now,
    };
    try {
      const result = await users.insertOne(user);
      user._id = result.insertedId;
      return user;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const concurrentLogin = await users.findOne({ googleSub: profile.sub });
      if (concurrentLogin) return concurrentLogin;
      const concurrentEmail = await findGoogleEmail(email);
      if (concurrentEmail) return linkGoogleAccount(concurrentEmail, profile, email);
      // A concurrently-created account may only have taken this username; retry.
    }
  }
  throw new Error('GOOGLE_ACCOUNT_CREATION_FAILED');
}

/* ------------------------------ public/auth ------------------------------ */

app.get('/api/config', (_req, res) => {
  res.json({
    appName: 'Box',
    author: 'Plag',
    auth: { google: googleReady },
    online: { signaling: true, path: '/peerjs' },
  });
});

app.get('/api/health', asyncRoute(async (_req, res) => {
  await db.command({ ping: 1 });
  res.json({ ok: true, online: { signaling: true } });
}));

app.get('/api/auth/google', (req, res) => {
  if (!googleOAuth) return res.status(503).json({ error: 'GOOGLE_NOT_CONFIGURED' });
  // The state and session cookies are host-only. Start OAuth on the exact host
  // configured for Google's callback so the browser sends both cookies there.
  const callbackUrl = new URL(googleCallbackOrigin);
  const callbackHost = callbackUrl.host.toLowerCase();
  const requestHost = new URL(`${callbackUrl.protocol}//${req.get('host') || ''}`).host.toLowerCase();
  if (requestHost !== callbackHost) {
    return res.redirect(302, new URL('/api/auth/google', googleCallbackOrigin).toString());
  }
  const state = randomBytes(32).toString('hex');
  res.cookie(googleStateCookie, state, {
    httpOnly: true,
    secure: prod,
    sameSite: 'lax',
    path: '/api/auth/google',
    maxAge: 10 * 60 * 1000,
  });
  const destination = googleOAuth.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state,
  });
  res.redirect(302, destination);
});

app.get('/api/auth/google/callback', asyncRoute(async (req, res) => {
  const expectedState = req.cookies[googleStateCookie];
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  res.clearCookie(googleStateCookie, {
    httpOnly: true,
    secure: prod,
    sameSite: 'lax',
    path: '/api/auth/google',
  });
  if (!googleOAuth || !timingSafeStringEqual(state, expectedState)) {
    return res.redirect(303, googleCallbackUrl('error'));
  }
  if (req.query.error || typeof req.query.code !== 'string') {
    return res.redirect(303, googleCallbackUrl('error'));
  }
  try {
    const { tokens } = await googleOAuth.getToken(req.query.code);
    if (!tokens.id_token) throw new Error('GOOGLE_ID_TOKEN_MISSING');
    const ticket = await googleOAuth.verifyIdToken({
      idToken: tokens.id_token,
      audience: googleClientId,
    });
    const profile = ticket.getPayload();
    if (!profile) throw new Error('GOOGLE_PROFILE_MISSING');
    const user = await findOrCreateGoogleUser(profile);
    await users.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    issueSession(res, user._id);
    return res.redirect(303, googleCallbackUrl('success'));
  } catch (error) {
    console.error('[Box] Google OAuth callback failed:', error?.message || 'unknown error');
    return res.redirect(303, googleCallbackUrl('error'));
  }
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 120).toLowerCase();
  const username = cleanText(req.body.username, 14);
  const password = String(req.body.password || '');
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'INVALID_EMAIL' });
  if (!USERNAME.test(username)) return res.status(400).json({ error: 'INVALID_USERNAME' });
  if (password.length < 8 || password.length > 128)
    return res.status(400).json({ error: 'WEAK_PASSWORD' });
  const exists = await users.findOne({
    $or: [{ emailLower: email }, { usernameLower: username.toLowerCase() }],
  });
  if (exists)
    return res.status(409).json({
      error: exists.emailLower === email ? 'EMAIL_TAKEN' : 'USERNAME_TAKEN',
    });
  const now = new Date();
  const doc = {
    email,
    emailLower: email,
    username,
    usernameLower: username.toLowerCase(),
    displayName: username,
    passwordHash: await bcrypt.hash(password, 12),
    preferences: { language: 'fr', sound: true, reducedMotion: false, friendRequests: true },
    stats: { games: 0, wins: 0, boxes: 0 },
    createdAt: now,
    updatedAt: now,
  };
  const result = await users.insertOne(doc);
  doc._id = result.insertedId;
  issueSession(res, result.insertedId);
  res.status(201).json({ user: publicUser(doc) });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || '');
  const user = await users.findOne({ emailLower: email });
  if (user && !user.passwordHash)
    return res.status(403).json({ error: 'PASSWORD_NOT_SET' });
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  issueSession(res, user._id);
  await users.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('box_session', { path: '/', sameSite: 'lax', secure: prod });
  res.status(204).end();
});

// Existing sessions created before the provider removal can set a password once.
app.post('/api/auth/password', requireUser, asyncRoute(async (req, res) => {
  const password = String(req.body.password || '');
  const currentPassword = String(req.body.currentPassword || '');
  if (password.length < 8 || password.length > 128)
    return res.status(400).json({ error: 'WEAK_PASSWORD' });
  if (req.user.passwordHash && !(await bcrypt.compare(currentPassword, req.user.passwordHash)))
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  const set = { passwordHash: await bcrypt.hash(password, 12), updatedAt: new Date() };
  if (req.user.googleSub) set.authProvider = 'google+password';
  await users.updateOne({ _id: req.userId }, { $set: set });
  res.json({ ok: true });
}));

/* ------------------------------ profile ------------------------------ */

app.get('/api/users/me', requireUser, (req, res) => res.json({ user: publicUser(req.user) }));

app.patch('/api/users/me', requireUser, asyncRoute(async (req, res) => {
  const set = { updatedAt: new Date() };
  if (req.body.displayName !== undefined) {
    const displayName = cleanText(req.body.displayName, 40);
    if (displayName.length < 2) return res.status(400).json({ error: 'INVALID_DISPLAY_NAME' });
    set.displayName = displayName;
  }
  if (req.body.username !== undefined) {
    const username = cleanText(req.body.username, 14);
    if (!USERNAME.test(username)) return res.status(400).json({ error: 'INVALID_USERNAME' });
    const collision = await users.findOne({
      usernameLower: username.toLowerCase(),
      _id: { $ne: req.userId },
    });
    if (collision) return res.status(409).json({ error: 'USERNAME_TAKEN' });
    set.username = username;
    set.usernameLower = username.toLowerCase();
  }
  if (req.body.preferences && typeof req.body.preferences === 'object') {
    const p = req.body.preferences;
    if (p.language !== undefined && LANGUAGES.has(p.language)) set['preferences.language'] = p.language;
    if (p.sound !== undefined) set['preferences.sound'] = !!p.sound;
    if (p.reducedMotion !== undefined) set['preferences.reducedMotion'] = !!p.reducedMotion;
    if (p.friendRequests !== undefined) set['preferences.friendRequests'] = !!p.friendRequests;
    if (p.game && typeof p.game === 'object') {
      const game = p.game;
      if ([4, 5, 6, 7].includes(Number(game.size))) set['preferences.game.size'] = Number(game.size);
      if ([0, 5, 10, 15, 20].includes(Number(game.turnLimit)))
        set['preferences.game.turnLimit'] = Number(game.turnLimit);
      if (['chill', 'sharp', 'ruthless'].includes(game.difficulty))
        set['preferences.game.difficulty'] = game.difficulty;
      if ([2, 3, 4].includes(Number(game.playerCount)))
        set['preferences.game.playerCount'] = Number(game.playerCount);
    }
  }
  await users.updateOne({ _id: req.userId }, { $set: set });
  const user = await users.findOne({ _id: req.userId });
  res.json({ user: publicUser(user) });
}));

app.post('/api/users/me/avatar', requireUser, upload.single('avatar'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'INVALID_IMAGE' });
  const oldId = req.user.avatarId;
  const avatarId = await saveAvatarBuffer(req.userId, req.file.buffer, req.file.mimetype, oldId);
  await users.updateOne(
    { _id: req.userId },
    {
      $set: { avatarId, avatarVersion: Date.now(), updatedAt: new Date() },
    },
  );
  const user = await users.findOne({ _id: req.userId });
  res.json({ user: publicUser(user) });
}));

app.get('/api/users/:id/avatar', asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.sendStatus(404);
  const user = await users.findOne({ _id: new ObjectId(req.params.id) }, { projection: { avatarId: 1 } });
  if (!user?.avatarId) return res.sendStatus(404);
  const file = await db.collection('avatars.files').findOne({ _id: user.avatarId });
  if (!file) return res.sendStatus(404);
  res.set({
    'Content-Type': file.metadata?.contentType || 'image/jpeg',
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: String(file._id),
  });
  avatars.openDownloadStream(user.avatarId).on('error', () => res.end()).pipe(res);
}));

/* ------------------------------ friends ------------------------------ */

app.get('/api/users/search', requireUser, asyncRoute(async (req, res) => {
  const q = cleanText(req.query.q, 14).replace(/[^a-zA-Z0-9_-]/g, '');
  if (q.length < 2) return res.json({ users: [] });
  const found = await users
    .find({ usernameLower: { $regex: `^${q.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` }, _id: { $ne: req.userId } })
    .project({ passwordHash: 0 })
    .limit(8)
    .toArray();
  res.json({ users: found.map(friendUser) });
}));

async function friendshipPayload(userId) {
  const rows = await friendships
    .find({ $or: [{ requesterId: userId }, { addresseeId: userId }] })
    .sort({ updatedAt: -1 })
    .toArray();
  const ids = rows.map((r) => (r.requesterId.equals(userId) ? r.addresseeId : r.requesterId));
  const people = await users.find({ _id: { $in: ids } }, { projection: { passwordHash: 0 } }).toArray();
  const map = new Map(people.map((p) => [String(p._id), p]));
  return rows
    .map((r) => {
      const outgoing = r.requesterId.equals(userId);
      const otherId = outgoing ? r.addresseeId : r.requesterId;
      const person = map.get(String(otherId));
      if (!person) return null;
      return {
        id: String(r._id),
        status: r.status,
        direction: outgoing ? 'outgoing' : 'incoming',
        user: friendUser(person),
        updatedAt: r.updatedAt,
      };
    })
    .filter(Boolean);
}

app.get('/api/friends', requireUser, asyncRoute(async (req, res) => {
  res.json({ friendships: await friendshipPayload(req.userId) });
}));

app.post('/api/friends/requests/:userId', requireUser, asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.userId)) return res.status(404).json({ error: 'USER_NOT_FOUND' });
  const targetId = new ObjectId(req.params.userId);
  if (targetId.equals(req.userId)) return res.status(400).json({ error: 'CANNOT_ADD_SELF' });
  const target = await users.findOne({ _id: targetId });
  if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });
  if (target.preferences?.friendRequests === false)
    return res.status(403).json({ error: 'REQUESTS_DISABLED' });
  const relation = await friendships.findOne({
    $or: [
      { requesterId: req.userId, addresseeId: targetId },
      { requesterId: targetId, addresseeId: req.userId },
    ],
  });
  const now = new Date();
  if (relation?.status === 'accepted') {
    return res.json({ friendships: await friendshipPayload(req.userId) });
  }
  if (relation?.status === 'pending' && relation.addresseeId.equals(req.userId)) {
    await friendships.updateOne({ _id: relation._id }, { $set: { status: 'accepted', updatedAt: now } });
  } else if (!relation) {
    await friendships.insertOne({
      requesterId: req.userId,
      addresseeId: targetId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await friendships.updateOne({ _id: relation._id }, { $set: { updatedAt: now } });
  }
  res.status(201).json({ friendships: await friendshipPayload(req.userId) });
}));

app.post('/api/friends/requests/:requestId/accept', requireUser, asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.requestId)) return res.sendStatus(404);
  const result = await friendships.updateOne(
    { _id: new ObjectId(req.params.requestId), addresseeId: req.userId, status: 'pending' },
    { $set: { status: 'accepted', updatedAt: new Date() } },
  );
  if (!result.matchedCount) return res.sendStatus(404);
  res.json({ friendships: await friendshipPayload(req.userId) });
}));

app.delete('/api/friends/:friendshipId', requireUser, asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.friendshipId)) return res.sendStatus(404);
  await friendships.deleteOne({
    _id: new ObjectId(req.params.friendshipId),
    $or: [{ requesterId: req.userId }, { addresseeId: req.userId }],
  });
  res.json({ friendships: await friendshipPayload(req.userId) });
}));

/* ------------------------------ results ------------------------------ */

app.post('/api/matches', requireUser, asyncRoute(async (req, res) => {
  const mode = req.body.mode === 'online' ? 'online' : 'local';
  const scores = Array.isArray(req.body.scores)
    ? req.body.scores.slice(0, 4).map((n) => Math.max(0, Math.min(100, Number(n) || 0)))
    : [];
  const names = Array.isArray(req.body.names) ? req.body.names.slice(0, 4).map((n) => cleanText(n, 14)) : [];
  if (scores.length < 2 || scores.length !== names.length)
    return res.status(400).json({ error: 'INVALID_MATCH' });
  const myIndex = Math.max(0, Math.min(scores.length - 1, Number(req.body.myIndex) || 0));
  const max = Math.max(...scores);
  const won = scores[myIndex] === max && scores.filter((s) => s === max).length === 1;
  await matches.insertOne({
    ownerId: req.userId,
    playerIds: [req.userId],
    mode,
    size: Math.max(4, Math.min(7, Number(req.body.size) || 5)),
    names,
    scores,
    myIndex,
    won,
    createdAt: new Date(),
  });
  await users.updateOne(
    { _id: req.userId },
    { $inc: { 'stats.games': 1, 'stats.wins': won ? 1 : 0, 'stats.boxes': scores[myIndex] } },
  );
  const user = await users.findOne({ _id: req.userId });
  res.status(201).json({ user: publicUser(user) });
}));

app.get('/api/matches', requireUser, asyncRoute(async (req, res) => {
  const recent = await matches.find({ ownerId: req.userId }).sort({ createdAt: -1 }).limit(10).toArray();
  res.json({ matches: recent.map((m) => ({ ...m, _id: String(m._id), ownerId: undefined, playerIds: undefined })) });
}));

// Self-host the PeerJS signaling service on this HTTP server, under /peerjs.
// Game data remains direct WebRTC traffic between the host and other players.
const peerServer = ExpressPeerServer(server, {
  key: peerKey,
  path: '/',
  proxied: true,
  allow_discovery: false,
  concurrent_limit: peerConcurrentLimit,
});
app.use('/peerjs', peerServer);

app.use('/api', (_req, res) => res.status(404).json({ error: 'API_NOT_FOUND' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err?.code === 11000) return res.status(409).json({ error: 'DUPLICATE_VALUE' });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: 'IMAGE_TOO_LARGE' });
  res.status(500).json({ error: 'SERVER_ERROR' });
});

let vite;
if (prod) {
  app.use(express.static(path.join(root, 'dist'), {
    immutable: true,
    maxAge: '1y',
    index: false,
    setHeaders(res, filePath) {
      const pwaFile = ['sw.js', 'manifest.webmanifest'].includes(path.basename(filePath))
        || filePath.includes(`${path.sep}icons${path.sep}`);
      if (pwaFile) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.use((_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(root, 'dist', 'index.html'));
  });
} else {
  // One process serves both the React app and its API in development.
  const { createServer } = await import('vite');
  vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

server.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`[Box] Site et API disponibles sur http://localhost:${port}`);
  console.log(`[Box] Signalisation PeerJS disponible sur /peerjs (limite: ${peerConcurrentLimit} clients)`);
  console.log(`[Box] Connexion Google ${googleReady ? 'activée' : 'désactivée — configure les identifiants OAuth dans .env'}`);
});
server.on('error', (error) => {
  console.error(`[Box] Impossible d ecouter sur le port ${port}. Verifiez l allocation et les variables PORT/SERVER_PORT.`);
  console.error(error?.message || error);
  process.exit(1);
});
async function shutdown() {
  server.close();
  await vite?.close();
  await mongo.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
