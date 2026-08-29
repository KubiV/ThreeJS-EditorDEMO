import { escapeHtml } from '../annotations/wikitext.js';
import { DEFAULT_CATEGORIES } from './sidebar.js';
import { formatLineLength, lineLengthControlMarkup, lineLengthControlValues } from './line-length-control.js';
import { actionIconMarkup } from './brand.js';
import { getRegisteredModules, getModule } from '../modules/module-registry.js';
import { getIfaaUrl } from '../modules/anatomy/index.js';

let activeSearchDebounce = null;
let currentSearchResults = [];
let searchDropdownOpen = false;

function buildModuleMarkup(draft, availableModules, systems = []) {
  const activeModuleId = draft.selectedModuleId !== undefined
    ? draft.selectedModuleId
    : (draft.module?.id || '');
  const hasModule = Boolean(activeModuleId);
  const assignedTerm = draft.module;

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

  return `
    <fieldset class="module-section-card ${hasModule ? 'is-active' : ''}">
      <legend>Odborný modul</legend>
      <label class="module-select-label">Vybrat modul
        <select name="selectedModule">${moduleOptions}</select>
      </label>
      ${hasModule ? `
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
      ` : ''}
    </fieldset>`;
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
export function renderTagDraftPanel(host, draft, { categories = DEFAULT_CATEGORIES, onChange, onSave, onCancel, onResetAnchor, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive = false, hasEditedAnchor = false }) {
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
      <div class="tag-draft-heading"><div><p class="eyebrow">EDITOR POPISKU</p><h2>Nový štítek</h2></div><button type="button" class="icon-button" data-cancel aria-label="Zavřít přidávání štítku">×</button></div>
      <ol class="draft-steps"><li class="is-done">Nastavte údaje</li><li class="${isAnchored ? 'is-done' : 'is-current'}">${brushMode ? 'Malujte po povrchu' : 'Klikněte na povrch modelu'}</li><li class="${isAnchored ? 'is-current' : ''}">Uložte štítek</li></ol>
      <p class="draft-autosave">Rozpracovaný štítek se průběžně ukládá v tomto prohlížeči.</p>
      
      ${buildModuleMarkup(draft, availableModules, anatomySystems)}

      <label>Název štítku (hlavní text)<input name="title" value="${escapeHtml(draft.title)}" placeholder="Např. Caput femoris" autocomplete="off" /></label>
      <div class="draft-category-row"><label>Kategorie<select name="category">${categories.map((category) => `<option value="${escapeHtml(category.id)}" ${draft.category === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></label><button type="button" class="small-button" data-add-category>${actionIconMarkup('add')}Nová kategorie</button></div>
      <fieldset class="brush-mode-card ${brushMode ? 'is-active' : ''}"><legend>Štětec plochy</legend><label class="brush-toggle"><input type="checkbox" name="brushMode" ${brushMode ? 'checked' : ''}><span><b>Plošné zvýraznění</b><small>Namaluje část modelu místo jediného bodu.</small></span></label><div class="brush-settings ${brushMode ? '' : 'is-disabled'}"><label class="brush-category-colour"><span>Barva z kategorie</span><i style="--brush-category-color:${escapeHtml(categoryColor)}"></i><input type="checkbox" name="brushColorOverride" ${colorMode === 'custom' ? 'checked' : ''} ${brushMode ? '' : 'disabled'}> Ručně přepsat</label><label>Barva štítku a plochy<input type="color" name="brushColor" value="${escapeHtml(brushColor)}" ${brushMode && colorMode === 'custom' ? '' : 'disabled'}></label><label>Velikost štětce <output data-brush-radius>${formatLineLength(brushRadius, brushStep)}</output><input type="range" name="brushRadius" min="${brushMinimum}" max="${brushMaximum}" step="${brushStep}" value="${brushRadius}" ${brushMode ? '' : 'disabled'}></label>${hasPaintedSurface ? `<button type="button" class="small-button small-button-danger" data-clear-surface>${actionIconMarkup('delete')}Vymazat plochu</button>` : ''}</div><p class="draft-help brush-help">${brushMode ? 'Štětec je aktivní — malujte levým tlačítkem po modelu. Pro otočení modelu táhněte pravým tlačítkem myši, táhněte mimo model nebo držte Alt.' : 'Zapnutím štětce můžete místo bodu zvýraznit celou plochu modelu.'}</p></fieldset>
      ${!brushMode ? `
      <fieldset class="tag-editor-style"><legend>Barva a vodicí čára</legend><label>Barva<select name="colorMode"><option value="category" ${colorMode === 'category' ? 'selected' : ''}>Podle kategorie</option><option value="custom" ${colorMode === 'custom' ? 'selected' : ''}>Vlastní barva</option></select></label><label>Barva štítku a čáry<input type="color" name="pointColor" value="${escapeHtml(brushColor)}" ${colorMode === 'custom' ? '' : 'disabled'}></label></fieldset>
      ` : ''}
      ${lineLengthControlMarkup(draft)}
      <div class="draft-anchor-controls" style="display: flex; gap: 8px; margin: 4px 0 8px; flex-wrap: wrap;">
        <button type="button" class="small-button ${anchorSelectionActive ? 'is-active' : ''}" data-edit-anchor>${actionIconMarkup('view')}${anchorSelectionActive ? 'Klikněte na nový bod' : (isAnchored ? 'Upravit bod na modelu' : 'Vybrat bod na modelu')}</button>
      </div>
      <p class="draft-help">Táhněte posuvník a sledujte přerušovanou čáru v modelu. ${brushMode ? 'První tah štětce nebo tlačítko výše nastaví ukotvení vodicí čáry.' : 'Po kliknutí na povrch se ukotvení zamkne.'}</p>
      <label>Detailní popisek <span class="field-note">podporuje [[Wiki odkazy]]</span><textarea name="description" rows="5" placeholder="Např. odkaz na související článek nebo detail…">${escapeHtml(draft.description)}</textarea></label>
      <div class="draft-anchor-state ${isAnchored ? 'is-anchored' : ''}" role="status">${anchorSelectionActive ? 'Režim výběru bodu je aktivní — klikněte na povrch modelu pro umístění vodicí čáry.' : (isAnchored ? (brushMode ? (hasPaintedSurface ? 'Plocha i bod na modelu jsou vybrané. Můžete upravit bod nebo namalovat další plochu.' : 'Bod na modelu je vybraný. Můžete táhnout štětcem pro namalování plochy.') : 'Bod na modelu je vybraný. Můžete jej vybrat znovu.') : (brushMode ? 'Plocha ani bod zatím nejsou vybrané — táhněte štětcem nebo klikněte na „Vybrat bod na modelu“.' : 'Bod zatím není vybraný — najeďte na model a klikněte.'))}</div>
      <div class="draft-actions"><button type="button" class="button button-secondary" data-reset ${isAnchored ? '' : 'disabled'}>${actionIconMarkup('refresh')}Vybrat jiný bod</button><button type="button" class="button button-primary" data-save ${isAnchored && draft.title.trim() ? '' : 'disabled'}>${actionIconMarkup('add')}Přidat štítek</button></div>
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
      module: draft.module
    });
  };

  host.querySelectorAll('input, select, textarea').forEach((input) => {
    if (!['moduleSearchQuery', 'moduleSystemFilter', 'selectedModule'].includes(input.name)) {
      input.addEventListener('input', emit);
    }
  });

  ['brushMode', 'brushColorOverride', 'colorMode', 'category'].forEach((name) => {
    const el = host.querySelector(`[name="${name}"]`);
    if (el) {
      el.addEventListener('change', () => {
        emit();
        renderTagDraftPanel(host, draft, { categories, onChange, onSave, onCancel, onResetAnchor, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
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
      renderTagDraftPanel(host, draft, { categories, onChange, onSave, onCancel, onResetAnchor, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
    });
  }

  // Module search input handler
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
      performSearch(host, query, systemId, (selectedTerm) => {
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
        renderTagDraftPanel(host, draft, { categories, onChange, onSave, onCancel, onResetAnchor, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
        onChange({
          title: draft.title,
          category: draft.category,
          description: draft.description,
          module: draft.module
        });
      });
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
      renderTagDraftPanel(host, draft, { categories, onChange, onSave, onCancel, onResetAnchor, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
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

  host.querySelector('[data-cancel]').addEventListener('click', onCancel);
  host.querySelector('[data-reset]').addEventListener('click', onResetAnchor);
  host.querySelector('[data-save]').addEventListener('click', onSave);
}

/**
 * Panel used when editing an existing label.
 */
export function renderTagEditorPanel(host, draft, { categories = DEFAULT_CATEGORIES, onChange, onSave, onCancel, onEditLeaderLine, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive = false, hasEditedAnchor = false }) {
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
      <div class="tag-draft-heading"><div><p class="eyebrow">EDITOR POPISKU</p><h2>Upravit štítek</h2></div><button type="button" class="icon-button" data-cancel aria-label="Zavřít úpravu štítku">×</button></div>
      <p class="draft-autosave">Souřadnice jsou ukotveny na povrchu modelu. Koncový bod vodicí čáry upravíte přímo ve 3D pohledu.</p>
      
      ${buildModuleMarkup(draft, availableModules, anatomySystems)}

      <label>Název štítku (hlavní text)<input name="title" value="${escapeHtml(draft.title)}" placeholder="Např. Caput femoris" autocomplete="off" /></label>
      <div class="draft-category-row"><label>Kategorie<select name="category">${categories.map((category) => `<option value="${escapeHtml(category.id)}" ${draft.category === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></label><button type="button" class="small-button" data-add-category>${actionIconMarkup('add')}Nová kategorie</button></div>
      
      <fieldset class="brush-mode-card ${brushMode ? 'is-active' : ''}"><legend>Štětec plochy</legend><label class="brush-toggle"><input type="checkbox" name="brushMode" ${brushMode ? 'checked' : ''}><span><b>Plošné zvýraznění</b><small>Namaluje část modelu místo jediného bodu.</small></span></label><div class="brush-settings ${brushMode ? '' : 'is-disabled'}"><label class="brush-category-colour"><span>Barva z kategorie</span><i style="--brush-category-color:${escapeHtml(categoryColor)}"></i><input type="checkbox" name="brushColorOverride" ${colorMode === 'custom' ? 'checked' : ''} ${brushMode ? '' : 'disabled'}> Ručně přepsat</label><label>Barva štítku a plochy<input type="color" name="brushColor" value="${escapeHtml(color)}" ${brushMode && colorMode === 'custom' ? '' : 'disabled'}></label><label>Velikost štětce <output data-brush-radius>${formatLineLength(brushRadius, brushStep)}</output><input type="range" name="brushRadius" min="${brushMinimum}" max="${brushMaximum}" step="${brushStep}" value="${brushRadius}" ${brushMode ? '' : 'disabled'}></label>${hasPaintedSurface ? `<button type="button" class="small-button small-button-danger" data-clear-surface>${actionIconMarkup('delete')}Vymazat plochu</button>` : ''}</div><p class="draft-help brush-help">${brushMode ? 'Štětec je aktivní — malujte levým tlačítkem po modelu. Pro otočení modelu táhněte pravým tlačítkem myši, táhněte mimo model nebo držte Alt.' : 'Zapnutím štětce můžete k tomuto štítku domalovat zvýrazněnou plochu.'}</p></fieldset>

      <fieldset class="tag-editor-style"><legend>${surfaceTitle}</legend>${!brushMode ? `<label>Barva<select name="colorMode"><option value="category" ${colorMode === 'category' ? 'selected' : ''}>Podle kategorie</option><option value="custom" ${colorMode === 'custom' ? 'selected' : ''}>Vlastní barva</option></select></label><label>Barva štítku a čáry<input type="color" name="pointColor" value="${escapeHtml(color)}" ${colorMode === 'custom' ? '' : 'disabled'}></label>` : ''}<button type="button" class="small-button" data-edit-line>${actionIconMarkup('edit')}Upravit polohu čáry</button><button type="button" class="small-button ${anchorSelectionActive ? 'is-active' : ''}" data-edit-anchor>${actionIconMarkup('view')}${anchorSelectionActive ? 'Klikněte na nový bod' : 'Upravit bod na modelu'}</button><p>${anchorSelectionActive ? 'Režim výběru je aktivní — klikněte na nové místo na povrchu modelu.' : hasEditedAnchor ? 'Nový bod je vybraný. Uložte změny pro jeho potvrzení.' : 'Čára končí barevným kruhem u plovoucího štítku. Přetažením kruhu ji přesunete.'}</p></fieldset>
      ${lineLengthControlMarkup(draft)}
      <label>Detailní popisek <span class="field-note">podporuje [[Wiki odkazy]]</span><textarea name="description" rows="5" placeholder="Např. odkaz na související článek nebo detail…">${escapeHtml(draft.description)}</textarea></label>
      <div class="draft-actions"><button type="button" class="button button-secondary" data-cancel>Zrušit</button><button type="button" class="button button-primary" data-save ${draft.title.trim() ? '' : 'disabled'}>${actionIconMarkup('save')}Uložit změny</button></div>
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
      module: draft.module
    });
  };

  host.querySelectorAll('input, select, textarea').forEach((input) => {
    if (!['moduleSearchQuery', 'moduleSystemFilter', 'selectedModule'].includes(input.name)) {
      input.addEventListener('input', emit);
    }
  });

  ['category', 'colorMode', 'brushMode', 'brushColorOverride'].forEach((name) => {
    const el = host.querySelector(`[name="${name}"]`);
    if (el) {
      el.addEventListener('change', () => {
        emit();
        renderTagEditorPanel(host, draft, { categories, onChange, onSave, onCancel, onEditLeaderLine, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
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
      renderTagEditorPanel(host, draft, { categories, onChange, onSave, onCancel, onEditLeaderLine, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
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
      performSearch(host, query, systemId, (selectedTerm) => {
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
        renderTagEditorPanel(host, draft, { categories, onChange, onSave, onCancel, onEditLeaderLine, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
        onChange({
          title: draft.title,
          category: draft.category,
          description: draft.description,
          module: draft.module
        });
      });
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
      renderTagEditorPanel(host, draft, { categories, onChange, onSave, onCancel, onEditLeaderLine, onEditAnchor, onClearSurface, onAddCategory, anchorSelectionActive, hasEditedAnchor });
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
  host.querySelector('[data-edit-line]').addEventListener('click', onEditLeaderLine);
  host.querySelector('[data-edit-anchor]').addEventListener('click', onEditAnchor);
  host.querySelector('[data-save]').addEventListener('click', onSave);
}
