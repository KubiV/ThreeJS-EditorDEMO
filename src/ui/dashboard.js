import { escapeHtml } from '../annotations/wikitext.js';
import { brandMarkup, wikiSessionIndicatorMarkup } from './brand.js';

const pluralModels = (count) => (count === 1 ? 'model' : count >= 2 && count <= 4 ? 'modely' : 'modelů');
const pluralTags = (count) => (count === 1 ? 'štítek' : count >= 2 && count <= 4 ? 'štítky' : 'štítků');
const unavailablePreview = '<span class="model-placeholder" aria-label="Náhled 3D modelu není k dispozici">3D</span>';
const variantLabels = { small: 'Malá varianta (S)', medium: 'Střední varianta (M)', original: 'Originál' };
const defaultUpload = {
  maxFileSizeBytes: 50 * 1024 * 1024,
  maxFiles: 5,
  allowedExtensions: ['.stl', '.obj', '.mtl', '.gltf', '.glb']
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium' }).format(date);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function normalizeFileGroup(file) {
  if (file?.original) return file;
  return {
    id: file?.id || file?.path,
    folder: '',
    title: file?.name || '3D soubor',
    original: file || {},
    variants: [],
    additionalFiles: [],
    metadata: {},
    models: Array.isArray(file?.models) ? file.models : []
  };
}

function fileTreeRow(file, label, modifier = '') {
  const facts = [formatBytes(file.bytes), Number.isFinite(file.triangles) ? `${file.triangles.toLocaleString('cs-CZ')} trojúhelníků` : ''].filter(Boolean).join(' · ');
  return `<div class="file-tree-row ${modifier}"><span class="file-tree-kind">${escapeHtml(label)}</span><span class="format format-${escapeHtml(String(file.format || '3D').toLowerCase())}">.${escapeHtml(String(file.format || '3D').toLowerCase())}</span><span class="file-tree-name"><b>${escapeHtml(file.name || file.path || 'soubor')}</b><small>${escapeHtml(file.path || '')}</small></span>${facts ? `<em>${escapeHtml(facts)}</em>` : ''}</div>`;
}

