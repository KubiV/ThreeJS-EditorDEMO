# Nasazení 3D prohlížeče do existující MediaWiki

Tento návod popisuje nasazení do již běžící, veřejně dostupné MediaWiki. Aplikace 3D prohlížeče běží jako samostatná Node.js služba a MediaWiki poskytuje články, šablony a přihlášenou relaci uživatele.

Příklady používají tyto adresy:

| Služba | Adresa |
| --- | --- |
| MediaWiki | `https://wiki.example.org` |
| 3D prohlížeč | `https://3d.example.org` |

Použijte vlastní domény, ale pro úpravy pod přihlášeným účtem je doporučené ponechat obě služby pod stejnou hlavní doménou, například `wiki.example.org` a `3d.example.org`. Obě služby musí používat HTTPS.

## Co bude po instalaci fungovat

- Články `3D:Název modelu` budou uchovávat konfiguraci modelu a jeho štítky.
- Šablona `{{3D prohlížeč}}` vloží prohlížeč do běžného wiki článku.
- Šablona `{{3D odkaz}}` vytvoří odkaz do samostatného prohlížeče s ikonou 3D krychle za textem; text i ikona jsou jeden odkaz.
- Přihlášený uživatel MediaWiki bude moci nahrát model a uložit změny do článku `3D:`.

## 1. Připravte servery a zálohy

Je potřeba:

- administrátorský přístup k cílové MediaWiki a k jejímu `LocalSettings.php`;
- shellový přístup k serveru pro MediaWiki a k serveru, na kterém poběží Node.js aplikace;
- Node.js 18 nebo novější a PHP kompatibilní s provozovanou MediaWiki;
- DNS záznam a platný TLS certifikát pro `3d.example.org`;
- záloha databáze MediaWiki, jejího `LocalSettings.php` a budoucí složky s modely.

Rozšíření v tomto projektu je ověřené s MediaWiki 1.41. Před nasazením do jiné hlavní verze ověřte nejdříve postup na testovací wiki se stejnou verzí a stejným nastavením oprávnění.

## 2. Nainstalujte rozšíření do MediaWiki

Z balíčku tohoto projektu zkopírujte celou složku `extensions/ThreeDViewer/` do `extensions/ThreeDViewer/` cílové MediaWiki. Například:

```bash
rsync -a /cesta/k/ThreeJS-EditorDEMO/extensions/ThreeDViewer/ \
  /var/www/mediawiki/extensions/ThreeDViewer/
```

Souborům nastavte stejného vlastníka a skupinu, jaké používá zbytek instalace MediaWiki. Nepřepisujte bez zálohy případnou starší, ručně upravenou kopii rozšíření.

Na serveru MediaWiki přidejte na konec `LocalSettings.php` následující konfiguraci. Číslo `3000` je příklad; musí být v dané wiki nepoužité. Název jmenného prostoru a hodnota `pagePrefix` v pozdější konfiguraci aplikace musí být stejné.

```php
# Vlastní obsahový prostor pro definice modelů.
define( 'NS_MODEL3D', 3000 );
$wgExtraNamespaces[NS_MODEL3D] = '3D';
$wgNamespacesWithSubpages[NS_MODEL3D] = true;
if ( !in_array( NS_MODEL3D, $wgContentNamespaces, true ) ) {
	$wgContentNamespaces[] = NS_MODEL3D;
}

# Parser hooky pro <model3d> a pro obě wiki šablony.
wfLoadExtension( 'ThreeDViewer' );
$wgThreeDViewerUrl = 'https://3d.example.org/';

# Umožní prohlížeči na této přesné adrese volat Action API s relací uživatele.
$wgCrossSiteAJAXdomains[] = 'https://3d.example.org';
```

Pokud wiki už prostor `3D` používá, nepřidávejte jej podruhé. Použijte jeho stávající interní ID a nastavte stejný název i v konfiguraci aplikace.

Spusťte standardní aktualizaci MediaWiki a vytvořte výchozí wiki stránky:

```bash
cd /var/www/mediawiki
php maintenance/update.php
php extensions/ThreeDViewer/maintenance/seedPages.php
```

`seedPages.php` založí `Template:3D prohlížeč`, `Template:3D odkaz`, jejich podstránky `Template:3D prohlížeč/dokumentace` a `Template:3D odkaz/dokumentace`, `3D:Kategorie`, stránku `3D:Prohlížeč` (O 3D prohlížeči) a ukázkový článek `3D:Femur`. Dokumentace podstránek se při otevření rodičovských šablon zobrazí automaticky. Existující stránky nepřepisuje. Variantu s přepsáním existujících stránek (`--force`) používejte jen po záloze a s jistotou, že jejich vlastní úpravy chcete nahradit.

