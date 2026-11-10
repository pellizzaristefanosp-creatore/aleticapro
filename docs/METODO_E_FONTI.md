# GASA Biomechanics — Metodo, definizioni, fonti e limiti

Questo documento accompagna l'app **Sprint Lab** (`index.html`) e la pipeline per il Reel (`python/`).
Distingue: **osservazioni cinematiche** (ciò che il video mostra), **associazioni con la prestazione**
(correlazioni riportate in letteratura), **interpretazioni meccaniche plausibili** ed **effetti dimostrati da interventi**.

## 1. Catena di elaborazione

1. **Metadati reali del video**: `ffprobe` per la pipeline Python. Nel browser il frame rate si ricava da `requestVideoFrameCallback` (mediaTime dei fotogrammi presentati a velocità 0,2×) ed è sempre modificabile a mano.
2. **Pose estimation**: MediaPipe Pose Landmarker (modello *full*, 33 landmark), eseguito in locale (WebAssembly nel browser, Tasks API in Python). Il video non lascia il dispositivo.
3. **Controllo qualità**:
   - correzione degli scambi sinistra/destra delle gambe per continuità temporale (frequenti in vista sagittale);
   - media mobile centrata pesata per la visibilità (5 fotogrammi di default, regolabile da 1 a 7);
   - stima della vista (sagittale, frontale o obliqua) da due indizi 2D: la larghezza di spalle e anche rispetto al tronco e la posizione del naso rispetto alle orecchie;
   - stima del lato vicino alla camera.
4. **Metriche e confidenza**: ogni valore ha un livello **alta / media / bassa**, calcolato dalla visibilità minima dei landmark coinvolti (≥0,80 → alta; ≥0,55 → media; altrimenti bassa).
   - L'arto lontano dalla camera perde un livello.
   - Gli angoli che usano tallone e avampiede hanno al massimo confidenza "media".
   - Il CoM ha al massimo confidenza "media".
   - In vista obliqua tutti gli angoli sagittali perdono un livello.
   - **I valori a confidenza bassa non vengono mostrati come numeri** ("n.m." = non misurabile), salvo attivazione esplicita dell'opzione "valori a bassa confidenza" (mostrati con "~").
5. **Eventi**: touchdown e toe-off possono essere rilevati automaticamente (piede vicino al livello del terreno e quasi fermo orizzontalmente; solo con camera fissa) oppure segnati a mano. Gli eventi automatici hanno confidenza "media" e vanno sempre verificati fotogramma per fotogramma.
6. **Report, grafici, export**: CSV con un valore per fotogramma, JSON e Markdown con eventi e angoli agli eventi, PNG annotato, video annotato. Nella pipeline Python: Reel 9:16, sottotitoli e script.

## 2. Definizioni degli angoli (2D, piano immagine)

Il riferimento è il **terreno**: per default è l'orizzontale dell'immagine. Con lo strumento *Terreno* si traccia la linea reale del suolo e tutte le verticali e orizzontali vengono ruotate di conseguenza.

| Misura | Definizione | Segno |
|---|---|---|
| Tronco vs verticale | centro anche → centro spalle rispetto alla verticale del terreno | + = inclinato in avanti |
| Tronco vs orizzontale | 90° − \|tronco vs verticale\| | — |
| Anca | coscia (anca→ginocchio) rispetto al prolungamento del tronco | + flessione / − estensione |
| Coscia vs verticale | anca→ginocchio rispetto alla verticale verso il basso | + = ginocchio avanti |
| Ginocchio | 180° − angolo incluso anca-ginocchio-caviglia | flessione (0 = esteso) |
| Caviglia | 90° − angolo fra tibia (caviglia→ginocchio) e piede (tallone→avampiede) | + dorsiflessione / − plantarflessione |
| Tibia vs verticale | caviglia→ginocchio rispetto alla verticale del terreno | + = ginocchio davanti alla caviglia |
| Testa / tronco | spalle→orecchio rispetto al segmento del tronco | + = testa avanti / flessa |
| Piede vs CoM | distanza orizzontale (lungo il terreno) fra il punto di contatto del piede e la proiezione del CoM | % della lunghezza dell'arto; cm se la scala è calibrata |
| Obliquità bacino / spalle (frontale) | linea sx–dx rispetto all'orizzontale del terreno | lato più basso indicato |
| FPPA ginocchio (frontale) | 180° − angolo incluso anca-ginocchio-caviglia | + valgo / − varo; **solo in appoggio** (in volo: confidenza bassa) |
| Caviglia – linea mediana (frontale) | distanza laterale della caviglia dalla mediana del bacino | % larghezza bacino; < 0 = incrocia |

