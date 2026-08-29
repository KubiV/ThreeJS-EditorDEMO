import { escapeHtml } from '../annotations/wikitext.js';
import { DEFAULT_CATEGORIES } from './sidebar.js';
import { formatLineLength, lineLengthControlMarkup, lineLengthControlValues } from './line-length-control.js';
import { actionIconMarkup } from './brand.js';
import { getRegisteredModules, getModule } from '../modules/module-registry.js';
import { getIfaaUrl } from '../modules/anatomy/index.js';

let activeSearchDebounce = null;
let currentSearchResults = [];
let searchDropdownOpen = false;

export function isTermTaggedOnModel(term, existingTags = []) {
  if (!term || !existingTags || !existingTags.length) return false;
  const tCode = term.taCode || term.id;
  const tLatin = (term.latin || '').toLowerCase().trim();
  for (const tag of existingTags) {
    if (tag.module?.termId && (tag.module.termId === tCode || tag.module.termId === term.id)) return true;
    if (tag.title && tag.title.toLowerCase().trim() === tLatin) return true;
  }
  return false;
}

function buildModuleMarkup(draft, availableModules, systems = []) {
  const activeModuleId = draft.selectedModuleId !== undefined
    ? draft.selectedModuleId
    : (draft.module?.id || 'anatomy');
  const hasModule = Boolean(activeModuleId);
  const assignedTerm = draft.module;
  const moduleMode = draft.moduleMode || 'structure'; // 'structure' | 'direct'

  const moduleOptions = [
    '<option value="">Bez modulu (vlastní zadání)</option>',
    ...availableModules.map((mod) => `<option value="${escapeHtml(mod.id)}" ${activeModuleId === mod.id ? 'selected' : ''}>${escapeHtml(mod.name)}</option>`)
  ].join('');

  const systemFilterOptions = [
    '<option value="">Všechny orgánové soustavy</option>',
    ...systems.map((sys) => `<option value="${escapeHtml(sys.id)}" ${draft.moduleSystemFilter === sys.id ? 'selected' : ''}>${escapeHtml(sys.shortName || sys.name)}</option>`)
  ].join('');

  let assignedCard = '';
  if (assignedTerm) {
    const ifaaUrl = assignedTerm.termId ? getIfaaUrl(assignedTerm.termId) : '';
    const assignedCodeMarkup = ifaaUrl
      ? `<a href="${escapeHtml(ifaaUrl)}" target="_blank" rel="noopener noreferrer" class="assigned-term-code-link" title="Otevřít oficiální strom Terminologia Anatomica (IFAA)">${escapeHtml(assignedTerm.termId || '–')} ↗</a>`
      : `<strong class="assigned-term-code">${escapeHtml(assignedTerm.termId || '–')}</strong>`;

    assignedCard = `
      <div class="assigned-term-card">
        <div class="assigned-term-meta">
          <span class="assigned-term-badge">TA 1989</span>
          ${assignedCodeMarkup}
          ${assignedTerm.parent ? `<span class="assigned-term-parent-badge" title="Nadřazená struktura / kost">📍 ${escapeHtml(assignedTerm.parent)}</span>` : ''}
          <span class="assigned-term-system">${escapeHtml(assignedTerm.system || '')}</span>
        </div>
        ${assignedTerm.path ? `<div class="assigned-term-path" title="Hierarchická cesta">${escapeHtml(assignedTerm.path)}</div>` : ''}
        <div class="assigned-term-names">
          <div class="assigned-term-latin"><b>Latinsky:</b> <span>${escapeHtml(assignedTerm.latin || draft.title)}</span></div>
          ${assignedTerm.english ? `<div class="assigned-term-english"><b>Anglicky:</b> <span>${escapeHtml(assignedTerm.english)}</span></div>` : ''}
        </div>
        <div class="assigned-term-actions">
          <button type="button" class="small-button" data-insert-description title="Vložit anglický název a TA kód s odkazem do popisku štítku">${actionIconMarkup('add')}Vložit do popisku</button>
          <button type="button" class="small-button small-button-danger" data-clear-term title="Odpojit tento termín">${actionIconMarkup('delete')}Odpojit</button>
        </div>
      </div>`;
  }

  const hasStructure = Boolean(draft.moduleStructureFilter && draft.moduleStructureFilter.trim());

  return `
    <fieldset class="module-section-card ${hasModule ? 'is-active' : ''}">
      <legend>Odborný modul</legend>
      <label class="module-select-label">Vybrat modul
        <select name="selectedModule">${moduleOptions}</select>
      </label>
      ${hasModule ? `
        <div class="module-mode-tabs">
          <button type="button" class="module-mode-tab ${moduleMode === 'structure' ? 'is-active' : ''}" data-set-module-mode="structure" title="Filtrovat všechny prvky vybrané kosti nebo orgánu">Podle struktury (kosti / orgánu)</button>
          <button type="button" class="module-mode-tab ${moduleMode === 'direct' ? 'is-active' : ''}" data-set-module-mode="direct" title="Přímé fulltextové vyhledání termínu v databázi">Hledat jednotlivý termín</button>
        </div>

        ${moduleMode === 'structure' ? `
          <div class="module-structure-wrap">
            <label class="module-structure-label">Filtr podle struktury / kosti
              <span class="field-note">např. Scapula, Femur, Cranium…</span>
              <div class="module-structure-input-container">
                <input type="search" name="moduleStructureFilter" value="${escapeHtml(draft.moduleStructureFilter || '')}" placeholder="Zadejte název (např. Scapula, Femur…)" autocomplete="off" />
                <button type="button" class="module-clear-structure-btn" data-clear-structure title="Zrušit filtr struktury" ${hasStructure ? '' : 'hidden'}>${actionIconMarkup('cancel')}</button>
              </div>
            </label>

            <div class="module-structure-container" data-structure-container>
              <div class="module-structure-browser" data-structure-browser ${hasStructure ? '' : 'hidden'}>
                <div class="module-structure-browser-loading">Načítám prvky struktury ${escapeHtml(draft.moduleStructureFilter || '')}…</div>
              </div>
              <div class="module-structure-prompt" data-structure-prompt ${hasStructure ? 'hidden' : ''}>
                <p>💡 Zadejte název kosti nebo orgánu výše (např. <b>Scapula</b>, <b>Femur</b>) a zobrazí se všechny její anatomické prvky pro rychlé vyklikání na 3D model.</p>
              </div>
            </div>
            ${assignedCard}
          </div>
        ` : `
          <div class="module-search-wrap">
            <label>Vyhledat v Terminologia Anatomica <span class="field-note">podporuje překlepy, latinu, angličtinu i kód</span>
              <div class="module-search-inputs">
                <input type="search" name="moduleSearchQuery" value="${escapeHtml(draft.moduleSearchQuery || '')}" placeholder="Zadejte název (např. caput femoris, femur, A02.8...)" autocomplete="off" />
                <select name="moduleSystemFilter">${systemFilterOptions}</select>
              </div>
            </label>
            <div class="module-search-dropdown ${searchDropdownOpen ? 'is-open' : ''}" data-search-dropdown ${searchDropdownOpen ? '' : 'hidden'}>
              <div class="module-search-dropdown-scroll"></div>
            </div>
            ${assignedCard}
          </div>
        `}
      ` : ''}
    </fieldset>`;
}

