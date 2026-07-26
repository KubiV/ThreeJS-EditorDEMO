Act as a Senior Full-Stack & Three.js Developer. Refactor and expand my GitHub repository: https://github.com/KubiV/ThreeJS-EditorDEMO.
I have a running testing mediawiki at http://localhost:8000/index.php/Hlavní_strana also in the same directory.
I am putting here an example of the wikiskripta webpage as PDF for the visuals. Reference the working leader-line interaction pattern currently present in `http://localhost:5173/editor.html` (in `threejsdemo`).

The goal is to transform this demo into a production-ready, interactive 3D model viewer and editor tailored for educational medical articles (WikiSkripta), structurally inspired by the "Virtual Microscope" project (mikroskop.wikiskripta.eu).

---

### Language & Localization Requirement (CRITICAL)
- **UI Language:** ALL user-facing text, buttons, tooltips, modal dialogs, status messages, and sidebars MUST be fully in Czech (Čeština) by default (e.g., "Zobrazit vše", "Skrýt popisky", "Nahrát model", "Průřez", "Resetovat pohled", "Přidat štítek", "Uložit do WikiSkript").
- **Encoding & Character Set:** Ensure full UTF-8 support across the entire app for Czech diacritics (háčky, čárky) and Latin/Czech anatomical nomenclature.

---

### Core Architecture & MediaWiki Sync (Virtual Microscope Model)
- **Data Architecture:** Matching `mikroskop.wikiskripta.eu`, 3D model files (`.glb`, `.stl`, `.obj`) are loaded from storage/wiki uploads, while ALL tag coordinates ($x, y, z$), surface normal vectors, camera states, leader line vector length ($lineLength$ or line endpoint offset), categories, and Czech description texts are stored **directly inside the MediaWiki article page** as JSON within a `<model3d>` parser tag.

---

### Design & Visual Identity Requirements
- **Design System:** Clean, simple, and modern UI inspired by **WikiSkripta** and the MediaWiki **"Medik" skin** (light background, signature WikiSkripta blue accents `#00538a`, clean borders, legible typography, medical documentation aesthetic). Avoid heavy dark/futuristic overlays.
- **Layout:** Minimalist sidebar-driven interface. The 3D viewport takes center stage, while a retractable side panel manages tag lists, detailed descriptions, and display settings.

---

### Module 0: Landing Page & Model Hub (Rozcestník)
1. **Model Hub (Medik Skin Styling):**
   - Clean dashboard serving as the entry point before entering the 3D canvas.
   - Responsive grid/list view of uploaded 3D models with thumbnail previews, titles, tags, file format badges (`.stl`, `.obj`, `.glb`), and annotation counts.
   - Czech action buttons: "Nahrát 3D model" and "Otevřít prázdné plátno".
2. **File Storage Architecture:**
   - Organize uploaded 3D models into dedicated subdirectories (`storage/models/{model_id}/`).
   - Maintain a local model registry in `storage/models.json`.

---

### Module 1: 3D Viewport & Simplified UI
1. **Simplified Sidebar UI Panel (Medik Theme):**
   - Docked side panel matching the WikiSkripta visual theme.
   - Accordions/tabs in Czech:
     * **Anatomické štítky & popisky** (Tag list & detailed description view)
     * **Nastavení zobrazení** (Lighting, wireframe, color picker for STL, opacity, clipping planes)
     * **Načtené modely** (Loaded scene objects list)
2. **Multi-Format Loader & Shader Options:**
   - Support loading `.stl`, `.obj` (with `.mtl`), and `.gltf`/`.glb`.
   - Provide material customization (color picker, roughness, wireframe toggle) for `.stl` files lacking native textures.
3. **LOD (Level of Detail) & Progressive Loading:**
   - Dynamic loading for Low, Medium, and Original mesh resolutions with a Czech progress indicator ("Načítání 3D modelu... 45%").

---

### Module 2: Tag & Annotation System (Štítky, Popisky & Vodicí Čáry)