export function renderDashboard(host, models = [], options = {}) {
  const {
    files = [],
    onOpen = () => {},
    onUpload = async () => {},
    onAbout = () => {},
    onSettings = () => {},
    wikiSessionUser = null,
    wikiSessionUserUrl = '',
    wikiSessionLoginUrl = '',
    modelAccess = { requireLogin: false },
    indexProblem = '',
    wikiStatus = { issues: [] },
    upload = defaultUpload
  } = options;
  // The MediaWiki index may be temporarily unavailable (for example while the
  // server is restarting). Keep the hub usable rather than letting an invalid
  // response take down the entire viewer.
  const modelList = Array.isArray(models) ? models : [];
  const fileList = (Array.isArray(files) ? files : []).map(normalizeFileGroup);
  const modelPreviewsRequireLogin = Boolean(modelAccess?.requireLogin && !wikiSessionUser);
  const configuredFileSizeBytes = Number(upload?.maxFileSizeBytes);
  const configuredFileSizeMB = Number(upload?.maxFileSizeMB);
  const uploadMaxFileSizeBytes = Number.isFinite(configuredFileSizeBytes) && configuredFileSizeBytes > 0
    ? configuredFileSizeBytes
    : Number.isFinite(configuredFileSizeMB) && configuredFileSizeMB > 0
      ? configuredFileSizeMB * 1024 * 1024
      : defaultUpload.maxFileSizeBytes;
  const configuredMaxFiles = Number(upload?.maxFiles);
  const uploadMaxFiles = Number.isInteger(configuredMaxFiles) && configuredMaxFiles > 0
    ? configuredMaxFiles
    : defaultUpload.maxFiles;
  const uploadExtensions = Array.isArray(upload?.allowedExtensions)
    ? upload.allowedExtensions.filter((extension) => /^\.[a-z0-9]+$/i.test(String(extension)))
    : defaultUpload.allowedExtensions;
  const uploadSizeLabel = formatBytes(uploadMaxFileSizeBytes);
  const uploadFileCountLabel = `${uploadMaxFiles} ${uploadMaxFiles === 1 ? 'soubor' : uploadMaxFiles >= 2 && uploadMaxFiles <= 4 ? 'soubory' : 'souborů'}`;
  const uploadFormatLabel = uploadExtensions.length
    ? uploadExtensions.map((extension) => extension.slice(1).toUpperCase()).join(', ')
    : 'nastavené formáty';
  const modelSummary = indexProblem
    ? 'Články ve jmenném prostoru 3D nejsou nyní dostupné.'
    : `${modelList.length} ${pluralModels(modelList.length)} definovaných ve jmenném prostoru 3D`;
  const setupIssues = Array.isArray(wikiStatus?.issues) ? wikiStatus.issues : [];
  const hasSetupError = setupIssues.some((issue) => issue?.severity === 'error');
  const setupStatus = setupIssues.length
    ? `<section class="wiki-setup-status${hasSetupError ? ' is-error' : ''}"${hasSetupError ? ' role="alert"' : ' role="status"'}><h2>Stav integrace MediaWiki</h2><ul>${setupIssues.map((issue) => `<li class="is-${escapeHtml(issue?.severity || 'warning')}">${escapeHtml(issue?.message || 'Nastavení MediaWiki vyžaduje pozornost.')}</li>`).join('')}</ul></section>`
    : '';
  const emptyModels = indexProblem
    ? `<div class="hub-index-problem" role="alert"><h3>Modely z článků se nepodařilo načíst</h3><p>${escapeHtml(indexProblem)}</p><p>Spusťte nebo připojte MediaWiki a stránku poté obnovte. Soubory uložené v úložišti zůstávají níže k dispozici.</p></div>`
    : '<div class="empty-hub"><h3>Zatím zde nejsou žádné 3D modely.</h3><p>Nahrajte soubor a vytvořte jeho definující článek.</p></div>';
  const cards = modelList.map((model) => {
    const tagCount = model.tags?.length || 0;
    const provenance = [model.license, model.origin].filter(Boolean).join(' · ');
    const preview = model.thumbnail && !modelPreviewsRequireLogin
      ? `<img class="model-thumbnail" src="${escapeHtml(model.thumbnail)}" alt="Náhled modelu ${escapeHtml(model.title)}" loading="lazy">`
      : unavailablePreview;
    return `
      <article class="model-card">
        <button type="button" class="model-preview" data-open="${escapeHtml(model.id)}" aria-label="Otevřít model ${escapeHtml(model.title)}">${preview}<span class="format format-${escapeHtml(model.format).toLowerCase()}">.${escapeHtml(model.format).toLowerCase()}</span></button>
        <div class="model-card-content">
          <h3>${escapeHtml(model.title)}</h3>
          <p>${escapeHtml(model.description || 'Bez doplňujícího popisu.')}</p>
          ${provenance ? `<small class="model-provenance">${escapeHtml(provenance)}</small>` : ''}
          <div class="model-meta"><span>${tagCount} ${pluralTags(tagCount)}</span><button class="text-button" data-open="${escapeHtml(model.id)}">Otevřít model <span aria-hidden="true">→</span></button></div>
        </div>
      </article>`;
  }).join('');
  const fileCards = fileList.map((group) => {
    const original = group.original || {};
    const variants = Array.isArray(group.variants) ? group.variants : [];
    const extraFiles = Array.isArray(group.additionalFiles) ? group.additionalFiles : [];
    const usedBy = Array.isArray(group.models) ? group.models : [];
    const metadata = group.metadata || {};
    const sourceUrl = safeHttpUrl(metadata.sourceUrl);
    const metadataRows = [
      metadata.license ? `<div><dt>Licence</dt><dd>${escapeHtml(metadata.license)}</dd></div>` : '',
      metadata.author ? `<div><dt>Autor / držitel práv</dt><dd>${escapeHtml(metadata.author)}</dd></div>` : '',
      metadata.origin ? `<div><dt>Původ</dt><dd>${escapeHtml(metadata.origin)}</dd></div>` : '',
      metadata.description ? `<div><dt>Popis</dt><dd>${escapeHtml(metadata.description)}</dd></div>` : '',
      metadata.createdAt ? `<div><dt>Nahráno</dt><dd>${escapeHtml(formatDate(metadata.createdAt))}</dd></div>` : '',
      sourceUrl ? `<div><dt>Zdroj</dt><dd><a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Otevřít zdroj ↗</a></dd></div>` : ''
    ].filter(Boolean).join('');
    const summaryFacts = [
      variants.length ? `${variants.length} ${variants.length === 1 ? 'varianta' : variants.length >= 2 && variants.length <= 4 ? 'varianty' : 'variant'}` : 'pouze originál',
      usedBy.length ? `${usedBy.length} ${pluralModels(usedBy.length)}` : ''
    ].filter(Boolean).join(' · ');
    return `<details class="file-card file-group"><summary><span class="format format-${escapeHtml(String(original.format || '3D').toLowerCase())}">.${escapeHtml(String(original.format || '3D').toLowerCase())}</span><span><b>${escapeHtml(group.title || original.name || '3D soubor')}</b><small>${group.folder ? `Složka: ${escapeHtml(group.folder)}` : 'Soubor v kořeni úložiště'}</small></span><em>${escapeHtml(summaryFacts)}</em></summary><div class="file-group-details"><section class="file-tree"><p class="file-tree-heading">Nahraný původní model</p>${fileTreeRow(original, variantLabels.original, 'file-tree-original')}${variants.length ? `<div class="file-tree-variants"><p>Vygenerované varianty</p>${variants.map((variant) => fileTreeRow(variant, variantLabels[variant.variant] || variant.variant, 'file-tree-variant')).join('')}</div>` : ''}${extraFiles.length ? `<div class="file-tree-variants file-tree-extra"><p>Další nahrané soubory</p>${extraFiles.map((file) => fileTreeRow(file, 'Doprovodný soubor', 'file-tree-variant')).join('')}</div>` : ''}</section><section class="file-upload-info"><p class="file-tree-heading">Informace při nahrání</p>${metadataRows ? `<dl>${metadataRows}</dl>` : '<p class="file-empty">Informace o nahrání nejsou u tohoto staršího souboru uložené.</p>'}</section><section class="file-card-models"><p class="file-tree-heading">Použití v článcích 3D</p>${usedBy.length ? usedBy.map((model) => `<button type="button" class="text-button" data-open="${escapeHtml(model.id)}">${escapeHtml(model.title)} <span>${escapeHtml(model.article)}</span> →</button>`).join('') : '<p>Soubor zatím není použitý v žádném dostupném článku 3D.</p>'}</section></div></details>`;
  }).join('');

  host.innerHTML = `
    <main class="wiki-shell hub">
      <header class="wiki-topbar">${brandMarkup()}<nav class="topbar-actions"><button type="button" class="topbar-link" data-action="about">O 3D prohlížeči</button><button type="button" class="topbar-icon" data-action="user-settings" aria-label="Uživatelské nastavení" title="Uživatelské nastavení">⚙</button>${wikiSessionIndicatorMarkup(wikiSessionUser, { userPageUrl: wikiSessionUserUrl, loginUrl: wikiSessionLoginUrl })}</nav></header>
      <div class="wiki-page-layout"><div class="wiki-content"><section class="hub-hero">
          <div><p class="eyebrow">ROZCESTNÍK · 3D VIZUALIZACE</p><h1>Prohlížejte modely v prostoru.</h1><p>Interaktivní 3D modely, štítky a popisky připravené pro články vaší wiki.</p></div>
          <div class="hub-actions"><button class="button button-primary" data-action="upload">Nahrát 3D model</button></div>
        </section>
        <section class="hub-section">
          ${setupStatus}
          <div class="section-title"><div><h2>Modely z článků 3D</h2><p>${modelSummary}</p></div></div>
          ${cards ? `<div class="model-grid">${cards}</div>` : emptyModels}
          <div class="section-title section-title-files"><div><h2>Soubory 3D</h2><p>${fileList.length} ${fileList.length === 1 ? 'modelová složka' : fileList.length >= 2 && fileList.length <= 4 ? 'modelové složky' : 'modelových složek'} v úložišti</p></div></div>
          ${fileCards ? `<div class="file-list">${fileCards}</div>` : '<div class="empty-hub"><h3>Úložiště souborů je prázdné.</h3></div>'}
        </section></div></div>
    </main>
    <dialog class="modal" id="upload-dialog">
      <form method="dialog" id="upload-form">
        <button class="modal-close" type="button" data-close aria-label="Zavřít">×</button>
        <h2>Průvodce nahráním 3D modelu</h2><p>Po nahrání vznikne automaticky náhled a varianty S, M a originál. Podporované formáty: ${escapeHtml(uploadFormatLabel)}. Jeden soubor může mít nejvýše ${escapeHtml(uploadSizeLabel)}; najednou lze nahrát ${escapeHtml(uploadFileCountLabel)}.</p>
        <section class="upload-step"><p class="upload-step-title"><span>1</span> Základní údaje</p>
          <label>Název modelu<input name="title" required maxlength="120" placeholder="Např. Srdce – přední pohled" /></label>
          <label>Stručný popis<textarea name="description" rows="3" placeholder="Určeno pro článek…"></textarea></label>
        </section>
        <section class="upload-step"><p class="upload-step-title"><span>2</span> Autorství a licence</p>
          <label>Licence<select name="license" required><option value="">Vyberte licenci…</option><option>CC BY 4.0</option><option>CC BY-SA 4.0</option><option>CC0 1.0</option><option>Public domain</option><option>Vlastní licence / práva vyhrazena</option><option>Jiná (uveďte v původu)</option></select></label>
          <label>Autor / držitel práv<input name="author" maxlength="160" placeholder="Např. autor nebo instituce" /></label>
          <label>Původ modelu<input name="origin" required maxlength="300" placeholder="Např. sbírka, projekt nebo databáze" /></label>
          <label>Zdrojový odkaz<input name="sourceUrl" type="url" maxlength="1000" placeholder="https://…" /><small>Odkaz na stránku původu nebo licenci.</small></label>
        </section>
        <section class="upload-step"><p class="upload-step-title"><span>3</span> Soubory</p>
          <label>Soubory modelu<input name="files" type="file" required multiple accept="${escapeHtml(uploadExtensions.join(','))}" /></label>
          <div class="upload-file-limits" role="note">
            <span>Maximální velikost souboru</span>
            <strong>${escapeHtml(uploadSizeLabel)}</strong>
            <small>na jeden soubor · najednou lze nahrát ${escapeHtml(uploadFileCountLabel)}</small>
          </div>
        </section>
        <div class="form-actions"><button type="button" data-close class="button button-secondary">Zrušit</button><button class="button button-primary" type="submit">Nahrát model</button></div>
        <p class="form-message" role="status"></p>
      </form>
    </dialog>`;

  const uploadDialog = host.querySelector('#upload-dialog');
  host.querySelector('[data-action="upload"]').addEventListener('click', () => uploadDialog.showModal());
  host.querySelector('[data-action="about"]').addEventListener('click', onAbout);
  host.querySelector('[data-action="user-settings"]').addEventListener('click', onSettings);
  host.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => onOpen(button.dataset.open)));
  host.querySelectorAll('.model-thumbnail').forEach((image) => image.addEventListener('error', () => {
    const placeholder = document.createElement('span');
    placeholder.className = 'model-placeholder';
    placeholder.setAttribute('aria-label', 'Náhled 3D modelu není k dispozici');
    placeholder.textContent = '3D';
    image.replaceWith(placeholder);
  }, { once: true }));
  host.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => uploadDialog.close()));
  const uploadForm = host.querySelector('#upload-form');
  const titleInput = uploadForm.elements.title;
  const fileInput = uploadForm.elements.files;
  titleInput.addEventListener('input', () => titleInput.setCustomValidity(''));
  fileInput.addEventListener('change', () => {
    const selectedFiles = Array.from(fileInput.files || []);
    const oversizedFile = Number.isFinite(uploadMaxFileSizeBytes) && uploadMaxFileSizeBytes > 0
      ? selectedFiles.find((file) => file.size > uploadMaxFileSizeBytes)
      : undefined;
    if (oversizedFile) {
      fileInput.setCustomValidity(`Soubor „${oversizedFile.name}“ je větší než povolených ${uploadSizeLabel}.`);
    } else if (Number.isInteger(uploadMaxFiles) && uploadMaxFiles > 0 && selectedFiles.length > uploadMaxFiles) {
      fileInput.setCustomValidity(`Najednou lze nahrát nejvýše ${uploadFileCountLabel}.`);
    } else {
      fileInput.setCustomValidity('');
    }
  });
  uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector('.form-message');
    const submit = form.querySelector('[type="submit"]');
    try {
      submit.disabled = true;
      message.textContent = 'Nahrávám model, vytvářím náhled a varianty S/M…';
      await onUpload(new FormData(form));
      uploadDialog.close();
    } catch (error) {
      message.textContent = error.message;
      if (error.field === 'title') {
        titleInput.setCustomValidity(error.message);
        titleInput.reportValidity();
        titleInput.focus();
      }
    } finally {
      submit.disabled = false;
    }
  });
}
