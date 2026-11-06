# Cahier des charges — Système GraphRAG personnel (remplacement Claude × Obsidian)

Version : 1.0
Destinataire : Claude Code (exécution) + propriétaire du projet (validation)
Langue du système : français (interface et réponses), documents sources multilingues tolérés

---

## 1. Contexte et objectif

Aujourd'hui, le travail de connaissance repose sur deux outils séparés :

- **Obsidian** : stockage, rédaction et liens entre notes (Markdown, wikilinks `[[...]]`, tags, frontmatter).
- **Claude** (chat / projets) : interrogation de ces notes, synthèse, rédaction, raisonnement, avec un contexte chargé manuellement ou par copier-coller.

Limites constatées : la recherche est lexicale ou manuelle, les relations implicites entre notes ne sont pas exploitées, le contexte doit être réassemblé à chaque question, et les réponses ne sont pas traçables de façon systématique.

**Objectif** : construire un système qui ingère le coffre Obsidian (et d'autres sources), en extrait un **graphe de connaissances** (entités, relations, communautés thématiques), indexe le contenu pour la recherche vectorielle, et répond aux questions en combinant graphe et texte, avec **citations vérifiables** vers les notes d'origine.

Le système doit pouvoir **remplacer** l'usage actuel : on pose ses questions dans une interface dédiée (ou via Claude branché sur le système), on obtient une réponse sourcée, et on continue à éditer ses notes dans Obsidian sans rupture.

---

## 2. Périmètre

### 2.1 Inclus (V1)

- Ingestion d'un ou plusieurs coffres Obsidian, en lecture et en mise à jour incrémentale.
- Ingestion de fichiers Markdown, TXT, PDF (texte extractible) et exports simples (CSV, JSON) placés dans des dossiers surveillés.
- Extraction d'entités et de relations par LLM, avec schéma imposé et validation.
- Graphe de connaissances persistant, requêtable, avec historique de provenance.
- Détection de communautés thématiques et génération de résumés par communauté.
- Recherche hybride : vectorielle, par graphe (voisinage), et globale (résumés de communautés).
- Réponses en français avec citations (note source, section, extrait).
- Interfaces : CLI, API HTTP, interface web, serveur MCP (utilisable par Claude Code et Claude Desktop).
- Visualisation du graphe et navigation dans les sources.
- Configuration centralisée, journalisation, coûts LLM suivis.

### 2.2 Exclus (V1, éventuellement V2)

- Édition collaborative multi-utilisateurs en temps réel.
- Synchronisation mobile native (Obsidian Sync reste la solution de synchro des fichiers).
- Génération automatique de nouvelles notes sans validation humaine (V2 seulement, en mode brouillon).
- Ingestion d'emails, de messagerie ou de calendriers (connecteurs prévus en V2, cf. §6.6).

### 2.3 Principe directeur

**Le coffre Markdown reste la source de vérité.** Le graphe et les index sont des dérivés reconstructibles à tout moment. Si la base est supprimée, une commande de reconstruction doit la recréer à l'identique (aux variations LLM près, qui doivent être mises en cache).

---

## 3. Utilisateurs et cas d'usage

Utilisateur principal : une personne seule, technique ou semi-technique, qui écrit beaucoup en Markdown.

| # | Cas d'usage | Résultat attendu |
|---|---|---|
| U1 | « Qu'est-ce que j'ai noté sur le projet X et qui y est lié ? » | Synthèse, entités liées, notes sources citées |
| U2 | « Quelles idées reviennent dans mes notes de 2025 sur la santé ? » | Recherche globale par communauté, thèmes résumés |
| U3 | « Quel est le lien entre la personne A et l'entreprise B ? » | Chemin dans le graphe + justification textuelle |
| U4 | Ajouter une note dans Obsidian et la retrouver dans les réponses | Ingestion incrémentale en moins de 2 minutes |
| U5 | Voir les notes les plus centrales ou les plus isolées | Vue graphe filtrable, export |
| U6 | Demander à Claude (Desktop ou Code) d'interroger la base | Outils MCP exposés : recherche, voisinage, lecture de note |
| U7 | Vérifier d'où vient une affirmation | Clic sur une citation → extrait et lien `obsidian://` |
| U8 | Corriger une entité mal extraite (fusion, renommage, suppression) | Correction persistante, respectée aux prochaines ingestions |
| U9 | Savoir combien coûte une ingestion avant de la lancer | Estimation de tokens et de coût, avec confirmation |

---

## 4. Sources de données et connecteurs

### 4.1 Connecteur Obsidian (prioritaire)

Le parseur doit reconnaître :

- **Frontmatter YAML** : `title`, `aliases`, `tags`, `date`, et champs personnalisés (conservés tels quels dans les métadonnées).
- **Wikilinks** : `[[Note]]`, `[[Note|alias]]`, `[[Note#Section]]`, `[[Note#^bloc]]`. Chaque lien devient une **arête structurelle** du graphe, sans appel LLM.
- **Embeds** : `![[Note]]` et `![[image.png]]` (la note embarquée est indexée, l'image est ignorée en V1).
- **Tags** : `#tag` et `#tag/sous-tag`, dans le corps et dans le frontmatter.
- **Alias** : résolution des cibles de liens via le nom de fichier, puis `aliases`, puis la casse insensible.
- **Liens cassés** : signalés dans un rapport, pas bloquants.
- **Dossiers exclus** : `.obsidian/`, `.trash/`, `_graph/` (dossier de sortie du système), plus une liste configurable.
- **Blocs de code et callouts** : contenu conservé, callouts `> [!note]` traités comme du texte normal.

### 4.2 Autres connecteurs (V1, simples)

- Dossier de fichiers Markdown/TXT générique (sans wikilinks).
- PDF avec texte extractible (les PDF scannés sont signalés et ignorés, OCR en V2).
- CSV et JSON : chaque ligne ou objet devient un document avec ses champs.

### 4.3 Connecteurs V2 (hors périmètre V1, architecture prévue)

Interface `Connector` commune : `list()`, `fetch(id)`, `changed_since(cursor)`. Connecteurs envisagés : Google Drive, Notion, Gmail, Google Agenda, dossiers de téléchargement, fils RSS. Chaque connecteur doit fournir un identifiant stable et une date de modification.

### 4.4 Règles communes à tous les connecteurs

- Identifiant stable par document (chemin relatif + vault pour Obsidian).
- Empreinte de contenu (SHA-256) pour détecter les changements réels, pas seulement la date.
- Suppression : un document disparu entraîne la suppression de ses chunks, de ses provenances et de ses arêtes ; les entités orphelines sont supprimées au passage suivant.

---

## 5. Pipeline d'ingestion

Ordre des étapes, chacune idempotente et reprenable :

1. **Découverte** : parcours des sources, calcul des empreintes, comparaison avec l'état précédent. Produit une liste `ajouts / modifications / suppressions`.
2. **Parsing** : extraction du texte propre, des métadonnées, des liens et des tags (§4.1).
3. **Découpage (chunking)** : par titres Markdown d'abord, puis par taille. Taille cible 500 à 800 tokens, chevauchement de 10 à 15 %. Chaque chunk garde son chemin de titres (`Note > Section > Sous-section`) et son offset dans le fichier.
4. **Extraction LLM** (par chunk, modèle économique) : entités, relations, affirmations datées éventuelles. Sortie **JSON strict** validé par schéma. En cas de JSON invalide : une nouvelle tentative avec le message d'erreur, puis marquage du chunk comme « à reprendre ».
5. **Résolution d'entités** : fusion des doublons (normalisation de casse, accents, alias, similarité de nom et de type). Seuil de fusion configurable. Les fusions à faible confiance sont mises en file de revue (§7.4) plutôt qu'appliquées.
6. **Construction du graphe** : nœuds (entités, notes, tags), arêtes (relations extraites, liens wiki, appartenance note → entité, tag → note).
7. **Détection de communautés** : algorithme de partitionnement (Leiden ou Louvain, ou à défaut propagation d'étiquettes) sur le graphe d'entités. Hiérarchie à deux niveaux maximum.
8. **Résumés de communautés** : un résumé LLM par communauté, avec ses entités et relations principales. Régénéré seulement si la communauté a changé de plus de X %.
9. **Embeddings** : chunks, entités (nom + description), résumés de communautés. Modèle d'embedding configurable (§8.3).
10. **Index** : index vectoriel, index plein texte (FTS), index de voisinage.
11. **Rapport d'ingestion** : nombre de documents, chunks, entités, relations, erreurs, liens cassés, coût estimé et réel.

### 5.1 Exigences

- Ingestion incrémentale : modifier une note ne doit retraiter que ses chunks, puis recalculer uniquement les communautés touchées.
- **Cache LLM** : clé = hash(prompt + modèle + version du schéma). Une ré-ingestion identique ne rappelle pas le LLM.
- **Mode simulation** (`--dry-run`) : affiche le nombre de chunks, les tokens estimés et le coût estimé, sans appel LLM.
- **Reprise** : une ingestion interrompue reprend là où elle s'est arrêtée (état par étape et par document).
- **Verrou** : une seule ingestion à la fois sur une base donnée.

### 5.2 Schéma d'extraction (contrat)

Types d'entités recommandés (configurables) : `Personne`, `Organisation`, `Projet`, `Concept`, `Lieu`, `Événement`, `Œuvre`, `Outil`, `Autre`.

Types de relations recommandés : `travaille_avec`, `fait_partie_de`, `dépend_de`, `cause`, `contredit`, `soutient`, `est_un`, `mentionne`, `date_de`, `lié_à` (repli).

Chaque relation doit porter : sujet, prédicat, objet, **phrase source** (extrait exact, vérifié présent dans le chunk), chunk d'origine, confiance (0 à 1). Une relation sans phrase source vérifiable est rejetée.

---

## 6. Modèle de données

### 6.1 Stockage

- **Par défaut : SQLite** (un fichier, portable, sauvegardable). Extension `sqlite-vec` ou index vectoriel équivalent pour les embeddings, FTS5 pour le texte.
- **Option : Neo4j ou Kùzu** si la taille ou les requêtes de chemins l'exigent. L'accès passe par une couche d'abstraction (repository), pour que le changement de backend ne touche pas la logique métier.

### 6.2 Entités logiques

| Entité | Champs principaux |
|---|---|
| `Source` | id, type (obsidian, pdf, csv…), chemin, vault, empreinte, date_ingestion, statut |
| `Document` | id, source_id, titre, aliases, tags, frontmatter (JSON), date_modif |
| `Chunk` | id, document_id, ordre, chemin_titres, texte, offset, tokens, embedding |
| `Entity` | id, nom_canonique, type, aliases[], description, embedding, communauté_id, verrouillée (bool) |
| `Relation` | id, sujet_id, prédicat, objet_id, phrase_source, chunk_id, confiance, verrouillée |
| `Mention` | entity_id, chunk_id, nombre |
| `Tag` | nom, hiérarchie |
| `Link` | document_source_id, document_cible_id (ou cible non résolue), type (wikilink, embed) |
| `Community` | id, niveau, membres[], résumé, embedding, empreinte_membres |
| `Correction` | id, action (fusion, renommage, suppression, ajout), cible, date, auteur |
| `CostLog` | date, modèle, tokens_entrée, tokens_sortie, coût, étape |
| `Job` | id, type, statut, étape courante, erreurs, horodatages |

### 6.3 Règles

- Toute entité, relation et communauté doit pouvoir remonter à ses **chunks sources**.
- Les **corrections manuelles** (`verrouillée = vrai`) ne sont jamais écrasées par une ré-extraction.
- Suppression logique puis purge planifiée, pour permettre l'annulation d'une ingestion.
- Versionnage du schéma de base (migrations numérotées).

---

## 7. Recherche, raisonnement et réponses

### 7.1 Types de recherche

**a) Recherche locale (questions factuelles et ciblées)**
1. Repérer les entités de la question (correspondance vectorielle et plein texte sur les noms et alias).
2. Récupérer leur voisinage (profondeur 1 à 2, nombre de nœuds plafonné, priorisé par confiance et centralité).
3. Récupérer les chunks liés à ces entités et les chunks les plus proches de la question.
4. Fusionner, dédupliquer, reclasser, et tronquer au budget de contexte.

**b) Recherche globale (questions de synthèse, thèmes, « qu'est-ce qui revient »)**
1. Sélectionner les communautés pertinentes (similarité avec la question).
2. Produire une réponse partielle par communauté (map), puis une synthèse (reduce).

**c) Recherche de chemin (« comment A est-il lié à B ? »)**
Plus court chemin dans le graphe, avec les relations et leurs phrases sources sur chaque arête.

**d) Recherche directe de note** : par titre, alias, tag, ou date.

