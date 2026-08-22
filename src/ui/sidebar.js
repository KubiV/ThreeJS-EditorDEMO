import { categoryColor, capitalizeTitle, normalizeCategoryDefinitions } from '../api/model3d-format.js';
import { escapeHtml, renderWikitext } from '../annotations/wikitext.js';

export const DEFAULT_CATEGORIES = [{ id: 'obecne', name: 'Obecné', description: '' }];

export function categoryDefinitions(categories = [], tags = []) {
  // The shared catalogue is combined with legacy categories stored on older
  // model pages.  Keep the first occurrence of an id: the shared catalogue
  // is passed first and therefore remains the canonical name and colour.
  const definitions = [];
  const known = new Set();
  (categories || []).forEach((category) => {
    const normalized = normalizeCategoryDefinitions([category])[0];
    if (!normalized || known.has(normalized.id)) return;
    known.add(normalized.id);
    definitions.push(normalized);
  });
  (tags || []).forEach((tag) => {
    const id = String(tag.category || 'obecne');
    if (!known.has(id)) {
      known.add(id);
      const name = capitalizeTitle(id, 'Obecné');
      definitions.push({ id, name, description: '', color: categoryColor(name) });
    }
  });
  return definitions.length ? definitions : normalizeCategoryDefinitions(DEFAULT_CATEGORIES);
}

function categoryName(category, definitions) {
  return definitions.find((item) => item.id === category)?.name || category || 'Bez kategorie';
}

function hasGeneratedVariants(model) {
  return Boolean(model.variants?.medium && (model.variants?.small || model.variants?.low));
}