**Angoli disegnati a mano**: a 3 punti, rispetto alla verticale, rispetto all'orizzontale, fra 2 linee, distanze.
- Con il *magnete* attivo, ogni punto si aggancia al landmark più vicino e segue il tracking in tutti i fotogrammi.
- Senza magnete, il disegno resta legato al fotogramma in cui è stato fatto.
- L'angolo di circa 44,4° misurato in precedenza fra due linee disegnate a mano è un **angolo fra linee arbitrarie**: non va confuso con l'inclinazione anatomica del tronco o del corpo.

## 3. Centro di massa (stima)

Il CoM viene stimato con un modello segmentale a 14 segmenti, con masse relative e posizioni dei centri di massa di **de Leva (1996)**, maschile o femminile. Le assunzioni:
- i centri articolari MediaPipe sostituiscono i punti di repere originali;
- il centro di massa della testa è posto nel punto medio fra le orecchie;
- la mano è posta a metà fra polso e indice.

Si tratta di una **stima**: dipende dalla visibilità degli arti controlaterali, spesso occlusi in vista sagittale. Per questo la confidenza del CoM non supera mai "media", e le distanze piede–CoM a confidenza bassa non vengono riportate.

## 4. Cosa dice la letteratura (e cosa no)

- **Associazioni (osservazionali)**:
  - Negli sprinter più veloci l'impulso orizzontale netto per unità di massa è maggiore e la componente propulsiva conta più della frenante: *push more, brake less?* (Morin et al., 2015).
  - Gli angoli della tibia di stance e di swing al touchdown e l'angolo del ginocchio in appoggio mostrano relazioni ampie con la potenza massima in accelerazione iniziale (Josse et al., 2025, giocatori di football americano).
  - Configurazione della gamba e dorsiflessione nella prima parte dell'appoggio sono associate al rapporto delle forze (RF) (King et al., 2023).
  - Si tratta di **correlazioni**, non di relazioni di causa-effetto.
- **Variabilità fra fasi e fra atleti**:
  - Nell'accelerazione iniziale la cinematica al touchdown cambia molto da un passo all'altro (von Lieres und Wilkau et al., 2018/2020): il confronto 1° vs 2° passo è informativo, ma non esiste un singolo valore "ideale".
  - Strategie di coordinazione diverse si osservano anche in sprinter di alto livello (Donaldson et al., 2024).
- **Risultati discordanti**: in giovani sprinter la forza neuromuscolare, e non la cinematica articolare sagittale, discrimina la prestazione sui 50 m (Zhou et al., 2026). Non bisogna attribuire alla tecnica visibile ciò che può dipendere dalla capacità di produrre forza.
- **Interventi**: in giocatori di rugby, interventi tecnici individualizzati hanno modificato tecnica e prestazione di accelerazione più dell'approccio uguale per tutti (Wild et al., 2023, case study longitudinali). Questo sostiene correzioni **individuali e motivate**, non l'imitazione di un modello d'élite.
- **Limiti dei sistemi markerless**:
  - In un confronto marker-based vs markerless sulla cinematica sagittale dello sprint non è stato possibile trarre conclusioni nette, soprattutto per il bacino (Crespeau et al., 2025).
  - In una gara di salto in lungo, OpenPose con camera singola ha mostrato errori casuali elevati e accordo scarso (ICC medio 0,17) (Cronin et al., 2024).
  - Le misure dell'app vanno quindi considerate **stime 2D**, utili per l'osservazione e il confronto intra-atleta nelle stesse condizioni di ripresa.
