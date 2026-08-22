import './ui/styles.css';
import * as THREE from 'three';
import { AnnotationManager } from './annotations/annotation-manager.js';
import { escapeHtml } from './annotations/wikitext.js';
import { DEFAULT_MODEL_APPEARANCE, capitalizeTitle, categoryTagFromDefinitions, normalizeModelAppearance, replaceCategoryTag, replaceModel3dTag } from './api/model3d-format.js';
import { createModel3dTag, fetchWikiConfig, fetchWikiSessionUser, fetchWikiStatus, publishWithWikiSession } from './api/mediawiki.js';
import { deleteModel, fetchModelPermissions, fetchWikiCategories, fetchWikiIndex, fetchWikiModel, regenerateModelThumbnail, saveModel, uploadModel } from './api/models.js';
import { applyMaterialSettings, findMaterialFile, loadModel } from './core/loaders.js';
import { SceneManager } from './core/scene-manager.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderAboutPage } from './ui/about.js';
import { actionIconMarkup, brandMarkup, setBranding, settingsIconMarkup, wikiSessionIndicatorMarkup } from './ui/brand.js';
import { showCategoryDialog, showModelInfoDialog } from './ui/dialogs.js';
import { categoryDefinitions, renderSidebar } from './ui/sidebar.js';
import { renderTagDraftPanel, renderTagEditorPanel } from './ui/tag-draft-panel.js';
import { hidePersistentNotice, showPersistentNotice, showToast } from './ui/toast.js';

const app = document.querySelector('#app');
const defaultSettings = () => ({
  ...DEFAULT_MODEL_APPEARANCE,
  lod: 'original',
  loadStrategy: 'fixed',
  onDemandLod: 'medium',
  interfaceMode: 'simple',
  navigationMode: 'orbit',
  showNavigationCubeStandalone: true,
  showNavigationCubeEmbedded: false,
  embeddedLod: 'small',
  embeddedPanelMode: 'list',
  awaitingEmbeddedLoad: false,
  categories: new Set(),
  hiddenTags: new Set(),
  categoryDefinitions: [],
  loadedObjects: [],
  loadingStatus: 'Připravuji pracovní plochu…',
  editMode: false,
  canEdit: true,
  modelPermissions: { canEdit: false, canDelete: false, canRegenerateThumbnail: false },
  wikiDirty: false,
  defaultViewDirty: false,
  defaultOrientationDirty: false,
  rotationGizmoVisible: false,
  embedded: false
});

let models = [];
let storedFiles = [];
let wikiIndexProblem = '';
let categoryCatalog = { article: '', categories: [], wikitext: '' };
let currentModel;
let selectedTag;
let settings = defaultSettings();
let sceneManager;
let annotationManager;
let leaderKeyActive = false;
let ignoreNextClick = false;
let brushStroke = null;
let tagDraft;
let tagEditor;
let wikiConfig = {
  endpoint: '',
  pagePrefix: '',
  isConfigured: false,
  isReadable: false,
  modelAccess: { mode: 'login-required', requireLogin: true, restrictedToGroups: false },
  modelManagement: { requireOwnershipForEdits: false },
  // These values keep the upload guidance useful until the server
  // configuration is loaded. A successful API response always replaces them.
  upload: { maxFileSizeBytes: 50 * 1024 * 1024, maxFiles: 5, allowedExtensions: ['.stl', '.obj', '.mtl', '.gltf', '.glb'] },
  branding: { headerText: '3D prohlížeč', topbarBackgroundColor: '#ffbe00', topbarTextColor: '#202122' }
};
let wikiStatus = { issues: [] };
let wikiSessionUser = null;
let loadRequestId = 0;
let modelRevision = 0;
let defaultViewRevision = 0;
let defaultOrientationRevision = 0;
let wikiSaveInFlight = false;
const deviceSettingsKey = 'wikiskripta-3d-load-settings';
const tagDraftStoragePrefix = 'wikiskripta-3d:tag-draft:';

function applicationName() {
  return wikiConfig.branding?.headerText || '3D prohlížeč';
}

function applyBranding(branding = {}) {
  const background = branding.topbarBackgroundColor || '#ffbe00';
  const text = branding.topbarTextColor || '#202122';
  document.documentElement.style.setProperty('--topbar-background-color', background);
  document.documentElement.style.setProperty('--topbar-text-color', text);
  setBranding(branding);
}

function readDeviceSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(deviceSettingsKey) || '{}');
    // Previous releases had one shared switch. Keep it for the standalone
    // viewer, while new embedded viewers use their intentionally quieter
    // default unless the visitor explicitly opts in.
    const legacyNavigationCube = typeof saved.showNavigationCube === 'boolean'
      ? saved.showNavigationCube
      : undefined;
    return {
      loadStrategy: ['fixed', 'progressive', 'on-demand'].includes(saved.loadStrategy) ? saved.loadStrategy : 'fixed',
      lod: ['small', 'low', 'medium', 'original'].includes(saved.lod) ? saved.lod : 'original',
      onDemandLod: ['small', 'low', 'medium'].includes(saved.onDemandLod) ? saved.onDemandLod : 'medium',
      interfaceMode: saved.interfaceMode === 'advanced' ? 'advanced' : 'simple',
      navigationMode: ['orbit', 'turntable', 'trackball'].includes(saved.navigationMode) ? saved.navigationMode : 'orbit',
      showNavigationCubeStandalone: typeof saved.showNavigationCubeStandalone === 'boolean'
        ? saved.showNavigationCubeStandalone
        : legacyNavigationCube ?? true,
      showNavigationCubeEmbedded: typeof saved.showNavigationCubeEmbedded === 'boolean'
        ? saved.showNavigationCubeEmbedded
        : false
    };
  } catch {
    return {};
  }
}

function saveDeviceSettings() {
  try {
    localStorage.setItem(deviceSettingsKey, JSON.stringify({
      loadStrategy: settings.loadStrategy,
      lod: settings.lod,
      onDemandLod: settings.onDemandLod,
      interfaceMode: settings.interfaceMode,
      navigationMode: settings.navigationMode,
      showNavigationCubeStandalone: settings.showNavigationCubeStandalone,
      showNavigationCubeEmbedded: settings.showNavigationCubeEmbedded
    }));
  } catch {
    // A privacy-restricted browser may deny local storage; loading still works for this session.
  }
}

function loadModelAppearance(model) {
  const appearance = normalizeModelAppearance(model?.appearance);
  if (model) model.appearance = appearance;
  Object.assign(settings, appearance);
}

function normalizedLod(lod) {
  return lod === 'low' ? 'small' : ['small', 'medium', 'original'].includes(lod) ? lod : 'original';
}

function hasGeneratedVariants(model) {
  return Boolean(model?.variants?.medium && (model.variants?.small || model.variants?.low));
}

function fileForLod(model, lod) {
  const selected = normalizedLod(lod);
  if (selected === 'small') return model.variants?.small || model.variants?.low || model.file;
  if (selected === 'medium') return model.variants?.medium || model.file;
  return model.variants?.original || model.file;
}

function lodLabel(lod) {
  return ({ small: 'malá varianta (S)', medium: 'střední varianta (M)', original: 'originál' })[normalizedLod(lod)] || 'model';
}

function isWikiModel(model = currentModel) {
  return model?.source === 'wiki';
}

function modelArticleTitle(value) {
  const requested = String(value || '').trim();
  const prefix = String(wikiConfig.pagePrefix || '3D').trim().replace(/:+$/, '');
  const leaf = prefix && requested.toLocaleLowerCase('cs-CZ').startsWith(`${prefix}:`.toLocaleLowerCase('cs-CZ'))
    ? requested.slice(prefix.length + 1)
    : requested;
  const title = capitalizeTitle(leaf);
  if (!title || !prefix) return title;
  return `${prefix}:${title}`;
}

function wikiArticleUrl(title) {
  if (!title || !wikiConfig.endpoint) return '';
  try {
    const url = new URL(wikiConfig.endpoint);
    url.pathname = url.pathname.replace(/api\.php$/, 'index.php');
    url.search = '';
    url.searchParams.set('title', title);
    return url.toString();
  } catch {
    return '';
  }
}

function wikiDefinitionUrl(model = currentModel) {
  if (!isWikiModel(model) || !model?.article) return '';
  return wikiArticleUrl(model.article);
}

function wikiUserPageUrl(user = wikiSessionUser) {
  if (!user?.name || !wikiConfig.endpoint) return '';
  try {
    const url = new URL(wikiConfig.endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.pathname = url.pathname.replace(/api\.php$/, 'index.php');
    url.search = '';
    url.searchParams.set('title', `User:${user.name}`);
    return url.toString();
  } catch {
    return '';
  }
}

function normalizedModelName(value) {
  const prefix = String(wikiConfig.pagePrefix || '3D').trim().replace(/:+$/, '');
  const title = String(value || '').trim().replace(/_/g, ' ').replace(/\s+/g, ' ').normalize('NFC');
  const withoutPrefix = prefix && title.toLocaleLowerCase('cs-CZ').startsWith(`${prefix}:`.toLocaleLowerCase('cs-CZ'))
    ? title.slice(prefix.length + 1).trim()
    : title;
  return withoutPrefix.toLocaleLowerCase('cs-CZ');
}

function duplicateModelTitleError(title) {
  const error = new Error(`Model s názvem „${title}“ již existuje. Zadejte prosím jiný název.`);
  error.field = 'title';
  return error;
}

function existingModelWithTitle(title) {
  const normalizedTitle = normalizedModelName(title);
  return models.find((model) => (
    normalizedModelName(model.title) === normalizedTitle
    || normalizedModelName(model.article) === normalizedTitle
  ));
}

function urlParams() {
  return new URLSearchParams(window.location.search);
}

function isWikiEditRoute() {
  return urlParams().get('edit') === '1';
}

function isEmbeddedMode() {
  return urlParams().get('embed') === '1';
}

function embeddedLodFromUrl() {
  const value = String(urlParams().get('variant') || urlParams().get('varianta') || urlParams().get('zobrazeni') || 'small')
    .toLocaleLowerCase('cs-CZ').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (['medium', 'm', 'stredni'].includes(value)) return 'medium';
  if (['original', 'orig', 'o', 'puvodni'].includes(value)) return 'original';
  return 'small';
}

function embeddedAwaitLoadFromUrl() {
  const value = String(urlParams().get('awaitLoad') || urlParams().get('await-load') || '1')
    .toLocaleLowerCase('cs-CZ').trim();
  return !['0', 'false', 'ne', 'no', 'off', 'vypnuto'].includes(value);
}

function standaloneViewerUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('embed');
  url.searchParams.delete('edit');
  url.searchParams.delete('variant');
  url.searchParams.delete('varianta');
  url.searchParams.delete('zobrazeni');
  url.searchParams.delete('awaitLoad');
  url.searchParams.delete('await-load');
  return url.toString();
}

