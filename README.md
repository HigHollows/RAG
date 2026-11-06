# GraphRAG Studio

Logiciel Windows pour interroger vos notes **Obsidian** (et vos dossiers de Markdown, TXT, PDF, CSV, JSON, PDF scannés) : il construit un graphe de connaissances et répond à vos questions avec des **citations vérifiables**. Tout reste sur votre machine. Vos notes ne sont jamais modifiées.

## Installation

Deux fichiers sont fournis dans ce dossier :

| Fichier | Usage |
|---|---|
| `GraphRAG-Studio-Setup-1.0.0.exe` | Installateur (recommandé). Crée un raccourci, permet le lancement avec Windows et la connexion à Claude. |
| `GraphRAG-Studio-1.0.0-portable.exe` | Version portable : double-clic, sans installation. |

Windows peut afficher un avertissement « SmartScreen » car le logiciel n'est pas signé : cliquez sur **Informations complémentaires → Exécuter quand même**.

## Premier lancement (3 minutes)

1. Ouvrez l'application, écran **Questions**, puis **Choisir mon coffre Obsidian…** et sélectionnez le dossier de votre coffre.
2. L'écran **Ingestion** s'ouvre : lisez l'estimation, puis **Lancer l'ingestion**.
3. Revenez à **Questions** et posez une question.

## Avec ou sans clé Claude

- **Sans clé** : le graphe est construit localement (liens `[[…]]`, tags, mentions) et les réponses sont des passages de vos notes, cités.
- **Avec une clé Anthropic** (Réglages → Modèles Claude) : extraction d'entités et de relations, résumés de thèmes, réponses rédigées. La clé est chiffrée par Windows. Le coût est estimé avant chaque ingestion, avec un budget maximum par ingestion et par mois.

## Les écrans

- **Questions** : posez une question ; la réponse cite ses sources (clic sur un numéro pour voir l'extrait, ouvrir la note dans Obsidian).
- **Graphe** : relations entre entités, filtres, recherche de chemin entre deux éléments, export PNG.
- **Explorateur** : entités, notes et thèmes. Vous pouvez renommer, fusionner, supprimer ou ajouter une relation ; vos corrections sont conservées.
- **Revue** : fusions douteuses, liens cassés, extractions échouées, notes vides.
- **Ingestion** : lancement, estimation du coût, historique, exports (GraphML, JSON, CSV, Markdown), reconstruction.
- **Réglages** : coffres, modèles, budgets, OCR, ingestion automatique, thème, connexion à Claude, API locale.

## Fonctions optionnelles (Réglages)

- **OCR** : lecture des pages de PDF scannés (et, si vous l'activez, des images). Local, français et anglais inclus.
- **Ingestion automatique** : réingestion 20 s après une modification du coffre, planification, arrière-plan, lancement avec Windows.
- **Claude Desktop / Claude Code (MCP, lecture seule)** : Réglages → « Utiliser avec Claude » donne la configuration à copier. Outils : `search_knowledge`, `get_entity`, `find_path`, `get_note`, `list_communities`, `ingest_status`. À utiliser avec l'installateur (pas la version portable).
- **Plugin Obsidian** : copiez le dossier `obsidian-plugin/` dans `<coffre>/.obsidian/plugins/graphrag-studio/`, activez-le, puis collez le jeton affiché dans Réglages → API HTTP locale (à activer).
- **API HTTP locale** : `POST http://127.0.0.1:7474/api/<méthode>` avec `Authorization: Bearer <jeton>` et `{"args":[…]}` ; description : `GET /api/openapi.json`.

## Où sont mes données ?

`%APPDATA%\GraphRAG Studio\` : `graph.db` (base), `config.json`, `backups\` (5 sauvegardes automatiques), `eval\` (rapports d'évaluation). Le graphe est un dérivé de vos notes : le bouton **Reconstruire** le recrée à tout moment, vos corrections sont conservées. Pages de synthèse écrites dans `<coffre>\_graph\` (désactivable par coffre).

## Dépannage

- **« Aucune clé API »** : normal en mode hors-ligne ; ajoutez une clé dans Réglages pour les réponses rédigées.
- **Un PDF est ignoré** : s'il est scanné, vérifiez que l'OCR est activé (Réglages).
- **Une note n'apparaît pas** : lancez une ingestion ; les dossiers `.obsidian`, `.trash` et `_graph` sont ignorés.
- **Repartir de zéro** : fermez l'application et supprimez `%APPDATA%\GraphRAG Studio\graph.db`.

## Limites connues

- Embeddings locaux par hachage (pas de modèle neuronal) : recherche vectorielle correcte, pas au niveau d'un modèle dédié.
- Pas encore de connecteurs Notion, Google Drive ni mail ; pas de mode 100 % local pour l'extraction IA et les réponses rédigées.
- Exécutables non signés.

## Pour les développeurs

```
npm install
npm test            # 16 tests, aucun appel API réel
npm start           # lance l'application
node src/cli.js --help
npm run dist        # reconstruit dist/*.exe
```

Cahier des charges d'origine : `docs/cahier_des_charges_graphrag.md`.
