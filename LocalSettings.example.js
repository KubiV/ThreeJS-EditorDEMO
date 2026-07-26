/**
 * Lokální serverová konfigurace 3D prohlížeče a editoru.
 *
 * Tento soubor zkopírujte na serveru jako `LocalSettings.js` a upravujte
 * pouze v textovém editoru. `LocalSettings.js` je v .gitignore a server ho
 * nikdy nevystavuje přes HTTP.
 */
export default {
  server: {
    // Výchozí port Node.js serveru.
    port: 3000,
    // Pokud je výchozí port obsazený, zkusí server následující volné porty.
    fallbackToNextPort: true
  },

  // Vzhled horní lišty. Barvy zadávejte jako hexadecimální kód (#RRGGBB).
  branding: {
    // Text zobrazený za logem v horní liště. Prázdný text skryje název.
    headerText: '3D prohlížeč',
    topbarBackgroundColor: '#ffbe00',
    topbarTextColor: '#202122'
  },

  storage: {
    // Cesta je relativní ke kořeni projektu, může být i absolutní.
    directory: 'storage',
    // Veřejná URL, na kterou se doplňují relativní cesty z <model3d>.
    publicModelsUrl: '/storage/models'
  },

  upload: {
    // Maximální velikost JEDNOHO nahrávaného souboru. Tato hodnota se
    // automaticky zobrazí v průvodci nahráním a vynutí ji i server.
    maxFileSizeMB: 50,
    // Nejvýše tolik souborů lze nahrát najednou (např. OBJ + MTL + textury).
    maxFiles: 5,
    allowedExtensions: ['.stl', '.obj', '.mtl', '.gltf', '.glb']
  },

  security: {
    // Zápisové endpointy vždy vyžadují platnou relaci MediaWiki a právo
    // „edit“. Tyto hodnoty navíc omezují počet zápisů jednoho uživatele.
    writeRateWindowMinutes: 15,
    writeRateMaxRequests: 20,
    // Vlastní origin prohlížeče je povolen automaticky. Sem přidejte pouze
    // další, výslovně důvěryhodné originy bez cesty (obvykle nechte prázdné).
    trustedOrigins: [],
    // Modely se nevystavují jako veřejné statické soubory. Před každým
    // načtením server ověří MediaWiki relaci a právo „read“.
    modelAccess: {
      requireLogin: true,
      // Prázdné pole znamená každý přihlášený čtenář. Např. ['student',
      // 'teacher'] povolí modely jen členům těchto MediaWiki skupin.
      allowedGroups: []
    }
  },

  mediaWiki: {
    apiUrl: 'http://localhost:8000/api.php',
    pagePrefix: '3D',
    categoryPage: '3D:Kategorie',
    // Nechte prázdné pro automatické odvození z apiUrl.
    infoPageUrl: '',
    loginUrl: '',

    // Volitelné přihlašovací údaje bota. Zůstávají jen v LocalSettings.js
    // na serveru a nikdy se neposílají do prohlížeče.
    botUsername: '',
    botPassword: ''
  }
};