function returnToArticleUrl() {
  const returnTo = urlParams().get('returnTo');
  if (!returnTo) return null;
  try {
    const target = new URL(returnTo, window.location.href);
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('unsupported');
    return target.toString();
  } catch {
    return null;
  }
}

function currentCategoryDefinitions() {
  // Categories are authored centrally in 3D:Kategorie. Model-local
  // definitions remain as a migration fallback for articles created before
  // the shared catalogue was introduced.
  return categoryDefinitions([
    ...(categoryCatalog.categories || []),
    ...(currentModel?.categories || [])
  ], currentModel?.tags || []);
}

function ensureModelCategories(model = currentModel) {
  if (!model) return [];
  return categoryDefinitions([
    ...(categoryCatalog.categories || []),
    ...(model.categories || [])
  ], model.tags || []);
}

function renderError(error) {
  app.innerHTML = `<main class="error-page"><h1>Nepodařilo se otevřít prohlížeč</h1><p>${error.message}</p><button class="button button-primary" id="retry">${actionIconMarkup('refresh')}Zkusit znovu</button></main>`;
  app.querySelector('#retry').addEventListener('click', initialize);
}

function updateWikiSessionIndicators() {
  document.querySelectorAll('[data-wiki-session-indicator]').forEach((indicator) => {
    indicator.outerHTML = wikiSessionIndicatorMarkup(wikiSessionUser, { userPageUrl: wikiUserPageUrl(), loginUrl: wikiConfig.loginUrl });
  });
}

async function refreshWikiSessionUser() {
  if (!wikiConfig.isReadable || !wikiConfig.endpoint) {
    wikiSessionUser = null;
    updateWikiSessionIndicators();
    return null;
  }
  try {
    wikiSessionUser = await fetchWikiSessionUser(wikiConfig.endpoint);
  } catch {
    // A temporary connection problem must not turn an existing UI into a
    // false signed-in state.
    wikiSessionUser = null;
  }
  updateWikiSessionIndicators();
  return wikiSessionUser;
}

async function addHubManagementPermissions(modelList) {
  if (!wikiSessionUser?.rights?.includes('edit')) return modelList;
  const permissions = await Promise.all(modelList.map(async (model) => {
    try {
      return await fetchModelPermissions({ storageId: model.storageId, article: model.article, rawFile: model.rawFile });
    } catch {
      return undefined;
    }
  }));
  return modelList.map((model, index) => ({
    ...model,
    ...(permissions[index] ? {
      storageId: permissions[index].storageId || model.storageId,
      managementPermissions: permissions[index]
    } : {})
  }));
}

async function initialize() {
  try {
    wikiIndexProblem = '';
    const [loadedConfig, loadedStatus] = await Promise.all([
      fetchWikiConfig().catch(() => wikiConfig),
      fetchWikiStatus().catch((error) => ({
        issues: [{
          code: 'mediawiki-status-unavailable',
          severity: 'error',
          message: `Stav připojení k MediaWiki se nepodařilo ověřit: ${error.message}`
        }]
      }))
    ]);
    wikiConfig = loadedConfig;
    applyBranding(wikiConfig.branding);
    wikiStatus = loadedStatus;
    await refreshWikiSessionUser();
    if (wikiConfig.isReadable) {
      const [wikiIndex, categoryResponse] = await Promise.all([
        fetchWikiIndex().catch((error) => ({ models: [], files: [], error })),
        fetchWikiCategories().catch(() => ({ article: wikiConfig.categoryPage || '', categories: [], wikitext: '' }))
      ]);
      models = Array.isArray(wikiIndex?.models) ? wikiIndex.models : [];
      models = await addHubManagementPermissions(models);
      storedFiles = Array.isArray(wikiIndex?.fileGroups) ? wikiIndex.fileGroups : (Array.isArray(wikiIndex?.files) ? wikiIndex.files : []);
      categoryCatalog = {
        article: String(categoryResponse?.article || wikiConfig.categoryPage || ''),
        categories: Array.isArray(categoryResponse?.categories) ? categoryResponse.categories : [],
        wikitext: String(categoryResponse?.wikitext || '')
      };
      wikiIndexProblem = String(wikiIndex?.indexError || wikiIndex?.error?.message || '');
      if (wikiIndexProblem) {
        showToast(`Seznam modelů se zatím nepodařilo načíst: ${wikiIndexProblem}`, 'error');
      }
    }
    renderHub({ clearHash: false });
    await openFromLocation();
  } catch (error) {
    renderError(error);
  }
}

function renderHub({ clearHash = true } = {}) {
  destroyViewer();
  document.title = `${applicationName()} – 3D modely`;
  currentModel = undefined;
  selectedTag = undefined;
  tagDraft = undefined;
  if (clearHash) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    history.pushState(null, '', url);
  }
  renderDashboard(app, models, {
    files: storedFiles,
    indexProblem: wikiIndexProblem,
    wikiStatus,
    upload: wikiConfig.upload,
    modelAccess: wikiConfig.modelAccess,
    wikiSessionUser,
    wikiSessionUserUrl: wikiUserPageUrl(),
    wikiSessionLoginUrl: wikiConfig.loginUrl,
    onOpen: (id) => openIndexedWikiModel(models.find((model) => model.id === id)),
    onOpenInNewTab: (id) => {
      const model = models.find((item) => item.id === id);
      if (!model?.article) return;
      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('article', model.article);
      url.hash = '';
      window.open(url.toString(), '_blank', 'noopener');
    },
    onAbout: renderAbout,
    onSettings: renderUserSettingsPage,
    onEditModel: (modelId) => {
      const model = models.find((item) => item.id === modelId);
      openModelInfoEditor(model).catch((error) => showToast(error.message, 'error'));
    },
    onRegenerateThumbnail: async (modelId) => {
      const model = models.find((item) => item.id === modelId);
      if (!model?.storageId) return;
      const result = await regenerateModelThumbnail(model.storageId);
      model.thumbnail = result.thumbnail;
      renderHub({ clearHash: false });
      showToast(`Náhled modelu „${model.title}“ byl přegenerován.`);
    },
    onDeleteModel: async (modelId) => {
      const model = models.find((item) => item.id === modelId);
      if (!model?.storageId) return;
      if (!window.confirm(`Opravdu odstranit model „${model.title}“ včetně jeho souborů a článku ${model.article || '3D'}?`)) return;
      await deleteModel(model.storageId);
      await initialize();
      showToast(`Model „${model.title}“ byl odstraněn.`);
    },
    onUpload: async (formData) => {
      if (!wikiConfig.isReadable) throw new Error('Pro nahrání modelu je třeba připojit MediaWiki a vytvořit článek ve jmenném prostoru 3D.');
      const title = capitalizeTitle(formData.get('title'));
      formData.set('title', title);
      if (existingModelWithTitle(title)) throw duplicateModelTitleError(title);
      const user = await fetchWikiSessionUser(wikiConfig.endpoint);
      if (!user || !user.rights.includes('edit')) {
        if (wikiConfig.loginUrl) window.open(wikiConfig.loginUrl, '_blank', 'noopener');
        throw new Error('Před nahráním modelu se přihlaste do MediaWiki účtem s právem upravovat články 3D.');
      }
      const model = await uploadModel(formData);
      const modelArticle = modelArticleTitle(model.title);
      ensureModelCategories(model);
      // A new model has no stored camera yet. SceneManager fits it from its
      // actual bounds on first open, rather than using a fixed world distance.
      const parserTag = createModel3dTag(model);
      try {
        await publishWithWikiSession({
          endpoint: wikiConfig.endpoint,
          title: modelArticle,
          text: parserTag,
          summary: 'Vytvoření definice 3D modelu po nahrání',
          createOnly: true
        });
      } catch (error) {
        if (error.code === 'articleexists') throw duplicateModelTitleError(title);
        throw error;
      }
      try {
        await saveModel({ ...model, wikiArticle: modelArticle });
      } catch (error) {
        showToast(`Model je vytvořen v ${modelArticle}, ale nepodařilo se uložit jeho lokální vazbu: ${error.message}`, 'error');
      }
      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('article', modelArticle);
      url.searchParams.set('edit', '1');
      url.hash = '';
      window.location.assign(url);
    }
  });
}

async function openIndexedWikiModel(model, tagId) {
  if (!model?.article) return;
  try {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('article', model.article);
    url.hash = '';
    history.pushState(null, '', url);
    return await openModel(await fetchWikiModel(model.article), tagId);
  } catch (error) {
    showToast(`Model ${model.title} se nepodařilo načíst: ${error.message}`, 'error');
  }
}

function renderAbout({ updateLocation = true } = {}) {
  destroyViewer();
  document.title = `O 3D prohlížeči | ${applicationName()}`;
  currentModel = undefined;
  selectedTag = undefined;
  tagDraft = undefined;
  if (updateLocation) history.pushState(null, '', '#page=about');
  renderAboutPage(app, { onHome: () => renderHub(), onSettings: renderUserSettingsPage, wikiSessionUser, wikiSessionUserUrl: wikiUserPageUrl(), wikiSessionLoginUrl: wikiConfig.loginUrl });
}

