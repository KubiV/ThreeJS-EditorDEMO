import { createSearchIndex } from './fuzzy-search.js';

let dataPromise = null;
let searchIndex = null;
let cachedData = null;

async function loadData() {
  if (cachedData) return cachedData;
  if (!dataPromise) {
    dataPromise = import('./data/terminologia-anatomica.json', { with: { type: 'json' } })
      .then((module) => {
        cachedData = module.default || module;
        searchIndex = createSearchIndex(cachedData.terms || []);
        return cachedData;
      })
      .catch((error) => {
        dataPromise = null;
        console.error('Chyba při načítání databáze Terminologia Anatomica:', error);
        throw error;
      });
  }
  return dataPromise;
}

export function getIfaaUrl(taCode) {
  if (!taCode) return '';
  const cleanCode = String(taCode).trim().replace(/^A/i, '');
  if (!/^\d{2}\.\d\.\d{2}\.\d{3}$/.test(cleanCode) && !/^\d{2}\./.test(cleanCode)) return '';
  return `https://ifaa.unifr.ch/Public/EntryPage/TA98%20Tree/Entity%20TA98%20EN/${encodeURIComponent(cleanCode)}%20Entity%20TA98%20EN.htm`;
}

export const AnatomyModule = {
  id: 'anatomy',
  name: 'Anatomie (Terminologia Anatomica)',
  shortName: 'Anatomie',
  description: 'Terminologia Anatomica 1989: 16 orgánových soustav, latinské a anglické názvy s identifikačními kódy.',

  getUrl(termId) {
    return getIfaaUrl(termId);
  },

  async isReady() {
    await loadData();
    return true;
  },

  async getSystems() {
    const data = await loadData();
    return data.systems || [];
  },

  async getCategories() {
    const data = await loadData();
    return (data.systems || []).map((system) => ({
      id: system.id,
      name: system.name,
      shortName: system.shortName,
      latinName: system.latinName,
      description: `Orgánová soustava: ${system.latinName}`,
      color: system.color
    }));
  },

  async searchTerms(query = '', { systemId = '', limit = 25 } = {}) {
    await loadData();
    if (!searchIndex) return [];
    return searchIndex.search(query, { systemId, limit });
  },

  async getStructures({ systemId = '', query = '', limit = 40 } = {}) {
    await loadData();
    if (!searchIndex) return [];
    return searchIndex.getStructures({ systemId, query, limit });
  },

  async getStructureElements(structureQuery, { subQuery = '', systemId = '', limit = 200 } = {}) {
    await loadData();
    if (!searchIndex) return { structureQuery, direct: [], related: [], totalCount: 0 };
    return searchIndex.getStructureElements(structureQuery, { subQuery, systemId, limit });
  },

  async getTermById(id) {
    const data = await loadData();
    if (!id) return null;
    return (data.terms || []).find((term) => term.id === id || term.taCode === id) || null;
  },

  formatTagData(term) {
    if (!term) return {};
    return {
      title: term.latin,
      category: term.systemId || 'obecne',
      module: {
        id: 'anatomy',
        termId: term.taCode || term.id,
        latin: term.latin,
        english: term.english || '',
        parent: term.parent || '',
        parentEnglish: term.parentEnglish || '',
        path: term.path || '',
        system: term.systemId || '',
        url: getIfaaUrl(term.taCode || term.id)
      }
    };
  }
};
