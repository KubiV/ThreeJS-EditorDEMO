import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const EXCEL_PATH = path.join(rootDir, 'data', 'anatomicka nomenklatura TA 98.xls');
const OUTPUT_DIR = path.join(rootDir, 'src', 'modules', 'anatomy', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'terminologia-anatomica.json');

const SYSTEM_CONFIG = {
  'Anatomia generalis': {
    id: 'anatomia-generalis',
    name: 'Anatomia generalis (Obecná anatomie)',
    shortName: 'Obecná anatomie',
    latinName: 'Anatomia generalis',
    color: '#708090'
  },
  'Ossa': {
    id: 'ossa',
    name: 'Ossa (Kosterní soustava)',
    shortName: 'Kosterní soustava',
    latinName: 'Systema skeletale / Ossa',
    color: '#d4a373'
  },
  'Juncturae': {
    id: 'juncturae',
    name: 'Juncturae (Kloubní soustava)',
    shortName: 'Kloubní soustava',
    latinName: 'Systema articulare / Juncturae',
    color: '#c08497'
  },
  'Musculi': {
    id: 'musculi',
    name: 'Musculi (Svalová soustava)',
    shortName: 'Svalová soustava',
    latinName: 'Systema musculare / Musculi',
    color: '#c94c4c'
  },
  'Systema digestorium': {
    id: 'systema-digestorium',
    name: 'Systema digestorium (Trávicí soustava)',
    shortName: 'Trávicí soustava',
    latinName: 'Systema digestorium',
    color: '#e29578'
  },
  'Systema respiratorium': {
    id: 'systema-respiratorium',
    name: 'Systema respiratorium (Dýchací soustava)',
    shortName: 'Dýchací soustava',
    latinName: 'Systema respiratorium',
    color: '#83c5be'
  },
  'Cavitas thoracis': {
    id: 'cavitas-thoracis',
    name: 'Cavitas thoracis (Hrudní dutina)',
    shortName: 'Hrudní dutina',
    latinName: 'Cavitas thoracis',
    color: '#588b8b'
  },
  'S. urinarium': {
    id: 'systema-urinarium',
    name: 'Systema urinarium (Močová soustava)',
    shortName: 'Močová soustava',
    latinName: 'Systema urinarium',
    color: '#e9c46a'
  },
  'S. genitalia': {
    id: 'systemata-genitalia',
    name: 'Systemata genitalia (Pohlavní soustava)',
    shortName: 'Pohlavní soustava',
    latinName: 'Systemata genitalia',
    color: '#f4a261'
  },
  'Cavitas abdominis': {
    id: 'cavitas-abdominis',
    name: 'Cavitas abdominis (Břišní a pánevní dutina)',
    shortName: 'Břišní dutina',
    latinName: 'Cavitas abdominis et pelvis',
    color: '#c6ad8f'
  },
  'Gl. endocrinae': {
    id: 'glandulae-endocrinae',
    name: 'Glandulae endocrinae (Endokrinní žlázy)',
    shortName: 'Endokrinní žlázy',
    latinName: 'Glandulae endocrinae',
    color: '#9b5de5'
  },
  'S. cardiovasculare': {
    id: 'systema-cardiovasculare',
    name: 'Systema cardiovasculare (Srdečně-cévní soustava)',
    shortName: 'Srdečně-cévní soustava',
    latinName: 'Systema cardiovasculare',
    color: '#e63946'
  },
  'S. lymphoideum': {
    id: 'systema-lymphoideum',
    name: 'Systema lymphoideum (Mízní soustava)',
    shortName: 'Mízní soustava',
    latinName: 'Systema lymphoideum',
    color: '#52b788'
  },
  'S. nervosum': {
    id: 'systema-nervosum',
    name: 'Systema nervosum (Nervová soustava)',
    shortName: 'Nervová soustava',
    latinName: 'Systema nervosum',
    color: '#3a86ff'
  },
  'Organa sensuum': {
    id: 'organa-sensuum',
    name: 'Organa sensuum (Smyslové orgány)',
    shortName: 'Smyslové orgány',
    latinName: 'Organa sensuum',
    color: '#00b4d8'
  },
  'Integumentum c.': {
    id: 'integumentum-commune',
    name: 'Integumentum commune (Kůže a deriváty)',
    shortName: 'Kožní soustava',
    latinName: 'Integumentum commune',
    color: '#bc6c25'
  }
};

function cleanString(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFC');
}

function normalizeId(rawId) {
  let id = cleanString(rawId);
  if (id === '102.0.00.000') id = 'A02.0.00.000';
  return id;
}