function viewerMarkup() {
  document.title = `${currentModel?.title || '3D prohlížeč'} | ${applicationName()}`;
  const embedded = isEmbeddedMode();
  const returnTo = embedded ? null : returnToArticleUrl();
  const wiki = isWikiModel();
  const embedGate = embedded && settings.awaitingEmbeddedLoad ? `
    <div class="embed-load-gate" data-embed-load-gate>
      <div><p class="eyebrow">3D prohlížeč</p><h1>${escapeHtml(currentModel?.title || '3D model')}</h1><button type="button" class="button button-primary" data-action="load-embedded-model">${actionIconMarkup('upload')}Načíst</button><p class="embed-load-note">Plný prohlížeč otevřete tlačítkem „Otevřít“ vlevo nahoře.</p></div>
    </div>` : '';
  const modeControl = !embedded && wiki ? `
    <nav class="mode-switch" aria-label="Režim stránky">
      <span class="mode-switch-label">Režim</span>
      <button type="button" class="mode-tab ${settings.canEdit ? '' : 'is-active'}" ${settings.canEdit ? 'data-action="mode-toggle" data-mode="read"' : ''}>Čtení</button>
      <button type="button" class="mode-tab ${settings.canEdit ? 'is-active' : ''}" ${settings.canEdit ? '' : 'data-action="mode-toggle" data-mode="edit"'}>Úpravy</button>
      ${settings.canEdit ? `<button type="button" class="topbar-save" data-action="wiki-save" title="Uložit">${actionIconMarkup('save')}ULOŽIT</button>` : ''}
    </nav>` : '';
  const topbarActions = embedded ? '' : `<nav class="topbar-actions"><button type="button" class="topbar-link" data-action="about">O 3D prohlížeči</button><button type="button" class="topbar-icon" data-action="user-settings" aria-label="Uživatelské nastavení" title="Uživatelské nastavení">${settingsIconMarkup()}</button>${wikiSessionIndicatorMarkup(wikiSessionUser, { userPageUrl: wikiUserPageUrl(), loginUrl: wikiConfig.loginUrl })}</nav>`;
  const toolbarActions = embedded
    ? `<a class="toolbar-button toolbar-link" href="${standaloneViewerUrl()}" target="_blank" rel="noopener noreferrer" title="Otevřít plnohodnotný prohlížeč"><span class="toolbar-logo" aria-hidden="true"></span>${actionIconMarkup('open')}Otevřít</a>`
    : '';
  const viewportToolbar = toolbarActions ? `<div class="viewport-toolbar">${toolbarActions}</div>` : '';
  const navigationCube = `<div class="navigation-cube" role="group" aria-label="Navigační kostka: rychlé nastavení směru pohledu">
    <div class="navigation-cube-main"><button type="button" class="navigation-cube-face navigation-cube-top" data-nav-face="top" aria-label="Pohled shora" title="Pohled shora">Shora</button><button type="button" class="navigation-cube-face navigation-cube-front" data-nav-face="front" aria-label="Pohled zepředu" title="Pohled zepředu">Zepředu</button><button type="button" class="navigation-cube-face navigation-cube-right" data-nav-face="right" aria-label="Pohled zprava" title="Pohled zprava">Zprava</button><div class="navigation-cube-opposites"><button type="button" class="navigation-cube-bottom" data-nav-face="bottom" aria-label="Pohled zdola" title="Pohled zdola">Zdola</button><button type="button" class="navigation-cube-left" data-nav-face="left" aria-label="Pohled zleva" title="Pohled zleva">Zleva</button><button type="button" class="navigation-cube-back" data-nav-face="back" aria-label="Pohled zezadu" title="Pohled zezadu">Zezadu</button></div></div>
    <button type="button" class="navigation-cube-reset" data-nav-reset aria-label="Resetovat polohu pohledu" title="Resetovat polohu pohledu">${actionIconMarkup('refresh')}Reset polohy</button>
  </div>`;
  const footerContent = `${embedded ? `<button class="footer-link" data-action="about">${actionIconMarkup('info')}O 3D prohlížeči</button>` : ''}${wikiSessionUser ? '' : '<span>Pro úpravy se přihlaste do MediaWiki.</span>'}${returnTo ? `<a class="footer-link" href="${escapeHtml(returnTo)}">${actionIconMarkup('back')}Zpět na článek</a>` : ''}`;
  app.innerHTML = `
    <main class="viewer ${embedded ? 'is-embedded' : ''} ${settings.awaitingEmbeddedLoad ? 'is-awaiting-load' : ''}">
      <header class="wiki-topbar">${brandMarkup({ interactive: true })}${modeControl}${topbarActions}</header>
      <div class="viewer-body"><section class="viewport">
          ${viewportToolbar}
          ${(embedded ? settings.showNavigationCubeEmbedded : settings.showNavigationCubeStandalone) ? navigationCube : ''}
          <div id="canvas"></div><div id="annotation-layer" aria-label="Štítky modelu"></div><div id="tag-draft-host"></div>
          ${embedGate}
        </section>
        <div id="sidebar-host"></div></div>
      ${footerContent ? `<footer class="viewer-footer">${footerContent}</footer>` : ''}
    </main>`;
}

async function openModel(model, tagId, lod = 'original') {
  if (!model) return;
  if (wikiConfig.modelAccess?.requireLogin && !wikiSessionUser) {
    throw new Error('Modely jsou chráněné. Přihlaste se do MediaWiki a potom stránku obnovte.');
  }
  destroyViewer();
  currentModel = model;
  currentModel.title = capitalizeTitle(currentModel.title);
  ensureModelCategories(currentModel);
  selectedTag = undefined;
  tagDraft = undefined;
  modelRevision = 0;
  defaultViewRevision = 0;
  defaultOrientationRevision = 0;
  settings = { ...defaultSettings(), ...readDeviceSettings() };
  loadModelAppearance(currentModel);
  if (lod !== 'original') {
    settings.loadStrategy = 'fixed';
    settings.lod = normalizedLod(lod);
  }
  settings.embedded = isEmbeddedMode();
  settings.embeddedLod = embeddedLodFromUrl();
  settings.awaitingEmbeddedLoad = settings.embedded && embeddedAwaitLoadFromUrl();
  if (settings.embedded) settings.lod = settings.embeddedLod;
  settings.categories = new Set((model.tags || []).map((tag) => tag.category));
  settings.categoryDefinitions = currentCategoryDefinitions();
  if (isWikiModel(model)) {
    settings.canEdit = false;
    if (!settings.embedded && isWikiEditRoute()) {
      try {
        wikiSessionUser = await fetchWikiSessionUser(wikiConfig.endpoint);
        if (!wikiSessionUser || !wikiSessionUser.rights.includes('edit')) {
          showToast('Režim úprav vyžaduje přihlášený účet MediaWiki s právem upravovat stránky.', 'error');
        } else {
          // The default policy intentionally mirrors pre-ownership releases:
          // a MediaWiki editor can edit every model. The optional permissions
          // lookup only becomes an editing gate in strict owner-only mode.
          settings.canEdit = true;
          try {
            settings.modelPermissions = await fetchModelPermissions({ storageId: model.storageId, article: model.article, rawFile: model.rawFile });
            if (settings.modelPermissions.storageId) model.storageId = settings.modelPermissions.storageId;
            if (wikiConfig.modelManagement?.requireOwnershipForEdits) {
              settings.canEdit = settings.modelPermissions.canEdit;
              if (!settings.canEdit) showToast('Váš účet nemá pro tento model povolené úpravy.', 'error');
            }
          } catch (error) {
            if (wikiConfig.modelManagement?.requireOwnershipForEdits) throw error;
            // The auxiliary management check must not lock out a normal
            // editor when upgrading an older server or an old model record.
          }
        }
      } catch (error) {
        showToast(`Nelze ověřit přihlášení MediaWiki: ${error.message}`, 'error');
      }
    }
    if (!settings.embedded && !isWikiEditRoute()) {
      fetchModelPermissions({ storageId: model.storageId, article: model.article, rawFile: model.rawFile }).then((permissions) => {
        if (currentModel !== model) return;
        settings.modelPermissions = permissions;
        if (permissions.storageId) model.storageId = permissions.storageId;
        renderCurrentSidebar();
      }).catch(() => {});
    }
  }
  restoreTagDraft();
  viewerMarkup();
  const canvas = document.querySelector('#canvas');
  const labelLayer = document.querySelector('#annotation-layer');
  sceneManager = new SceneManager(canvas, (camera) => annotationManager?.update(camera));
  sceneManager.setNavigationMode(settings.navigationMode);
  applySceneBackground();
  annotationManager = new AnnotationManager(sceneManager, labelLayer, {
    onSelect: (tag) => {
      selectedTag = tag;
      renderCurrentSidebar();
      updateHash();
    },
    onChange: (_tag, { transient }) => {
      if (!transient) {
        if (tagEditor?.tag === _tag) {
          tagEditor.draft.lineLength = _tag.lineLength;
          renderTagDraft();
        }
        persistModel();
        renderCurrentSidebar();
      }
    }
  });
  renderTagDraft();
  if (tagDraft) updateTagDraftNotice();
  attachViewportInteractions();
  document.querySelectorAll('[data-nav-face]').forEach((button) => button.addEventListener('click', () => {
    sceneManager.snapToFace(button.dataset.navFace);
  }));
  document.querySelector('[data-nav-reset]')?.addEventListener('click', () => handleSidebarAction('reset'));
  document.querySelector('[data-action="wiki-save"]')?.addEventListener('click', saveWikiModel);
  document.querySelectorAll('[data-action="mode-toggle"]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.mode === 'read') exitWikiEdit();
    else requestWikiEdit();
  }));
  document.querySelector('[data-action="home"]').addEventListener('click', () => renderHub());
  document.querySelector('[data-action="about"]').addEventListener('click', renderAbout);
  document.querySelector('[data-action="user-settings"]')?.addEventListener('click', () => {
    renderUserSettingsPage();
  });
  document.querySelector('[data-action="load-embedded-model"]')?.addEventListener('click', () => {
    settings.awaitingEmbeddedLoad = false;
    document.querySelector('.viewer')?.classList.remove('is-awaiting-load');
    document.querySelector('[data-embed-load-gate]')?.remove();
    startModelLoading(currentModel, selectedTag?.id);
  });
  renderCurrentSidebar();

  return startModelLoading(model, tagId);
}

async function startModelLoading(model, tagId) {
  const requestId = ++loadRequestId;
  if (settings.embedded && settings.awaitingEmbeddedLoad) return false;
  if (!hasGeneratedVariants(model)) return loadCurrentModel(model, tagId, 'original', { requestId });
  if (settings.embedded) return loadCurrentModel(model, tagId, settings.embeddedLod, { requestId });
  if (settings.loadStrategy === 'fixed') return loadCurrentModel(model, tagId, settings.lod, { requestId });
  if (settings.loadStrategy === 'on-demand') return loadCurrentModel(model, tagId, settings.onDemandLod, { requestId });

  const smallLoaded = await loadCurrentModel(model, tagId, 'small', { requestId });
  if (!smallLoaded || requestId !== loadRequestId) return false;
  const mediumLoaded = await loadCurrentModel(model, tagId, 'medium', { requestId, preserveCamera: true, background: true });
  if (!mediumLoaded || requestId !== loadRequestId) return false;
  return loadCurrentModel(model, tagId, 'original', { requestId, preserveCamera: true, background: true });
}

