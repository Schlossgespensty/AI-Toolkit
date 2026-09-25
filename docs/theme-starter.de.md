# Eigenes AI-Toolkit-Design

Dieses Paket enthält alle 33 unterstützten UI-Texturrollen und alle 165
Farb-, Schrift- und Komponentenvariablen. Auch die großen Hintergründe sind
enthalten. Du brauchst kein weiteres Theme und keine Entwicklungswerkzeuge.
Als Ausgangspunkt dient das UCP-Design mit Monsterfishs Originalgrafiken.

## Loslegen

1. Den kompletten Ordner `monsterfish-theme` nach
   `%APPDATA%\AI Toolkit\themes\` kopieren.
2. Die Tauri-Vorschau von AI Toolkit neu starten und unter
   **Bearbeiten → Design → Monsterfish Theme** auswählen.
3. Dateien bearbeiten und zum Neuladen den Editor neu starten.

Bei einem eigenen Datenordner liegt `themes` in diesem Datenordner. Für weitere
Designs den Ordner kopieren und Ordnername sowie `id` in `theme.json` gemeinsam
ändern. Die ID verwendet Kleinbuchstaben und Bindestriche; `name` ist der frei
wählbare Anzeigename. `default` und `ucp` sind reserviert.

## Was du bearbeiten kannst

- **`textures/`**: Bilder für Hintergründe, Buttons, Tabs, Rahmen, Eingabefelder,
  Checkboxen, Pfeile, Schieberegler und Scrollbalken. Ein Bild wird überall für
  dieselbe Rolle verwendet. `TEXTURE-ROLES.md` listet jede Zuordnung auf.
- **`variables.css`**: alle Farben, Schriftfamilien und angebotenen Formwerte.
  Nur bestehende Variablen im `:root`-Block ändern. Die Reihenfolge ist
  Grundpalette → Bedeutung → Komponente; verknüpfte Werte folgen automatisch.
  Unter `--component-toolbar-*` stehen die Hintergrund- und Abstandsregeln der
  Werkzeugleiste, unter `--component-toolbar-group-*` deren Gruppenrahmen.
  Im UCP-Ausgangspunkt sind `border-width` und `accent-width` jeweils `0px`,
  `surface` ist `transparent` und `shadow` ist `none`: kein zusätzlicher Kasten
  um die Buttons. Für Rahmen z. B. `border-width: 1px` und `radius: 6px`
  einstellen. `gap` trennt Gruppen bzw. Buttons, `padding-block` und
  `padding-inline` bestimmen Innenabstände. Die Logik bleibt unverändert.
  `--component-toolbar-command-*` bestimmt die Mindesthöhe der gerahmten
  Werkzeugleisten-Buttons sowie den oberen und unteren Textabstand. UCP nutzt
  30 px hohe, flache dunkle Buttons mit goldenen Zustandsakzenten. Rahmen,
  Flächen und Abstände sind dort einstellbar; Dialogbuttons bleiben separat.
  Auswahlfelder nutzen unter `--component-select-*` den Systempfeil
  (`appearance: auto`, `indicator-size: 0px`). Für einen eigenen Bildpfeil
  `appearance: none`, `indicator-size: 20px` und `padding-inline-end: 30px`
  setzen und die `dropdown`-Grafik ersetzen. `indicator-inset` bestimmt den
  Randabstand; `color-scheme` passt Systempfeil und Auswahlliste an hell/dunkel an.
  Die Auswahlfelder auf dunklen Werkzeugleisten verwenden die `chrome-*`-
  Werte; die aufgeklappten Einträge verwenden `option-*`. Für Scrollleisten
  stehen unter `--component-scrollbar-*` Breite, horizontale Höhe und
  `cap-height` bereit. Letzteres reserviert den Platz für den Kettenhaken,
  damit die wiederholten Kettenglieder nicht hinter ihm sichtbar bleiben.
  `--component-number-stepper-*` gestaltet das kompakte Zahlenfeld für die
  Pinselbreite. UCP nutzt ein dunkles Feld mit sichtbarer Beschriftung und
  Minus/Plus-Buttons (`button-display: inline-flex`, `appearance: textfield`,
  `spinner-display: none`). Für native Auf/Ab-Pfeile: `button-display: none`,
  `appearance: auto`, `spinner-display: inline-block`. Farben,
  Breite, Rahmen, Rundung und Abstände stehen in derselben Variablengruppe.
- **`theme.json`**: Name, Bildzuweisungen und Skalierung. `cover` füllt eine
  Fläche, `contain` erhält das vollständige Bild, `tile` kachelt, `frame`
  skaliert Rahmen in neun Abschnitten. `slice` bestimmt die Bildabschnitte,
  `width` die Rahmenbreite bei frei skalierbaren Rahmen, `fill` die Verwendung
  der Bildmitte. Tabs verwenden eine feste Breite von 8 px, Kategorien 2 px;
  horizontale Scrollleisten behalten ihre vorhandene Rahmengeometrie.
  Zustandsbilder teilen die Geometrie ihres Normalzustands.
- **`tokens.json`**: vollständige optionale Entwicklerquelle der Variablen.
  Für Bildtausch und direkte Änderungen in `variables.css` nicht erforderlich.
  Der Editor liest `variables.css`; Änderungen an Tokens müssen erst generiert
  werden. `theme.schema.json` beschreibt die unterstützte Konfiguration.

Bildgrößen und Rahmenwerte zunächst beibehalten. Keine Texte in Buttons
einzeichnen: Beschriftungen und Übersetzungen kommen vom Editor. Normal-,
Hover- und gedrückten Zustand zusammen gestalten und den Textkontrast prüfen.
Schriftfamilien wählen installierte Systemschriften; Schriftdateien lädt ein
Theme nicht nach. Anschließend den ganzen Ordner als ZIP weitergeben und die
Herkunft der enthaltenen Grafiken in `ATTRIBUTION.md` erhalten bzw. ergänzen.

## Umfang

Das Paket enthält alle derzeit vom Theme-System angebotenen Einstellungen
und Grafiken in einem Ordner. Dekoration und die angebotenen Abstandsregeln
gehören zum Theme. Reihenfolge, Andocken und Umbruchlogik der Arbeitsbereiche,
Bedienlogik und Barrierefreiheit bleiben Aufgabe des Editors; eigene
CSS-Selektoren oder Skripte sind nicht vorgesehen.
Kategoriefarben und Kartenfarben beschreiben Inhalte und gehören nicht zum
Theme. Spielsprites und Übersetzungen werden separat verwaltet. Die eingebauten
Standardwerte dienen weiterhin als Rückfall bei beschädigten eigenen Dateien.