1. **Data Model Distinction:**
   - **Štítek (3D Tag / Floating Label):** A floating 2D text label rendered in 3D/screen space attached to a leader line (vodicí čára). The line originates at the exact point on the mesh surface ($x, y, z$) and extends out to the floating tag. Displays short title (e.g., *Arcus aortae*).
   - **Popisek (Detailní popis v UI):** The rich description text rendered in the sidebar panel when a Tag is selected.

2. **Leader Line Interaction & Dragging Style (MATCHING `localhost:5173/editor.html`):**
   - **Placement & Hover Preview:** When hovering or clicking on the 3D mesh in Edit Mode, display an interactive leader line projecting outward along the surface normal (or camera-facing vector).
   - **Interactive Line Dragging (Úprava délky čáry):**
     * Clicking/hovering on a model point or existing tag handle displays a visible leader line extending from the surface hit point to the tag label.
     * Users can interactively drag the line endpoint / tag handle with the mouse to dynamically adjust the line length (`lineLength`) and orientation in real-time before or after saving.
     * The line length directly controls the distance between the anchor point on the model surface ($x, y, z$) and the floating label (nápis).
   - **Visual Styling:** Lines should be crisp, anti-aliased, dynamically anchored at the surface hit point, and updated seamlessly during camera rotations (`OrbitControls`).

3. **Hyperlinks & Wikitext Integration in Popisky:**
   - The sidebar **Popisek** card must parse Wikitext and render internal WikiSkripta hyperlinks (e.g., `[[Aorta]]`, `[[Histologie cév]]`).

4. **Interactive Navigation & Categorization:**
   - Selecting a Tag (in 3D or from the sidebar list) smoothly moves the camera (`OrbitControls` lerp) to focus on that structure and displays its **Popisek** in the sidebar.
   - Anatomical category filters in Czech (e.g., *processus*, *fossa*, *arteria*, *nervus*, *kosti*, *svaly*).
   - "Zobrazit vše" / "Skrýt vše" global toggles.

---

### Module 3: MediaWiki Parser Tag & Bot Sync

1. **MediaWiki Article Format Example:**
```wikitext
<model3d file="Srdce_model.glb">
{
  "camera": { "position": [10, 5, 20], "target": [0, 0, 0] },
  "tags": [
    {
      "id": "tag_1",
      "title": "Arcus aortae",
      "category": "arteria",
      "position": [2.1, 4.5, -0.2],
      "normal": [0.5, 0.8, 0.3],
      "lineLength": 1.8,
      "description": "[[Aorta|Srdečnice]] vychází z levé komory... Podrobnější popis v článku [[Aorta]]."
    }
  ]
}
</model3d>
```

2. **Wikitext & Link Parsing:**
   - Render Wikitext formatting and internal wiki links (`[[Článek]]`) inside annotation detail cards.

3. **Deep Linking:**
   - Support URL hash navigation (e.g., `#model=Srdce_model.glb&tag=tag_1`) to open a specific model and highlight a tag directly.

4. **MediaWiki API Sync / Bot Integration:**
   - Provide an "Export to Wiki" / "Uložit do WikiSkript" feature that formats the entire 3D scene configuration into JSON wrapped inside a MediaWiki parser tag.
   - Implement an API service client (`src/api/mediawiki.js`) capable of pushing updated tag configurations directly to a MediaWiki article via the MediaWiki Action API (`action=edit`), using Bot passwords or OAuth tokens.

---

### Technical Requirements:
- Organize codebase logically:
  - `src/core/` (Three.js setup, scene manager, loaders)
  - `src/annotations/` (Raycaster, leader lines, interactive handle dragging, tag state)
  - `src/ui/` (Dashboard, sidebar, modals, glassmorphism/Medik CSS)
  - `src/api/` (MediaWiki integration, file upload handlers)
  - `storage/models/` (Dedicated model files folder)
- Keep JavaScript/TypeScript modular (ESM syntax).
- Include comprehensive `README.md` explaining deployment, MediaWiki bot credentials setup, and embedding instructions.