function setLoadingStatus(message) {
  settings.loadingStatus = message;
  const status = document.querySelector('#loading-status');
  if (status) status.textContent = message;
}

function applySceneBackground() {
  const color = settings.sceneBackground || DEFAULT_MODEL_APPEARANCE.sceneBackground;
  sceneManager?.setBackground(color);
  document.querySelector('.viewer')?.style.setProperty('--scene-background', color);
}

async function loadCurrentModel(model, tagId, lod = 'original', { requestId = ++loadRequestId, preserveCamera = false, background = false } = {}) {
  if (!model.file) {
    sceneManager.showEmptyCanvas();
    settings.loadedObjects = [];
    annotationManager.setTags(model.tags || [], { preserveCategories: false, categories: currentCategoryDefinitions() });
    setLoadingStatus('Prázdné plátno je připraveno — model nahrajte z rozcestníku');
    return true;
  }

  const selectedLod = normalizedLod(lod);
  const chosenFile = fileForLod(model, selectedLod);
  setLoadingStatus(`${background ? 'Doplňování' : 'Načítání'} ${lodLabel(selectedLod)}… 0 %`);
  try {
    const object = await loadModel(chosenFile, {
      mtlUrl: findMaterialFile(model.files),
      color: settings.color,
      onProgress: (progress) => {
        if (requestId === loadRequestId) setLoadingStatus(`${background ? 'Doplňování' : 'Načítání'} ${lodLabel(selectedLod)}… ${Math.round(progress * 100)} %`);
      }
    });
    if (requestId !== loadRequestId || !sceneManager) return false;
    const camera = preserveCamera ? sceneManager.cameraState() : undefined;
    sceneManager.setModel(object);
    sceneManager.setContentQuaternionArray(model.orientation?.quaternion);
    if (camera) sceneManager.updateCameraState(camera);
    settings.loadedObjects = sceneManager.loadedObjectNames();
    settings.lod = selectedLod;
    applyMaterialSettings(sceneManager.modelRoot, settings);
    sceneManager.setClipping(settings);
    annotationManager.setTags(model.tags || [], { preserveCategories: false, categories: currentCategoryDefinitions() });
    if (model.camera) sceneManager.updateCameraState(model.camera, { applyModelQuaternion: !model.orientation?.quaternion });
    sceneManager.setRotationGizmoVisible(settings.rotationGizmoVisible);
    syncTagDraftToModel();
    setLoadingStatus(`Načtena ${lodLabel(selectedLod)}`);
    renderCurrentSidebar();
    if (tagId) annotationManager.select(tagId);
    else updateHash();
    return true;
  } catch (error) {
    if (requestId === loadRequestId) {
      setLoadingStatus('Model se nepodařilo načíst');
      showToast(error.message, 'error');
    }
    return false;
  }
}

function bytesLabel(bytes) {
  if (!Number.isFinite(Number(bytes))) return '';
  const value = Number(bytes);
  return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} kB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function userVariantOption(value, label, selected) {
  const info = currentModel?.variantInfo?.[value] || (value === 'small' ? currentModel?.variantInfo?.low : undefined);
  return `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}${info ? ` · ${bytesLabel(info.bytes)}` : ''}</option>`;
}

function userSettingsContent() {
  const currentModelHasVariants = hasGeneratedVariants(currentModel);
  const availabilityNote = currentModel && !currentModelHasVariants
    ? '<p class="setting-note">Tento model nemá samostatně vytvořené varianty S a M; použije se dostupný soubor.</p>'
    : '';
  const loadingSettings = `
    <section class="load-settings"><h2>Načítání pro toto zařízení</h2>
      <label>Režim<select data-user-setting="loadStrategy"><option value="fixed" ${settings.loadStrategy === 'fixed' ? 'selected' : ''}>Vybraná varianta</option><option value="progressive" ${settings.loadStrategy === 'progressive' ? 'selected' : ''}>Postupně od malé</option><option value="on-demand" ${settings.loadStrategy === 'on-demand' ? 'selected' : ''}>Na vyžádání originálu</option></select></label>
      ${settings.loadStrategy === 'fixed' ? `<label>Varianta<select data-user-setting="lod">${userVariantOption('small', 'Malá (S)', settings.lod)}${userVariantOption('medium', 'Střední (M)', settings.lod)}${userVariantOption('original', 'Originál', settings.lod)}</select></label>` : ''}
      ${settings.loadStrategy === 'progressive' ? '<p class="setting-note">Nejdřív se zobrazí S, poté se na pozadí načte M a nakonec originál.</p>' : ''}
      ${settings.loadStrategy === 'on-demand' ? `<label>Výchozí varianta<select data-user-setting="onDemandLod">${userVariantOption('small', 'Malá (S)', settings.onDemandLod)}${userVariantOption('medium', 'Střední (M)', settings.onDemandLod)}</select></label>${currentModel ? `<button type="button" class="small-button" data-user-action="prefer-original">${actionIconMarkup('upload')}Po návratu načíst originál</button>` : ''}` : ''}
      ${availabilityNote}
    </section>`;
  const navigationSettings = `
    <section class="navigation-settings"><h2>Ovládání 3D prostoru</h2>
      <label>Způsob otáčení<select data-user-setting="navigationMode"><option value="orbit" ${settings.navigationMode === 'orbit' ? 'selected' : ''}>Původní — pohled kolem modelu</option><option value="turntable" ${settings.navigationMode === 'turntable' ? 'selected' : ''}>Těleso — stabilní otočení</option><option value="trackball" ${settings.navigationMode === 'trackball' ? 'selected' : ''}>Těleso — volný trackball</option></select></label>
      <label class="navigation-cube-toggle"><input type="checkbox" data-user-setting="showNavigationCubeStandalone" ${settings.showNavigationCubeStandalone ? 'checked' : ''}> Zobrazit navigační kostku v plnohodnotném prohlížeči</label>
      <label class="navigation-cube-toggle"><input type="checkbox" data-user-setting="showNavigationCubeEmbedded" ${settings.showNavigationCubeEmbedded ? 'checked' : ''}> Zobrazit navigační kostku ve vloženém prohlížeči</label>
      <p class="setting-note">Původní režim otáčí kamerou. Stabilní otočení používá pevné osy X/Y; volný trackball dovolí i náklon kolem směru pohledu. Navigační kostka vpravo nahoře rychle nastaví šest základních směrů. Ve vloženém prohlížeči je ve výchozím nastavení skrytá.</p>
    </section>`;
  return `
    <label>Rozhraní<select data-user-setting="interfaceMode"><option value="simple" ${settings.interfaceMode === 'simple' ? 'selected' : ''}>Jednoduché</option><option value="advanced" ${settings.interfaceMode === 'advanced' ? 'selected' : ''}>Pokročilé</option></select></label>
    <p class="setting-note">Jednoduché rozhraní je určené k prohlížení a studiu. Pokročilé zobrazí technické informace o modelu.</p>
    ${navigationSettings}
    ${loadingSettings}`;
}

function bindUserSettings(host) {
  host.querySelectorAll('[data-user-setting]').forEach((input) => {
    const eventName = input.matches('select, input[type="checkbox"]') ? 'change' : 'input';
    input.addEventListener(eventName, () => {
      updateUserSetting(input.dataset.userSetting, input.type === 'checkbox' ? input.checked : input.value);
    });
  });
  host.querySelector('[data-user-action="prefer-original"]')?.addEventListener('click', () => {
    settings.loadStrategy = 'fixed';
    settings.lod = 'original';
    saveDeviceSettings();
    renderUserSettingsPage();
  });
}

function renderUserSettingsPage() {
  if (settings.embedded) return;
  const model = currentModel;
  const tagId = selectedTag?.id;
  destroyViewer();
  document.title = `Nastavení prohlížeče | ${applicationName()}`;
  app.innerHTML = `
    <main class="user-settings-page">
      <header class="wiki-topbar">${brandMarkup({ interactive: true })}<nav class="topbar-actions"><button type="button" class="topbar-link" data-action="about">O 3D prohlížeči</button><span class="topbar-gear" aria-hidden="true">${settingsIconMarkup()}</span>${wikiSessionIndicatorMarkup(wikiSessionUser, { userPageUrl: wikiUserPageUrl(), loginUrl: wikiConfig.loginUrl })}</nav></header>
      <div class="wiki-page-layout"><article class="user-settings-content">
        <header class="settings-page-heading"><p class="eyebrow">UŽIVATELSKÉ NASTAVENÍ</p><h1>Prohlížeč</h1><p>Nastavení platí pro toto zařízení a uloží se i pro další modely.</p></header>
        <section class="settings-page-form" aria-label="Uživatelské nastavení prohlížeče">${userSettingsContent()}</section>
        <div class="settings-page-actions"><button type="button" class="button button-primary" data-action="settings-back">${actionIconMarkup('back')}${model ? 'Zpět k modelu' : 'Zpět k modelům'}</button></div>
      </article></div>
    </main>`;
  bindUserSettings(app);
  app.querySelector('[data-action="settings-back"]')?.addEventListener('click', () => {
    if (model) openModel(model, tagId);
    else renderHub();
  });
  app.querySelector('[data-action="home"]')?.addEventListener('click', () => renderHub());
  app.querySelector('[data-action="about"]')?.addEventListener('click', () => renderAbout());
}

function updateUserSetting(key, value) {
  if (key === 'loadStrategy' || key === 'interfaceMode' || key === 'navigationMode') settings[key] = value;
  else if (['showNavigationCubeStandalone', 'showNavigationCubeEmbedded'].includes(key)) settings[key] = Boolean(value);
  else if (key === 'lod' || key === 'onDemandLod') settings[key] = normalizedLod(value);
  else if (key === 'wireframe') settings[key] = Boolean(value);
  else settings[key] = Number.isNaN(Number(value)) ? value : Number(value);
  saveDeviceSettings();
  if (['loadStrategy', 'lod', 'onDemandLod'].includes(key)) {
    if (document.querySelector('.user-settings-page')) renderUserSettingsPage();
    else startModelLoading(currentModel, selectedTag?.id);
    return;
  }
  if (key === 'interfaceMode') {
    if (document.querySelector('.user-settings-page')) renderUserSettingsPage();
    else renderCurrentSidebar();
    return;
  }
  if (key === 'navigationMode') {
    sceneManager?.setNavigationMode(settings.navigationMode);
    if (document.querySelector('.user-settings-page')) renderUserSettingsPage();
    return;
  }
  if (['showNavigationCubeStandalone', 'showNavigationCubeEmbedded'].includes(key)) {
    if (document.querySelector('.user-settings-page')) renderUserSettingsPage();
    else openModel(currentModel, selectedTag?.id);
    return;
  }
  applyMaterialSettings(sceneManager?.modelRoot, settings);
  sceneManager?.setClipping(settings);
}