function buildAnatomyData() {
  if (!fs.existsSync(EXCEL_PATH)) {
    throw new Error(`Excel soubor nenalezen na cestě: ${EXCEL_PATH}`);
  }

  console.log(`Čtu Excel soubor: ${EXCEL_PATH}`);
  const fileBuffer = fs.readFileSync(EXCEL_PATH);
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

  // Pass 1: Build Level 2 section map (Axx.x) and Level 3 group head map (Axx.x.xx)
  const level2Map = new Map();
  const groupHeadMap = new Map();

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    rows.slice(1).forEach((r) => {
      const rawId = normalizeId(r[0]);
      const latin = cleanString(r[1]);
      const english = cleanString(r[2]);
      if (!rawId) return;

      const parts = rawId.split('.');
      if (parts.length >= 4) {
        const code2 = parts.slice(0, 2).join('.');
        const code3 = parts.slice(0, 3).join('.');
        if (parts[2] === '00' && (parts[3] === '000' || parts[3] === '001') && !level2Map.has(code2)) {
          level2Map.set(code2, { latin, english, code: rawId });
        }
        if ((parts[3] === '001' || parts[3] === '000') && !groupHeadMap.has(code3)) {
          groupHeadMap.set(code3, { latin, english, code: rawId });
        }
      }
    });
  });

  const systems = [];
  const terms = [];
  let termIndex = 0;

  workbook.SheetNames.forEach((sheetName) => {
    const config = SYSTEM_CONFIG[sheetName] || {
      id: sheetName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: sheetName,
      shortName: sheetName,
      latinName: sheetName,
      color: '#607d8b'
    };

    systems.push({
      id: config.id,
      name: config.name,
      shortName: config.shortName,
      latinName: config.latinName,
      color: config.color
    });

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    let currentSection = '';
    let stack = [];

    rows.slice(1).forEach((row) => {
      const rawId = normalizeId(row[0]);
      const rawLatinOriginal = String(row[1] || '');
      const rawLatin = cleanString(row[1]);
      const rawEnglish = cleanString(row[2]);

      if (!rawLatin && !rawEnglish && !rawId) return;

      if (!rawId && (rawLatin || rawEnglish)) {
        currentSection = rawLatin || rawEnglish;
        stack = [];
        return;
      }

      const leadingSpaces = rawLatinOriginal.search(/\S|$/);
      const level = leadingSpaces >= 0 ? leadingSpaces : 0;

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      const parts = rawId.split('.');
      const code2 = parts.length >= 2 ? parts.slice(0, 2).join('.') : '';
      const code3 = parts.length >= 3 ? parts.slice(0, 3).join('.') : '';

      const l2Section = level2Map.get(code2);
      const groupParent = groupHeadMap.get(code3);
      const directParent = stack.length > 0 ? stack[stack.length - 1] : null;

      termIndex++;
      const id = rawId || `${config.id}-hdr-${termIndex}`;
      const latin = rawLatin || rawEnglish || id;
      const english = rawEnglish || '';

      let parentLatin = '';
      let parentEnglish = '';

      if (groupParent && groupParent.latin !== latin) {
        parentLatin = groupParent.latin;
        parentEnglish = groupParent.english;
      } else if (directParent && directParent.latin !== latin) {
        parentLatin = directParent.latin;
        parentEnglish = directParent.english;
      }

      // Breadcrumb path: e.g. "Ossa membri superioris > Ulna"
      const pathParts = [];
      if (l2Section && l2Section.latin !== latin && l2Section.latin !== parentLatin) {
        pathParts.push(l2Section.latin);
      } else if (currentSection && currentSection !== latin && currentSection !== parentLatin) {
        pathParts.push(currentSection);
      }
      if (parentLatin && !pathParts.includes(parentLatin)) {
        pathParts.push(parentLatin);
      }
      const path = pathParts.join(' > ');

      stack.push({ level, latin, english, code: rawId });

      terms.push({
        id,
        taCode: rawId,
        latin,
        english,
        systemId: config.id,
        section: currentSection || (l2Section ? l2Section.latin : ''),
        parent: parentLatin,
        parentEnglish,
        path
      });
    });
  });

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const result = {
    version: '1989',
    title: 'Terminologia Anatomica (1989 / 1998)',
    source: 'anatomicka nomenklatura TA 98.xls',
    generatedAt: new Date().toISOString(),
    totalTerms: terms.length,
    systems,
    terms
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`✅ Úspěšně vygenerováno ${terms.length} termínů do ${OUTPUT_FILE}`);
  console.log(`✅ Seznam soustav (${systems.length}):`, systems.map((s) => s.shortName).join(', '));
}

buildAnatomyData();