async function renderStructureBrowserContent(host, draft, existingTags = [], onSelectTerm) {
  const browserEl = host.querySelector('[data-structure-browser]');
  if (!browserEl) return;
  const anatomyModule = getModule('anatomy');
  if (!anatomyModule) return;

  const query = draft.moduleStructureFilter;
  if (!query || !query.trim()) {
    browserEl.hidden = true;
    browserEl.innerHTML = '';
    delete browserEl.dataset.renderedQuery;
    return;
  }

  const subQuery = draft.moduleStructureSubQuery || '';
  const activeTab = draft.moduleStructureTab || 'direct'; // 'direct' | 'related' | 'all'

  try {
    const res = await anatomyModule.getStructureElements(query, { subQuery });
    const direct = res.direct || [];
    const related = res.related || [];
    const totalCount = res.totalCount || 0;

    let displayList = [];
    if (activeTab === 'direct') {
      displayList = direct.length ? direct : related;
    } else if (activeTab === 'related') {
      displayList = related;
    } else {
      displayList = [...direct, ...related];
    }

    const selectedTermId = draft.module?.termId || '';
    const selectedTitle = (draft.title || '').trim().toLowerCase();
    const directCount = direct.length;
    const relatedCount = related.length;

    const listHtml = displayList.length === 0 ? `
      <p class="module-structure-empty">Žádné prvky neodpovídají zadanému filtru „${escapeHtml(subQuery)}“.</p>
    ` : displayList.map((term) => {
      const isSelected = (selectedTermId && (term.taCode === selectedTermId || term.id === selectedTermId)) || (selectedTitle && term.latin && term.latin.toLowerCase() === selectedTitle);
      const isTagged = isTermTaggedOnModel(term, existingTags);
      return `
        <button type="button" class="module-structure-item ${isSelected ? 'is-selected' : ''}" data-structure-item-id="${escapeHtml(term.id)}" title="${escapeHtml(term.path || term.latin)}">
          <div class="module-term-top">
            <strong class="module-term-latin">${escapeHtml(term.latin)}</strong>
            ${term.taCode ? `<span class="module-term-code">${escapeHtml(term.taCode)}</span>` : ''}
          </div>
          <div class="module-term-bottom">
            <span class="module-term-english">${escapeHtml(term.english || '')}</span>
            <div class="module-term-tags">
              ${term.parent && term.parent.toLowerCase() !== query.toLowerCase() ? `<span class="module-term-parent-badge" title="Nadřazená struktura">📍 ${escapeHtml(term.parent)}</span>` : ''}
              ${isTagged ? `<span class="module-term-tagged-badge" title="Tento štítek se již nachází na 3D modelu">✓ Na modelu</span>` : ''}
            </div>
          </div>
        </button>
      `;
    }).join('');

    const existingHeader = browserEl.querySelector('.module-structure-browser-header');
    const existingListScroll = browserEl.querySelector('.module-structure-list-scroll');
    const currentRenderedQuery = browserEl.dataset.renderedQuery;

    if (existingHeader && existingListScroll && currentRenderedQuery === query) {
      // Just update list items and tabs in place without rebuilding DOM or dropping input focus
      existingListScroll.innerHTML = listHtml;
      const tabs = browserEl.querySelectorAll('[data-structure-tab]');
      tabs.forEach((tabBtn) => {
        tabBtn.classList.toggle('is-active', tabBtn.dataset.structureTab === activeTab);
      });
    } else {
      browserEl.dataset.renderedQuery = query;
      browserEl.innerHTML = `
        <div class="module-structure-browser-header">
          <div class="module-structure-title-row">
            <span class="module-structure-badge">Struktura:</span>
            <strong class="module-structure-name">${escapeHtml(query)}</strong>
            <span class="module-structure-count" title="Počet dostupných prvků">${totalCount} prvků</span>
            <button type="button" class="module-structure-clear-link" data-clear-structure-link title="Zrušit filtr struktury">Změnit strukturu</button>
          </div>
          ${(directCount > 0 && relatedCount > 0) ? `
            <div class="module-structure-tabs">
              <button type="button" class="module-subtab ${activeTab === 'direct' ? 'is-active' : ''}" data-structure-tab="direct">Přímé části (${directCount})</button>
              <button type="button" class="module-subtab ${activeTab === 'related' ? 'is-active' : ''}" data-structure-tab="related">Související (${relatedCount})</button>
              <button type="button" class="module-subtab ${activeTab === 'all' ? 'is-active' : ''}" data-structure-tab="all">Vše (${totalCount})</button>
            </div>
          ` : ''}
          <div class="module-structure-subfilter-wrap">
            <input type="search" name="moduleStructureSubQuery" value="${escapeHtml(subQuery)}" placeholder="🔍 Filtrovat v prvcích (např. fossa, margo, spina…)" autocomplete="off" class="module-structure-subfilter-input" />
          </div>
        </div>
        <div class="module-structure-list-scroll">
          ${listHtml}
        </div>
      `;

      // Tab buttons
      browserEl.querySelectorAll('[data-structure-tab]').forEach((tabBtn) => {
        tabBtn.addEventListener('click', (e) => {
          e.preventDefault();
          draft.moduleStructureTab = tabBtn.dataset.structureTab;
          renderStructureBrowserContent(host, draft, existingTags, onSelectTerm);
        });
      });

      // Sub-filter input
      const subFilterInput = browserEl.querySelector('[name="moduleStructureSubQuery"]');
      if (subFilterInput) {
        subFilterInput.addEventListener('input', (e) => {
          draft.moduleStructureSubQuery = e.target.value;
          clearTimeout(activeSearchDebounce);
          activeSearchDebounce = setTimeout(() => {
            renderStructureBrowserContent(host, draft, existingTags, onSelectTerm);
          }, 120);
        });
      }

      // Clear link in header
      const clearLink = browserEl.querySelector('[data-clear-structure-link]');
      if (clearLink) {
        clearLink.addEventListener('click', () => {
          draft.moduleStructureFilter = '';
          draft.moduleStructureSubQuery = '';
          const structInput = host.querySelector('[name="moduleStructureFilter"]');
          if (structInput) {
            structInput.value = '';
            structInput.focus();
          }
          const clearBtn = host.querySelector('[data-clear-structure]');
          if (clearBtn) clearBtn.hidden = true;
          const promptEl = host.querySelector('[data-structure-prompt]');
          if (promptEl) promptEl.hidden = false;
          browserEl.hidden = true;
          browserEl.innerHTML = '';
          delete browserEl.dataset.renderedQuery;
        });
      }
    }

    // Element item click
    browserEl.querySelectorAll('[data-structure-item-id]').forEach((itemBtn) => {
      itemBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const id = itemBtn.dataset.structureItemId;
        const clicked = displayList.find((t) => t.id === id);
        if (clicked) {
          onSelectTerm(clicked);
        }
      });
    });
  } catch (err) {
    browserEl.innerHTML = `<p class="module-structure-empty">Chyba při načítání prvků: ${escapeHtml(err.message)}</p>`;
  }
}