function updateModelAppearance(key, value) {
  if (!currentModel || !Object.hasOwn(DEFAULT_MODEL_APPEARANCE, key)) return;
  currentModel.appearance = normalizeModelAppearance({
    ...currentModel.appearance,
    [key]: key === 'wireframe' ? Boolean(value) : value
  });
  Object.assign(settings, currentModel.appearance);
  applyMaterialSettings(sceneManager?.modelRoot, settings);
  sceneManager?.setClipping(settings);
  applySceneBackground();
  const control = document.querySelector(`[data-appearance="${key}"]`);
  const output = control?.closest('label')?.querySelector('output');
  if (output) output.textContent = key === 'opacity' ? `${Math.round(settings.opacity * 100)} %` : String(settings[key]);
  persistModel();
}

function updateModelInfo(key, value) {
  if (!currentModel || !['title', 'description', 'license', 'author', 'origin', 'sourceUrl'].includes(key)) return;
  const limits = { title: 120, description: 20000, license: 160, author: 160, origin: 300, sourceUrl: 1000 };
  const cleaned = String(value || '').trim().slice(0, limits[key]);
  currentModel[key] = key === 'title' ? capitalizeTitle(cleaned) : cleaned;
  persistModel();
}

async function openModelInfoEditor(model = currentModel) {
  if (!model?.article) throw new Error('Model nemá definující článek 3D, do kterého lze informace uložit.');
  const editableModel = model.wikitext ? model : await fetchWikiModel(model.article);
  showModelInfoDialog(editableModel, {
    onSave: async (changes) => {
      const next = {
        ...editableModel,
        ...changes,
        title: capitalizeTitle(changes.title)
      };
      const parserTag = createModel3dTag(next);
      const wikitext = replaceModel3dTag(editableModel.wikitext, parserTag);
      const result = await publishWithWikiSession({
        endpoint: wikiConfig.endpoint,
        title: editableModel.article,
        text: wikitext,
        summary: 'Aktualizace informací o 3D modelu'
      });
      Object.assign(editableModel, next, { wikitext });
      const index = models.findIndex((item) => item.id === editableModel.id || item.article === editableModel.article);
      if (index >= 0) Object.assign(models[index], next);
      if (currentModel?.article === editableModel.article) {
        Object.assign(currentModel, next, { wikitext });
        renderCurrentSidebar();
      } else {
        renderHub({ clearHash: false });
      }
      showToast(`Informace o modelu uložil uživatel ${result.user.name}.`);
    }
  });
}

function editLeaderLine() {
  if (!settings.canEdit || !selectedTag) return;
  annotationManager.select(selectedTag.id, { focus: false });
  showToast('Přetáhněte barevný kruh u plovoucího štítku. Tím změníte polohu vodicí čáry.');
}

function modelIsReady() {
  return Boolean(sceneManager?.modelRoot?.children.length) && !sceneManager.modelBounds.isEmpty();
}

function fitModelView() {
  if (!modelIsReady()) {
    showToast('Pohled lze upravit až po dokončení načítání modelu.', 'error');
    return;
  }
  sceneManager?.frameObject(sceneManager.modelRoot);
  showToast('Pohled je přizpůsoben celému modelu. Chcete-li jej nastavit jako výchozí, nejprve jej případně upravte myší.');
}

function saveDefaultView() {
  if (!settings.canEdit) return requestWikiEdit();
  if (!modelIsReady()) {
    showToast('Výchozí pohled lze nastavit až po dokončení načítání modelu.', 'error');
    return;
  }
  const camera = sceneManager?.captureCameraState();
  if (!camera || !currentModel) return;
  currentModel.camera = {
    position: [...camera.position],
    target: [...camera.target]
  };
  settings.defaultViewDirty = true;
  persistModel({ defaultView: true });
  renderCurrentSidebar();
  showToast('Aktuální pohled je nastaven. Pro trvalé uložení klikněte nahoře na „ULOŽIT“.');
}

function clearDefaultView() {
  if (!settings.canEdit) return requestWikiEdit();
  if (!currentModel) return;
  delete currentModel.camera;
  settings.defaultViewDirty = true;
  sceneManager?.resetView();
  persistModel({ defaultView: true });
  renderCurrentSidebar();
  showToast('Automatický pohled je připraven. Zapište změnu tlačítkem „ULOŽIT“ nahoře.');
}

function toggleRotationGizmo() {
  if (!settings.canEdit) return requestWikiEdit();
  if (!modelIsReady()) {
    showToast('Natočení lze upravit až po dokončení načítání modelu.', 'error');
    return;
  }
  settings.rotationGizmoVisible = !settings.rotationGizmoVisible;
  sceneManager?.setRotationGizmoVisible(settings.rotationGizmoVisible);
  renderCurrentSidebar();
}

function stageDefaultOrientation() {
  if (!modelIsReady() || !currentModel) return false;
  currentModel.orientation = { quaternion: sceneManager.contentQuaternion() };
  // Older definitions stored body orientation inside the camera. From now on
  // camera and body state are independent, so remove the legacy duplicate.
  if (currentModel.camera) delete currentModel.camera.modelQuaternion;
  settings.defaultOrientationDirty = true;
  persistModel({ defaultOrientation: true });
  return true;
}

function saveDefaultOrientation() {
  if (!settings.canEdit) return requestWikiEdit();
  if (!stageDefaultOrientation()) {
    showToast('Výchozí natočení lze nastavit až po dokončení načítání modelu.', 'error');
    return;
  }
  settings.rotationGizmoVisible = false;
  sceneManager.setRotationGizmoVisible(false);
  renderCurrentSidebar();
  showToast('Výchozí natočení tělesa je nastaveno. Pro trvalé uložení klikněte nahoře na „ULOŽIT“.');
}

function clearDefaultOrientation() {
  if (!settings.canEdit) return requestWikiEdit();
  if (!currentModel) return;
  delete currentModel.orientation;
  if (currentModel.camera) delete currentModel.camera.modelQuaternion;
  sceneManager?.resetContentRotation();
  settings.rotationGizmoVisible = false;
  sceneManager?.setRotationGizmoVisible(false);
  settings.defaultOrientationDirty = true;
  persistModel({ defaultOrientation: true });
  renderCurrentSidebar();
  showToast('Výchozí natočení tělesa bylo vráceno do původní orientace.');
}