Výchozí wiki šablony jsou v `extensions/ThreeDViewer/templates/` a `seedPages.php` je při instalaci načítá přímo z této složky. Ikona 3D krychle je vložená přímo rozšířením, takže ji není nutné nahrávat do jmenného prostoru `Soubor:`. Při aktualizaci již nasazené wiki nejprve zazálohujte vlastní úpravy šablon, nakopírujte novou verzi celého rozšíření a teprve potom podle potřeby spusťte `php extensions/ThreeDViewer/maintenance/seedPages.php --force`.

Ukázkový článek `3D:Femur` očekává soubor `storage/models/Femur.stl`. Pro jeho funkční zobrazení jej zkopírujte z `threejsdemo/public/Femur.stl` do této cesty, nebo ukázkový článek po instalaci smažte a ověřte systém vlastním modelem.

## 3. Nainstalujte Node.js aplikaci

Na serveru aplikace vytvořte samostatný servisní účet a složku. Následující cesty jsou příklady:

```bash
sudo adduser --system --group --home /opt/wikiskripta-3d wikiskripta3d
sudo mkdir -p /opt/wikiskripta-3d
sudo chown wikiskripta3d:wikiskripta3d /opt/wikiskripta-3d
```

Do této složky nakopírujte nebo naklonujte zdrojový kód projektu. Poté pod servisním účtem nainstalujte závislosti, sestavte klientskou část a vytvořte neveřejnou konfiguraci:

```bash
cd /opt/wikiskripta-3d
sudo -u wikiskripta3d npm ci
sudo -u wikiskripta3d npm run build
sudo -u wikiskripta3d cp LocalSettings.example.js LocalSettings.js
sudo chmod 600 LocalSettings.js
```

Upravte `LocalSettings.js`. Příklad pro samostatnou subdoménu:

```js
export default {
  server: {
    port: 3000,
    fallbackToNextPort: false
  },
  branding: {
    headerText: '3D prohlížeč',
    topbarBackgroundColor: '#ffbe00',
    topbarTextColor: '#202122'
  },
  storage: {
    directory: '/var/lib/wikiskripta-3d/storage',
    publicModelsUrl: 'https://3d.example.org/storage/models'
  },
  upload: {
    maxFileSizeMB: 50,
    maxFiles: 5,
    allowedExtensions: ['.stl', '.obj', '.mtl', '.gltf', '.glb']
  },
  security: {
    writeRateWindowMinutes: 15,
    writeRateMaxRequests: 20,
    trustedOrigins: [],
    modelAccess: {
      requireLogin: true,
      allowedGroups: []
    }
  },
  mediaWiki: {
    apiUrl: 'https://wiki.example.org/api.php',
    pagePrefix: '3D',
    categoryPage: '3D:Kategorie',
    infoPageUrl: 'https://wiki.example.org/index.php?title=3D:Prohl%C3%AD%C5%BEe%C4%8D',
    loginUrl: 'https://wiki.example.org/index.php?title=Special:UserLogin',
    botUsername: '',
    botPassword: ''
  }
};
```

Hodnota `storage.publicModelsUrl` musí být HTTPS adresa této aplikace, nikoli cesta na disku. Aplikace ukládá modely do `storage/models/` a do článků MediaWiki ukládá jen jejich relativní jména; při čtení se k nim tato adresa připojí. Cesta `/storage/models/...` už není veřejný statický adresář: před vydáním souboru Node služba ověří MediaWiki relaci, právo `read` a případně skupinu v `security.modelAccess.allowedGroups`.

Zápis do aplikace ověřuje server proti MediaWiki: `POST /api/models`,
`PUT /api/models/*` a `POST /api/wiki/publish` přijmou pouze požadavek z
důvěryhodného originu s relací MediaWiki, jejíž uživatel má právo `edit`.
Výchozí limit je 20 zápisů jednoho uživatele za 15 minut. Vlastní origin
prohlížeče je povolen automaticky; `security.trustedOrigins` slouží jen pro
další výslovně důvěryhodné originy.

Node aplikace musí při tom obdržet cookie přihlášeného uživatele. Při nasazení
na samostatné doméně `3d.example.org` a wiki na `wiki.example.org` proto buď
provozujte prohlížeč pod stejným hostem jako wiki, nebo na MediaWiki bezpečně
nastavte společnou cookie doménu pouze pro důvěryhodné subdomény (např.
`.example.org`) a ponechte `Secure` a `SameSite=Lax` nebo přísnější. Bez této
vazby server nahrání i načtení chráněného modelu odmítne, i když se prohlížeč
umí přihlásit přímo k wiki.

Soubor `.env` tato verze aplikace nenačítá. Konfigurace patří do `LocalSettings.js`, který nesmí být verzovaný ani veřejně přístupný. Po každé změně tohoto souboru je nutný restart Node.js služby.

Připravte zapisovatelné a zálohované úložiště pro modely:

```bash
sudo install -d -o wikiskripta3d -g wikiskripta3d -m 750 /var/lib/wikiskripta-3d/storage/models
sudo -u wikiskripta3d sh -c 'printf "[]\n" > /var/lib/wikiskripta-3d/storage/models.json'
```

Pokud už úložiště obsahuje reálné modely, druhý příkaz nepoužívejte: soubor `models.json` by přepsal.

## 4. Volitelně nastavte účet bota

Běžné nahrávání a ukládání funguje přes relaci uživatele přihlášeného do MediaWiki. Bot není pro tento postup nezbytný.

Chcete-li povolit serverové publikování bez relace uživatele, vytvořte v MediaWiki bot password s minimálním oprávněním k úpravě článků v prostoru `3D`. Do `LocalSettings.js` potom zkopírujte přesný název účtu a heslo, které MediaWiki při založení bot password vydá:

```js
botUsername: 'uzivatel@nazev-bota',
botPassword: 'heslo-z-bot-password'
```

Údaje bota patří pouze do `LocalSettings.js` s omezenými právy souboru. Nikdy je nedávejte do JavaScriptu prohlížeče, do `.env.example`, do gitového repozitáře ani do wikitextu.

## 5. Spusťte službu a zveřejněte ji přes HTTPS

Vytvořte například `/etc/systemd/system/wikiskripta-3d.service`. Cestu k `npm` nahraďte výsledkem `command -v npm` na daném serveru.

```ini
[Unit]
Description=WikiSkripta 3D editor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=wikiskripta3d
Group=wikiskripta3d
WorkingDirectory=/opt/wikiskripta-3d
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Službu načtěte a spusťte:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wikiskripta-3d
sudo systemctl status wikiskripta-3d
```

Node.js služba sama nemá obsluhovat veřejné TLS. Umístěte před ni reverzní proxy. Minimalistická konfigurace pro Caddy je:

```caddyfile
3d.example.org {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
```

Povolte z internetu pouze porty 80 a 443. Port 3000 omezte firewallem na lokální reverzní proxy; aplikace jej standardně otevírá na všech síťových rozhraních. Pokud wiki používá vlastní Content Security Policy s direktivou `frame-src`, přidejte do ní také `https://3d.example.org`.

## 6. Zabezpečte provozní vrstvu

Modely jsou standardně dostupné jen přihlášeným čtenářům MediaWiki. Pro další
omezení nastavte `security.modelAccess.allowedGroups`, například na
`['student', 'teacher']`; prázdné pole povolí každého přihlášeného čtenáře.
Přímá URL bez platné relace vrací `401` a odpovědi modelů mají hlavičku
`Cache-Control: private, no-store`. Model nelze technicky utajit před
uživatelem, který jej smí zobrazit — jeho prohlížeč si data musí stáhnout — ale
adresa není použitelná pro nepřihlášené ani mimo určené skupiny.

Aplikace dále autoritativně chrání zápisové endpointy relací MediaWiki,
kontrolou originu a limitem zápisů:

- `POST /api/models`;
- `PUT /api/models/*`;
- `POST /api/wiki/publish`.

Za reverzní proxy ponechte také limit velikosti požadavku a omezení podle IP,
aby jeden platný účet nemohl zbytečně zaměstnat přenos nebo převod modelu. Pro
menší instalace je vhodné zpřístupnit editor pouze přes VPN nebo samostatné
administrátorské přihlášení a návštěvníkům nechat jen veřejný prohlížeč. U
produkčního provozu přidejte antivirovou kontrolu nahrávaných souborů a
pravidelné zálohy `storage/`, `models.json` i databáze MediaWiki.

## 7. Ověřte instalaci

Po spuštění ověřte stav aplikace z příkazové řádky:

```bash
curl -sS https://3d.example.org/api/wiki/status
```

Úspěšná odpověď obsahuje `"isReady": true`, nalezený jmenný prostor `3D` a prázdné pole `issues`. Pak proveďte tento ruční test:

1. Otevřete `https://3d.example.org/` a zkontrolujte seznam modelů.
2. Přihlaste se do `https://wiki.example.org/` účtem s právem `edit`.
3. V editoru nahrajte malý testovací model a uložte vytvořený článek `3D:Název`.
4. Do běžného článku vložte například:

   ```wikitext
   {{3D prohlížeč|model=3D:Název|výška=560|varianta=malá}}

   {{3D odkaz|model=3D:Název|text=Otevřít model}}
   ```

5. Zkontrolujte zobrazení v iframe, samostatné otevření, návrat na článek a uložení změny štítku.

Pokud stav hlásí nedostupné API, ověřte adresu `mediaWiki.apiUrl`, DNS a firewall mezi Node.js a MediaWiki. Pokud se uživatel může přihlásit do wiki, ale nemůže uložit změnu z prohlížeče, nejprve zkontrolujte přesný origin v `$wgCrossSiteAJAXdomains`, HTTPS na obou subdoménách a případnou vlastní CSP politiku wiki.