async function performSearch(host, query, systemId, onSelectTerm) {
  const dropdown = host.querySelector('[data-search-dropdown]');
  if (!dropdown) return;
  const scrollContainer = dropdown.querySelector('.module-search-dropdown-scroll');

  const anatomyModule = getModule('anatomy');
  if (!anatomyModule) return;

  scrollContainer.innerHTML = '<p class="module-dropdown-loading">Hledám v Terminologia Anatomica…</p>';
  dropdown.hidden = false;
  dropdown.classList.add('is-open');
  searchDropdownOpen = true;

  try {
    const results = await anatomyModule.searchTerms(query, { systemId, limit: 30 });
    currentSearchResults = results;

    if (!results.length) {
      scrollContainer.innerHTML = '<p class="module-dropdown-empty">Nenalezen žádný odpovídající termín.</p>';
      return;
    }

    scrollContainer.innerHTML = results.map((term) => {
      const parentLabel = term.parent ? term.parent : (term.section || term.systemId);
      const breadcrumb = term.path || (term.parent ? `${term.systemId} > ${term.parent}` : '');
      return `
        <button type="button" class="module-term-item" data-term-id="${escapeHtml(term.id)}" title="${escapeHtml(breadcrumb || term.latin)}">
          <div class="module-term-top">
            <strong class="module-term-latin">${escapeHtml(term.latin)}</strong>
            ${term.taCode ? `<span class="module-term-code">${escapeHtml(term.taCode)}</span>` : ''}
          </div>
          <div class="module-term-bottom">
            ${term.english ? `<span class="module-term-english">${escapeHtml(term.english)}</span>` : ''}
            <span class="module-term-parent-badge" title="Nadřazená struktura / kost">📍 ${escapeHtml(parentLabel)}</span>
          </div>
          ${breadcrumb ? `<div class="module-term-path">${escapeHtml(breadcrumb)}</div>` : ''}
        </button>`;
    }).join('');

    scrollContainer.querySelectorAll('[data-term-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const found = currentSearchResults.find((t) => t.id === button.dataset.termId);
        if (found) {
          searchDropdownOpen = false;
          dropdown.hidden = true;
          dropdown.classList.remove('is-open');
          onSelectTerm(found);
        }
      });
    });
  } catch (error) {
    scrollContainer.innerHTML = `<p class="module-dropdown-empty">Chyba vyhledávání: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Persistent panel used while creating a label.
 */
export function renderTagDraftPanel(host, draft, {
  categories = DEFAULT_CATEGORIES,
  existingTags = [],
  onChange,
  onSave,
  onCancel,
  onResetAnchor,
  onEditAnchor,
  onClearSurface,
  onAddCategory,
  anchorSelectionActive = false,
  hasEditedAnchor = false
}) {
  const isAnchored = Array.isArray(draft.position);
  const hasPaintedSurface = Boolean(draft.highlight?.points?.length);
  const lineLengthControl = lineLengthControlValues(draft);
  const brushMode = Boolean(draft.brushMode);
  const brushRadius = Number(draft.brushRadius) || 1;
  const brushMinimum = Number(draft.brushMinRadius) || 0.01;
  const brushMaximum = Number(draft.brushMaxRadius) || Math.max(brushRadius, 1);
  const brushStep = Number(draft.brushStep) || 0.01;
  const categoryColor = categories.find((category) => category.id === draft.category)?.color || '#d64b3b';
  const colorMode = (draft.brushColorMode === 'custom' || draft.style?.colorMode === 'custom') ? 'custom' : 'category';
  const brushColor = colorMode === 'custom' && /^#[0-9a-f]{6}$/i.test(String(draft.brushColor || draft.style?.color || ''))
    ? (draft.brushColor || draft.style?.color)
    : categoryColor;

  const availableModules = getRegisteredModules();
  const anatomyModule = getModule('anatomy');
  let anatomySystems = [];

  host.innerHTML = `
    <aside class="tag-draft-panel" aria-label="Nový štítek modelu">
      <div class="resize-handle resize-handle-draft-right" aria-hidden="true" title="Změnit šířku panelu"></div>
      <div class="resize-handle resize-handle-draft-bottom" aria-hidden="true" title="Změnit výšku panelu"></div>
      <div class="resize-handle resize-handle-draft-corner" aria-hidden="true" title="Změnit rozměry panelu"></div>
      
      <div class="sidebar-top tag-draft-top">
        <div class="sidebar-title-wrap tag-draft-title-wrap">
          <p class="eyebrow">EDITOR POPISKU</p>
          <h2>Nový štítek</h2>
        </div>
        <button type="button" class="icon-button" data-cancel title="Zavřít přidávání štítku" aria-label="Zavřít přidávání štítku">${actionIconMarkup('cancel')}</button>
      </div>

      <div class="sidebar-scroll tag-draft-scroll">
        <ol class="draft-steps"><li class="is-done">1. Nastavte údaje</li><li class="${isAnchored ? 'is-done' : 'is-current'}">2. ${brushMode ? 'Namalujte plochu' : 'Vyberte bod'}</li><li class="${isAnchored ? 'is-current' : ''}">3. Uložte štítek</li></ol>
        <p class="draft-autosave">Rozpracovaný štítek se průběžně ukládá v tomto prohlížeči.</p>
        
        ${buildModuleMarkup(draft, availableModules, anatomySystems)}

        <label>Název štítku (hlavní text)<input name="title" value="${escapeHtml(draft.title)}" placeholder="Např. Caput femoris" autocomplete="off" /></label>
        <div class="draft-category-row"><label>Kategorie<select name="category">${categories.map((category) => `<option value="${escapeHtml(category.id)}" ${draft.category === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></label><button type="button" class="small-button" data-add-category>${actionIconMarkup('add')}Nová kategorie</button></div>
        <fieldset class="brush-mode-card ${brushMode ? 'is-active' : ''}"><legend>Štětec plochy</legend><label class="brush-toggle"><input type="checkbox" name="brushMode" ${brushMode ? 'checked' : ''}><span><b>Plošné zvýraznění</b><small>Namaluje část modelu místo jediného bodu.</small></span></label><div class="brush-settings ${brushMode ? '' : 'is-disabled'}"><label class="brush-category-colour"><span>Barva z kategorie</span><i style="--brush-category-color:${escapeHtml(categoryColor)}"></i><input type="checkbox" name="brushColorOverride" ${colorMode === 'custom' ? 'checked' : ''} ${brushMode ? '' : 'disabled'}> Ručně přepsat</label><label>Barva štítku a plochy<input type="color" name="brushColor" value="${escapeHtml(brushColor)}" ${brushMode && colorMode === 'custom' ? '' : 'disabled'}></label><label>Velikost štětce <output data-brush-radius>${formatLineLength(brushRadius, brushStep)}</output><input type="range" name="brushRadius" min="${brushMinimum}" max="${brushMaximum}" step="${brushStep}" value="${brushRadius}" ${brushMode ? '' : 'disabled'}></label>${hasPaintedSurface ? `<button type="button" class="small-button small-button-danger" data-clear-surface>${actionIconMarkup('delete')}Vymazat plochu</button>` : ''}</div><p class="draft-help brush-help">${brushMode ? 'Štětec je aktivní — malujte levým tlačítkem po modelu. Pro otočení táhněte mimo model nebo držte Alt, pro posun táhněte pravým tlačítkem.' : 'Zapnutím štětce můžete místo bodu zvýraznit celou plochu modelu.'}</p></fieldset>
        ${!brushMode ? `
        <fieldset class="tag-editor-style"><legend>Barva a vodicí čára</legend><label>Barva<select name="colorMode"><option value="category" ${colorMode === 'category' ? 'selected' : ''}>Podle kategorie</option><option value="custom" ${colorMode === 'custom' ? 'selected' : ''}>Vlastní barva</option></select></label><label>Barva štítku a čáry<input type="color" name="pointColor" value="${escapeHtml(brushColor)}" ${colorMode === 'custom' ? '' : 'disabled'}></label></fieldset>
        ` : ''}
        ${lineLengthControlMarkup(draft)}
        <div class="draft-anchor-controls" style="display: flex; gap: 8px; margin: 4px 0 8px; flex-wrap: wrap;">
          <button type="button" class="small-button ${anchorSelectionActive ? 'is-active' : ''}" data-edit-anchor>${actionIconMarkup('view')}${anchorSelectionActive ? 'Klikněte na nový bod' : (isAnchored ? 'Upravit bod na modelu' : 'Vybrat bod na modelu')}</button>
          ${isAnchored ? `<button type="button" class="small-button" data-reset>${actionIconMarkup('refresh')}Resetovat bod</button>` : ''}
        </div>
        <p class="draft-help">Táhněte posuvník a sledujte přerušovanou čáru v modelu. ${brushMode ? 'První tah štětce nebo tlačítko výše nastaví ukotvení vodicí čáry.' : 'Po kliknutí na povrch se ukotvení zamkne.'}</p>
        <label>Detailní popisek <span class="field-note">podporuje [[Wiki odkazy]]</span><textarea name="description" rows="5" placeholder="Např. odkaz na související článek nebo detail…">${escapeHtml(draft.description)}</textarea></label>
        <div class="draft-anchor-state ${isAnchored ? 'is-anchored' : ''}" role="status">${anchorSelectionActive ? 'Režim výběru bodu je aktivní — klikněte na povrch modelu pro umístění vodicí čáry.' : (isAnchored ? (brushMode ? (hasPaintedSurface ? 'Plocha i bod na modelu jsou vybrané. Můžete upravit bod nebo namalovat další plochu.' : 'Bod na modelu je vybraný. Můžete táhnout štětcem pro namalování plochy.') : 'Bod na modelu je vybraný. Můžete jej vybrat znovu.') : (brushMode ? 'Plocha ani bod zatím nejsou vybrané — táhněte štětcem nebo klikněte na „Vybrat bod na modelu“.' : 'Bod zatím není vybraný — najeďte na model a klikněte.'))}</div>
      </div>

      <div class="sidebar-bottom tag-draft-bottom">
        <button type="button" class="button button-primary" data-save ${isAnchored && draft.title.trim() ? '' : 'disabled'}>${actionIconMarkup('add')}Přidat štítek</button>
        <button type="button" class="button button-secondary" data-cancel>${actionIconMarkup('cancel')}Zrušit</button>
      </div>
    </aside>`;

  // Asynchronously populate anatomy systems if anatomy module is active
  if (anatomyModule) {
    anatomyModule.getSystems().then((systems) => {
      const systemSelect = host.querySelector('[name="moduleSystemFilter"]');
      if (systemSelect && systemSelect.options.length <= 1) {
        systemSelect.innerHTML = [
          '<option value="">Všechny orgánové soustavy</option>',
          ...systems.map((sys) => `<option value="${escapeHtml(sys.id)}" ${draft.moduleSystemFilter === sys.id ? 'selected' : ''}>${escapeHtml(sys.shortName || sys.name)}</option>`)
        ].join('');
      }
    });
  }

  const emit = () => {
    const title = host.querySelector('[name="title"]').value;
    const category = host.querySelector('[name="category"]').value;
    const lineLength = Number(host.querySelector('[name="lineLength"]').value);
    const description = host.querySelector('[name="description"]').value;
    const brushMode = host.querySelector('[name="brushMode"]')?.checked || false;
    const brushColorOverride = host.querySelector('[name="brushColorOverride"]')?.checked || false;
    const colorModeSelect = host.querySelector('[name="colorMode"]')?.value;
    const brushColorMode = brushMode ? (brushColorOverride ? 'custom' : 'category') : (colorModeSelect === 'custom' ? 'custom' : 'category');
    const brushColorInput = host.querySelector('[name="brushColor"]') || host.querySelector('[name="pointColor"]');
    const brushColor = brushColorInput ? brushColorInput.value : categoryColor;
    const brushRadiusInput = host.querySelector('[name="brushRadius"]');
    const brushRadius = brushRadiusInput ? Number(brushRadiusInput.value) : 1;
    const brushCategoryColor = categories.find((item) => item.id === category)?.color || '#d64b3b';

    const lineLengthEl = host.querySelector('[data-line-length]');
    if (lineLengthEl) lineLengthEl.textContent = formatLineLength(lineLength, lineLengthControl.step);
    const brushRadiusEl = host.querySelector('[data-brush-radius]');
    if (brushRadiusEl) brushRadiusEl.textContent = formatLineLength(brushRadius, brushStep);
    const saveBtn = host.querySelector('[data-save]');
    if (saveBtn) saveBtn.disabled = !isAnchored || !title.trim();

    onChange({
      title,
      category,
      lineLength,
      description,
      brushMode,
      brushColorMode,
      brushColor,
      brushCategoryColor,
      brushRadius,
      style: { colorMode: brushColorMode, color: brushColor },
      selectedModuleId: draft.selectedModuleId,
      moduleMode: draft.moduleMode,
      moduleStructureFilter: draft.moduleStructureFilter,
      moduleStructureSubQuery: draft.moduleStructureSubQuery,
      moduleStructureTab: draft.moduleStructureTab,
      module: draft.module
    });
  };

  const onSelectTerm = (selectedTerm) => {
    if (!anatomyModule) return;
    const formatted = anatomyModule.formatTagData(selectedTerm);
    draft.title = formatted.title;
    draft.category = formatted.category;
    draft.module = formatted.module;

    const lines = [];
    if (draft.module?.termId) {
      const url = getIfaaUrl(draft.module.termId);
      lines.push(url
        ? `* '''Terminologia Anatomica:''' [${url} ${draft.module.termId}]`
        : `* '''Terminologia Anatomica:''' ${draft.module.termId}`);
    }
    if (draft.module?.english) lines.push(`* '''Anglicky:''' ${draft.module.english}`);
    if (draft.module?.parent) lines.push(`* '''Struktura / Kost:''' ${draft.module.parent}`);
    const snippet = lines.join('\n');
    if (!draft.description || !draft.description.trim()) {
      draft.description = snippet;
    }

    searchDropdownOpen = false;
    renderTagDraftPanel(host, draft, {
      categories,
      existingTags,
      onChange,
      onSave,
      onCancel,
      onResetAnchor,
      onEditAnchor,
      onClearSurface,
      onAddCategory,
      anchorSelectionActive,
      hasEditedAnchor
    });
    emit();
  };

  // Render structure browser content if active
  if ((draft.moduleMode || 'structure') === 'structure' && draft.moduleStructureFilter) {
    renderStructureBrowserContent(host, draft, existingTags, onSelectTerm);
  }

  host.querySelectorAll('input, select, textarea').forEach((input) => {
    if (!['moduleSearchQuery', 'moduleSystemFilter', 'selectedModule', 'moduleStructureFilter', 'moduleStructureSubQuery'].includes(input.name)) {
      input.addEventListener('input', emit);
    }
  });

  ['brushMode', 'brushColorOverride', 'colorMode', 'category'].forEach((name) => {
    const el = host.querySelector(`[name="${name}"]`);
    if (el) {
      el.addEventListener('change', () => {
        emit();
        renderTagDraftPanel(host, draft, { categories, existingTags, onChange, onSave, onCancel, onResetAnchor, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
      });
    }
  });

  // Module switcher handler
  const moduleSelect = host.querySelector('[name="selectedModule"]');
  if (moduleSelect) {
    moduleSelect.addEventListener('change', async (e) => {
      draft.selectedModuleId = e.target.value;
      if (!draft.selectedModuleId) {
        draft.module = undefined;
      }
      searchDropdownOpen = false;
      emit();
      renderTagDraftPanel(host, draft, { categories, existingTags, onChange, onSave, onCancel, onResetAnchor, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
    });
  }

  // Module Mode tabs
  host.querySelectorAll('[data-set-module-mode]').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      draft.moduleMode = tabBtn.dataset.setModuleMode;
      searchDropdownOpen = false;
      emit();
      renderTagDraftPanel(host, draft, { categories, existingTags, onChange, onSave, onCancel, onResetAnchor, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
    });
  });

  // Structure filter input and clear button handlers
  const structInput = host.querySelector('[name="moduleStructureFilter"]');
  const clearStructBtn = host.querySelector('[data-clear-structure]');

  const updateStructureView = () => {
    const hasVal = Boolean(draft.moduleStructureFilter && draft.moduleStructureFilter.trim());
    if (clearStructBtn) clearStructBtn.hidden = !hasVal;
    const browserEl = host.querySelector('[data-structure-browser]');
    const promptEl = host.querySelector('[data-structure-prompt]');
    if (hasVal) {
      if (promptEl) promptEl.hidden = true;
      if (browserEl) {
        browserEl.hidden = false;
        renderStructureBrowserContent(host, draft, existingTags, onSelectTerm);
      }
    } else {
      if (browserEl) {
        browserEl.hidden = true;
        browserEl.innerHTML = '';
        delete browserEl.dataset.renderedQuery;
      }
      if (promptEl) promptEl.hidden = false;
    }
    emit();
  };

  if (structInput) {
    structInput.addEventListener('input', (e) => {
      draft.moduleStructureFilter = e.target.value;
      clearTimeout(activeSearchDebounce);
      activeSearchDebounce = setTimeout(() => {
        updateStructureView();
      }, 150);
    });
  }

  if (clearStructBtn) {
    clearStructBtn.addEventListener('click', () => {
      draft.moduleStructureFilter = '';
      draft.moduleStructureSubQuery = '';
      if (structInput) {
        structInput.value = '';
        structInput.focus();
      }
      updateStructureView();
    });
  }

  // Module direct search input handler
  const searchInput = host.querySelector('[name="moduleSearchQuery"]');
  const systemFilterSelect = host.querySelector('[name="moduleSystemFilter"]');

  const triggerSearch = () => {
    if (!searchInput) return;
    const query = searchInput.value.trim();
    const systemId = systemFilterSelect ? systemFilterSelect.value : '';
    draft.moduleSearchQuery = searchInput.value;
    draft.moduleSystemFilter = systemId;

    clearTimeout(activeSearchDebounce);
    activeSearchDebounce = setTimeout(() => {
      performSearch(host, query, systemId, onSelectTerm);
    }, 150);
  };

  if (searchInput) {
    searchInput.addEventListener('input', triggerSearch);
    searchInput.addEventListener('focus', () => {
      triggerSearch();
    });
  }

  if (systemFilterSelect) {
    systemFilterSelect.addEventListener('change', () => {
      triggerSearch();
    });
  }

  // Insert description snippet button
  const insertDescBtn = host.querySelector('[data-insert-description]');
  if (insertDescBtn && draft.module) {
    insertDescBtn.addEventListener('click', () => {
      const descInput = host.querySelector('[name="description"]');
      const lines = [];
      if (draft.module.termId) {
        const url = getIfaaUrl(draft.module.termId);
        lines.push(url
          ? `* '''Terminologia Anatomica:''' [${url} ${draft.module.termId}]`
          : `* '''Terminologia Anatomica:''' ${draft.module.termId}`);
      }
      if (draft.module.english) lines.push(`* '''Anglicky:''' ${draft.module.english}`);
      if (draft.module.parent) lines.push(`* '''Struktura / Kost:''' ${draft.module.parent}`);
      const snippet = lines.join('\n');
      const current = descInput.value.trim();
      descInput.value = current ? `${current}\n\n${snippet}` : snippet;
      emit();
    });
  }

  // Clear assigned term button
  const clearTermBtn = host.querySelector('[data-clear-term]');
  if (clearTermBtn) {
    clearTermBtn.addEventListener('click', () => {
      draft.module = undefined;
      renderTagDraftPanel(host, draft, { categories, existingTags, onChange, onSave, onCancel, onResetAnchor, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
      onChange({ module: undefined });
    });
  }

  // Close dropdown on outside click
  document.addEventListener('click', (event) => {
    if (!host.contains(event.target)) {
      const dropdown = host.querySelector('[data-search-dropdown]');
      if (dropdown) {
        dropdown.hidden = true;
        dropdown.classList.remove('is-open');
        searchDropdownOpen = false;
      }
    }
  }, { once: true });

  if (onAddCategory) {
    const addCatBtn = host.querySelector('[data-add-category]');
    if (addCatBtn) addCatBtn.addEventListener('click', onAddCategory);
  }

  if (onClearSurface) {
    const clearSurfaceBtn = host.querySelector('[data-clear-surface]');
    if (clearSurfaceBtn) clearSurfaceBtn.addEventListener('click', onClearSurface);
  }

  if (onEditAnchor) {
    const editAnchorBtn = host.querySelector('[data-edit-anchor]');
    if (editAnchorBtn) editAnchorBtn.addEventListener('click', onEditAnchor);
  }

  host.querySelectorAll('[data-cancel]').forEach((button) => button.addEventListener('click', onCancel));
  const resetBtn = host.querySelector('[data-reset]');
  if (resetBtn) resetBtn.addEventListener('click', onResetAnchor);
  const saveBtn = host.querySelector('[data-save]');
  if (saveBtn) saveBtn.addEventListener('click', onSave);
}

/**
 * Panel used when editing an existing label.
 */
export function renderTagEditorPanel(host, draft, {
  categories = DEFAULT_CATEGORIES,
  existingTags = [],
  onChange,
  onSave,
  onCancel,
  onEditLeaderLine,
  onEditAnchor,
  onClearSurface,
  onAddCategory,
  anchorSelectionActive = false,
  hasEditedAnchor = false
}) {
  const lineLengthControl = lineLengthControlValues(draft);
  const hasPaintedSurface = Boolean(draft.highlight?.points?.length);
  const brushMode = Boolean(draft.brushMode || draft.highlight);
  const brushRadius = Number(draft.brushRadius) || Number(draft.highlight?.radius) || 1;
  const brushMinimum = Number(draft.brushMinRadius) || 0.01;
  const brushMaximum = Number(draft.brushMaxRadius) || Math.max(brushRadius, 1);
  const brushStep = Number(draft.brushStep) || 0.01;
  const categoryColor = categories.find((category) => category.id === draft.category)?.color || '#d64b3b';
  const colorMode = (draft.brushColorMode === 'custom' || draft.style?.colorMode === 'custom' || draft.highlight?.colorMode === 'custom') ? 'custom' : 'category';
  const color = colorMode === 'custom' && /^#[0-9a-f]{6}$/i.test(String(draft.brushColor || draft.style?.color || draft.highlight?.color || ''))
    ? (draft.brushColor || draft.style?.color || draft.highlight?.color)
    : categoryColor;
  const surfaceTitle = (draft.highlight || brushMode) ? 'Plocha a vodicí čára' : 'Barva a vodicí čára';

  const availableModules = getRegisteredModules();
  const anatomyModule = getModule('anatomy');
  let anatomySystems = [];

  host.innerHTML = `
    <aside class="tag-draft-panel" aria-label="Úprava štítku modelu">
      <div class="resize-handle resize-handle-draft-right" aria-hidden="true" title="Změnit šířku panelu"></div>
      <div class="resize-handle resize-handle-draft-bottom" aria-hidden="true" title="Změnit výšku panelu"></div>
      <div class="resize-handle resize-handle-draft-corner" aria-hidden="true" title="Změnit rozměry panelu"></div>
      
      <div class="sidebar-top tag-draft-top">
        <div class="sidebar-title-wrap tag-draft-title-wrap">
          <p class="eyebrow">EDITOR POPISKU</p>
          <h2>Upravit štítek</h2>
        </div>
        <button type="button" class="icon-button" data-cancel title="Zavřít úpravu štítku" aria-label="Zavřít úpravu štítku">${actionIconMarkup('cancel')}</button>
      </div>

      <div class="sidebar-scroll tag-draft-scroll">
        <p class="draft-autosave">Souřadnice jsou ukotveny na povrchu modelu. Koncový bod vodicí čáry upravíte přímo ve 3D pohledu.</p>
        
        ${buildModuleMarkup(draft, availableModules, anatomySystems)}

        <label>Název štítku (hlavní text)<input name="title" value="${escapeHtml(draft.title)}" placeholder="Např. Caput femoris" autocomplete="off" /></label>
        <div class="draft-category-row"><label>Kategorie<select name="category">${categories.map((category) => `<option value="${escapeHtml(category.id)}" ${draft.category === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></label><button type="button" class="small-button" data-add-category>${actionIconMarkup('add')}Nová kategorie</button></div>
        
        <fieldset class="brush-mode-card ${brushMode ? 'is-active' : ''}"><legend>Štětec plochy</legend><label class="brush-toggle"><input type="checkbox" name="brushMode" ${brushMode ? 'checked' : ''}><span><b>Plošné zvýraznění</b><small>Namaluje část modelu místo jediného bodu.</small></span></label><div class="brush-settings ${brushMode ? '' : 'is-disabled'}"><label class="brush-category-colour"><span>Barva z kategorie</span><i style="--brush-category-color:${escapeHtml(categoryColor)}"></i><input type="checkbox" name="brushColorOverride" ${colorMode === 'custom' ? 'checked' : ''} ${brushMode ? '' : 'disabled'}> Ručně přepsat</label><label>Barva štítku a plochy<input type="color" name="brushColor" value="${escapeHtml(color)}" ${brushMode && colorMode === 'custom' ? '' : 'disabled'}></label><label>Velikost štětce <output data-brush-radius>${formatLineLength(brushRadius, brushStep)}</output><input type="range" name="brushRadius" min="${brushMinimum}" max="${brushMaximum}" step="${brushStep}" value="${brushRadius}" ${brushMode ? '' : 'disabled'}></label>${hasPaintedSurface ? `<button type="button" class="small-button small-button-danger" data-clear-surface>${actionIconMarkup('delete')}Vymazat plochu</button>` : ''}</div><p class="draft-help brush-help">${brushMode ? 'Štětec je aktivní — malujte levým tlačítkem po modelu. Pro otočení modelu táhněte pravým tlačítkem myši, táhněte mimo model nebo držte Alt.' : 'Zapnutím štětce můžete k tomuto štítku domalovat zvýrazněnou plochu.'}</p></fieldset>

        <fieldset class="tag-editor-style"><legend>${surfaceTitle}</legend>${!brushMode ? `<label>Barva<select name="colorMode"><option value="category" ${colorMode === 'category' ? 'selected' : ''}>Podle kategorie</option><option value="custom" ${colorMode === 'custom' ? 'selected' : ''}>Vlastní barva</option></select></label><label>Barva štítku a čáry<input type="color" name="pointColor" value="${escapeHtml(color)}" ${colorMode === 'custom' ? '' : 'disabled'}></label>` : ''}<button type="button" class="small-button" data-edit-line>${actionIconMarkup('edit')}Upravit polohu čáry</button><button type="button" class="small-button ${anchorSelectionActive ? 'is-active' : ''}" data-edit-anchor>${actionIconMarkup('view')}${anchorSelectionActive ? 'Klikněte na nový bod' : 'Upravit bod na modelu'}</button><p>${anchorSelectionActive ? 'Režim výběru je aktivní — klikněte na nové místo na povrchu modelu.' : hasEditedAnchor ? 'Nový bod je vybraný. Uložte změny pro jeho potvrzení.' : 'Čára končí barevným kruhem u plovoucího štítku. Přetažením kruhu ji přesunete.'}</p></fieldset>
        ${lineLengthControlMarkup(draft)}
        <label>Detailní popisek <span class="field-note">podporuje [[Wiki odkazy]]</span><textarea name="description" rows="5" placeholder="Např. odkaz na související článek nebo detail…">${escapeHtml(draft.description)}</textarea></label>
      </div>

      <div class="sidebar-bottom tag-draft-bottom">
        <button type="button" class="button button-primary" data-save ${draft.title.trim() ? '' : 'disabled'}>${actionIconMarkup('save')}Uložit změny</button>
        <button type="button" class="button button-secondary" data-cancel>${actionIconMarkup('cancel')}Zrušit</button>
      </div>
    </aside>`;

  if (anatomyModule) {
    anatomyModule.getSystems().then((systems) => {
      const systemSelect = host.querySelector('[name="moduleSystemFilter"]');
      if (systemSelect && systemSelect.options.length <= 1) {
        systemSelect.innerHTML = [
          '<option value="">Všechny orgánové soustavy</option>',
          ...systems.map((sys) => `<option value="${escapeHtml(sys.id)}" ${draft.moduleSystemFilter === sys.id ? 'selected' : ''}>${escapeHtml(sys.shortName || sys.name)}</option>`)
        ].join('');
      }
    });
  }

  const emit = () => {
    const title = host.querySelector('[name="title"]').value;
    const category = host.querySelector('[name="category"]').value;
    const lineLength = Number(host.querySelector('[name="lineLength"]').value);
    const description = host.querySelector('[name="description"]').value;
    const brushMode = host.querySelector('[name="brushMode"]')?.checked || false;
    const brushColorOverride = host.querySelector('[name="brushColorOverride"]')?.checked || false;
    const colorModeSelect = host.querySelector('[name="colorMode"]')?.value;
    const colorMode = brushMode ? (brushColorOverride ? 'custom' : 'category') : (colorModeSelect === 'custom' ? 'custom' : 'category');
    const colorInput = host.querySelector('[name="brushColor"]') || host.querySelector('[name="pointColor"]');
    const color = colorInput ? colorInput.value : categoryColor;
    const brushRadiusInput = host.querySelector('[name="brushRadius"]');
    const brushRadius = brushRadiusInput ? Number(brushRadiusInput.value) : 1;
    const brushCategoryColor = categories.find((item) => item.id === category)?.color || '#d64b3b';

    const lineLengthEl = host.querySelector('[data-line-length]');
    if (lineLengthEl) lineLengthEl.textContent = formatLineLength(lineLength, lineLengthControl.step);
    const brushRadiusEl = host.querySelector('[data-brush-radius]');
    if (brushRadiusEl) brushRadiusEl.textContent = formatLineLength(brushRadius, brushStep);
    const saveBtn = host.querySelector('[data-save]');
    if (saveBtn) saveBtn.disabled = !title.trim();

    onChange({
      title,
      category,
      lineLength,
      description,
      brushMode,
      brushColorMode: colorMode,
      brushColor: color,
      brushCategoryColor,
      brushRadius,
      style: { colorMode, color },
      selectedModuleId: draft.selectedModuleId,
      moduleMode: draft.moduleMode,
      moduleStructureFilter: draft.moduleStructureFilter,
      moduleStructureSubQuery: draft.moduleStructureSubQuery,
      moduleStructureTab: draft.moduleStructureTab,
      module: draft.module
    });
  };

  const onSelectTerm = (selectedTerm) => {
    if (!anatomyModule) return;
    const formatted = anatomyModule.formatTagData(selectedTerm);
    draft.title = formatted.title;
    draft.category = formatted.category;
    draft.module = formatted.module;

    const lines = [];
    if (draft.module?.termId) {
      const url = getIfaaUrl(draft.module.termId);
      lines.push(url
        ? `* '''Terminologia Anatomica:''' [${url} ${draft.module.termId}]`
        : `* '''Terminologia Anatomica:''' ${draft.module.termId}`);
    }
    if (draft.module?.english) lines.push(`* '''Anglicky:''' ${draft.module.english}`);
    if (draft.module?.parent) lines.push(`* '''Struktura / Kost:''' ${draft.module.parent}`);
    const snippet = lines.join('\n');
    if (!draft.description || !draft.description.trim()) {
      draft.description = snippet;
    }

    searchDropdownOpen = false;
    renderTagEditorPanel(host, draft, {
      categories,
      existingTags,
      onChange,
      onSave,
      onCancel,
      onEditLeaderLine,
      onEditAnchor,
      onClearSurface,
      onAddCategory,
      anchorSelectionActive,
      hasEditedAnchor
    });
    emit();
  };

  if ((draft.moduleMode || 'structure') === 'structure' && draft.moduleStructureFilter) {
    renderStructureBrowserContent(host, draft, existingTags, onSelectTerm);
  }

  host.querySelectorAll('input, select, textarea').forEach((input) => {
    if (!['moduleSearchQuery', 'moduleSystemFilter', 'selectedModule', 'moduleStructureFilter', 'moduleStructureSubQuery'].includes(input.name)) {
      input.addEventListener('input', emit);
    }
  });

  ['category', 'colorMode', 'brushMode', 'brushColorOverride'].forEach((name) => {
    const el = host.querySelector(`[name="${name}"]`);
    if (el) {
      el.addEventListener('change', () => {
        emit();
        renderTagEditorPanel(host, draft, { categories, existingTags, onChange, onSave, onCancel, onEditLeaderLine, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
      });
    }
  });

  const moduleSelect = host.querySelector('[name="selectedModule"]');
  if (moduleSelect) {
    moduleSelect.addEventListener('change', (e) => {
      draft.selectedModuleId = e.target.value;
      if (!draft.selectedModuleId) {
        draft.module = undefined;
      }
      searchDropdownOpen = false;
      emit();
      renderTagEditorPanel(host, draft, { categories, existingTags, onChange, onSave, onCancel, onEditLeaderLine, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
    });
  }

  host.querySelectorAll('[data-set-module-mode]').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      draft.moduleMode = tabBtn.dataset.setModuleMode;
      searchDropdownOpen = false;
      emit();
      renderTagEditorPanel(host, draft, { categories, existingTags, onChange, onSave, onCancel, onEditLeaderLine, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
    });
  });

  const structInput = host.querySelector('[name="moduleStructureFilter"]');
  const clearStructBtn = host.querySelector('[data-clear-structure]');

  const updateStructureView = () => {
    const hasVal = Boolean(draft.moduleStructureFilter && draft.moduleStructureFilter.trim());
    if (clearStructBtn) clearStructBtn.hidden = !hasVal;
    const browserEl = host.querySelector('[data-structure-browser]');
    const promptEl = host.querySelector('[data-structure-prompt]');
    if (hasVal) {
      if (promptEl) promptEl.hidden = true;
      if (browserEl) {
        browserEl.hidden = false;
        renderStructureBrowserContent(host, draft, existingTags, onSelectTerm);
      }
    } else {
      if (browserEl) {
        browserEl.hidden = true;
        browserEl.innerHTML = '';
        delete browserEl.dataset.renderedQuery;
      }
      if (promptEl) promptEl.hidden = false;
    }
    emit();
  };

  if (structInput) {
    structInput.addEventListener('input', (e) => {
      draft.moduleStructureFilter = e.target.value;
      clearTimeout(activeSearchDebounce);
      activeSearchDebounce = setTimeout(() => {
        updateStructureView();
      }, 150);
    });
  }

  if (clearStructBtn) {
    clearStructBtn.addEventListener('click', () => {
      draft.moduleStructureFilter = '';
      draft.moduleStructureSubQuery = '';
      if (structInput) {
        structInput.value = '';
        structInput.focus();
      }
      updateStructureView();
    });
  }

  const searchInput = host.querySelector('[name="moduleSearchQuery"]');
  const systemFilterSelect = host.querySelector('[name="moduleSystemFilter"]');

  const triggerSearch = () => {
    if (!searchInput) return;
    const query = searchInput.value.trim();
    const systemId = systemFilterSelect ? systemFilterSelect.value : '';
    draft.moduleSearchQuery = searchInput.value;
    draft.moduleSystemFilter = systemId;

    clearTimeout(activeSearchDebounce);
    activeSearchDebounce = setTimeout(() => {
      performSearch(host, query, systemId, onSelectTerm);
    }, 150);
  };

  if (searchInput) {
    searchInput.addEventListener('input', triggerSearch);
    searchInput.addEventListener('focus', () => {
      triggerSearch();
    });
  }

  if (systemFilterSelect) {
    systemFilterSelect.addEventListener('change', () => {
      triggerSearch();
    });
  }

  const insertDescBtn = host.querySelector('[data-insert-description]');
  if (insertDescBtn && draft.module) {
    insertDescBtn.addEventListener('click', () => {
      const descInput = host.querySelector('[name="description"]');
      const lines = [];
      if (draft.module.termId) {
        const url = getIfaaUrl(draft.module.termId);
        lines.push(url
          ? `* '''Terminologia Anatomica:''' [${url} ${draft.module.termId}]`
          : `* '''Terminologia Anatomica:''' ${draft.module.termId}`);
      }
      if (draft.module.english) lines.push(`* '''Anglicky:''' ${draft.module.english}`);
      if (draft.module.parent) lines.push(`* '''Struktura / Kost:''' ${draft.module.parent}`);
      const snippet = lines.join('\n');
      const current = descInput.value.trim();
      descInput.value = current ? `${current}\n\n${snippet}` : snippet;
      emit();
    });
  }

  const clearTermBtn = host.querySelector('[data-clear-term]');
  if (clearTermBtn) {
    clearTermBtn.addEventListener('click', () => {
      draft.module = undefined;
      renderTagEditorPanel(host, draft, { categories, existingTags, onChange, onSave, onCancel, onEditLeaderLine, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
      onChange({ module: undefined });
    });
  }

  document.addEventListener('click', (event) => {
    if (!host.contains(event.target)) {
      const dropdown = host.querySelector('[data-search-dropdown]');
      if (dropdown) {
        dropdown.hidden = true;
        dropdown.classList.remove('is-open');
        searchDropdownOpen = false;
      }
    }
  }, { once: true });

  if (onAddCategory) {
    const addCatBtn = host.querySelector('[data-add-category]');
    if (addCatBtn) addCatBtn.addEventListener('click', onAddCategory);
  }

  if (onClearSurface) {
    const clearSurfaceBtn = host.querySelector('[data-clear-surface]');
    if (clearSurfaceBtn) clearSurfaceBtn.addEventListener('click', onClearSurface);
  }

  host.querySelectorAll('[data-cancel]').forEach((button) => button.addEventListener('click', onCancel));
  const editLineBtn = host.querySelector('[data-edit-line]');
  if (editLineBtn) editLineBtn.addEventListener('click', onEditLeaderLine);
  const editAnchorBtn = host.querySelector('[data-edit-anchor]');
  if (editAnchorBtn) editAnchorBtn.addEventListener('click', onEditAnchor);
  const saveBtn = host.querySelector('[data-save]');
  if (saveBtn) saveBtn.addEventListener('click', onSave);
}