async function regenerateCurrentModelThumbnail() {
  if (!currentModel?.storageId) return;
  if (settings.wikiDirty) {
    showToast('Nejprve uložte výchozí pohled a natočení do článku 3D.', 'error');
    return;
  }
  try {
    const result = await regenerateModelThumbnail(currentModel.storageId);
    currentModel.thumbnail = result.thumbnail;
    updateIndexedModelThumbnail(result.thumbnail);
    showToast('Náhled byl přegenerován podle uloženého pohledu modelu.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function updateIndexedModelThumbnail(thumbnail) {
  if (!currentModel) return;
  const index = models.findIndex((model) => model.storageId === currentModel.storageId
    || (model.article && model.article === currentModel.article));
  if (index >= 0) models[index] = { ...models[index], thumbnail };
}

async function regenerateCurrentModelThumbnailFromCurrentView() {
  if (!currentModel?.storageId) return;
  if (!modelIsReady()) {
    showToast('Náhled lze vytvořit až po dokončení načítání modelu.', 'error');
    return;
  }
  const camera = sceneManager?.captureCameraState();
  const quaternion = sceneManager?.contentQuaternion();
  if (!camera || !quaternion) {
    showToast('Aktuální pohled modelu se nepodařilo zjistit.', 'error');
    return;
  }
  try {
    const result = await regenerateModelThumbnail(currentModel.storageId, {
      useCurrentView: true,
      camera: { position: [...camera.position], target: [...camera.target] },
      orientation: { quaternion: [...quaternion] }
    });
    currentModel.thumbnail = result.thumbnail;
    updateIndexedModelThumbnail(result.thumbnail);
    showToast('Náhled byl vytvořen z aktuální polohy a natočení modelu.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function deleteCurrentModel() {
  if (!currentModel?.storageId) return;
  if (!window.confirm(`Opravdu odstranit model „${currentModel.title}“ včetně jeho souborů a článku ${currentModel.article || '3D'}?`)) return;
  try {
    await deleteModel(currentModel.storageId);
    showToast(`Model „${currentModel.title}“ byl odstraněn.`);
    await initialize();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderCurrentSidebar() {
  const host = document.querySelector('#sidebar-host');
  if (!host || !currentModel) return;
  renderSidebar(host, currentModel, selectedTag, {
    ...settings,
    tagDraftActive: Boolean(tagDraft),
    modelReady: modelIsReady(),
    wikiDefinitionUrl: wikiDefinitionUrl(),
    wikiArticleUrl
  }, {
    select: (id) => annotationManager.select(id),
    category: (category, checked) => {
      if (checked) settings.categories.add(category);
      else settings.categories.delete(category);
      annotationManager.setVisible(settings.categories);
      if (!checked && selectedTag?.category === category) annotationManager.clearSelection();
      renderCurrentSidebar();
    },
    embeddedMode: (mode) => {
      settings.embeddedPanelMode = mode === 'detail' ? 'detail' : 'list';
      renderCurrentSidebar();
    },
    toggleTag: (id) => {
      if (settings.hiddenTags.has(id)) settings.hiddenTags.delete(id);
      else settings.hiddenTags.add(id);
      annotationManager.setHiddenTags(settings.hiddenTags);
      renderCurrentSidebar();
    },
    setting: (key, value) => {
      settings[key] = key === 'lod' ? value : key === 'wireframe' ? value : Number.isNaN(Number(value)) ? value : Number(value);
      if (['loadStrategy', 'lod', 'onDemandLod'].includes(key)) {
        settings[key] = key === 'lod' || key === 'onDemandLod' ? normalizedLod(value) : value;
        saveDeviceSettings();
        startModelLoading(currentModel, selectedTag?.id);
        return;
      }
      applyMaterialSettings(sceneManager?.modelRoot, settings);
      sceneManager?.setClipping(settings);
      renderCurrentSidebar();
    },
    appearance: updateModelAppearance,
    info: updateModelInfo,
    action: handleSidebarAction
  });
}

function handleSidebarAction(action) {
  if (action === 'back') renderHub();
  if (action === 'collapse') {
    document.querySelector('#sidebar-host').classList.toggle('is-collapsed');
    renderCurrentSidebar();
  }
  if (action === 'reset') {
    if (currentModel?.camera) sceneManager.updateCameraState(currentModel.camera, { applyModelQuaternion: !currentModel.orientation?.quaternion });
    else sceneManager.resetView();
    sceneManager.setContentQuaternionArray(currentModel?.orientation?.quaternion);
  }
  if (action === 'fit-model') fitModelView();
  if (action === 'save-default-view') saveDefaultView();
  if (action === 'clear-default-view') clearDefaultView();
  if (action === 'toggle-rotation-gizmo') toggleRotationGizmo();
  if (action === 'save-default-orientation') saveDefaultOrientation();
  if (action === 'clear-default-orientation') clearDefaultOrientation();
  if (action === 'edit-model-info') openModelInfoEditor().catch((error) => showToast(error.message, 'error'));
  if (action === 'regenerate-thumbnail') regenerateCurrentModelThumbnail();
  if (action === 'regenerate-thumbnail-current') regenerateCurrentModelThumbnailFromCurrentView();
  if (action === 'delete-model') deleteCurrentModel();
  if (action === 'edit-leader-line') editLeaderLine();
  if (action === 'show-all') {
    annotationManager.showAll(true);
    settings.categories = new Set((currentModel.tags || []).map((tag) => tag.category));
    settings.hiddenTags.clear();
    renderCurrentSidebar();
  }
  if (action === 'hide-all') {
    annotationManager.showAll(false);
    settings.categories.clear();
    renderCurrentSidebar();
  }
  if (action === 'add-tag') openTagDraft();
  if (action === 'edit-tag' && selectedTag) editTag(selectedTag);
  if (action === 'delete-tag' && selectedTag) deleteTag(selectedTag);
  if (action === 'request-edit') requestWikiEdit();
  if (action === 'add-category') manageCategories({ startAdding: true });
  if (action === 'manage-categories') manageCategories();
  if (action === 'load-original') {
    settings.lod = 'original';
    saveDeviceSettings();
    const requestId = ++loadRequestId;
    loadCurrentModel(currentModel, selectedTag?.id, 'original', { requestId, preserveCamera: true });
  }
}

function attachViewportInteractions() {
  const canvas = sceneManager.renderer.domElement;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (tagDraft?.brushMode) {
      const hit = sceneManager.intersectModel(event);
      if (!hit?.face) {
        // Brush mode deliberately locks navigation even when a gesture begins
        // beside the mesh; otherwise a missed stroke can rotate the model.
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      brushStroke = { pointerId: event.pointerId, controlsEnabled: sceneManager.controls.enabled };
      // OrbitControls registers its normal pointer handler on the canvas as
      // well. Disabling it in capture phase keeps a brush stroke from also
      // starting a camera/model rotation.
      sceneManager.controls.enabled = false;
      paintDraftAt(hit);
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    if (settings.canEdit && annotationManager.beginHandleDrag(event)) {
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    if (sceneManager.beginContentRotation(event)) {
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }
  }, true);
  canvas.addEventListener('pointermove', (event) => {
    if (brushStroke?.pointerId === event.pointerId) {
      const hit = sceneManager.intersectModel(event);
      if (hit?.face) paintDraftAt(hit);
      return;
    }
    if (annotationManager.dragHandle(event)) return;
    if (sceneManager.dragContentRotation(event)) return;
    if (tagEditor?.repositioningAnchor) {
      annotationManager.showPreview(sceneManager.intersectModel(event), tagEditor.draft.lineLength);
      return;
    }
    if (!tagDraft) return;
    if (tagDraft.position) annotationManager.showPreviewAt(tagDraft.position, tagDraft.normal, tagDraft.lineLength);
    else annotationManager.showPreview(sceneManager.intersectModel(event), tagDraft.lineLength);
  });
  canvas.addEventListener('pointerup', (event) => {
    if (brushStroke?.pointerId === event.pointerId) {
      const { controlsEnabled } = brushStroke;
      brushStroke = null;
      sceneManager.controls.enabled = controlsEnabled;
      canvas.releasePointerCapture?.(event.pointerId);
      ignoreNextClick = true;
      renderTagDraft();
      return;
    }
    if (sceneManager.consumeRotationGizmoChange()) {
      // Dragging the rings is itself an edit. Stage it immediately so the
      // global save button writes exactly the orientation the editor sees.
      if (settings.canEdit && stageDefaultOrientation()) renderCurrentSidebar();
      canvas.releasePointerCapture?.(event.pointerId);
      ignoreNextClick = true;
      return;
    }
    if (annotationManager.endHandleDrag()) {
      canvas.releasePointerCapture?.(event.pointerId);
      ignoreNextClick = true;
      showToast('Délka a směr vodicí čáry byly upraveny.');
      return;
    }
    if (sceneManager.endContentRotation(event)) {
      canvas.releasePointerCapture?.(event.pointerId);
      ignoreNextClick = true;
    }
  });
  canvas.addEventListener('pointerleave', () => {
    if (!annotationManager.drag && !tagDraft?.position && !tagEditor?.draft.position) annotationManager.hidePreview();
  });
  canvas.addEventListener('pointercancel', (event) => {
    if (brushStroke?.pointerId !== event.pointerId) return;
    const { controlsEnabled } = brushStroke;
    brushStroke = null;
    sceneManager.controls.enabled = controlsEnabled;
  });
  canvas.addEventListener('click', (event) => {
    if (ignoreNextClick) {
      ignoreNextClick = false;
      return;
    }
    if (!settings.canEdit || (!tagDraft && !tagEditor?.repositioningAnchor) || tagDraft?.brushMode) return;
    const hit = sceneManager.intersectModel(event);
    if (!hit?.face) return;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    if (tagEditor?.repositioningAnchor) {
      tagEditor.draft.position = sceneManager.worldPointToContent(hit.point).toArray();
      tagEditor.draft.normal = sceneManager.worldDirectionToContent(normal).toArray();
      tagEditor.repositioningAnchor = false;
      tagEditor.hasEditedAnchor = true;
      annotationManager.showPreviewAt(tagEditor.draft.position, tagEditor.draft.normal, tagEditor.draft.lineLength);
      renderTagDraft();
      showToast('Nový bod na modelu je vybraný. Uložte změny štítku.');
      return;
    }
    tagDraft.position = sceneManager.worldPointToContent(hit.point).toArray();
    tagDraft.normal = sceneManager.worldDirectionToContent(normal).toArray();
    annotationManager.showPreviewAt(tagDraft.position, tagDraft.normal, tagDraft.lineLength);
    saveTagDraft();
    renderTagDraft();
    showToast('Bod štítku je vybraný. Dokončete údaje a uložte štítek.');
  });
  canvas.addEventListener('wheel', (event) => {
    if (!settings.canEdit || !selectedTag || !(event.shiftKey || leaderKeyActive)) return;
    event.preventDefault();
    const direction = Math.sign(event.deltaY);
    selectedTag.lineLength = Math.max(
      annotationManager.minimumLineLength(),
      Number(selectedTag.lineLength) - direction * annotationManager.lineLengthStep()
    );
    annotationManager.setTags(currentModel.tags, { categories: currentCategoryDefinitions() });
    annotationManager.select(selectedTag.id, { focus: false });
    persistModel();
    renderCurrentSidebar();
  }, { passive: false });
}

function paintDraftAt(hit) {
  if (!tagDraft?.brushMode || !hit?.face) return false;
  const position = sceneManager.worldPointToContent(hit.point).toArray();
  const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
  const normal = sceneManager.worldDirectionToContent(worldNormal).toArray();
  const colorMode = tagDraft.brushColorMode === 'custom' ? 'custom' : 'category';
  const color = colorMode === 'custom' ? tagDraft.brushColor : categoryBrushColor(tagDraft.category);
  tagDraft.highlight ||= { colorMode, color, radius: tagDraft.brushRadius, points: [] };
  const radius = Number(tagDraft.brushRadius || tagDraft.highlight.radius);
  const previous = tagDraft.highlight.points.at(-1);
  if (previous && new THREE.Vector3().fromArray(previous.position).distanceTo(new THREE.Vector3().fromArray(position)) < radius * 0.32) return false;
  if (tagDraft.highlight.points.length >= 240) return false;
  tagDraft.highlight.colorMode = colorMode;
  tagDraft.highlight.color = color;
  tagDraft.highlight.radius = radius;
  tagDraft.highlight.points.push({ position, normal });
  if (!tagDraft.position) {
    tagDraft.position = position;
    tagDraft.normal = normal;
    annotationManager.showPreviewAt(position, normal, tagDraft.lineLength);
  }
  annotationManager.showBrushPreview(tagDraft.highlight);
  saveTagDraft();
  return true;
}

function draftLineLimits(requestedLineLength) {
  if (!sceneManager?.modelBounds || sceneManager.modelBounds.isEmpty()) {
    const lineStep = 0.01;
    const minLineLength = 0.0001;
    const defaultLength = 2;
    const requested = Number(requestedLineLength);
    const maxLineLength = Math.max(20, Number.isFinite(requested) ? requested + lineStep : 0);
    return {
      minLineLength,
      lineLength: Number.isFinite(requested) ? Math.min(maxLineLength, Math.max(minLineLength, requested)) : defaultLength,
      maxLineLength,
      lineStep
    };
  }
  const { min, max } = sceneManager.modelBounds;
  const largest = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 0.0001);
  const minLineLength = Math.max(largest * 0.0005, 0.0001);
  // Values below one unit remain controllable in hundredths at worst, while
  // small-coordinate models receive thousandths or ten-thousandths.
  const lineStep = Math.max(Math.min(largest * 0.001, 0.01), 0.0001);
  const alignToStep = (value) => minLineLength + Math.round((value - minLineLength) / lineStep) * lineStep;
  const defaultLength = Math.max(alignToStep(largest * 0.14), minLineLength);
  const requested = Number(requestedLineLength);
  const maxLineLength = Math.max(
    alignToStep(largest * 0.9),
    minLineLength + lineStep,
    Number.isFinite(requested) ? requested + lineStep : 0
  );
  return {
    minLineLength,
    lineLength: Number.isFinite(requested) ? Math.min(maxLineLength, Math.max(minLineLength, requested)) : defaultLength,
    maxLineLength,
    lineStep
  };
}

function draftBrushLimits(requestedRadius) {
  const bounds = sceneManager?.modelBounds;
  const size = bounds && !bounds.isEmpty()
    ? Math.max(...bounds.getSize(new THREE.Vector3()).toArray(), 0.0001)
    : 10;
  const brushMinRadius = Math.max(size * 0.003, 0.0001);
  const brushStep = Math.max(size * 0.002, 0.0001);
  const brushMaxRadius = Math.max(size * 0.18, brushMinRadius + brushStep);
  const requested = Number(requestedRadius);
  const brushRadius = Number.isFinite(requested)
    ? Math.min(brushMaxRadius, Math.max(brushMinRadius, requested))
    : Math.max(size * 0.025, brushMinRadius);
  return { brushMinRadius, brushMaxRadius, brushStep, brushRadius };
}

function tagDraftStorageKey(model = currentModel) {
  const identity = model?.article || model?.id;
  return identity ? `${tagDraftStoragePrefix}${encodeURIComponent(identity)}` : '';
}

function saveTagDraft() {
  const key = tagDraftStorageKey();
  if (!key || !tagDraft || !settings.canEdit) return;
  const { id, title, category, description, position, normal, lineLength, brushMode, brushColorMode, brushColor, brushRadius, highlight } = tagDraft;
  try {
    localStorage.setItem(key, JSON.stringify({ version: 2, id, title, category, description, position, normal, lineLength, brushMode, brushColorMode, brushColor, brushRadius, highlight }));
  } catch {
    // The active editing session remains usable if browser storage is unavailable.
  }
}

function clearSavedTagDraft() {
  const key = tagDraftStorageKey();
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore privacy-restricted storage; there is no draft to remove in it.
  }
}

function validDraftVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every((coordinate) => Number.isFinite(Number(coordinate)));
}

function validDraftHighlight(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.points)) return undefined;
  const color = /^#[0-9a-f]{6}$/i.test(String(value.color || '')) ? String(value.color).toLowerCase() : '#d64b3b';
  const radius = Number(value.radius);
  const points = value.points.slice(0, 240).flatMap((point) => validDraftVector(point?.position) && validDraftVector(point?.normal)
    ? [{ position: point.position.map(Number), normal: point.normal.map(Number) }]
    : []);
  const colorMode = value.colorMode === 'category' ? 'category' : 'custom';
  return Number.isFinite(radius) && radius > 0 && points.length ? { colorMode, color, radius, points } : undefined;
}

function categoryBrushColor(categoryId) {
  return currentCategoryDefinitions().find((category) => category.id === categoryId)?.color || '#d64b3b';
}

function restoreTagDraft() {
  const key = tagDraftStorageKey();
  if (!key || !settings.canEdit || !isWikiModel()) return false;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved || ![1, 2].includes(saved.version)) return false;
    const limits = draftLineLimits(saved.lineLength);
    const brushLimits = draftBrushLimits(saved.brushRadius);
    const categories = currentCategoryDefinitions();
    const requestedLength = Number(saved.lineLength);
    const highlight = validDraftHighlight(saved.highlight);
    tagDraft = {
      id: String(saved.id || `tag-${crypto.randomUUID()}`).slice(0, 100),
      title: String(saved.title || '').slice(0, 160),
      category: categories.some((category) => category.id === saved.category) ? saved.category : (categories[0]?.id || 'obecne'),
      description: String(saved.description || '').slice(0, 20000),
      position: validDraftVector(saved.position) ? saved.position.map(Number) : undefined,
      normal: validDraftVector(saved.normal) ? saved.normal.map(Number) : undefined,
      brushMode: Boolean(saved.brushMode || highlight),
      brushColorMode: highlight?.colorMode || (saved.brushColorMode === 'custom' ? 'custom' : 'category'),
      brushColor: highlight?.color || (/^#[0-9a-f]{6}$/i.test(String(saved.brushColor || '')) ? saved.brushColor : '#d64b3b'),
      ...brushLimits,
      ...(highlight ? { highlight } : {}),
      ...limits,
      lineLength: Number.isFinite(requestedLength) ? Math.min(limits.maxLineLength, Math.max(limits.minLineLength, requestedLength)) : limits.lineLength
    };
    settings.editMode = true;
    return true;
  } catch {
    return false;
  }
}

function syncTagDraftToModel() {
  if (!tagDraft || !sceneManager?.modelBounds || sceneManager.modelBounds.isEmpty()) return;
  const limits = draftLineLimits(tagDraft.lineLength);
  const brushLimits = draftBrushLimits(tagDraft.brushRadius);
  tagDraft = {
    ...tagDraft,
    ...limits,
    ...brushLimits,
    lineLength: Math.min(limits.maxLineLength, Math.max(limits.minLineLength, Number(tagDraft.lineLength) || limits.lineLength))
  };
  if (tagDraft.position && tagDraft.normal) annotationManager?.showPreviewAt(tagDraft.position, tagDraft.normal, tagDraft.lineLength);
  if (tagDraft.highlight) annotationManager?.showBrushPreview(tagDraft.highlight);
  saveTagDraft();
  renderTagDraft();
}

function openTagDraft() {
  const limits = draftLineLimits();
  const brushLimits = draftBrushLimits();
  const categories = currentCategoryDefinitions();
  tagDraft = {
    id: `tag-${crypto.randomUUID()}`,
    title: '',
    category: categories[0]?.id || 'obecne',
    description: '',
    position: undefined,
    normal: undefined,
    brushMode: false,
    brushColorMode: 'category',
    brushColor: categoryBrushColor(categories[0]?.id),
    ...brushLimits,
    ...limits
  };
  settings.editMode = true;
  saveTagDraft();
  updateTagDraftNotice();
  renderTagDraft();
  renderCurrentSidebar();
}

function closeTagDraft() {
  clearSavedTagDraft();
  tagDraft = undefined;
  settings.editMode = false;
  annotationManager?.hidePreview();
  annotationManager?.hideBrushPreview();
  hidePersistentNotice('tag-draft');
  renderTagDraft();
  renderCurrentSidebar();
}

function renderTagDraft() {
  const host = document.querySelector('#tag-draft-host');
  if (!host) return;
  if (tagEditor) {
    renderTagEditorPanel(host, tagEditor.draft, {
      categories: currentCategoryDefinitions(),
      onChange: (changes) => {
        Object.assign(tagEditor.draft, changes);
        if (tagEditor.draft.style.colorMode !== 'custom') tagEditor.draft.style.color = categoryBrushColor(tagEditor.draft.category);
      },
      onCancel: closeTagEditor,
      onEditLeaderLine: editLeaderLine,
      onEditAnchor: editTagAnchor,
      anchorSelectionActive: tagEditor.repositioningAnchor,
      hasEditedAnchor: tagEditor.hasEditedAnchor,
      onSave: saveTagEditor
    });
    return;
  }
  if (!tagDraft) {
    host.innerHTML = '';
    return;
  }
  updateTagDraftNotice();
  renderTagDraftPanel(host, tagDraft, {
    categories: currentCategoryDefinitions(),
    onChange: (changes) => {
      Object.assign(tagDraft, changes);
      if (tagDraft.brushColorMode !== 'custom') tagDraft.brushColor = tagDraft.brushCategoryColor || categoryBrushColor(tagDraft.category);
      if (tagDraft.brushMode) {
        tagDraft.highlight ||= { points: [] };
        tagDraft.highlight.colorMode = tagDraft.brushColorMode;
        tagDraft.highlight.color = tagDraft.brushColor;
        tagDraft.highlight.radius = tagDraft.brushRadius;
        if (tagDraft.highlight.points.length) annotationManager.showBrushPreview(tagDraft.highlight);
      } else {
        delete tagDraft.highlight;
        annotationManager.hideBrushPreview();
      }
      saveTagDraft();
      if (tagDraft.position) annotationManager.showPreviewAt(tagDraft.position, tagDraft.normal, tagDraft.lineLength);
    },
    onResetAnchor: () => {
      tagDraft.position = undefined;
      tagDraft.normal = undefined;
      delete tagDraft.highlight;
      annotationManager.hideBrushPreview();
      annotationManager.hidePreview();
      saveTagDraft();
      renderTagDraft();
    },
    onCancel: closeTagDraft,
    onAddCategory: () => manageCategories({ startAdding: true, selectForDraft: true }),
    onSave: () => {
      if (!tagDraft?.position || !tagDraft.title.trim()) return;
      const saved = { ...tagDraft };
      delete saved.minLineLength;
      delete saved.maxLineLength;
      delete saved.lineStep;
      delete saved.brushMode;
      delete saved.brushColor;
      delete saved.brushColorMode;
      delete saved.brushCategoryColor;
      delete saved.brushRadius;
      delete saved.brushMinRadius;
      delete saved.brushMaxRadius;
      delete saved.brushStep;
      closeTagDraft();
      addTag(saved);
    }
  }, true);
}

function updateTagDraftNotice() {
  if (!tagDraft) {
    hidePersistentNotice('tag-draft');
    return;
  }
  showPersistentNotice('tag-draft', tagDraft.brushMode
    ? 'Nový štítek: nastavte údaje v panelu a tažením štětce vyberte plochu na modelu.'
    : 'Nový štítek: nastavte údaje v panelu, najeďte na povrch a kliknutím vyberte ukotvení.');
}

function addTag(tag) {
  currentModel.tags ||= [];
  currentModel.tags.push(tag);
  // A freshly created label must be visible immediately, even when its
  // category had not yet appeared in the current category filter.
  settings.categories.add(tag.category);
  settings.hiddenTags.delete(tag.id);
  annotationManager.setTags(currentModel.tags, { categories: currentCategoryDefinitions() });
  annotationManager.setVisible(settings.categories);
  annotationManager.select(tag.id, { focus: false });
  persistModel();
  renderCurrentSidebar();
  showToast('Štítek byl přidán.');
}

function editTag(tag) {
  if (tagDraft) {
    showToast('Nejdříve dokončete nebo zrušte právě vytvářený štítek.', 'error');
    return;
  }
  const limits = draftLineLimits(tag.lineLength);
  const sourceStyle = tag.style || tag.highlight;
  tagEditor = {
    tag,
    draft: {
      title: tag.title || '',
      category: tag.category || currentCategoryDefinitions()[0]?.id || 'obecne',
      description: tag.description || '',
      ...limits,
      lineLength: tag.lineLength || limits.lineLength,
      style: {
        colorMode: sourceStyle?.colorMode === 'custom' ? 'custom' : 'category',
        color: sourceStyle?.color || categoryBrushColor(tag.category)
      },
      highlight: tag.highlight,
      position: tag.position ? [...tag.position] : undefined,
      normal: tag.normal ? [...tag.normal] : undefined
    }
  };
  annotationManager.select(tag.id, { focus: false });
  annotationManager.hidePreview();
  renderTagDraft();
  renderCurrentSidebar();
}

function closeTagEditor() {
  tagEditor = undefined;
  annotationManager.hidePreview();
  renderTagDraft();
  renderCurrentSidebar();
}

function editTagAnchor() {
  if (!tagEditor || !settings.canEdit) return;
  tagEditor.repositioningAnchor = !tagEditor.repositioningAnchor;
  if (!tagEditor.repositioningAnchor && !tagEditor.hasEditedAnchor) annotationManager.hidePreview();
  renderTagDraft();
  showToast(tagEditor.repositioningAnchor
    ? 'Klikněte na nové místo na povrchu modelu. Pohled se při samotném kliknutí nezmění.'
    : 'Výběr nového bodu byl zrušen.');
}

function saveTagEditor() {
  if (!tagEditor || !tagEditor.draft.title.trim()) return;
  const { tag, draft } = tagEditor;
  Object.assign(tag, {
    title: draft.title.trim(),
    category: draft.category,
    description: draft.description,
    lineLength: draft.lineLength,
    style: { ...draft.style },
    ...(draft.position && draft.normal ? { position: [...draft.position], normal: [...draft.normal] } : {})
  });
  settings.categories.add(tag.category);
  settings.hiddenTags.delete(tag.id);
  annotationManager.setTags(currentModel.tags, { categories: currentCategoryDefinitions() });
  annotationManager.setVisible(settings.categories);
  annotationManager.select(tag.id, { focus: false });
  annotationManager.hidePreview();
  persistModel();
  tagEditor = undefined;
  renderTagDraft();
  renderCurrentSidebar();
  showToast('Štítek byl uložen.');
}

function deleteTag(tag) {
  if (!currentModel || !window.confirm(`Opravdu odstranit štítek „${tag.title}“?`)) return;
  currentModel.tags = (currentModel.tags || []).filter((item) => item.id !== tag.id);
  selectedTag = undefined;
  annotationManager.setTags(currentModel.tags, { categories: currentCategoryDefinitions() });
  persistModel();
  renderCurrentSidebar();
  showToast('Štítek byl odstraněn.');
}

function updateWikiSaveControl() {
  const button = document.querySelector('[data-action="wiki-save"]');
  if (!button) return;
  const pending = settings.wikiDirty;
  button.disabled = wikiSaveInFlight;
  button.innerHTML = `${actionIconMarkup('save')}${wikiSaveInFlight ? 'UKLÁDÁNÍ…' : 'ULOŽIT'}`;
  button.title = wikiSaveInFlight ? 'Ukládání…' : 'Uložit';
  button.toggleAttribute('data-dirty', pending);
  button.setAttribute('aria-busy', String(wikiSaveInFlight));
}

function persistModel({ defaultView = false, defaultOrientation = false } = {}) {
  if (!isWikiModel()) return;
  modelRevision += 1;
  if (defaultView) defaultViewRevision = modelRevision;
  if (defaultOrientation) defaultOrientationRevision = modelRevision;
  settings.wikiDirty = true;
  updateWikiSaveControl();
}

function updateHash() {
  if (!currentModel) return;
  const hash = isWikiModel() ? new URLSearchParams() : new URLSearchParams({ model: currentModel.id });
  if (selectedTag) hash.set('tag', selectedTag.id);
  history.replaceState(null, '', `#${hash.toString()}`);
}

async function openFromLocation() {
  const article = urlParams().get('article');
  const tag = new URLSearchParams(window.location.hash.slice(1)).get('tag');
  if (!article) return openFromHash();
  if (!wikiConfig.isReadable) throw new Error('Pro načtení článku 3D: je třeba nastavit mediaWiki.apiUrl v LocalSettings.js na serveru vieweru.');
  const model = await fetchWikiModel(article);
  return openModel(model, tag);
}

function openFromHash() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  if (hash.get('page') === 'about') return renderAbout({ updateLocation: false });
  const modelId = hash.get('model');
  if (!modelId) return;
  const model = models.find((item) => item.id === modelId || item.file?.split('/').pop() === modelId);
  if (model) openIndexedWikiModel(model, hash.get('tag'));
}

