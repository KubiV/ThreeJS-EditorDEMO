# WikiSkripta 3D editor

Český prohlížeč a editor anatomických 3D modelů pro vzdělávací články WikiSkript. Rozhraní vychází z vizuálního jazyka WikiSkript: žlutá lišta `#ffbe00`, kompaktní wiki navigace, modré odkazy a jemné obsahové panely.

## Co umí

- Rozcestník modelů s náhledy, formáty a počtem štítků.
- Načtení **STL**, **OBJ + MTL**, **GLTF** a **GLB**; v režimu úprav lze nastavit barvu, pozadí, drsnost, drátěný model, průhlednost i průřezy modelu.
- Upload průvodce se zdrojem, autorem a licencí modelu; údaje se ukládají do registru i exportu pro MediaWiki.
- Automatické varianty Small/Medium/Original a vygenerovaný SVG náhled. Zjednodušení zachovává souřadnice i měřítko, takže štítky fungují ve všech variantách. Pokud vytvoření variant selže, prohlížeč bezpečně použije originál.
- Tři strategie načítání uložené pro konkrétní zařízení: vybraná varianta, postupné S → M → originál nebo předdefinovaná varianta s tlačítkem pro originál. Vložený prohlížeč začíná malou variantou, pokud šablona neurčí jinou.
- Anatomické **štítky** v prostoru s antialiasovanou vodicí čárou a samostatné bohaté **popisky** v panelu.
- Filtrování kategorií, plynulé zaměření kamery na štítek a URL odkazy typu `#model=ukazka-femur&tag=caput-femoris` (funguje i název souboru modelu).
- Editor štítků: zvolte „Přidat štítek“ a klikněte na povrch modelu. Vybraný zlatý koncový bod vodicí čáry lze táhnout myší; tím se průběžně uloží její směr do `normal` i vzdálenost do `lineLength`. Pro jemné doladění lze v režimu úprav podržet `Shift` nebo `L` a otáčet kolečkem.
- Jednoduchý bezpečný renderer Wikitextu pro interní odkazy jako `[[Aorta|Srdečnice]]`.
- Export konfigurace do parser tagu `<model3d>` a volitelné uložení přes MediaWiki Action API.

## Rychlé spuštění

Požadován je Node.js 18 nebo novější. Pro lokální MediaWiki je navíc potřeba
PHP s podporou SQLite a samostatně nainstalovaná MediaWiki 1.41 ve složce
`mediawiki-1.41.1/`. Tato složka v repozitáři není; tím se na GitHub
nepublikuje ani databáze, ani její konfigurace.

Po vytvoření lokální instalace MediaWiki vytvořte odkaz na verzované rozšíření:

```bash
bash scripts/link-local-mediawiki-extension.sh
```

```bash
npm install
# v prvním terminálu: lokální MediaWiki (http://localhost:8000)
npm run wiki
# ve druhém terminálu: 3D prohlížeč
npm run dev
```