- **Cosa non si deduce dal video**: forze di reazione al suolo, impulso, rigidità muscolo-tendinea, rischio d'infortunio. Il negative step viene **descritto**, non giudicato come errore.

## 5. Fonti (verificate su PubMed)

1. de Leva P. *Adjustments to Zatsiorsky-Seluyanov's segment inertia parameters.* J Biomech. 1996;29(9):1223-30. PMID 8872282. doi:10.1016/0021-9290(95)00178-6
2. Morin JB et al. *Acceleration capability in elite sprinters and ground impulse: Push more, brake less?* J Biomech. 2015;48:3149-54. PMID 26209876. doi:10.1016/j.jbiomech.2015.07.009
3. Rabita G et al. *Sprint mechanics in world-class athletes: a new insight into the limits of human locomotion.* Scand J Med Sci Sports. 2015;25:583-94. PMID 25640466. doi:10.1111/sms.12389
4. von Lieres und Wilkau HC et al. *Phase analysis in maximal sprinting: step-to-step technical changes between the initial acceleration, transition and maximal velocity phases.* Sports Biomech. 2020;19:141-156. PMID 29972337. doi:10.1080/14763141.2018.1473479
5. Josse et al. *Kinetics and kinematics of initial sprint acceleration performance in Division I collegiate American football players.* J Sports Sci. 2025;43:2900-2913. PMID 41058108. doi:10.1080/02640414.2025.2567779
6. King et al. *Relationships between kinematic characteristics and ratio of forces during initial sprint acceleration.* J Sports Sci. 2023;40:2524-2532. PMID 36722337. doi:10.1080/02640414.2023.2172797
7. Donaldson et al. *Characterising coordination strategies during initial acceleration in sprinters ranging from highly trained to world class.* J Sports Sci. 2024;41:1768-1778. PMID 38185945. doi:10.1080/02640414.2023.2298100
8. Wild et al. *Enhancing the Initial Acceleration Performance of Elite Rugby Backs. Part II.* Int J Sports Physiol Perform. 2023;18:1019-1029. PMID 37562789. doi:10.1123/ijspp.2023-0091
9. Zhou et al. *Neuromuscular strength, not sagittal-plane joint or modeled muscle-tendon kinematics, is associated with 50-m sprint performance in youth male sprinters.* Front Physiol. 2026;17:1858508. PMID 42559095. doi:10.3389/fphys.2026.1858508
10. Crespeau et al. *Concurrent assessment of sprint running lower-limb and trunk kinematics using marker-based and markerless motion capture.* J Sports Sci. 2025. PMID 40643212. doi:10.1080/02640414.2025.2528439
11. Cronin et al. *Feasibility of OpenPose markerless motion analysis in a real athletics competition.* Front Sports Act Living. 2024;5:1298003. PMID 38250008. doi:10.3389/fspor.2023.1298003
12. Cavedon et al. *Effect of different anthropometry-driven block settings on sprint start performance.* Eur J Sport Sci. 2023;23:1110-1120. PMID 36453590. doi:10.1080/17461391.2022.2153347

## 6. Consigli di ripresa (per misure più affidabili)

- **Camera ferma**, perpendicolare alla direzione di corsa (vista sagittale), all'altezza dell'anca, a 8–15 m di distanza per ridurre la prospettiva.
- **Frame rate** di almeno 120 fps (meglio 240) per i tempi di contatto: a 30 fps l'errore è di ±33 ms per ogni evento.
- Buona luce e abbigliamento aderente e contrastato: i landmark del piede beneficiano di scarpe visibili.
- Per la scala, inquadra un oggetto di lunghezza nota **sul piano di corsa** (ad esempio un'asta da 1 m).
