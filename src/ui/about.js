import { brandMarkup, wikiSessionIndicatorMarkup } from './brand.js';

export function renderAboutPage(host, { onHome, onSettings, wikiSessionUser = null, wikiSessionUserUrl = '', wikiSessionLoginUrl = '' }) {
  host.innerHTML = `
    <main class="wiki-shell about-page">
      <header class="wiki-topbar">
        ${brandMarkup({ interactive: true })}
        <nav class="topbar-actions"><button type="button" class="topbar-link" data-action="home">← Zpět k modelům</button><button type="button" class="topbar-icon" data-action="user-settings" aria-label="Uživatelské nastavení" title="Uživatelské nastavení">⚙</button>${wikiSessionIndicatorMarkup(wikiSessionUser, { userPageUrl: wikiSessionUserUrl, loginUrl: wikiSessionLoginUrl })}</nav>
      </header>
      <div class="wiki-page-layout">
        <article class="about-content">
          <header class="about-hero">
            <p class="eyebrow">NÁPOVĚDA · 3D VIZUALIZACE</p>
            <h1>O 3D prohlížeči</h1>
            <p>Interaktivní prohlížeč 3D modelů pro MediaWiki. Tato nápověda je dostupná přímo v aplikaci.</p>
          </header>

          <div class="about-grid">
            <section class="about-section">
              <h2>Jak prohlížeč funguje</h2>
              <p>Prohlížeč načítá data z článků v prostoru <code>3D:</code>. Samotné 3D soubory jsou odděleně v úložišti modelů.</p>
              <p>U modelu můžete otáčet pohledem, přibližovat jej a vybírat štítky. Jejich popisky, kategorie a poloha jsou uložené u příslušného článku.</p>
            </section>

            <section class="about-section about-section-highlight">
              <h2>Úprava modelu</h2>
              <p>Pro změnu popisků, kategorií nebo kamery otevřete model ve vieweru tlačítkem <strong>Editovat</strong>.</p>
              <p>Je nutné být přihlášen do MediaWiki účtem s právem upravovat danou stránku. Viewer používá skutečnou přihlašovací relaci MediaWiki; heslo ani cookie se do editoru neukládají.</p>
            </section>

            <section class="about-section about-section-wide">
              <h2>Vložení modelu do článku</h2>
              <p>Do běžného článku vložíte model šablonou:</p>
              <pre><code>{{3D prohlížeč|model=3D:Název modelu}}</code></pre>
              <p>Nejdůležitější volby jsou <code>výška</code>, <code>varianta</code> (<code>malá</code>, <code>střední</code> nebo <code>originál</code>) a <code>načíst po kliknutí</code>. Výchozí hodnota <code>ano</code> zobrazí tlačítko Načíst; hodnotou <code>ne</code> se model načte hned.</p>
              <pre><code>{{3D prohlížeč|model=3D:Název modelu|výška=620|varianta=střední|načíst po kliknutí=ne}}</code></pre>
              <p>Pokud má článek obsahovat jen odkaz, použijte:</p>
              <pre><code>{{3D odkaz|model=3D:Název modelu}}</code></pre>
              <p>Úplný přehled parametrů je ve wiki na podstránkách <code>Šablona:3D prohlížeč/dokumentace</code> a <code>Šablona:3D odkaz/dokumentace</code>.</p>
            </section>
          </div>

          <div class="about-actions"><button type="button" class="button button-primary" data-action="home">Zobrazit 3D modely</button></div>
        </article>
      </div>
    </main>`;

  host.querySelectorAll('[data-action="home"]').forEach((button) => button.addEventListener('click', onHome));
  host.querySelector('[data-action="user-settings"]')?.addEventListener('click', onSettings);
}