function bytesLabel(bytes) {
  if (!Number.isFinite(Number(bytes))) return '';
  const value = Number(bytes);
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} kB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function safeLink(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function renderEmbeddedSidebar(host, model, selectedTag, definitions, state, actions) {
  const tags = model.tags || [];
  const categoryById = new Map(definitions.map((category) => [category.id, category]));
  const categoryIds = [...new Set(tags.map((tag) => tag.category || 'obecne'))];
  const visibleTags = tags.filter((tag) => state.categories.has(tag.category || 'obecne'));
  const panelMode = state.embeddedPanelMode === 'detail' ? 'detail' : 'list';
  const categoryFilters = categoryIds.map((id) => {
    const category = categoryById.get(id);
    const color = category?.color || categoryColor(category?.name || id);
    const count = tags.filter((tag) => (tag.category || 'obecne') === id).length;
    return `<label title="${escapeHtml(category?.description || '')}"><input type="checkbox" data-category="${escapeHtml(id)}" aria-label="Zobrazit kategorii ${escapeHtml(category?.name || id)}" ${state.categories.has(id) ? 'checked' : ''}><i class="category-swatch" style="--category-color:${escapeHtml(color)}"></i><span>${escapeHtml(category?.name || id)}</span><small>${count}</small></label>`;
  }).join('');
  const selectedVisible = selectedTag && visibleTags.some((tag) => tag.id === selectedTag.id) ? selectedTag : undefined;
  const tagGroups = categoryIds
    .filter((id) => state.categories.has(id))
    .map((id) => {
      const category = categoryById.get(id);
      const color = category?.color || categoryColor(category?.name || id);
      const categoryTags = visibleTags.filter((tag) => (tag.category || 'obecne') === id);
      if (!categoryTags.length) return '';
      return `<section class="embed-tag-group"><h2><i class="category-swatch" style="--category-color:${escapeHtml(color)}"></i>${escapeHtml(category?.name || id)}<small>${categoryTags.length}</small></h2><div>${categoryTags.map((tag) => `<button type="button" class="embed-tag-item ${tag.id === selectedVisible?.id ? 'is-active' : ''}" data-tag="${escapeHtml(tag.id)}"><span>${escapeHtml(tag.title)}</span><span aria-hidden="true">→</span></button>`).join('')}</div></section>`;
    }).join('');
  const panelContent = panelMode === 'list'
    ? `<section class="embed-tag-groups" aria-label="Seznam štítků podle kategorií">${tagGroups || `<p class="embed-empty-note">${tags.length ? 'Vyberte alespoň jednu kategorii.' : 'Model nemá žádné popisky.'}</p>`}</section>`
    : `<section class="embed-description ${selectedVisible ? '' : 'is-empty'}" aria-live="polite">${selectedVisible ? `<h2>${escapeHtml(selectedVisible.title)}</h2><p class="embed-category">${escapeHtml(categoryName(selectedVisible.category, definitions))}</p><div class="wikitext">${renderWikitext(selectedVisible.description, { wikiArticleUrl: state.wikiArticleUrl })}</div>` : '<p>Klikněte na štítek přímo v 3D modelu. Jeho popisek se zobrazí zde.</p>'}</section>`;
  host.innerHTML = `
    <aside class="embed-sidebar" aria-label="Popisky modelu">
      <p class="eyebrow">3D POPISKY</p>
      ${categoryFilters ? `<fieldset class="embed-category-filters"><legend>Kategorie</legend><div>${categoryFilters}</div></fieldset>` : ''}
      <div class="embed-panel-switch" role="group" aria-label="Obsah pravého panelu"><button type="button" data-embedded-mode="list" class="${panelMode === 'list' ? 'is-active' : ''}" aria-pressed="${panelMode === 'list'}">Seznam štítků</button><button type="button" data-embedded-mode="detail" class="${panelMode === 'detail' ? 'is-active' : ''}" aria-pressed="${panelMode === 'detail'}">Popisek štítku</button></div>
      ${panelContent}
    </aside>`;
  host.querySelectorAll('[data-tag]').forEach((button) => button.addEventListener('click', () => actions.select(button.dataset.tag)));
  host.querySelectorAll('[data-category]').forEach((input) => input.addEventListener('change', () => {
    actions.category(input.dataset.category, input.checked);
  }));
  host.querySelectorAll('[data-embedded-mode]').forEach((button) => button.addEventListener('click', () => {
    actions.embeddedMode(button.dataset.embeddedMode);
  }));
}

export function renderSidebar(host, model, selectedTag, state, actions) {
  const collapsed = host.classList.contains('is-collapsed');
  const definitions = categoryDefinitions(state.categoryDefinitions, model.tags);
  if (state.embedded) {
    renderEmbeddedSidebar(host, model, selectedTag, definitions, state, actions);
    return;
  }
  const categoryById = new Map(definitions.map((category) => [category.id, category]));
  const categories = [...new Set((model.tags || []).map((tag) => tag.category || 'obecne'))];
  const selectedId = selectedTag?.id;
  const editable = Boolean(state.canEdit);
  const tagList = (model.tags || []).map((tag) => {
    const category = categoryById.get(tag.category);
    const color = category?.color || categoryColor(categoryName(tag.category, definitions));
    const hidden = state.hiddenTags?.has(tag.id);
    return `<div class="tag-row ${hidden ? 'is-hidden' : ''}"><button class="tag-item ${tag.id === selectedId ? 'is-active' : ''}" data-tag="${escapeHtml(tag.id)}"><span class="tag-dot" style="--category-color:${escapeHtml(color)}"></span><span><b>${escapeHtml(tag.title)}</b><small><i class="category-swatch" style="--category-color:${escapeHtml(color)}"></i>${escapeHtml(categoryName(tag.category, definitions))}</small></span></button><button class="small-button tag-visibility" data-toggle-tag="${escapeHtml(tag.id)}" aria-label="${hidden ? 'Zobrazit' : 'Skrýt'} štítek ${escapeHtml(tag.title)}" title="${hidden ? 'Zobrazit štítek' : 'Skrýt štítek'}">${hidden ? 'Zobrazit' : 'Skrýt'}</button></div>`;
  }).join('');
  const smallInfo = model.variantInfo?.small || model.variantInfo?.low;
  const mediumInfo = model.variantInfo?.medium;
  const originalInfo = model.variantInfo?.original;
  const generatedVariants = hasGeneratedVariants(model);
  const canRequestOriginal = state.loadStrategy === 'on-demand' && generatedVariants && state.lod !== 'original';
  const appearance = state;
  const appearanceDisabled = editable ? '' : 'disabled';
  const variantRow = (label, info) => {
    const details = [bytesLabel(info?.bytes), Number.isFinite(Number(info?.triangles)) ? `${Number(info.triangles).toLocaleString('cs-CZ')} trojúhelníků` : ''].filter(Boolean).join(' · ');
    return `<div><b>${label}</b><span>${details || 'Velikost souboru není k dispozici'}</span></div>`;
  };
  const variantSummary = generatedVariants ? `<details class="model-variants"><summary>Varianty modelu jsou připraveny</summary><p class="setting-note">Pro rychlé načtení jsou k dispozici S, M a originál.</p><div class="variant-list">${variantRow('Malá (S)', smallInfo)}${variantRow('Střední (M)', mediumInfo)}${variantRow('Originál', originalInfo)}</div></details>` : '';
  const sourceUrl = safeLink(model.sourceUrl);
  const provenance = [model.license, model.author, model.origin].filter(Boolean);
  const provenanceCard = provenance.length || sourceUrl ? `<section class="provenance-card"><p class="eyebrow">PŮVOD A LICENCE</p>${model.license ? `<b>${escapeHtml(model.license)}</b>` : ''}${model.author ? `<span>${escapeHtml(model.author)}</span>` : ''}${model.origin ? `<span>${escapeHtml(model.origin)}</span>` : ''}${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Zdroj modelu ↗</a>` : ''}</section>` : '';
  const loadedObjects = state.loadedObjects?.length ? state.loadedObjects : [model.file ? model.file.split('/').pop() : 'Zatím bez modelu'];
  const isAdvanced = state.interfaceMode === 'advanced';
  const loadingInfo = isAdvanced ? `<section class="panel-section advanced-section loading-info"><div class="panel-heading"><h2>Stav modelu</h2></div><p class="loading-status"><span class="status-dot" aria-hidden="true"></span><span id="loading-status" role="status">${escapeHtml(state.loadingStatus || 'Připravuji pracovní plochu…')}</span></p></section>` : '';
  const definitionUrl = safeLink(state.wikiDefinitionUrl);
  const technicalInfo = isAdvanced ? `<details class="panel-section technical-info"><summary>Technické informace</summary><p>Načtená varianta: <b>${state.lod === 'small' ? 'Malá (S)' : state.lod === 'medium' ? 'Střední (M)' : 'Originál'}</b></p>${model.generation?.status ? `<p>Generování variant: <b>${escapeHtml(model.generation.status)}</b></p>` : ''}${definitionUrl ? `<p class="model-definition-link">Článek: <a href="${escapeHtml(definitionUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(model.article || '3D')} ↗</a></p>` : ''}<div class="loaded-model">${loadedObjects.map((name) => `<div><span class="format format-${escapeHtml(model.format || 'glb').toLowerCase()}">.${escapeHtml(model.format || 'GLB').toLowerCase()}</span><span>${escapeHtml(name)}</span></div>`).join('')}</div></details>` : '';
  const hasCustomDefaultView = Boolean(model.camera?.position && model.camera?.target);
  const defaultViewStatus = state.defaultViewDirty
    ? `${hasCustomDefaultView ? 'Vlastní' : 'Automatický'} · čeká na uložení`
    : hasCustomDefaultView ? 'Vlastní' : 'Automatický';
  const defaultViewDisabled = state.modelReady ? '' : 'disabled';
  const defaultViewSaveDisabled = editable && state.modelReady ? '' : 'disabled';
  const defaultViewGuidance = editable
    ? `<ol class="default-view-steps"><li>${state.modelReady ? 'Nastavte si model myší.' : 'Počkejte na dokončení načítání modelu.'}</li><li>Klikněte na „Nastavit aktuální pohled“.</li><li>Klikněte nahoře na „Uložit do článku 3D“.</li></ol>`
    : '<p class="setting-note">Dočasné otočení tělesa při prohlížení nemění jeho definici. Pro uložení výchozího natočení se přepněte do režimu Úpravy.</p>';
  const defaultViewPanel = isAdvanced ? `
    <section class="panel-section default-view-section"><div class="panel-heading"><h2>Výchozí pohled</h2><span class="advanced-badge">${defaultViewStatus}</span></div>
      <p class="setting-note">${hasCustomDefaultView ? 'Při otevření se použije vlastní poloha kamery uložená v definici tohoto 3D modelu.' : 'Při otevření se model automaticky zobrazí celý.'}</p>
      <div class="default-view-actions"><button type="button" class="small-button" data-action="fit-model" ${defaultViewDisabled}>Zobrazit celý model</button>${editable ? `<button type="button" class="small-button small-button-primary" data-action="save-default-view" ${defaultViewSaveDisabled}>Nastavit aktuální pohled</button>` : ''}${hasCustomDefaultView && editable ? `<button type="button" class="small-button" data-action="clear-default-view" ${defaultViewSaveDisabled}>Vrátit automatický pohled</button>` : ''}</div>
      ${state.defaultViewDirty ? '<p class="default-view-pending" role="status">Aktuální pohled je vybrán. Dokončete změnu tlačítkem „Uložit do článku 3D“ v horní liště.</p>' : ''}
      ${defaultViewGuidance}
    </section>` : '';
  const hasCustomOrientation = Boolean(model.orientation?.quaternion?.length === 4);
  const orientationStatus = state.defaultOrientationDirty
    ? `${hasCustomOrientation ? 'Vlastní' : 'Výchozí'} · čeká na uložení`
    : hasCustomOrientation ? 'Vlastní' : 'Výchozí';
  const orientationDisabled = editable && state.modelReady ? '' : 'disabled';
  const orientationPanel = isAdvanced ? `
    <section class="panel-section default-view-section object-orientation-section"><div class="panel-heading"><h2>Výchozí natočení tělesa</h2><span class="advanced-badge">${orientationStatus}</span></div>
      <p class="setting-note">Natočení patří přímo k tělesu, ne ke kameře. Pomocí barevných kruhů otáčejte kolem světových os X, Y a Z.</p>
      ${editable ? `<div class="default-view-actions"><button type="button" class="small-button small-button-primary" data-action="toggle-rotation-gizmo" ${orientationDisabled}>${state.rotationGizmoVisible ? 'Skrýt kruhy otáčení' : 'Upravit natočení kruhy'}</button><button type="button" class="small-button" data-action="save-default-orientation" ${orientationDisabled}>Uložit aktuální natočení</button>${hasCustomOrientation ? `<button type="button" class="small-button" data-action="clear-default-orientation" ${orientationDisabled}>Vrátit výchozí natočení</button>` : ''}</div>` : '<p class="setting-note">Pro změnu výchozího natočení se přepněte do režimu Úpravy.</p>'}
      ${state.rotationGizmoVisible ? '<p class="default-view-pending" role="status">Kruhy jsou aktivní. Tažením za červený, zelený nebo modrý kruh natočíte těleso.</p>' : ''}
      ${state.defaultOrientationDirty ? '<p class="default-view-pending" role="status">Natočení je připraveno. Dokončete změnu tlačítkem „Uložit změny do článku 3D“ v horní liště.</p>' : ''}
    </section>` : '';
  const appearancePanel = isAdvanced ? `
    <section class="panel-section model-appearance is-advanced"><div class="panel-heading"><h2>Vzhled modelu</h2></div><div class="settings appearance-settings">
      <label>Barva modelu<input type="color" data-appearance="color" value="${escapeHtml(appearance.color)}" ${appearanceDisabled}></label>
      <label>Barva pozadí scény<input type="color" data-appearance="sceneBackground" value="${escapeHtml(appearance.sceneBackground)}" ${appearanceDisabled}></label>
      <label>Drátěný model<input type="checkbox" data-appearance="wireframe" ${appearance.wireframe ? 'checked' : ''} ${appearanceDisabled}></label>
      <label>Drsnost <output>${appearance.roughness}</output><input type="range" data-appearance="roughness" min="0" max="1" step=".05" value="${appearance.roughness}" ${appearanceDisabled}></label>
      <label>Průhlednost <output>${Math.round(appearance.opacity * 100)} %</output><input type="range" data-appearance="opacity" min=".1" max="1" step=".05" value="${appearance.opacity}" ${appearanceDisabled}></label>
      <label>Průřez (osa X)<input type="range" data-appearance="clipX" min="-100" max="100" value="${appearance.clipX}" ${appearanceDisabled}></label>
      <label>Průřez (osa Y)<input type="range" data-appearance="clipY" min="-100" max="100" value="${appearance.clipY}" ${appearanceDisabled}></label>
      <label>Průřez (osa Z)<input type="range" data-appearance="clipZ" min="-100" max="100" value="${appearance.clipZ}" ${appearanceDisabled}></label>
    </div><p class="setting-note">${editable ? 'Změny uložíte do článku 3D modelu tlačítkem „Uložit změny“.' : 'Vzhled lze upravit po přepnutí na Úpravy.'}</p></section>` : '';
  const categoryFilters = categories.map((id) => {
    const category = categoryById.get(id);
    const color = category?.color || categoryColor(category?.name || id);
    return `<label title="${escapeHtml(category?.description || '')}"><input type="checkbox" data-category="${escapeHtml(id)}" aria-label="Zobrazit kategorii ${escapeHtml(category?.name || id)}" ${state.categories.has(id) ? 'checked' : ''}><i class="category-swatch" style="--category-color:${escapeHtml(color)}"></i>${escapeHtml(category?.name || id)}</label>`;
  }).join('');

  host.innerHTML = `
    <aside class="sidebar ${collapsed ? 'is-collapsed' : ''}">
      <div class="sidebar-top"><button class="icon-button" data-action="back" title="Zpět na 3D rozcestník" aria-label="Zpět na 3D rozcestník">←</button><div><strong>${escapeHtml(model.title)}</strong><small>${escapeHtml(model.article || '3D model')}</small></div><button class="icon-button sidebar-toggle" data-action="collapse" title="${collapsed ? 'Rozbalit boční panel' : 'Sbalit boční panel'}" aria-label="${collapsed ? 'Rozbalit boční panel' : 'Sbalit boční panel'}">${collapsed ? '⌄' : '⌃'}</button></div>
      <div class="sidebar-scroll">
        <section class="panel-section tag-section"><div class="panel-heading"><h2>Štítky a popisky</h2><span>${model.tags?.length || 0}</span></div>${editable && !state.tagDraftActive ? '<button type="button" class="tag-draft-launcher" data-action="add-tag">＋ Přidat štítek</button>' : ''}<div class="tag-tools"><button class="small-button" data-action="show-all">Zobrazit vše</button><button class="small-button" data-action="hide-all">Skrýt vše</button>${editable ? '<button class="small-button" data-action="add-category">＋ Kategorie</button><button class="small-button" data-action="manage-categories">Správa</button>' : ''}</div>
        ${categoryFilters ? `<p class="tag-visibility-heading">Zobrazení podle kategorií</p><div class="category-filters">${categoryFilters}</div>` : ''}
        <div class="tag-list">${tagList || '<p class="empty-note">Zatím nejsou vloženy žádné štítky.</p>'}</div></section>
        <section class="description-card ${selectedTag ? '' : 'is-empty'}"><p class="eyebrow">POPIS ŠTÍTKU</p>${selectedTag ? `<div class="description-heading"><h2>${escapeHtml(selectedTag.title)}</h2>${editable ? '<div class="description-actions"><button class="small-button" data-action="edit-tag">Upravit</button><button class="small-button small-button-danger" data-action="delete-tag">Odstranit</button></div>' : ''}</div><div class="wikitext">${renderWikitext(selectedTag.description, { wikiArticleUrl: state.wikiArticleUrl })}</div>` : '<p>Vyberte štítek v seznamu nebo přímo v 3D pohledu.</p>'}</section>
        ${appearancePanel}
        ${isAdvanced ? `${defaultViewPanel}${orientationPanel}${loadingInfo}${variantSummary}${technicalInfo}${provenanceCard}` : ''}
      </div>
      <div class="sidebar-bottom${canRequestOriginal ? '' : ' sidebar-bottom-single'}">${canRequestOriginal ? '<button class="button button-primary" data-action="load-original" title="Načíst původní variantu modelu v plné kvalitě">Originální rozlišení modelu</button>' : ''}<button class="button button-secondary" data-action="reset">Resetovat pohled</button></div>
    </aside>`;

  host.querySelectorAll('[data-tag]').forEach((button) => button.addEventListener('click', () => actions.select(button.dataset.tag)));
  host.querySelectorAll('[data-toggle-tag]').forEach((button) => button.addEventListener('click', () => actions.toggleTag(button.dataset.toggleTag)));
  host.querySelectorAll('[data-category]').forEach((input) => input.addEventListener('change', () => actions.category(input.dataset.category, input.checked)));
  host.querySelectorAll('[data-setting]').forEach((input) => input.addEventListener('input', () => actions.setting(input.dataset.setting, input.type === 'checkbox' ? input.checked : input.value)));
  host.querySelectorAll('[data-appearance]').forEach((input) => {
    const eventName = input.matches('input[type="checkbox"]') ? 'change' : 'input';
    input.addEventListener(eventName, () => actions.appearance(input.dataset.appearance, input.type === 'checkbox' ? input.checked : input.value));
  });
  host.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => actions.action(button.dataset.action)));
}