**Routage** : un classificateur léger (règles puis, si besoin, LLM) choisit le mode. L'utilisateur peut forcer le mode (`--mode local|global|path|note`).

### 7.2 Génération de la réponse

- Langue de la réponse : celle de la question.
- Chaque affirmation factuelle porte une **citation** `[n]` renvoyant à un extrait réel (note, section, phrase).
- Liste de sources en fin de réponse : titre de la note, chemin, section, lien `obsidian://open?vault=...&file=...`.
- **Pas de preuve, pas de réponse** : si les sources ne couvrent pas la question, le système le dit explicitement et propose ce qui est trouvé de plus proche.
- **Contradictions** : si deux sources se contredisent, les deux positions sont présentées avec leurs dates.
- Distinction explicite entre **ce qui est noté** et **ce qui est une inférence du système**.
- Budget de contexte et de sortie configurables ; réponse en streaming dans l'interface web et la CLI.

### 7.3 Évaluation de la qualité (exigence forte)

- Jeu de test de 50 questions minimum, couvrant les cas U1 à U3, avec réponses de référence rédigées par le propriétaire.
- Métriques : rappel des sources attendues, taux de citations valides (l'extrait existe bien dans la source), taux de réponses fidèles (évaluation par LLM juge + vérification humaine par échantillon), taux de « je ne sais pas » correct.
- Comparaison avec une baseline : la même question posée à Claude avec les notes pertinentes collées à la main.
- La suite d'évaluation doit tourner en une commande et produire un rapport daté.

### 7.4 Revue humaine

File de revue listant :
- fusions d'entités à faible confiance ;
- relations extraites à faible confiance ;
- liens cassés ;
- notes sans aucune entité extraite (signal de mauvaise extraction ou de note vide).

Chaque élément : valider, rejeter, corriger. La décision crée une `Correction`.

---

## 8. Interfaces et connexions

Le système expose un **noyau unique** (bibliothèque métier) et plusieurs façades. Aucune logique métier ne doit vivre dans une interface.

### 8.1 Vue d'ensemble

```
Obsidian (vault) ─┐
Dossiers / PDF   ─┼──► Ingestion ──► Graphe + index (SQLite)
Futurs connecteurs┘                       │
                                          ├──► CLI
                                          ├──► API HTTP ──► Interface web
                                          ├──► Serveur MCP ──► Claude Desktop / Claude Code
                                          └──► Export (Markdown, JSON, GraphML)
                                                  │
                                                  └──► Notes de synthèse dans _graph/ (Obsidian)
```

### 8.2 Interfaces à livrer

**A. CLI** (priorité 1)
Commandes minimales :
- `init` : crée la configuration et la base.
- `ingest [--source …] [--dry-run] [--full]` : ingestion incrémentale ou complète.
- `status` : état des sources, dernière ingestion, coûts cumulés, erreurs.
- `ask "question" [--mode …] [--format texte|json]` : réponse sourcée.
- `entity <nom>` : fiche d'une entité (voisinage, mentions, notes).
- `path <A> <B>` : chemin dans le graphe.
- `note <chemin>` : résumé et entités d'une note.
- `review` : traiter la file de revue (mode interactif).
- `export --format graphml|json|md` : export.
- `rebuild` : reconstruire les dérivés à partir des sources.
- `eval` : lancer la suite d'évaluation.
- `serve` : lancer l'API et l'interface web.

**B. API HTTP** (priorité 2)
- Ressources : `/sources`, `/documents/{id}`, `/entities/{id}`, `/relations`, `/communities`, `/search`, `/ask` (réponse en streaming), `/path`, `/jobs`, `/reviews`, `/corrections`, `/costs`.
- Documentation OpenAPI générée automatiquement.
- Authentification : jeton d'API local ; écoute par défaut sur `127.0.0.1` uniquement.
- Réponses JSON typées, erreurs au format standard avec codes stables.

**C. Interface web** (priorité 2)
Pages :
- **Chat** : question, mode, réponse en streaming, sources cliquables, panneau d'extraits.
- **Graphe** : visualisation interactive, filtres par type, tag, communauté, recherche de nœud, centrage, recherche de chemin, export d'image.
- **Entité** : fiche, relations, notes sources, historique des corrections, bouton « corriger ».
- **Note** : rendu Markdown, entités détectées surlignées, liens entrants et sortants.
- **Revue** : file de revue (§7.4).
- **Ingestion** : état des jobs, journal, coûts, bouton lancer / annuler.
- **Réglages** : sources, modèles, seuils, dossiers exclus.
- Responsive, utilisable au clavier, thème clair et sombre.

**D. Serveur MCP** (priorité 2, critique pour Claude)
Outils exposés :
- `search_knowledge(question, mode?)` → réponse sourcée ou extraits bruts.
- `get_entity(nom)` → fiche et voisinage.
- `find_path(a, b)` → chemin commenté.
- `get_note(chemin)` → contenu et métadonnées.
- `list_communities(thème?)` → résumés.
- `ingest_status()` → état.

Ressources MCP : notes, entités, communautés en lecture. Pas d'outil d'écriture destructif en V1 ; l'ajout de note peut être prévu en V2 sous confirmation.
Transport : stdio (Claude Desktop, Claude Code) et HTTP (si besoin).
Les réponses MCP doivent inclure les citations sous forme structurée, pour que Claude puisse les reprendre.

**E. Obsidian** (priorité 3)
- **V1 : lecture seule.** Le système lit le vault ; aucune écriture dans les notes existantes.
- **Dossier `_graph/`** : notes générées (index des entités, pages de communautés, rapports d'ingestion) avec wikilinks vers les notes d'origine. Visibles dans Obsidian, régénérées à chaque ingestion, jamais modifiées à la main.
- **V2 : plugin Obsidian** (optionnel) : panneau latéral « Demander », commande « Entités de cette note », lien vers l'interface web. Doit appeler l'API locale, sans logique métier propre.
- Lien `obsidian://open` vers chaque source.

**F. Export et interopérabilité**
- GraphML et JSON (graphe), Markdown (rapports), CSV (entités et relations).
- Import/export de la file de corrections (sauvegarde des décisions humaines).

**G. Notifications et automatisation** (V2)
- Ingestion planifiée (cron ou service système) et déclenchée par changement de fichier (watcher).
- Notification (fichier, bureau, ou Claude via MCP) à la fin d'une ingestion avec erreurs.

### 8.3 Connexions externes

| Service | Usage | Obligatoire | Notes |
|---|---|---|---|
| API Claude (Anthropic) | Extraction, résumés, réponses | Oui (ou modèle local en repli) | Modèles configurables : Haiku 5.5 pour l'extraction en masse, Sonnet 5.5 pour les réponses, Opus 5.5 optionnel pour les synthèses globales |
| Modèle d'embedding | Recherche vectorielle | Oui | Anthropic ne fournit pas d'API d'embeddings. Options : modèle local (sentence-transformers multilingue, privilégié pour la confidentialité) ou API d'un fournisseur tiers. Interface commune, changement de modèle = réindexation |
| Stockage local | Base, index, cache, fichiers | Oui | SQLite + dossier de cache |
| Serveur MCP | Intégration Claude Desktop / Code | Non (recommandé) | Transport stdio |
| Obsidian | Source des notes (fichiers locaux) | Oui | Pas d'API nécessaire en V1 |

**Politique de sortie des données** : par défaut, seuls les extraits nécessaires au traitement d'une requête partent vers l'API LLM. Une option « locale uniquement » doit exister (modèles locaux pour extraction et réponse), avec une dégradation de qualité assumée et documentée.

---

## 9. Configuration

Fichier unique `config.yaml` (surchargeable par variables d'environnement pour les secrets).

Paramètres minimaux :
- `vaults` : liste de chemins, nom, dossiers exclus, extensions.
- `storage` : chemin de la base et du cache.
- `llm` : fournisseur, modèles par tâche (extraction, réponse, résumé, juge), température, budget max par ingestion et par mois.
- `embeddings` : fournisseur, modèle, dimension, lot.
- `chunking` : taille cible, chevauchement, stratégie.
- `extraction` : types d'entités et de relations, seuils de confiance, seuil de fusion.
- `retrieval` : nombre de chunks, profondeur de voisinage, budget de contexte, modes par défaut.
- `communities` : algorithme, résolution, seuil de régénération.
- `server` : hôte, port, jeton d'API.
- `logging` : niveau, rotation, masquage des secrets et du contenu des notes dans les logs (option).

Les secrets (clés API) ne sont jamais dans le fichier versionné ; ils viennent de l'environnement ou d'un gestionnaire de secrets.

---

## 10. Exigences non fonctionnelles

### 10.1 Performance (cibles pour un coffre de 5 000 notes, environ 20 Mo de texte)

- Ingestion complète : moins de 2 h hors attente API (avec parallélisation contrôlée), recommandé en lots.
- Ingestion incrémentale d'une note modifiée : moins de 2 minutes, appels LLM limités à ses chunks et aux communautés touchées.
- Réponse locale : moins de 5 s hors génération ; premier jeton en streaming en moins de 2 s.
- Réponse globale : moins de 30 s.
- Mémoire : moins de 2 Go en fonctionnement normal.

### 10.2 Coût

- Affichage du coût estimé avant toute ingestion complète.
- Budget mensuel et par job, avec arrêt propre à l'atteinte.
- Cache LLM obligatoire (§5.1).
- Tableau de bord des coûts (par jour, modèle, étape).

### 10.3 Fiabilité

- Aucune perte de données sources : le système ne modifie jamais les fichiers du vault (V1).
- Reconstruction complète possible à tout moment (`rebuild`).
- Sauvegarde : export automatique de la base et de la file de corrections (rotation de N sauvegardes).
- Gestion des erreurs API : réessais avec backoff exponentiel, limites de débit respectées, états persistés.

### 10.4 Sécurité et confidentialité

- Écoute réseau locale par défaut ; jeton obligatoire dès qu'on expose l'API.
- Pas de contenu de notes dans les logs par défaut.
- Protection contre l'injection de prompt : le contenu des notes est traité comme **donnée** ; les instructions trouvées dans une note ne modifient pas le comportement du système.
- Validation stricte des sorties LLM (schémas) avant écriture en base.
- Chiffrement optionnel de la base au repos.
- Journal des appels LLM (sans contenu par défaut), pour audit.

### 10.5 Qualité du code et exploitation

- Tests unitaires sur le parseur Obsidian (wikilinks, alias, frontmatter, cas limites), le découpage, la validation de schéma, la résolution d'entités, les requêtes de voisinage.
- Tests d'intégration avec un petit coffre de test versionné (30 à 50 notes fictives couvrant tous les cas du §4.1).
- Tests de la pipeline avec un LLM simulé (réponses enregistrées), pour que la CI n'appelle jamais l'API réelle.
- Linter et formateur, typage statique sur le noyau.
- Migrations de base versionnées.
- Documentation : README d'installation, guide de configuration, guide d'exploitation (sauvegarde, reconstruction, dépannage), référence de l'API et des outils MCP.

### 10.6 Accessibilité et langue

- Interface web conforme aux bonnes pratiques WCAG 2.1 AA (contrastes, clavier, libellés).
- Interface et réponses en français ; l'anglais est accepté en entrée et dans les sources.

---

## 11. Structure du dépôt attendue

```
graphrag/
  README.md
  config.example.yaml
  pyproject.toml
  core/            # noyau métier, sans dépendance d'interface
    sources/       # connecteurs (obsidian, markdown, pdf, csv)
    ingest/        # pipeline : découverte, parsing, chunking, extraction, résolution, graphe, communautés
    store/         # abstraction + implémentation SQLite (migrations)
    retrieve/      # recherche locale, globale, chemin, routage
    answer/        # génération, citations, garde-fous
    llm/           # clients LLM, cache, budget, schémas de sortie
    embed/         # clients d'embedding
    review/        # file de revue et corrections
    eval/          # jeu de test et métriques
  interfaces/
    cli/
    api/           # HTTP + OpenAPI
    web/           # interface web (graphe, chat, revue, réglages)
    mcp/           # serveur MCP
    obsidian_plugin/   # V2 uniquement
  tests/
    unit/
    integration/
    fixtures/vault_test/   # coffre fictif de test
    eval/questions.yaml    # jeu de questions de référence
  docs/
```

Règle de dépendance : `interfaces/*` dépendent de `core/`, jamais l'inverse.

---

## 12. Plan de livraison

Chaque phase se termine par une démonstration et une validation écrite par le propriétaire.

### Phase 0 — Fondations (critère : le projet démarre et les tests passent)
- Structure du dépôt, configuration, journalisation, base avec migrations.
- Parseur Obsidian complet (§4.1) testé sur le coffre fictif.
- Cas d'acceptation : 100 % des wikilinks, alias et frontmatter du coffre de test sont extraits correctement.

### Phase 1 — Ingestion et graphe (critère : un coffre réel s'ingère sans erreur bloquante)
- Découpage, extraction LLM avec schéma et validation, cache, budget, dry-run, reprise.
- Résolution d'entités, construction du graphe, ingestion incrémentale.
- CLI `init`, `ingest`, `status`, `entity`, `note`, `path`.
- Cas d'acceptation : sur le coffre de test, chaque relation extraite a une phrase source présente dans le chunk ; une modification d'une note ne retraite que ses chunks ; une seconde ingestion sans changement ne fait aucun appel LLM.

### Phase 2 — Recherche et réponses (critère : qualité mesurée)
- Recherche locale, globale, chemin, routage, réponses avec citations.
- CLI `ask`, `eval`.
- Cas d'acceptation : au moins 80 % des réponses du jeu de test sont jugées fidèles, 95 % des citations pointent vers un extrait réel, et les questions hors-corpus reçoivent une réponse « je ne sais pas » dans au moins 90 % des cas.

### Phase 3 — Communautés et résumés
- Détection, résumés, recherche globale branchée.
- Cas d'acceptation : les communautés sont stables d'une ingestion à l'autre sur un corpus inchangé ; chaque résumé cite ses entités.

### Phase 4 — Interfaces
- API HTTP et OpenAPI, serveur MCP, interface web (chat, graphe, entité, note, revue, ingestion, réglages).
- Cas d'acceptation : Claude Desktop ou Claude Code peut répondre à une question sur le coffre via MCP avec citations ; l'interface web affiche le graphe filtré en moins de 3 s pour 5 000 nœuds.

### Phase 5 — Obsidian et exploitation
- Notes générées dans `_graph/`, liens `obsidian://`, export, sauvegardes, watcher et ingestion planifiée.
- Documentation complète (README, exploitation, dépannage).
- Cas d'acceptation : une note créée dans Obsidian apparaît dans les réponses après une ingestion, sans intervention ; une restauration depuis sauvegarde fonctionne.

### Phase 6 — V2 (optionnel, après usage réel)
- Plugin Obsidian, connecteurs supplémentaires, OCR, génération de brouillons de notes validées, mode 100 % local.

---

## 13. Critères d'acceptation globaux (V1)

1. Le système remplace l'usage quotidien : une question courante se pose en un seul endroit et obtient une réponse sourcée.
2. Aucun fichier du vault n'est modifié.
3. Toute affirmation de réponse est vérifiable en un clic jusqu'à l'extrait source.
4. Une reconstruction complète depuis le vault donne un graphe équivalent (à la variation LLM près, mesurée par la suite d'évaluation).
5. Les coûts sont visibles, bornés et prévisibles.
6. La suite de tests passe sans appel API réel.
7. La documentation permet d'installer et de faire tourner le système sans l'auteur.

---

## 14. Risques et parades

| Risque | Parade |
|---|---|
| Extraction LLM bruitée (entités inventées, doublons) | Phrase source obligatoire, résolution prudente, file de revue, corrections persistantes |
| Coût d'ingestion élevé | Dry-run, cache, modèle économique pour l'extraction, budget |
| Réponses fausses avec citations plausibles | Vérification automatique que la citation existe, « pas de preuve, pas de réponse », évaluation continue |
| Dépendance à un fournisseur | Couches d'abstraction LLM et embeddings, modèle local en option |
| Confidentialité | Local par défaut, contenu minimal envoyé, logs sans contenu, option 100 % local |
| Dérive de schéma en base | Migrations versionnées, tests de schéma |
| Vault volumineux, lenteur | Ingestion incrémentale, index, plafonds de voisinage et de contexte |
| Injection de prompt via les notes | Contenu traité comme donnée, schémas stricts, pas d'outil d'écriture en V1 |

---

## 15. Hypothèses par défaut (à valider)

Ces choix ont été faits pour permettre le démarrage. Ils peuvent être modifiés avant la phase 0.

1. **Langue principale** : français ; coffre mixte français et anglais toléré.
2. **Fournisseur LLM** : API Claude. Haiku 5.5 pour l'extraction, Sonnet 5.5 pour les réponses.
3. **Embeddings** : modèle local multilingue (confidentialité, coût nul).
4. **Stockage** : SQLite, un fichier.
5. **Interface principale** : interface web locale + CLI ; MCP pour Claude.
6. **Obsidian** : lecture seule en V1, dossier `_graph/` pour les sorties.
7. **Déploiement** : machine personnelle, Python 3.11+, sans service cloud.
8. **Volume cible** : 5 000 notes, croissance modérée.

---

## 16. Questions ouvertes pour le propriétaire

1. Combien de coffres Obsidian et quel volume approximatif (notes, Mo) ?
2. Acceptez-vous que des extraits de notes soient envoyés à l'API Claude, ou exigez-vous un mode 100 % local dès la V1 ?
3. Quel budget mensuel LLM maximum est acceptable ?
4. Souhaitez-vous le serveur MCP en priorité (usage depuis Claude Desktop ou Claude Code) ou l'interface web ?
5. Les notes contiennent-elles des données sensibles (santé, finances, tiers identifiables) qui doivent être exclues ou traitées à part ?
6. Quelles sources hors Obsidian doivent entrer en V2 (Drive, Notion, emails, PDF) ?
7. Machine cible : Linux, macOS, Windows ? Avec ou sans GPU (pour l'embedding local) ?
8. Avez-vous des questions types à me donner pour constituer le jeu d'évaluation (§7.3) ?

---

## 17. Brief de démarrage pour Claude Code

À coller tel quel dans Claude Code, après avoir placé ce document à la racine du dépôt :

> Lis `cahier_des_charges_graphrag.md`. Ne commence aucun développement avant d'avoir :
> 1. proposé le plan détaillé de la phase 0 (arborescence réelle, dépendances, tâches) ;
> 2. listé les questions du §16 auxquelles le document ne répond pas, et utilisé les hypothèses du §15 pour les autres ;
> 3. créé le coffre de test `tests/fixtures/vault_test/` (30 à 50 notes fictives couvrant frontmatter, wikilinks avec alias et sections, embeds, tags imbriqués, liens cassés, doublons de noms, notes vides).
> Respecte la règle de dépendance du §11, le principe « le vault reste la source de vérité » du §2.3, et les critères d'acceptation de chaque phase. Ne fais aucun appel API réel dans les tests. Demande validation après chaque phase.

---

*Fin du cahier des charges.*