async function requestWikiEdit() {
  if (!isWikiModel()) return;
  if (isWikiEditRoute()) return exitWikiEdit();
  try {
    wikiSessionUser = await fetchWikiSessionUser(wikiConfig.endpoint);
    if (!wikiSessionUser || !wikiSessionUser.rights.includes('edit')) {
      showToast('Přihlaste se do MediaWiki účtem, který smí upravovat stránky.', 'error');
      if (wikiConfig.loginUrl) window.open(wikiConfig.loginUrl, '_blank', 'noopener');
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('edit', '1');
    window.location.assign(url);
  } catch (error) {
    showToast(`Přihlášení nelze ověřit: ${error.message}`, 'error');
  }
}

function exitWikiEdit() {
  if (wikiSaveInFlight) {
    showToast('Ukládání do článku 3D ještě probíhá. Počkejte na potvrzení o uložení.', 'error');
    return;
  }
  if (settings.wikiDirty && !window.confirm('Neuložené změny se ztratí. Chcete přejít do režimu prohlížení?')) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('edit');
  window.location.assign(url);
}

async function saveWikiModel() {
  if (!isWikiModel() || !settings.canEdit) return requestWikiEdit();
  if (wikiSaveInFlight) return;
  const savedRevision = modelRevision;
  const savedDefaultViewRevision = defaultViewRevision;
  const savedDefaultOrientationRevision = defaultOrientationRevision;
  const parserTag = createModel3dTag(currentModel);
  const text = replaceModel3dTag(currentModel.wikitext, parserTag);
  wikiSaveInFlight = true;
  updateWikiSaveControl();
  try {
    setLoadingStatus('Ukládání změn do MediaWiki…');
    const result = await publishWithWikiSession({ endpoint: wikiConfig.endpoint, title: currentModel.article, text });
    currentModel.wikitext = text;
    // Do not clear an edit made while the request was in flight. Otherwise a
    // second "Nastavit aktuální pohled" could look saved although the first
    // request only contained the previous camera state.
    if (modelRevision === savedRevision) settings.wikiDirty = false;
    if (defaultViewRevision === savedDefaultViewRevision) settings.defaultViewDirty = false;
    if (defaultOrientationRevision === savedDefaultOrientationRevision) settings.defaultOrientationDirty = false;
    updateWikiSaveControl();
    setLoadingStatus(settings.wikiDirty ? 'Změny jsou uloženy; další změny čekají na uložení' : 'Změny jsou uloženy');
    renderCurrentSidebar();
    showToast(settings.wikiDirty
      ? `Změny uložil uživatel ${result.user.name}; další úpravy ještě uložte.`
      : `Změny uložil uživatel ${result.user.name}.`);
  } catch (error) {
    setLoadingStatus('Uložení se nezdařilo');
    showToast(error.message, 'error');
  } finally {
    wikiSaveInFlight = false;
    updateWikiSaveControl();
  }
}

function modelsUsingSharedCategories() {
  const knownModels = [...models];
  if (currentModel && !knownModels.some((model) => model.article === currentModel.article || model.id === currentModel.id)) {
    knownModels.push(currentModel);
  }
  return knownModels.flatMap((model) => (model.tags || []).map((tag) => tag.category || 'obecne'));
}

function manageCategories({ startAdding = false, selectForDraft = false } = {}) {
  if (!isWikiModel() || !settings.canEdit) return requestWikiEdit();
  const definitions = categoryCatalog.categories.length
    ? categoryCatalog.categories
    : currentCategoryDefinitions();
  showCategoryDialog(definitions, {
    usedCategoryIds: modelsUsingSharedCategories(),
    startAdding,
    onSave: async (categories) => {
      const article = categoryCatalog.article || wikiConfig.categoryPage;
      if (!article) throw new Error('Není nastaven článek se společnými kategoriemi.');
      const parserTag = categoryTagFromDefinitions(categories);
      const wikitext = replaceCategoryTag(categoryCatalog.wikitext, parserTag);
      const result = await publishWithWikiSession({
        endpoint: wikiConfig.endpoint,
        title: article,
        text: wikitext,
        summary: 'Aktualizace společných kategorií 3D popisků'
      });
      categoryCatalog = { article: result.publishedTitle || article, categories, wikitext };
      settings.categoryDefinitions = currentCategoryDefinitions();
      if (selectForDraft && tagDraft) {
        tagDraft.category = categories.at(-1)?.id || tagDraft.category;
        saveTagDraft();
      }
      annotationManager.setTags(currentModel.tags || [], { categories: currentCategoryDefinitions() });
      renderCurrentSidebar();
      if (tagDraft) renderTagDraft();
      showToast(`Společné kategorie uložil uživatel ${result.user.name}.`);
    }
  });
}

function destroyViewer() {
  loadRequestId += 1;
  hidePersistentNotice('tag-draft');
  annotationManager?.dispose();
  sceneManager?.dispose();
  annotationManager = undefined;
  sceneManager = undefined;
}

window.addEventListener('keydown', (event) => { if (event.key.toLowerCase() === 'l') leaderKeyActive = true; });
window.addEventListener('keyup', (event) => { if (event.key.toLowerCase() === 'l') leaderKeyActive = false; });
window.addEventListener('hashchange', () => { if (!currentModel) openFromHash(); });
window.addEventListener('focus', () => { refreshWikiSessionUser(); });

initialize();
