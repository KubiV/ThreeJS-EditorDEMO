import express from 'express';
import multer from 'multer';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODEL_APPEARANCE, capitalizeTitle, normalizeCategoryDefinitions, normalizeModelAppearance, parseCategoryWikitext, parseModel3dWikitext } from './src/api/model3d-format.js';
import { createModelArtifacts, regenerateModelThumbnail } from './src/server/model-artifacts.js';
import localSettings from './LocalSettings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function settingsObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`LocalSettings.js: sekce „${name}“ musí být objekt.`);
  return value;
}

function positiveInteger(value, name, { max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`LocalSettings.js: „${name}“ musí být celé číslo od 1 do ${max}.`);
  return number;
}

function settingText(value, name, { fallback = '' } = {}) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new Error(`LocalSettings.js: „${name}“ musí být text.`);
  return value.trim();
}

function optionalSettingsObject(value, name) {
  if (value === undefined || value === null) return {};
  return settingsObject(value, name);
}

function optionalPositiveInteger(value, name, fallback, options) {
  if (value === undefined || value === null || value === '') return fallback;
  return positiveInteger(value, name, options);
}

function booleanSetting(value, name, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new Error(`LocalSettings.js: „${name}“ musí být true nebo false.`);
  return value;
}

function hexColor(value, name, fallback) {
  const color = settingText(value, name, { fallback });
  if (!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)) {
    throw new Error(`LocalSettings.js: „${name}“ musí být hexadecimální barva, například #00538a.`);
  }
  return color;
}

function normalizeOrigin(value, name) {
  const source = settingText(value, name);
  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error(`LocalSettings.js: „${name}“ musí být platný HTTP(S) origin.`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error(`LocalSettings.js: „${name}“ musí být pouze HTTP(S) origin bez cesty.`);
  }
  return url.origin;
}

function accountName(value, name) {
  const account = settingText(value, name).normalize('NFC');
  if (!account) throw new Error(`LocalSettings.js: uživatel v „${name}“ nesmí být prázdný.`);
  return account;
}

function accountKey(value) {
  return String(value || '').trim().normalize('NFC').toLocaleLowerCase('cs-CZ');
}

function configuredAccounts(value, name) {
  if (value === undefined || value === null) return new Set();
  if (!Array.isArray(value)) throw new Error(`LocalSettings.js: „${name}“ musí být pole uživatelských jmen MediaWiki.`);
  return new Set(value.map((user, index) => accountKey(accountName(user, `${name}[${index}]`))));
}

const serverSettings = settingsObject(localSettings?.server, 'server');
const storageSettings = settingsObject(localSettings?.storage, 'storage');
const uploadSettings = settingsObject(localSettings?.upload, 'upload');
const mediaWikiSettings = settingsObject(localSettings?.mediaWiki, 'mediaWiki');
const securitySettings = optionalSettingsObject(localSettings?.security, 'security');
const brandingSettings = optionalSettingsObject(localSettings?.branding, 'branding');
const requestedPort = positiveInteger(serverSettings.port, 'server.port', { max: 65535 });
const fallbackToNextPort = serverSettings.fallbackToNextPort !== false;
const storageDirectory = settingText(storageSettings.directory, 'storage.directory');
if (!storageDirectory) throw new Error('LocalSettings.js: „storage.directory“ nesmí být prázdné.');
const configuredStorageUrl = settingText(storageSettings.publicModelsUrl, 'storage.publicModelsUrl').replace(/\/+$/, '');
if (!configuredStorageUrl) throw new Error('LocalSettings.js: „storage.publicModelsUrl“ nesmí být prázdné.');
const configuredMaxFileSizeMB = positiveInteger(uploadSettings.maxFileSizeMB, 'upload.maxFileSizeMB', { max: 1024 * 1024 });
const configuredMaxFileSizeBytes = configuredMaxFileSizeMB * 1024 * 1024;
const configuredMaxFiles = positiveInteger(uploadSettings.maxFiles, 'upload.maxFiles', { max: 100 });
if (!Array.isArray(uploadSettings.allowedExtensions) || !uploadSettings.allowedExtensions.length) {
  throw new Error('LocalSettings.js: „upload.allowedExtensions“ musí obsahovat alespoň jednu příponu.');
}
const allowedExtensions = new Set(uploadSettings.allowedExtensions.map((extension) => {
  const value = settingText(extension, 'upload.allowedExtensions[]').toLowerCase();
  if (!/^\.[a-z0-9]+$/.test(value)) throw new Error(`LocalSettings.js: přípona „${extension}“ není platná.`);
  return value;
}));
const configuredWikiApiUrl = settingText(mediaWikiSettings.apiUrl, 'mediaWiki.apiUrl');
const configuredPagePrefix = settingText(mediaWikiSettings.pagePrefix, 'mediaWiki.pagePrefix').replace(/:+$/, '');
const configuredCategoryPage = settingText(mediaWikiSettings.categoryPage, 'mediaWiki.categoryPage', { fallback: `${configuredPagePrefix || '3D'}:Kategorie` });
const configuredInfoPageUrl = settingText(mediaWikiSettings.infoPageUrl, 'mediaWiki.infoPageUrl');
const configuredLoginUrl = settingText(mediaWikiSettings.loginUrl, 'mediaWiki.loginUrl');
const configuredBotUsername = settingText(mediaWikiSettings.botUsername, 'mediaWiki.botUsername');
const configuredBotPassword = settingText(mediaWikiSettings.botPassword, 'mediaWiki.botPassword');
const configuredHeaderText = settingText(brandingSettings.headerText, 'branding.headerText', { fallback: '3D prohlížeč' });
if (configuredHeaderText.length > 120) throw new Error('LocalSettings.js: „branding.headerText“ může mít nejvýše 120 znaků.');
const configuredTopbarBackgroundColor = hexColor(brandingSettings.topbarBackgroundColor, 'branding.topbarBackgroundColor', '#ffbe00');
const configuredTopbarTextColor = hexColor(brandingSettings.topbarTextColor, 'branding.topbarTextColor', '#202122');
const configuredWriteRateWindowMinutes = optionalPositiveInteger(securitySettings.writeRateWindowMinutes, 'security.writeRateWindowMinutes', 15, { max: 24 * 60 });
const configuredWriteRateMaxRequests = optionalPositiveInteger(securitySettings.writeRateMaxRequests, 'security.writeRateMaxRequests', 20, { max: 10000 });
if (securitySettings.trustedOrigins !== undefined && !Array.isArray(securitySettings.trustedOrigins)) {
  throw new Error('LocalSettings.js: „security.trustedOrigins“ musí být pole originů.');
}
const trustedWriteOrigins = new Set((securitySettings.trustedOrigins || []).map((origin, index) => normalizeOrigin(origin, `security.trustedOrigins[${index}]`)));
const modelAccessSettings = optionalSettingsObject(securitySettings.modelAccess, 'security.modelAccess');
const modelManagementSettings = optionalSettingsObject(securitySettings.modelManagement, 'security.modelManagement');
const configuredModelEditors = configuredAccounts(modelManagementSettings.editors, 'security.modelManagement.editors');
const configuredModelDeleters = configuredAccounts(modelManagementSettings.deleters, 'security.modelManagement.deleters');
const configuredThumbnailRegenerators = configuredAccounts(modelManagementSettings.thumbnailRegenerators, 'security.modelManagement.thumbnailRegenerators');
// Keep installations updated from older versions working as before: every
// authenticated MediaWiki editor may edit a model. An administrator may opt
// into owner-only edits only after legacy records have an assigned owner.
const configuredOwnershipEditOnly = booleanSetting(modelManagementSettings.requireOwnershipForEdits, 'security.modelManagement.requireOwnershipForEdits', false);
if (modelAccessSettings.allowedGroups !== undefined && !Array.isArray(modelAccessSettings.allowedGroups)) {
  throw new Error('LocalSettings.js: „security.modelAccess.allowedGroups“ musí být pole skupin MediaWiki.');
}
const configuredModelAccessMode = (() => {
  const mode = settingText(modelAccessSettings.mode, 'security.modelAccess.mode');
  if (!mode) return booleanSetting(modelAccessSettings.requireLogin, 'security.modelAccess.requireLogin', true) ? 'login-required' : 'public';
  if (!['login-required', 'public', 'view-only'].includes(mode)) {
    throw new Error('LocalSettings.js: „security.modelAccess.mode“ musí být „login-required“, „public“ nebo „view-only“.');
  }
  if (modelAccessSettings.requireLogin !== undefined) {
    const legacyRequireLogin = booleanSetting(modelAccessSettings.requireLogin, 'security.modelAccess.requireLogin', true);
    if (legacyRequireLogin !== (mode === 'login-required')) {
      throw new Error('LocalSettings.js: nepoužívejte současně neslučitelné „security.modelAccess.mode“ a „requireLogin“.');
    }
  }
  return mode;
})();
const configuredModelAccessRequireLogin = configuredModelAccessMode === 'login-required';
const configuredModelAccessGroups = new Set((modelAccessSettings.allowedGroups || []).map((group, index) => {
  const value = settingText(group, `security.modelAccess.allowedGroups[${index}]`);
  if (!value) throw new Error('LocalSettings.js: skupina v „security.modelAccess.allowedGroups“ nesmí být prázdná.');
  return value.toLocaleLowerCase('en-US');
}));
if (!configuredModelAccessRequireLogin && configuredModelAccessGroups.size) {
  throw new Error('LocalSettings.js: skupiny pro modely lze použít jen v režimu „security.modelAccess.mode: login-required“.');
}

