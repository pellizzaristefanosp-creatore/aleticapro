# GASA Biomechanics — Sprint Lab

Videoanalisi biomeccanica dello sprint, con angoli **riconosciuti automaticamente** sul profilo
sagittale e frontale e strumenti per **disegnare angoli con un tocco**. Funziona nel browser,
anche su iPhone. Comprende una pipeline Python che genera un **Reel Instagram 9:16** guidato dall'analisi.

> Il video non lascia mai il dispositivo: la pose estimation (MediaPipe) gira in locale.

## 1. App web (`index.html`)

### Avvio

È un'app statica, senza build. Serve un qualsiasi server HTTP:

```bash
python3 -m http.server 8000      # poi apri http://localhost:8000
```

Su iPhone si può pubblicare la cartella su un hosting statico (GitHub Pages, Vercel, Netlify) e
aggiungerla alla schermata Home: si apre a schermo intero.

### Cosa fa da sola

- **Rileva l'atleta e le articolazioni** a ogni fotogramma in pausa. Con **Analizza** elabora tutto l'intervallo IN–OUT.
- **Riconosce la vista** (sagittale, frontale o obliqua) e il **lato vicino** alla camera. Corregge gli scambi sinistra/destra delle gambe.
- **Profilo sagittale**: tronco (vs verticale e orizzontale), testa/tronco, anca, coscia, ginocchio, caviglia (dorsi/plantarflessione), tibia vs verticale, gomiti, **CoM stimato** (de Leva) e distanza piede–proiezione del CoM.
- **Profilo frontale**: obliquità del bacino, inclinazione delle spalle, tronco laterale, testa, FPPA del ginocchio (valgo/varo, solo in appoggio), caviglia rispetto alla linea mediana.
- **Eventi automatici**: touchdown e toe-off (vista sagittale, camera fissa), tempi di contatto e di volo con la risoluzione dichiarata, valutazione del negative step.
- **Confidenza per ogni misura**: blu = alta, giallo = media, grigio = bassa. I valori a confidenza bassa **non vengono mostrati come numeri**.
- **Segui atleta (◎)**: la camera virtuale centra e ingrandisce l'atleta. Le etichette sono impaginate in colonne con linee di richiamo.

### Disegnare angoli (super intuitivo)

| Strumento | Gesto |
|---|---|
| **Auto** ★ | tocca un'articolazione (anca, ginocchio, caviglia, gomito, spalla): l'angolo anatomico appare e **segue l'atleta** |
| **Angolo** | 3 tocchi: estremo – vertice – estremo |
| **vs Vert. / vs Oriz.** | 2 tocchi (es. caviglia → ginocchio = tibia vs verticale) |
| **2 linee** | 4 tocchi: angolo fra due rette |
| **Distanza** | 2 tocchi (in cm dopo la calibrazione con **Scala**) |
| **Terreno** | 2 tocchi sul suolo: corregge tutte le verticali e orizzontali se la camera è inclinata |

- Ogni punto si piazza con **tocca → trascina → rilascia**, con una **lente d'ingrandimento** per la precisione.
- Il **magnete** aggancia il punto all'articolazione più vicina: il disegno resta valido in tutti i fotogrammi.
- Pinch o rotella per lo zoom. Tasti: ←/→ fotogramma (Shift = 10), spazio play, Canc elimina, Ctrl+Z annulla.

### Export

PNG annotato, CSV con un valore per fotogramma, report JSON e Markdown, **video annotato** (Reel 1080×1920, 720×1280 o formato originale) con rallenty e fermo immagine sugli eventi. Safari e Chrome producono MP4 H.264. Un eventuale WebM si converte con `python/tools/to_instagram.sh`.

## 2. Pipeline Reel (`python/`)

```bash
pip install -r python/requirements.txt          # su Linux serve anche libegl1
python3 python/gasa_cli.py analyze VIDEO.mp4 --start 9.1 --end 10.1 -o out/
python3 python/gasa_cli.py reel    VIDEO.mp4 --config python/config.example.json -o out/
```

Il flusso è: metadati reali (ffprobe), pose estimation fotogramma per fotogramma, controllo qualità, angoli con confidenza, eventi (automatici oppure **verificati a mano nel JSON di configurazione**, consigliato), storyboard, narrazione, motion graphics, export.

| File in `out/` | Contenuto |
|---|---|
| `GASA_reel_1080x1920.mp4` | H.264, yuv420p, 30 fps, AAC, faststart |
| `GASA_reel_720x1280_iphone.mp4` | versione leggera |
| `report.md` / `report.json` | eventi, angoli agli eventi, tempi, qualità dei landmark, limiti |
| `angoli.csv` | tutti gli angoli per fotogramma, con la confidenza |
| `script.md`, `sottotitoli.srt`, `storyboard.json` | narrazione con timestamp, durata delle scene, animazioni |
| `landmarks_raw.json` | landmark grezzi, per la riproducibilità |

Le scene del Reel sono: hook sul distacco, primo movimento (velocità reale e rallenty), **tripla estensione** (freeze, zoom su anca, ginocchio e caviglia con punto luminoso, segmenti, arco e valore, più la sequenza temporale delle massime estensioni), tibia al primo appoggio (verticale tratteggiata, tibia d'appoggio e tibia che avanza), piede e CoM, tronco e testa, split screen 1° vs 2° passo sincronizzato sul touchdown, tre conclusioni, chiusura.
La **narrazione viene scritta dopo l'analisi** e usa solo i valori misurati, con la loro confidenza.

**Voce**: si usa il primo motore TTS disponibile tra:
- `piper` con `GASA_PIPER_MODEL=/percorso/it_IT-riccardo-x_low.onnx` (voce maschile italiana);
- `say -v Luca` su macOS;
- `espeak-ng`.

Se non ce n'è nessuno, il video contiene una traccia audio silenziosa e lo `script.md` lo dichiara.

## 3. Scienza e limiti

Il file [`docs/METODO_E_FONTI.md`](docs/METODO_E_FONTI.md) contiene le definizioni degli angoli, il modello del CoM, le soglie di confidenza, la letteratura verificata (associazioni, risultati discordanti, interventi, validità dei sistemi markerless) e i consigli di ripresa.
In sintesi: sono **misure 2D**. Forze, impulsi, rigidità o rischio d'infortunio non si deducono dal video.

## Struttura

```
index.html, css/, js/          app web (biomech.js = definizioni, overlay.js, tools.js, export.js, app.js)
vendor/mediapipe/, models/     MediaPipe Tasks Vision 1.2.2 + modelli Pose Landmarker (Apache-2.0)
python/gasa/                   biomech.py (port 1:1 di biomech.js), analysis.py, reel.py, gfx.py, tts.py
python/assets/fonts/           Inter (SIL OFL)
docs/                          metodo, fonti, limiti
```