Prohlížeč běží na [http://localhost:3000](http://localhost:3000); pokud je port obsazený, automaticky zkusí následující volný port. MediaWiki musí běžet souběžně na portu 8000, protože články `3D:` jsou zdrojem pravdy pro rozcestník. Produkční build vytvoříte a spustíte takto:

```bash
npm run build
npm start
```

`npm run dev` spouští Vite přes Express, takže funguje jak hot reload klienta, tak lokální API pro modely. `npm start` obsluhuje složku `dist` stejným API.

Pro nasazení do jiné, již běžící MediaWiki včetně HTTPS, rozšíření, šablon a provozu Node.js služby použijte samostatný [produkční návod](docs/instalace-do-existujici-mediawiki.md).

Při prvním zprovoznění lokální wiki vytvořte ukázkové články a šablony
bezpečným, opakovatelným příkazem. Existující stránky nepřepíše:

```bash
cd mediawiki-1.41.1
php extensions/ThreeDViewer/maintenance/seedPages.php
```

## Serverová konfigurace

Všechna nasazovací nastavení jsou v neveřejném souboru
`LocalSettings.js` v kořeni projektu, obdobně jako `LocalSettings.php` u
MediaWiki. Upravuje se pouze textovým editorem přímo na serveru — v aplikaci
pro něj není žádné rozhraní a server vrací na jeho URL vždy `404` (i během
vývoje s Vite).

Soubor je v `.gitignore`; pro nové nasazení použijte jako výchozí šablonu
`LocalSettings.example.js`:

```bash
cp LocalSettings.example.js LocalSettings.js
```

Sekce `server`, `branding`, `storage`, `upload`, `security` a `mediaWiki` nastavují port,
vzhled horní lišty, úložiště, limity nahrávání, ochranu zápisů a připojení k wiki.
V `branding` lze nastavit text za logem (`headerText`) a hexadecimální barvy
horní lišty (`topbarBackgroundColor`, `topbarTextColor`). Hodnota
`upload.maxFileSizeMB` je limit jednoho souboru. Výchozí hodnota je **50 MB**;
server ji vynucuje a průvodce nahráním ji načítá přes API, takže se po změně
konfigurace a restartu serveru automaticky zobrazí správná hodnota. Do
prohlížeče se předávají pouze veřejné údaje potřebné pro rozhraní (včetně
vzhledu lišty, limitu, počtu souborů a povolených přípon), nikdy obsah
`LocalSettings.js` ani údaje bota.

Zápisové endpointy (`POST /api/models`, `PUT /api/models/*` a
`POST /api/wiki/publish`) server chrání sám: požadavek musí přijít z vlastního
originu prohlížeče, uživatel musí mít platnou relaci MediaWiki s právem `edit`
a platí limit `security.writeRateMaxRequests` za
`security.writeRateWindowMinutes`. Nejde tedy pouze o omezení tlačítka v UI.
Chování adres `/storage/models/...` nastavuje
`security.modelAccess.mode`: `login-required` (výchozí) vyžaduje relaci
MediaWiki a právo `read`; `public` model zpřístupní všem včetně přímé URL;
`view-only` dovolí anonymní načtení ve 3D prohlížeči, ale odmítne běžné otevření
raw URL v nové kartě. Odpovědi modelů se navíc nesmí ukládat do sdílené cache.
Pro omezení režimu `login-required` například na studenty a vyučující nastavte
`allowedGroups: ['student', 'teacher']`.

Pro ověření relace musí cookie MediaWiki přicházet i k Node aplikaci. Použijte
stejný host pro wiki a prohlížeč, nebo bezpečně nastavte společnou cookie doménu
pro oba důvěryhodné subdomény; jinak bude nahrání i načtení chráněného modelu
správně odmítnuto. Režim `view-only` není kryptografická ochrana: Three.js musí
data přenést do prohlížeče, takže je technicky zdatný návštěvník může z jeho
komunikace získat. Je určen jen k zablokování běžného stažení zadáním URL.

## Uložení modelů

Nahrané soubory jsou organizovány do `storage/models/{model_id}/`. Při uploadu vzniknou původní soubory, `thumbnail.svg` a pro hlavní soubor také `{název}.small.*` a `{název}.medium.*`; následně se ihned vytvoří definující článek `3D:Název modelu`. `storage/models.json` slouží jen jako technický registr souborů, zdrojem pravdy pro název, vzhled, kameru a štítky je článek MediaWiki. STL a OBJ se nejprve převedou na propojenou indexovanou síť a zjednoduší edge-collapse algoritmem meshoptimizeru; pro GLTF/GLB jsou zjednodušené varianty uložené jako GLB. Varianty zachovají bounding box originálu. Pokud převod nelze provést, uloží se originál a SVG náhled bez variant S a M.

Původní model femuru je dostupný jako ukázka mimo registry, aby bylo možné ověřit štítky bez nahrání vlastního souboru. Skutečné nahrané modely jsou přes `.gitignore` vynechány. Pro OBJ nahrajte spolu s `.obj` i odpovídající `.mtl` a textury. Formát GLTF musí používat cesty relativní ke složce daného modelu.

## MediaWiki a `<model3d>`

Souřadnice, normály, délky čar, kamera, vzhled modelu i české popisky jsou zdrojem pravdy přímo v definujícím článku modelu. Sdílený katalog kategorií je samostatně uložen ve stránce `3D:Kategorie`:

```wikitext
<model3d file="Srdce_model.glb">
{
  "camera": { "position": [10, 5, 20], "target": [0, 0, 0] },
  "appearance": { "color": "#c7dce9", "sceneBackground": "#f7fafc", "roughness": 0.6, "opacity": 1, "wireframe": false, "clipX": 100, "clipY": 100, "clipZ": 100 },
  "tags": [
    {
      "id": "arcus-aortae",
      "title": "Arcus aortae",
      "category": "arteria",
      "position": [2.1, 4.5, -0.2],
      "normal": [0.3, 0.9, 0.1],
      "lineLength": 1.5,
      "description": "[[Aorta|Srdečnice]] vychází z levé komory."
    }
  ]
}
</model3d>
```

Průvodce nahráním zapíše tento blok do definujícího článku automaticky. Po nahrání se článek `3D:` otevře rovnou v režimu úprav; další návštěvníci jej otevírají v režimu čtení.

V rozhraní **Pokročilé** je sekce **Výchozí pohled**. Editor v ní může pohled
nejprve automaticky přizpůsobit rozměrům modelu, pak si model myší nastavit a
uložit aktuální pozici kamery jako výchozí. Volba **Použít automatický** zruší
starší uloženou kameru — vhodné například pro modely nahrané před zavedením
automatického přizpůsobení. Změnu je nutné potvrdit tlačítkem **Uložit změny**.

### Lokální MediaWiki

Projekt je připravený pro lokální instanci na `http://localhost:8000`:

- `mediawiki-1.41.1/LocalSettings.php` registruje vlastní obsahový jmenný prostor `3D` (interní ID `3000`), proto se konfigurace ukládají jako `3D:Název článku`.
- Neveřejný soubor `LocalSettings.js` obsahuje adresu Action API, předponu stránky i případné údaje bota. Je v `.gitignore` a do prohlížeče se nikdy neposílá.
- `mediawiki-1.41.1/LocalSettings.php` je instalační konfigurace MediaWiki a obsahuje tajné klíče. V produkci jej uchovávejte mimo veřejný repozitář.
- Endpoint `GET /api/wiki/config` vystaví pouze bezpečné hodnoty (`endpoint`, `pagePrefix`, `upload`), které rozhraní potřebuje jako nápovědu a pro kontrolu nahrání. `GET /api/wiki/status` navíc při otevření rozcestníku zkontroluje dostupnost API, existenci nastaveného namespace a úplnost nastavení bota; heslo ani uživatelské jméno bota nikdy nevrací.

Po spuštění editoru příkazem `npm run dev` se před nahráním přihlaste do MediaWiki. Průvodce vytvoří například článek `3D:Ukázkový model femuru` a otevře jej v režimu úprav. Uložení používá přihlášenou relaci MediaWiki.

### Přechod na reálná WikiSkripta

Zdrojový kód se nemění. V produkčním nasazení stačí upravit hodnoty v
`LocalSettings.js` na serveru:

```js
mediaWiki: {
  apiUrl: 'https://www.wikiskripta.eu/api.php',
  pagePrefix: '3D',
  botUsername: 'produkční_bot',
  botPassword: 'produkční_heslo_nebo_bot_password'
}
```

V cílové MediaWiki musí být stejný jmenný prostor `3D` a účet s oprávněním upravovat stránky. Produkční přihlašovací údaje nikdy nevkládejte do klientského JavaScriptu ani do repozitáře.

### Serverové přihlášení bota

1. V MediaWiki vytvořte bot password s oprávněním upravovat požadované stránky.
2. Zkopírujte `LocalSettings.example.js` do `LocalSettings.js` a v sekci `mediaWiki` vyplňte `apiUrl`, `pagePrefix`, `botUsername` a `botPassword`.
3. Server provede login token → přihlášení → CSRF token → `action=edit`. Heslo nikdy nevstupuje do prohlížeče ani do exportu.

Alternativně lze v exportním dialogu zadat URL `api.php` a krátkodobý OAuth token. Token se neposílá do lokálního registru; slouží pouze pro aktuální požadavek. V produkci doporučujeme přihlášení řešit serverovým botem a HTTPS.

## Architektura

```text
src/
  core/          Three.js scéna, kamera, ovládání a loadery
  annotations/   štítky, vodicí čáry, raycasting a renderer Wikitextu
  ui/            rozcestník, boční panel, formuláře a styly
  api/           lokální registry a MediaWiki Action API klient
storage/
  models/        samostatná složka pro každý nahraný model
  models.json    technický registr uložených souborů
```

Autoritativní konfigurace je vložena do `<model3d>` přímo v článku MediaWiki, aby ji mohl načíst prohlížeč i budoucí integrační bot.

## Články `3D:` jako zdroj dat

Rozcestník načítá články v prostoru `3D:` a samostatně vypisuje soubory v úložišti s vazbami na modely, které je používají. Prohlížeč také umí otevřít článek přímo, například adresou `http://localhost:3000/?article=3D:Femur`. Server načte wikitext článku přes Action API a z bloku `<model3d>` získá název souboru, kameru, vzhled a všechny popisky.

```wikitext
<model3d file="femur/Femur.glb">
{
  "schemaVersion": 3,
  "title": "Femur",
  "description": "Model stehenní kosti.",
  "files": ["femur/Femur.glb"],
  "variants": {
    "original": "femur/Femur.glb",
    "medium": "femur/Femur.medium.glb",
    "small": "femur/Femur.small.glb"
  },
  "thumbnail": "femur/thumbnail.svg",
  "metadata": {
    "license": "CC BY 4.0",
    "author": "Anatomický ústav UK",
    "origin": "Výuková sbírka",
    "sourceUrl": "https://example.org/model"
  },
  "appearance": {
    "color": "#c7dce9",
    "sceneBackground": "#f7fafc",
    "roughness": 0.6,
    "opacity": 1,
    "wireframe": false,
    "clipX": 100,
    "clipY": 100,
    "clipZ": 100
  },
  "camera": { "position": [10, 5, 20], "target": [0, 0, 0] },
  "tags": [
    {
      "id": "caput-femoris",
      "title": "Caput femoris",
      "category": "kosti",
      "position": [1.963, 5.154, 88.392],
      "normal": [0, -0.14, 0.99],
      "lineLength": 3,
      "description": "Hlavice [[Femur|stehenní kosti]]."
    }
  ]
}
</model3d>
```

`file` i položky `files` jsou relativní k `storage.publicModelsUrl` (výchozí je
`/storage/models`), případně mohou být úplné URL. Výchozí cesta je chráněný
endpoint aplikace, nikoli veřejný adresář; ve wiki zůstávají pouze popisná data
modelu. Pro úplnou ochranu používejte pro modely tutéž aplikaci (nebo externí
úložiště s odpovídajícím vlastním ověřením), ne veřejně dostupnou absolutní URL.

### Sdílené a upravitelné kategorie

Katalog kategorií je společný pro všechny modely a je uložen ve stránce
`3D:Kategorie` v bloku `<model3d-categories>`. V režimu úprav otevřete v
postranním panelu tlačítko **Kategorie**. Nová kategorie se uloží přímo do
MediaWiki; není to browser-local seznam. Kategorie používané štítkem nelze
odstranit, dokud štítek nepřevedete jinam.

### Vložení do wiki článků

Lokální MediaWiki obsahuje extension `ThreeDViewer`. Instalační skript při
prvním spuštění vytvoří následující stránky, aniž by přepsal existující obsah:

```bash
cd mediawiki-1.41.1
php extensions/ThreeDViewer/maintenance/seedPages.php
```

- `Template:3D prohlížeč` vloží iframe:

  ```wikitext
  {{3D prohlížeč|model=3D:Femur|výška=560|varianta=malá|načíst po kliknutí=ano}}
  ```

  Parametr `varianta` přijímá `malá` (výchozí), `střední` nebo `originál`.
  Parametr `načíst po kliknutí` je výchozí `ano`: iframe zobrazí tlačítko a
  model načte až po potvrzení návštěvníkem. Nastavte `ne`, chcete-li model
  načíst ihned.

- `Template:3D odkaz` otevře viewer v novém okně; za textem je klikací ikona 3D krychle:

  ```wikitext
  {{3D odkaz|model=3D:Femur|text=Prohlédnout femur}}
  ```

- `3D:Femur` je funkční ukázka s pěti popisky (soubor je v
  `storage/models/Femur.stl`) a `3D:Prohlížeč` je stránka **O 3D
  prohlížeči**, na kterou odkazuje zápatí vieweru.
- `Template:3D prohlížeč/dokumentace` a
  `Template:3D odkaz/dokumentace` obsahují úplný popis parametrů obou
  šablon. Stránky se zobrazí jako dokumentace přímo při otevření rodičovské
  šablony.

Obě šablony předají do vieweru adresu návratu, takže se z úprav lze vrátit na
prohlížeč i zpět na původní wiki článek.

Výchozí stránky se vždy zakládají ze souborů v
`extensions/ThreeDViewer/templates/`; skript `seedPages.php` je proto jediným
instalačním zdrojem šablon. Ikona krychle je vložená přímo rozšířením, nikoli
jako wiki soubor vyžadující samostatné nahrání.

### Uživatelské nastavení prohlížeče

V samostatném prohlížeči otevře ikona ozubeného kola nastavení uložená pro
aktuální zařízení: strategii načítání variant, výchozí variantu, vzhled modelu
a přepínač rozhraní **Jednoduché / Pokročilé**. Jednoduché rozhraní je výchozí
a soustředí se na studium štítků. Pokročilé navíc zpřístupní technické údaje o
načteném modelu; velikosti vytvořených variant jsou shrnuté ve sbalitelném
bloku u modelu.

### Ověření uživatele při úpravách

Tlačítko **Editovat** ve vieweru ověří přes `action=query&meta=userinfo`
skutečnou relaci MediaWiki a při ukládání získá CSRF token. JavaScript nečte,
neukládá ani nevytváří přihlašovací cookie. Nepřihlášený návštěvník může model
jen prohlížet; po přihlášení účtem s právem `edit` se otevře `?edit=1`, kde lze
měnit štítky i kategorie a uložit je do `3D:` stránky.

Pro lokální běh je v `LocalSettings.php` povolen pouze origin
`http://localhost:3000` pro cross-origin Action API. V produkci jej nahraďte
přesným originem vieweru (včetně schématu a portu) a
nepoužívejte zástupný znak. Pokud je viewer a MediaWiki pod stejnou doménou,
je nejjednodušší dát viewer za stejnou reverzní proxy.

## Poznámky k nasazení

- Upload i změny registru jsou omezené na přihlášené editory MediaWiki; za reverzní proxy nadále nastavte limit velikosti požadavku a omezování podle IP.
- Endpoint `/api/wiki/publish` vyžaduje stejnou ochranu jako upload a může publikovat pouze do `mediaWiki.apiUrl`; nevystavujte bot credentials klientovi.
- Varianty se vytvářejí při uploadu. Při převodu starších nebo externě publikovaných modelů lze do `<model3d>` vložit objekt `variants` s cestami `small`, `medium` a `original`; pro zpětnou kompatibilitu se načítá i původní klíč `low`.