const app = express();
const httpServer = createHttpServer(app);
const storageRoot = path.resolve(__dirname, storageDirectory);
const modelsRoot = path.join(storageRoot, 'models');
const registryPath = path.join(storageRoot, 'models.json');
const legacyDemoRoot = path.join(__dirname, 'threejsdemo', 'public');
const writeRateWindowMs = configuredWriteRateWindowMinutes * 60 * 1000;
const writeRateEntries = new Map();

function wikiIndexUrl(title) {
  if (configuredInfoPageUrl && title === `${configuredPagePrefix || '3D'}:Prohlížeč`) return configuredInfoPageUrl;
  const apiUrl = configuredWikiApiUrl;
  if (!apiUrl) return '';
  try {
    const url = new URL(apiUrl);
    url.pathname = url.pathname.replace(/api\.php$/, 'index.php');
    url.search = '';
    url.searchParams.set('title', title);
    return url.toString();
  } catch {
    return '';
  }
}

await fs.mkdir(modelsRoot, { recursive: true });
const realModelsRoot = await fs.realpath(modelsRoot);
const realLegacyDemoRoot = await fs.realpath(legacyDemoRoot);
if (!existsSync(registryPath)) await fs.writeFile(registryPath, '[]\n');

app.use(express.json({ limit: '2mb' }));
// Vite can serve project-root JavaScript during development. Keep both the
// real local configuration and its template server-only in every mode.
app.use(['/LocalSettings.js', '/LocalSettings.example.js'], (_req, res) => res.sendStatus(404));
app.use((_req, res, next) => {
  // Prevent a browser from guessing a scriptable content type when it
  // receives a malformed or mislabeled uploaded file.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

const cleanId = (value) => String(value || '')
  .toLocaleLowerCase('cs-CZ').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 64) || `model-${Date.now()}`;
const fileName = (value) => path.basename(value).replace(/[^a-zA-Z0-9._-]/g, '_');
const readRegistry = async () => JSON.parse(await fs.readFile(registryPath, 'utf8'));
const writeRegistry = (models) => fs.writeFile(registryPath, `${JSON.stringify(models, null, 2)}\n`);
const storageFileUrl = (id, name) => `/storage/models/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
const storageRawFile = (id, name) => `${id}/${name}`;

function modelOwnerKey(model) {
  return accountKey(model?.uploadedBy);
}

function modelPermissions(user, model) {
  const userKey = accountKey(user?.name);
  const isOwner = Boolean(userKey && userKey === modelOwnerKey(model));
  return {
    isOwner,
    canEdit: !configuredOwnershipEditOnly || isOwner || configuredModelEditors.has(userKey),
    canDelete: configuredModelDeleters.has(userKey),
    canRegenerateThumbnail: configuredThumbnailRegenerators.has(userKey)
  };
}

function requireModelPermission(user, model, operation) {
  const permissions = modelPermissions(user, model);
  const allowed = operation === 'edit' ? permissions.canEdit
    : operation === 'delete' ? permissions.canDelete
      : operation === 'thumbnail' ? permissions.canRegenerateThumbnail
        : false;
  if (allowed) return permissions;
  const labels = {
    edit: 'měnit informace o tomto 3D modelu',
    delete: 'mazat 3D modely',
    thumbnail: 'přegenerovat náhledové obrázky'
  };
  const error = new Error(`Uživatel ${user?.name || 'bez relace'} nemá oprávnění ${labels[operation] || 'provést tuto operaci'}.`);
  error.status = 403;
  throw error;
}

function registryModelById(models, id) {
  return models.find((model) => model.id === String(id || ''));
}

function localModelAssetPath(value) {
  const requested = String(value || '');
  const parts = requested.split('/');
  if (!requested || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\0'))) return undefined;
  const filePath = path.resolve(modelsRoot, ...parts);
  const relative = path.relative(modelsRoot, filePath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
  return filePath;
}

async function sendProtectedModelFile(filePath, res, next, { root = realModelsRoot } = {}) {
  let realFilePath;
  try {
    realFilePath = await fs.realpath(filePath);
    const relative = path.relative(root, realFilePath);
    // Do not follow a symlink from a model folder into another part of the
    // server, even if somebody with filesystem access created one there.
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return res.sendStatus(404);
    const details = await fs.stat(realFilePath);
    if (!details.isFile()) return res.sendStatus(404);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return res.sendStatus(404);
    return next(error);
  }
  // A shared proxy must never retain a model response and replay it to a
  // visitor without the MediaWiki session that was checked above.
  res.set({
    'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0'
  });
  return res.sendFile(realFilePath, { dotfiles: 'deny' }, (error) => {
    if (!error || error.code === 'ECONNABORTED') return;
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      if (!res.headersSent) res.sendStatus(404);
      return;
    }
    next(error);
  });
}

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/[\r\n]+/g, ' ').slice(0, maxLength);
}

function thumbnailViewFromRequest(value) {
  if (!value?.useCurrentView) return null;
  const vector = (coordinates, length) => Array.isArray(coordinates)
    && coordinates.length === length
    && coordinates.every((coordinate) => Number.isFinite(Number(coordinate)))
    ? coordinates.map(Number)
    : null;
  const position = vector(value.camera?.position, 3);
  const target = vector(value.camera?.target, 3);
  const quaternion = vector(value.orientation?.quaternion, 4);
  if (!position || !target || !quaternion || quaternion.every((coordinate) => coordinate === 0)) {
    const error = new Error('Aktuální pohled modelu není platný.');
    error.status = 400;
    throw error;
  }
  return { camera: { position, target }, orientation: { quaternion } };
}

function duplicateModelTitleError(title) {
  const error = new Error(`Model s názvem „${title}“ již existuje. Zadejte jiný název.`);
  error.status = 409;
  return error;
}

function cleanPublicUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function requestOrigin(req) {
  const header = String(req.get('origin') || '').trim();
  if (!header) return '';
  try {
    return new URL(header).origin;
  } catch {
    return '';
  }
}

function isSameHostOrigin(origin, req) {
  if (!origin) return false;
  try {
    // The Host header names the public viewer even when a reverse proxy
    // forwards traffic to this Node process over plain HTTP.
    return new URL(origin).host.toLocaleLowerCase() === String(req.get('host') || '').toLocaleLowerCase();
  } catch {
    return false;
  }
}

function mediaWikiUserFromInfo(info) {
  const isAnonymous = !info
    // MediaWiki returns `anon: ""` for anonymous visitors. Its presence,
    // rather than its truthiness, is the reliable indicator.
    || Object.prototype.hasOwnProperty.call(info, 'anon')
    || !Number.isInteger(Number(info.id))
    || Number(info.id) <= 0;
  if (isAnonymous || !info.name) return null;
  return {
    name: String(info.name),
    groups: Array.isArray(info.groups) ? info.groups.map(String) : [],
    rights: Array.isArray(info.rights) ? info.rights.map(String) : []
  };
}

async function currentMediaWikiUser(req) {
  if (!configuredWikiApiUrl) {
    const error = new Error('Ochrana 3D souborů vyžaduje nastavenou adresu MediaWiki API.');
    error.status = 503;
    throw error;
  }
  if (!req.headers.cookie) return null;
  const result = await requestWiki(validateApiUrl(configuredWikiApiUrl), {
    action: 'query', meta: 'userinfo', uiprop: 'groups|rights', format: 'json'
  }, { cookie: String(req.headers.cookie) });
  return mediaWikiUserFromInfo(result.data?.query?.userinfo);
}

function requireTrustedWriteOrigin(req, res, next) {
  const origin = requestOrigin(req);
  if (origin && (isSameHostOrigin(origin, req) || trustedWriteOrigins.has(origin))) return next();
  return res.status(403).json({
    error: 'Zápisový požadavek musí přijít z důvěryhodného originu aplikace.'
  });
}

async function requireMediaWikiEditor(req, res, next) {
  if (!req.headers.cookie) {
    return res.status(401).json({ error: 'Pro zápis se přihlaste do MediaWiki. Relace MediaWiki musí být dostupná také pro 3D prohlížeč.' });
  }
  try {
    const user = await currentMediaWikiUser(req);
    if (!user || !user.rights.includes('edit')) {
      return res.status(403).json({ error: 'Zápis vyžaduje přihlášený účet MediaWiki s právem upravovat stránky.' });
    }
    req.mediaWikiUser = user;
    return next();
  } catch (error) {
    error.status ||= 503;
    return next(error);
  }
}

/**
 * Every model byte passes this guard. URLs remain stable for GLTF/OBJ
 * companion files, but copying one into a new tab no longer bypasses the
 * MediaWiki access policy.
 */
async function requireModelReadAccess(req, res, next) {
  if (!configuredModelAccessRequireLogin) return next();
  if (!req.headers.cookie) {
    return res.status(401).json({ error: 'Pro načtení 3D modelu se přihlaste do MediaWiki.' });
  }
  try {
    const user = await currentMediaWikiUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Pro načtení 3D modelu se přihlaste do MediaWiki.' });
    }
    if (!user.rights.includes('read')) {
      return res.status(403).json({ error: 'Váš účet MediaWiki nemá právo číst chráněné 3D modely.' });
    }
    const groups = new Set(user.groups.map((group) => group.toLocaleLowerCase('en-US')));
    if (configuredModelAccessGroups.size && ![...configuredModelAccessGroups].some((group) => groups.has(group))) {
      return res.status(403).json({ error: 'Váš účet MediaWiki nemá přístup do skupiny oprávněné k prohlížení 3D modelů.' });
    }
    req.mediaWikiUser = user;
    return next();
  } catch (error) {
    error.status ||= 503;
    return next(error);
  }
}

const rawModelExtensions = new Set(['.stl', '.obj', '.mtl', '.gltf', '.glb', '.bin']);

function isRawModelAssetRequest(req) {
  return rawModelExtensions.has(path.extname(String(req.path || '')).toLowerCase());
}

/**
 * This is deliberately a convenience barrier, not authentication. The browser
 * must still receive model bytes for Three.js to render them, so an informed
 * viewer can copy them from developer tools. It does, however, reject normal
 * navigation to a raw model URL while leaving FileLoader/XHR requests intact.
 */
function requireViewerModelRequest(req, res, next) {
  if (configuredModelAccessMode !== 'view-only' || !isRawModelAssetRequest(req)) return next();
  const destination = String(req.get('sec-fetch-dest') || '').toLowerCase();
  const mode = String(req.get('sec-fetch-mode') || '').toLowerCase();
  const viewerRequest = req.get('x-3d-viewer-request') === '1';
  if (viewerRequest || (destination === 'empty' && mode !== 'navigate')) return next();
  return res.status(403).json({
    error: 'Surový 3D soubor je v režimu pouze prohlížení dostupný jen pro 3D prohlížeč.'
  });
}

function limitWriteRate(req, res, next) {
  const now = Date.now();
  const key = req.mediaWikiUser?.name.toLocaleLowerCase();
  if (!key) return res.status(500).json({ error: 'Nelze určit uživatele pro omezení zápisů.' });
  const current = writeRateEntries.get(key);
  const entry = current && now - current.startedAt < writeRateWindowMs
    ? current
    : { startedAt: now, count: 0 };
  if (entry.count >= configuredWriteRateMaxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.startedAt + writeRateWindowMs - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({ error: `Byl dosažen limit ${configuredWriteRateMaxRequests} zápisů za ${configuredWriteRateWindowMinutes} minut. Zkuste to později.` });
  }
  entry.count += 1;
  writeRateEntries.set(key, entry);
  return next();
}

const protectWrite = [requireTrustedWriteOrigin, requireMediaWikiEditor, limitWriteRate];

app.get('/storage/models/*', requireViewerModelRequest, requireModelReadAccess, (req, res, next) => {
  const filePath = localModelAssetPath(req.params[0]);
  if (!filePath) return res.sendStatus(404);
  return sendProtectedModelFile(filePath, res, next);
});
// Do not let an old static URL expose the registry or any other storage file.
app.use('/storage', (_req, res) => res.sendStatus(404));

// This is only the original demonstration model, retained for the legacy
// demo. It uses the same access gate as uploaded models.
app.get('/demo-assets/Femur.stl', requireViewerModelRequest, requireModelReadAccess, (_req, res, next) => (
  sendProtectedModelFile(path.join(legacyDemoRoot, 'Femur.stl'), res, next, { root: realLegacyDemoRoot })
));
app.use('/demo-assets', (req, res, next) => {
  // The legacy demo keeps its HTML, scripts and styles public, but never let
  // Express static serve a differently cased or future model file around the
  // protected route above.
  if (/\.(?:stl|obj|mtl|gltf|glb)$/i.test(req.path)) return res.sendStatus(404);
  return next();
}, express.static(legacyDemoRoot));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, done) => {
      prepareUploadDirectory(req).then((directory) => done(null, directory), done);
    },
    filename: (_req, file, done) => done(null, fileName(file.originalname))
  }),
  limits: { fileSize: configuredMaxFileSizeBytes, files: configuredMaxFiles },
  fileFilter: (_req, file, done) => done(null, allowedExtensions.has(path.extname(file.originalname).toLowerCase()))
});

async function prepareUploadDirectory(req) {
  if (req.uploadDirectoryPromise) return req.uploadDirectoryPromise;
  req.uploadDirectoryPromise = (async () => {
    const title = cleanText(req.body?.title, 120);
    if (!title) throw new Error('Doplňte název modelu před výběrem souborů.');
    const id = cleanId(req.body.modelId || title);
    const models = await readRegistry();
    if (models.some((model) => model.id === id || cleanId(model.title) === cleanId(title))) {
      throw duplicateModelTitleError(title);
    }
    const directory = path.join(modelsRoot, id);
    try {
      // Never reuse a model directory. Reusing it would let a second upload
      // overwrite files that are already referenced from MediaWiki.
      await fs.mkdir(directory);
    } catch (error) {
      if (error.code === 'EEXIST') throw duplicateModelTitleError(title);
      throw error;
    }
    req.modelId = id;
    req.uploadDirectory = directory;
    req.uploadDirectoryCreated = true;
    return directory;
  })();
  return req.uploadDirectoryPromise;
}

async function removeFailedUpload(req) {
  if (!req.uploadDirectoryCreated || !req.uploadDirectory) return;
  await fs.rm(req.uploadDirectory, { recursive: true, force: true });
  req.uploadDirectoryCreated = false;
}

function receiveModelFiles(req, res, next) {
  upload.array('files', configuredMaxFiles)(req, res, async (error) => {
    if (!error) return next();
    try {
      await removeFailedUpload(req);
    } catch (cleanupError) {
      console.error('Nepodařilo se uklidit neúspěšné nahrání:', cleanupError);
    }
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        error.message = `Jeden soubor může mít nejvýše ${configuredMaxFileSizeMB} MB.`;
        error.status = 413;
      } else if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
        error.message = `Najednou lze nahrát nejvýše ${configuredMaxFiles} souborů.`;
        error.status = 400;
      }
    }
    next(error);
  });
}

app.get('/api/models', async (_req, res, next) => {
  try { res.json(await readRegistry()); } catch (error) { next(error); }
});

app.get('/api/models/permissions', requireMediaWikiEditor, async (req, res, next) => {
  try {
    const article = String(req.query.article || '').trim();
    const rawFile = String(req.query.file || '').trim();
    const model = (await readRegistry()).find((item) => item.wikiArticle === article
      || item.rawFile === rawFile
      || item.rawVariants?.original === rawFile);
    res.json({
      ...modelPermissions(req.mediaWikiUser, model),
      ...(model?.id ? { storageId: model.id } : {}),
      isRegistered: Boolean(model)
    });
  } catch (error) { next(error); }
});

// Only non-secret settings are exposed to the browser, so the same UI works locally and in production.
app.get('/api/wiki/config', (_req, res) => {
  res.json({
    endpoint: configuredWikiApiUrl,
    pagePrefix: configuredPagePrefix,
    categoryPage: configuredCategoryPage,
    modelStorageUrl: configuredStorageUrl,
    infoPageUrl: configuredInfoPageUrl || wikiIndexUrl(`${configuredPagePrefix || '3D'}:Prohlížeč`),
    loginUrl: configuredLoginUrl || wikiIndexUrl('Special:UserLogin'),
    isReadable: Boolean(configuredWikiApiUrl),
    isConfigured: Boolean(configuredWikiApiUrl && configuredBotUsername && configuredBotPassword),
    isBotConfigured: Boolean(configuredBotUsername && configuredBotPassword),
    modelAccess: {
      mode: configuredModelAccessMode,
      requireLogin: configuredModelAccessRequireLogin,
      restrictedToGroups: Boolean(configuredModelAccessGroups.size)
    },
    modelManagement: {
      requireOwnershipForEdits: configuredOwnershipEditOnly
    },
    branding: {
      headerText: configuredHeaderText,
      topbarBackgroundColor: configuredTopbarBackgroundColor,
      topbarTextColor: configuredTopbarTextColor
    },
    upload: {
      maxFileSizeBytes: configuredMaxFileSizeBytes,
      maxFiles: configuredMaxFiles,
      allowedExtensions: [...allowedExtensions]
    }
  });
});

app.post('/api/models', ...protectWrite, receiveModelFiles, async (req, res, next) => {
  try {
    const files = req.files || [];
    const primary = files.find((file) => ['.stl', '.obj', '.gltf', '.glb'].includes(path.extname(file.filename).toLowerCase()));
    if (!primary) {
      await removeFailedUpload(req);
      return res.status(400).json({ error: 'Vyberte soubor .stl, .obj, .gltf nebo .glb.' });
    }
    const models = await readRegistry();
    const id = req.modelId;
    const title = capitalizeTitle(cleanText(req.body.title, 120));
    if (!title) throw new Error('Doplňte název modelu.');
    if (models.some((model) => model.id === id || cleanId(model.title) === cleanId(title))) throw duplicateModelTitleError(title);
    const artifacts = await createModelArtifacts({
      sourcePath: primary.path,
      outputDirectory: path.join(modelsRoot, id),
      originalFile: primary.filename
    });
    const variants = Object.fromEntries(Object.entries(artifacts.variantFiles).map(([key, name]) => [key, storageFileUrl(id, name)]));
    const rawVariants = Object.fromEntries(Object.entries(artifacts.variantFiles).map(([key, name]) => [key, storageRawFile(id, name)]));
    const record = {
      id,
      title,
      description: String(req.body.description || ''),
      format: path.extname(primary.filename).slice(1).toUpperCase(),
      file: variants.original,
      files: files.map((file) => storageFileUrl(id, file.filename)),
      rawFile: rawVariants.original,
      rawFiles: files.map((file) => storageRawFile(id, file.filename)),
      variants,
      rawVariants,
      variantInfo: artifacts.variantInfo,
      thumbnail: storageFileUrl(id, artifacts.thumbnailFile),
      rawThumbnail: storageRawFile(id, artifacts.thumbnailFile),
      generation: artifacts.generation,
      license: cleanText(req.body.license, 160),
      author: cleanText(req.body.author, 160),
      origin: cleanText(req.body.origin, 300),
      sourceUrl: cleanPublicUrl(req.body.sourceUrl),
      appearance: DEFAULT_MODEL_APPEARANCE,
      categories: normalizeCategoryDefinitions([{ id: 'obecne', name: 'Obecné', description: '' }]),
      tags: [],
      uploadedBy: req.mediaWikiUser.name,
      createdAt: new Date().toISOString()
    };
    models.unshift(record);
    await writeRegistry(models);
    req.uploadDirectoryCreated = false;
    res.status(201).json(record);
  } catch (error) {
    try {
      await removeFailedUpload(req);
    } catch (cleanupError) {
      console.error('Nepodařilo se uklidit neúspěšné nahrání:', cleanupError);
    }
    next(error);
  }
});

app.put('/api/models/:id', ...protectWrite, async (req, res, next) => {
  try {
    const models = await readRegistry();
    const index = models.findIndex((model) => model.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Model nebyl nalezen.' });
    const current = models[index];
    requireModelPermission(req.mediaWikiUser, current, 'edit');
    const tags = Array.isArray(req.body.tags) ? req.body.tags.map((tag, tagIndex) => ({
      id: String(tag.id || `tag-${tagIndex + 1}`).slice(0, 100),
      title: String(tag.title || 'Nový štítek').slice(0, 160),
      category: String(tag.category || 'kosti').slice(0, 80),
      position: Array.isArray(tag.position) && tag.position.length === 3 ? tag.position.map(Number) : [0, 0, 0],
      normal: Array.isArray(tag.normal) && tag.normal.length === 3 ? tag.normal.map(Number) : [0, 0, 1],
      lineLength: Number.isFinite(Number(tag.lineLength)) ? Math.max(0.0001, Number(tag.lineLength)) : 1.5,
      description: String(tag.description || '').slice(0, 20000)
    })) : current.tags || [];
    const camera = req.body.camera && Array.isArray(req.body.camera.position) && Array.isArray(req.body.camera.target)
      ? { position: req.body.camera.position.slice(0, 3).map(Number), target: req.body.camera.target.slice(0, 3).map(Number) }
      : current.camera;
    const appearance = normalizeModelAppearance(req.body.appearance ?? current.appearance);
    const categories = Array.isArray(req.body.categories)
      ? normalizeCategoryDefinitions(req.body.categories)
      : current.categories || [];
    models[index] = {
      ...current,
      title: capitalizeTitle(String(req.body.title || current.title).slice(0, 120)),
      description: String(req.body.description ?? current.description ?? '').slice(0, 20000),
      wikiArticle: cleanText(req.body.wikiArticle ?? current.wikiArticle, 255),
      appearance,
      categories,
      tags,
      ...(camera ? { camera } : {}),
      updatedAt: new Date().toISOString()
    };
    await writeRegistry(models);
    res.json(models[index]);
  } catch (error) { next(error); }
});

app.get('/api/models/:id/permissions', requireMediaWikiEditor, async (req, res, next) => {
  try {
    const model = registryModelById(await readRegistry(), req.params.id);
    if (!model) return res.status(404).json({ error: 'Model nebyl nalezen v lokálním úložišti.' });
    res.json(modelPermissions(req.mediaWikiUser, model));
  } catch (error) { next(error); }
});

app.post('/api/models/:id/thumbnail', ...protectWrite, async (req, res, next) => {
  try {
    const models = await readRegistry();
    const index = models.findIndex((model) => model.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Model nebyl nalezen.' });
    const current = models[index];
    requireModelPermission(req.mediaWikiUser, current, 'thumbnail');
    const originalFile = current.rawVariants?.original || current.rawFile;
    const sourcePath = localStoredModelPath(originalFile);
    if (!sourcePath) throw new Error('Původní soubor modelu není v lokálním úložišti dostupný.');
    const thumbnailName = path.basename(String(current.rawThumbnail || 'thumbnail.svg'));
    const thumbnailPath = path.join(modelsRoot, current.id, thumbnailName);
    const temporaryPath = path.join(modelsRoot, current.id, `.thumbnail-${crypto.randomUUID()}.tmp`);
    let view = thumbnailViewFromRequest(req.body) || {};
    if (!view.camera && current.wikiArticle) {
      const wikitext = await readWikiWikitext(current.wikiArticle);
      if (wikitext === null) throw new Error('Definující článek 3D modelu nebyl nalezen.');
      const parsed = parseModel3dWikitext(wikitext);
      view = { camera: parsed.config.camera, orientation: parsed.config.orientation };
    }
    try {
      await regenerateModelThumbnail({ sourcePath, outputPath: temporaryPath, originalFile: path.basename(originalFile), ...view });
      await fs.rename(temporaryPath, thumbnailPath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
    const thumbnailUpdatedAt = new Date().toISOString();
    models[index] = { ...current, rawThumbnail: storageRawFile(current.id, thumbnailName), thumbnail: storageFileUrl(current.id, thumbnailName), thumbnailUpdatedAt };
    await writeRegistry(models);
    res.json({ thumbnail: `${storageFileUrl(current.id, thumbnailName)}?v=${encodeURIComponent(thumbnailUpdatedAt)}`, thumbnailUpdatedAt });
  } catch (error) { next(error); }
});

app.delete('/api/models/:id', ...protectWrite, async (req, res, next) => {
  try {
    const models = await readRegistry();
    const index = models.findIndex((model) => model.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Model nebyl nalezen.' });
    const current = models[index];
    requireModelPermission(req.mediaWikiUser, current, 'delete');
    if (current.wikiArticle) {
      if (!req.mediaWikiUser.rights.includes('delete')) {
        return res.status(403).json({ error: 'Smazání modelu vyžaduje také právo „delete“ v MediaWiki pro odstranění jeho definujícího článku.' });
      }
      const apiUrl = validateApiUrl(configuredWikiApiUrl);
      const csrf = await requestWiki(apiUrl, { action: 'query', meta: 'tokens', format: 'json' }, { cookie: String(req.headers.cookie || '') });
      await requestWiki(apiUrl, {
        action: 'delete',
        title: current.wikiArticle,
        reason: `Odstranění 3D modelu uživatelem ${req.mediaWikiUser.name}`,
        token: csrf.data.query?.tokens?.csrftoken,
        format: 'json'
      }, { cookie: csrf.cookie });
    }
    // The folder name is the registered model id; no user input is used for
    // the deletion target.
    await fs.rm(path.join(modelsRoot, current.id), { recursive: true, force: true });
    models.splice(index, 1);
    await writeRegistry(models);
    res.json({ deleted: true, id: current.id });
  } catch (error) { next(error); }
});

function validateApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    const error = new Error('Zadejte platnou URL MediaWiki API.');
    error.code = 'mediawiki-api-invalid';
    throw error;
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    const error = new Error('URL MediaWiki API musí používat HTTP nebo HTTPS.');
    error.code = 'mediawiki-api-invalid';
    throw error;
  }
  return url.toString();
}

function qualifyWikiTitle(value) {
  const title = String(value || '').trim().replace(/[\r\n]+/g, ' ');
  if (!title) throw new Error('Doplňte název článku.');
  if (!configuredPagePrefix) return capitalizeTitle(title);
  const prefix = `${configuredPagePrefix}:`;
  const leaf = title.toLocaleLowerCase('cs-CZ').startsWith(prefix.toLocaleLowerCase('cs-CZ'))
    ? title.slice(prefix.length)
    : title;
  return `${prefix}${capitalizeTitle(leaf)}`;
}

function resolveStoredModelFile(file) {
  const requested = String(file || '').trim();
  if (!requested) throw new Error('Konfigurace neuvádí 3D soubor.');
  if (/^https?:\/\//i.test(requested)) return requested;
  if (requested.startsWith('/')) return requested;
  const parts = requested.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('Cesta k 3D souboru není platná.');
  return `${configuredStorageUrl}/${parts.map(encodeURIComponent).join('/')}`;
}

function localStoredModelPath(file) {
  const requested = String(file || '').trim();
  if (!requested || /^https?:\/\//i.test(requested) || requested.startsWith('/')) return undefined;
  const parts = requested.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return undefined;
  return path.join(modelsRoot, ...parts);
}

async function localVariantInfo(variants = {}) {
  const info = await Promise.all(Object.entries(variants).map(async ([variant, file]) => {
    const filePath = localStoredModelPath(file);
    if (!filePath) return undefined;
    try {
      const { size } = await fs.stat(filePath);
      return [variant, { bytes: size }];
    } catch {
      return undefined;
    }
  }));
  return Object.fromEntries(info.filter(Boolean));
}

async function requestPublicWiki(parameters, { method = 'GET' } = {}) {
  const apiTarget = configuredWikiApiUrl;
  if (!apiTarget) throw new Error('Na serveru není nastavena adresa MediaWiki API.');
  const apiUrl = validateApiUrl(apiTarget);
  const request = method === 'POST'
    ? fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'MediaWiki-3D-editor/2.0' },
      body: new URLSearchParams({ format: 'json', ...parameters })
    })
    : fetch(`${apiUrl}${apiUrl.includes('?') ? '&' : '?'}${new URLSearchParams({ format: 'json', ...parameters })}`, {
      headers: { 'user-agent': 'MediaWiki-3D-editor/2.0' }
    });
  let response;
  try {
    response = await request;
  } catch (cause) {
    const error = new Error('K MediaWiki API se nelze připojit. Zkontrolujte adresu, spuštění wiki a síťové připojení.');
    error.code = 'mediawiki-unreachable';
    error.cause = cause;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = new Error(data.error?.info || 'MediaWiki API odpovědělo chybou.');
    error.code = data.error?.code || `mediawiki-http-${response.status}`;
    throw error;
  }
  return data;
}

async function readWikiWikitext(title) {
  const data = await requestPublicWiki({
    action: 'query',
    titles: title,
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main'
  });
  const page = Object.values(data.query?.pages || {})[0];
  if (!page || page.missing !== undefined) return null;
  // MediaWiki 1.41 returns the wikitext in slots.main['*']; newer API
  // responses use slots.main.content. Support both representations.
  return page.revisions?.[0]?.slots?.main?.content
    ?? page.revisions?.[0]?.slots?.main?.['*']
    ?? page.revisions?.[0]?.['*']
    ?? '';
}

async function expandedWikitext(source, title) {
  // Most 3D pages already contain the data block directly. Apart from being
  // faster, skipping expandtemplates here avoids a MediaWiki API edge case
  // where an empty preprocessor input is rejected as a missing `text` field.
  if (!String(source || '').trim()) return source;
  const expanded = await requestPublicWiki({ action: 'expandtemplates', text: source, title, prop: 'wikitext' }, { method: 'POST' });
  return expanded.expandtemplates?.wikitext ?? source;
}

async function wikiModelRecord(article, suppliedWikitext) {
  const wikitext = suppliedWikitext ?? await readWikiWikitext(article);
  if (wikitext === null) return null;
  const source = /<model3d(?:\s|>)/i.test(wikitext) ? wikitext : await expandedWikitext(wikitext, article);
  const parsed = parseModel3dWikitext(source);
  const rawVariants = parsed.config.variants;
  const variantInfo = await localVariantInfo(rawVariants);
  const rawFiles = [...new Set([parsed.file, ...parsed.config.files, ...Object.values(rawVariants)])];
  const registryModels = await readRegistry();
  const registryModel = registryModels.find((model) => model.wikiArticle === article
    || model.rawFile === parsed.file
    || model.rawVariants?.original === parsed.file);
  const titleWithoutNamespace = article.includes(':') ? article.slice(article.indexOf(':') + 1) : article;
  const primaryFile = resolveStoredModelFile(parsed.file);
  const thumbnailVersion = registryModel?.thumbnailUpdatedAt;
  return {
    id: `wiki-${cleanId(article)}`,
    source: 'wiki',
    article,
    title: capitalizeTitle(parsed.config.title || titleWithoutNamespace),
    description: parsed.config.description,
    format: path.extname(parsed.file).slice(1).toUpperCase() || 'GLB',
    file: primaryFile,
    rawFile: parsed.file,
    files: rawFiles.map(resolveStoredModelFile),
    rawFiles,
    ...(Object.keys(rawVariants).length ? { variants: Object.fromEntries(Object.entries(rawVariants).map(([key, file]) => [key, resolveStoredModelFile(file)])), rawVariants } : {}),
    ...(Object.keys(variantInfo).length ? { variantInfo } : {}),
    ...(parsed.config.thumbnail ? {
      thumbnail: `${resolveStoredModelFile(parsed.config.thumbnail)}${thumbnailVersion ? `?v=${encodeURIComponent(thumbnailVersion)}` : ''}`,
      rawThumbnail: parsed.config.thumbnail
    } : {}),
    ...parsed.config.metadata,
    ...(parsed.config.uploadedBy || registryModel?.uploadedBy ? { uploadedBy: parsed.config.uploadedBy || registryModel?.uploadedBy } : {}),
    ...(registryModel?.id ? { storageId: registryModel.id } : {}),
    appearance: parsed.config.appearance,
    categories: parsed.config.categories,
    tags: parsed.config.tags,
    ...(parsed.config.orientation ? { orientation: parsed.config.orientation } : {}),
    ...(parsed.config.camera ? { camera: parsed.config.camera } : {}),
    wikitext
  };
}

function configuredNamespaceName() {
  return configuredPagePrefix || '3D';
}

function namespaceFromSiteInfo(siteInfo) {
  const namespaceName = configuredNamespaceName();
  const entry = Object.entries(siteInfo.query?.namespaces || {}).find(([, namespace]) => {
    const labels = [namespace['*'], namespace.canonical].filter(Boolean).map((label) => String(label).toLocaleLowerCase('cs-CZ'));
    return labels.includes(namespaceName.toLocaleLowerCase('cs-CZ'));
  });
  if (!entry) {
    const error = new Error(`Jmenný prostor ${namespaceName}: nebyl v MediaWiki nalezen. Nastavte jej na cílové wiki nebo upravte mediaWiki.pagePrefix v LocalSettings.js.`);
    error.code = 'mediawiki-namespace-missing';
    throw error;
  }
  const [id, namespace] = entry;
  return { id: Number(id), name: namespace['*'] || namespace.canonical || namespaceName };
}

async function wikiNamespace() {
  const siteInfo = await requestPublicWiki({ action: 'query', meta: 'siteinfo', siprop: 'namespaces' });
  return namespaceFromSiteInfo(siteInfo);
}

async function wikiNamespaceId() {
  return (await wikiNamespace()).id;
}

async function wikiModelArticleTitles() {
  const namespace = await wikiNamespaceId();
  const titles = [];
  let continuation;
  do {
    const response = await requestPublicWiki({
      action: 'query',
      list: 'allpages',
      apnamespace: namespace,
      aplimit: 'max',
      apfilterredir: 'nonredirects',
      ...(continuation ? { apcontinue: continuation } : {})
    });
    titles.push(...(response.query?.allpages || []).map((page) => page.title).filter(Boolean));
    continuation = response.continue?.apcontinue;
  } while (continuation);
  return titles;
}

async function storedModelFiles(directory = modelsRoot, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return storedModelFiles(path.join(directory, entry.name), relativePath);
    return entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase()) ? [relativePath] : [];
  }));
  return files.flat();
}

function localStoragePath(value) {
  const file = String(value || '').trim();
  return file && !file.startsWith('/') && !/^https?:\/\//i.test(file) ? file : '';
}

function generatedVariantFromPath(file) {
  const match = path.posix.basename(file).match(/\.(small|low|medium)\.[^.]+$/i);
  if (!match) return '';
  return match[1].toLowerCase() === 'low' ? 'small' : match[1].toLowerCase();
}

function fileInventoryEntry(file, info = {}) {
  return {
    path: file,
    name: path.posix.basename(file),
    format: path.extname(file).slice(1).toUpperCase() || '3D',
    ...(Number.isFinite(info.bytes) ? { bytes: info.bytes } : {}),
    ...(Number.isFinite(info.triangles) ? { triangles: info.triangles } : {})
  };
}

async function storedModelFileDetails() {
  const files = await storedModelFiles();
  const details = await Promise.all(files.map(async (file) => {
    try {
      const { size } = await fs.stat(path.join(modelsRoot, ...file.split('/')));
      return [file, { bytes: size }];
    } catch {
      return [file, {}];
    }
  }));
  return new Map(details);
}

function fileGroupKey(file) {
  const directory = path.posix.dirname(file);
  return directory === '.' ? `file:${file}` : `folder:${directory}`;
}

function buildFileGroups({ storedDetails, registryModels, wikiModels }) {
  const groups = new Map();
  const sourceModels = [...registryModels, ...wikiModels];

  for (const model of sourceModels) {
    const rawVariants = model.rawVariants && typeof model.rawVariants === 'object' ? model.rawVariants : {};
    const originalPath = localStoragePath(rawVariants.original || model.rawFile);
    if (!originalPath) continue;
    const key = fileGroupKey(originalPath);
    const folder = path.posix.dirname(originalPath) === '.' ? '' : path.posix.dirname(originalPath);
    const group = groups.get(key) || {
      id: key,
      folder,
      title: model.title || path.posix.basename(originalPath),
      original: undefined,
      variants: [],
      additionalFiles: [],
      metadata: {},
      models: []
    };
    const variantInfo = model.variantInfo || {};
    const originalInfo = { ...storedDetails.get(originalPath), ...variantInfo.original };
    group.original = fileInventoryEntry(originalPath, originalInfo);
    if (!group.title || group.title === path.posix.basename(originalPath)) group.title = model.title || group.title;

    for (const keyName of ['description', 'license', 'author', 'origin', 'sourceUrl', 'createdAt', 'updatedAt']) {
      if (model[keyName] !== undefined && model[keyName] !== '') group.metadata[keyName] = model[keyName];
    }

    const knownFiles = new Set([originalPath]);
    for (const [variant, rawFile] of Object.entries(rawVariants)) {
      const file = localStoragePath(rawFile);
      if (!file || variant === 'original') continue;
      knownFiles.add(file);
      const entry = { variant: variant === 'low' ? 'small' : variant, ...fileInventoryEntry(file, { ...storedDetails.get(file), ...variantInfo[variant] }) };
      const index = group.variants.findIndex((item) => item.variant === entry.variant);
      if (index >= 0) group.variants[index] = entry;
      else group.variants.push(entry);
    }
    for (const rawFile of model.rawFiles || []) {
      const file = localStoragePath(rawFile);
      if (!file || knownFiles.has(file)) continue;
      const variant = generatedVariantFromPath(file);
      if (variant) {
        const entry = { variant, ...fileInventoryEntry(file, storedDetails.get(file)) };
        const index = group.variants.findIndex((item) => item.variant === variant);
        if (index >= 0) group.variants[index] = entry;
        else group.variants.push(entry);
      } else if (!group.additionalFiles.some((item) => item.path === file)) {
        group.additionalFiles.push(fileInventoryEntry(file, storedDetails.get(file)));
      }
    }
    groups.set(key, group);
  }

  // Keep old or manually copied files visible too. Their missing upload data is
  // intentional: only a defining 3D article can supply it.
  for (const [file, details] of storedDetails) {
    const key = fileGroupKey(file);
    const existing = groups.get(key);
    if (existing) {
      const alreadyListed = [existing.original, ...existing.variants, ...existing.additionalFiles].some((entry) => entry.path === file);
      if (!alreadyListed) {
        const variant = generatedVariantFromPath(file);
        if (variant && !existing.variants.some((entry) => entry.variant === variant)) {
          existing.variants.push({ variant, ...fileInventoryEntry(file, details) });
        } else {
          existing.additionalFiles.push(fileInventoryEntry(file, details));
        }
      }
      continue;
    }
    groups.set(key, {
      id: key,
      folder: path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file),
      title: path.posix.basename(file),
      original: fileInventoryEntry(file, details),
      variants: [],
      additionalFiles: [],
      metadata: {},
      models: []
    });
  }

  const variantOrder = { small: 0, medium: 1, original: 2 };
  return [...groups.values()].map((group) => {
    const usedPaths = new Set([group.original.path, ...group.variants.map((variant) => variant.path), ...group.additionalFiles.map((file) => file.path)]);
    group.variants.sort((left, right) => (variantOrder[left.variant] ?? 9) - (variantOrder[right.variant] ?? 9));
    group.models = wikiModels
      .filter((model) => model.rawFiles?.some((file) => usedPaths.has(file)))
      .map((model) => ({ id: model.id, article: model.article, title: model.title }));
    return group;
  }).sort((left, right) => `${left.folder}/${left.original.name}`.localeCompare(`${right.folder}/${right.original.name}`, 'cs-CZ'));
}

app.get('/api/wiki/model', async (req, res, next) => {
  try {
    const article = qualifyWikiTitle(req.query.title);
    const model = await wikiModelRecord(article);
    if (!model) return res.status(404).json({ error: `Článek ${article} nebyl nalezen.` });
    // The editor redirects to reading mode immediately after saving. This
    // response contains the current camera definition and must never be
    // served from an HTTP cache.
    res.set('Cache-Control', 'no-store').json(model);
  } catch (error) { next(error); }
});

app.get('/api/wiki/index', async (_req, res, next) => {
  try {
    // The physical file list is still useful when MediaWiki is briefly down.
    // Keep it available and report the article-index problem explicitly rather
    // than responding with a generic 500 / an apparently empty application.
    const storedDetails = await storedModelFileDetails();
    const storedFiles = [...storedDetails.keys()];
    let models = [];
    let indexError;
    try {
      const titles = await wikiModelArticleTitles();
      const parsedModels = await Promise.all(titles.map(async (article) => {
        try { return await wikiModelRecord(article); } catch { return undefined; }
      }));
      models = parsedModels.filter(Boolean);
    } catch (error) {
      indexError = error.message || 'Články ve jmenném prostoru 3D se nepodařilo načíst.';
    }
    const referencedFiles = models.flatMap((model) => model.rawFiles || []);
    const allFiles = [...new Set([...storedFiles, ...referencedFiles])].sort((left, right) => left.localeCompare(right, 'cs-CZ'));
    const files = allFiles.map((file) => ({
      id: file,
      path: file,
      name: path.basename(file),
      format: path.extname(file).slice(1).toUpperCase() || '3D',
      models: models.filter((model) => model.rawFiles?.includes(file)).map((model) => ({ id: model.id, article: model.article, title: model.title }))
    }));
    const registryModels = await readRegistry().catch(() => []);
    const fileGroups = buildFileGroups({ storedDetails, registryModels, wikiModels: models });
    res.json({ models: models.map(({ wikitext, ...model }) => model), files, fileGroups, ...(indexError ? { indexError } : {}) });
  } catch (error) { next(error); }
});

app.get('/api/wiki/categories', async (_req, res, next) => {
  try {
    const wikitext = await readWikiWikitext(configuredCategoryPage);
    if (wikitext === null) return res.json({ article: configuredCategoryPage, categories: [], wikitext: '' });
    const source = /<model3d-categories(?:\s|>)/i.test(wikitext) ? wikitext : await expandedWikitext(wikitext, configuredCategoryPage);
    const parsed = parseCategoryWikitext(source);
    res.json({ article: configuredCategoryPage, categories: parsed.categories, wikitext });
  } catch (error) { next(error); }
});

app.get('/api/wiki/status', async (_req, res) => {
  const issues = [];
  const namespace = { name: configuredNamespaceName(), exists: false };
  const botCredentials = {
    username: Boolean(configuredBotUsername),
    password: Boolean(configuredBotPassword)
  };

  if (!configuredWikiApiUrl) {
    issues.push({
      code: 'mediawiki-api-not-configured',
      severity: 'error',
      message: 'Není nastavena adresa MediaWiki API. Doplňte mediaWiki.apiUrl v LocalSettings.js.'
    });
  } else {
    try {
      validateApiUrl(configuredWikiApiUrl);
      const foundNamespace = await wikiNamespace();
      namespace.id = foundNamespace.id;
      namespace.name = foundNamespace.name;
      namespace.exists = true;
    } catch (error) {
      const isMissingNamespace = error.code === 'mediawiki-namespace-missing';
      issues.push({
        code: error.code || (isMissingNamespace ? 'mediawiki-namespace-missing' : 'mediawiki-connection-failed'),
        severity: 'error',
        message: error.message || 'Stav MediaWiki se nepodařilo ověřit.'
      });
    }
  }

  if (botCredentials.username !== botCredentials.password) {
    issues.push({
      code: 'mediawiki-bot-incomplete',
      severity: 'error',
      message: 'Nastavení bota je neúplné. V LocalSettings.js doplňte mediaWiki.botUsername i mediaWiki.botPassword, nebo obě hodnoty ponechte prázdné.'
    });
  } else if (!botCredentials.username) {
    issues.push({
      code: 'mediawiki-bot-not-configured',
      severity: 'warning',
      message: 'Bot není nastaven. Nahrávání stále funguje po přihlášení uživatele do MediaWiki, ale serverové publikování přes bota není k dispozici.'
    });
  }

  res.json({
    endpoint: configuredWikiApiUrl,
    namespace,
    bot: { configured: botCredentials.username && botCredentials.password },
    isReady: !issues.some((issue) => issue.severity === 'error'),
    issues
  });
});

async function requestWiki(url, body, { cookie = '', authorization = '' } = {}) {
  const headers = { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'MediaWiki-3D-editor/2.0' };
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;
  const response = await fetch(url, { method: 'POST', headers, body: new URLSearchParams(body) });
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie') || ''];
  const data = await response.json();
  if (!response.ok || data.error) {
    const error = new Error(data.error?.info || 'MediaWiki API odpovědělo chybou.');
    if (data.error?.code) error.code = data.error.code;
    throw error;
  }
  return { data, cookie: cookies.filter(Boolean).map((item) => item.split(';')[0]).join('; ') || cookie };
}

async function authorizeModelPublication(user, title, text) {
  if (title === configuredCategoryPage) return;
  const parsed = parseModel3dWikitext(text);
  const models = await readRegistry();
  const model = models.find((item) => item.wikiArticle === title
    || item.rawFile === parsed.file
    || item.rawVariants?.original === parsed.file
    || (cleanId(item.title) === cleanId(parsed.config.title) && item.id === cleanId(parsed.config.title)));
  if (!model) {
    if (!configuredOwnershipEditOnly || configuredModelEditors.has(accountKey(user?.name))) return;
    const error = new Error('Úpravy jsou povoleny jen pro 3D modely nahrané tímto prohlížečem.');
    error.status = 403;
    throw error;
  }
  requireModelPermission(user, model, 'edit');
  if (parsed.config.uploadedBy && model.uploadedBy && accountKey(parsed.config.uploadedBy) !== modelOwnerKey(model)) {
    const error = new Error('Vlastníka nahraného modelu nelze změnit v definici článku.');
    error.status = 400;
    throw error;
  }
}

/**
 * Same-origin bridge for a user's existing MediaWiki session. Cookies are
 * host-scoped (not port-scoped), so this makes localhost:3000 -> localhost:8000
 * work without relying on browser CORS. It deliberately permits only the three
 * operations required by the viewer, never arbitrary Action API calls.
 */
app.post('/api/wiki/session', requireTrustedWriteOrigin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const action = String(body.action || '');
    const isUserInfo = action === 'query' && body.meta === 'userinfo';
    const isCsrfToken = action === 'query' && body.meta === 'tokens';
    if (!isUserInfo && !isCsrfToken) return res.status(400).json({ error: 'Nepovolený požadavek uživatelské MediaWiki relace.' });
    const apiTarget = configuredWikiApiUrl;
    if (!apiTarget) return res.status(503).json({ error: 'Na serveru není nastavena adresa MediaWiki API.' });
    const result = await requestWiki(validateApiUrl(apiTarget), body, { cookie: String(req.headers.cookie || '') });
    res.json(result.data);
  } catch (error) { next(error); }
});

app.post('/api/wiki/publish', ...protectWrite, async (req, res, next) => {
  try {
    const { title: requestedTitle, text, summary = 'Aktualizace 3D modelu z 3D editoru', createOnly = false } = req.body;
    if (!configuredWikiApiUrl || !requestedTitle || !text) return res.status(400).json({ error: 'Chybí nastavená URL API, název stránky nebo obsah.' });
    const apiUrl = validateApiUrl(configuredWikiApiUrl);
    if (req.body.endpoint && validateApiUrl(req.body.endpoint) !== apiUrl) {
      return res.status(403).json({ error: 'Server může publikovat pouze do nakonfigurované MediaWiki.' });
    }
    const title = qualifyWikiTitle(requestedTitle);
    await authorizeModelPublication(req.mediaWikiUser, title, text);
    // Publish through the authenticated visitor's own MediaWiki session. This
    // preserves the author in page history and keeps the permission check on
    // this server authoritative; a configured bot is not needed for edits.
    const sessionCookie = String(req.headers.cookie || '');
    const csrf = await requestWiki(apiUrl, { action: 'query', meta: 'tokens', format: 'json' }, { cookie: sessionCookie });
    const edited = await requestWiki(apiUrl, {
      action: 'edit', title, text, summary, token: csrf.data.query.tokens.csrftoken, format: 'json',
      ...(createOnly ? { createonly: '1' } : {})
    }, { cookie: csrf.cookie });
    res.json({ ...edited.data, publishedTitle: title, user: req.mediaWikiUser });
  } catch (error) { next(error); }
});

if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  // Vite i Express musí sdílet jeden HTTP server. Jinak si Vite otevře
  // vlastní HMR WebSocket na nastaveném portu a následný app.listen skončí EADDRINUSE.
  const vite = await createServer({ server: { middlewareMode: true, hmr: { server: httpServer } }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.message || 'Neočekávaná chyba serveru.',
    ...(error.code ? { code: error.code } : {})
  });
});

/**
 * Port a chování při kolizi jsou nastavené v LocalSettings.js.
 */
function startServer(port, allowFallback = fallbackToNextPort) {
  const onListening = () => console.log(`3D editor běží na http://localhost:${port}`);
  const onError = (error) => {
    httpServer.off('listening', onListening);
    if (error.code === 'EADDRINUSE' && allowFallback && port < requestedPort + 10) {
      console.warn(`Port ${port} je obsazený, zkouším port ${port + 1}…`);
      startServer(port + 1, true);
      return;
    }
    console.error(`Server nelze spustit na portu ${port}: ${error.message}`);
    process.exitCode = 1;
  };
  httpServer.once('error', onError);
  httpServer.once('listening', onListening);
  httpServer.listen(port);
}

startServer(requestedPort);
