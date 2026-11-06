'use strict';
// Génère le coffre fictif de test (≈40 notes) : frontmatter, wikilinks (alias, section, bloc), embeds,
// tags imbriqués, liens cassés, doublons de noms, notes vides, code. Usage : node make-vault.js

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, 'vault_test');

const N = {};
const note = (p, body, fm) => (N[p] = (fm ? '---\n' + fm.trim() + '\n---\n' : '') + body.trim() + '\n');

// ── Projets
note('Projets/Projet Phoenix.md', `
# Projet Phoenix
Le Projet Phoenix vise à refondre la plateforme de réservation d'Atelier Lumière. Il est dirigé par [[Claire Dubois]] avec l'appui de [[Marc Lefèvre|Marc]].
Le projet dépend de [[Migration Cloud]] et son budget est suivi dans [[Budget 2025#Phoenix]].

## Objectifs
- Réduire le temps de réservation de 40 %.
- Aligner l'équipe sur la [[Méthode Agile]].

## Risques
Le principal risque est le retard de la [[Migration Cloud]]. Voir aussi [[Réunion 2025-03-12#^decision]].
#projet/phoenix #priorité
`, `
title: Projet Phoenix
aliases: [Phoenix, Refonte réservation]
tags: [projet, refonte]
type: Projet
date: 2025-02-01
`);
note('Projets/Migration Cloud.md', `
# Migration Cloud
La Migration Cloud déplace les serveurs d'Atelier Lumière chez [[Nordtech]]. Responsable : [[Marc Lefèvre]].
Elle bloque le [[Projet Phoenix]] tant que la base n'est pas migrée.
## Calendrier
Fin prévue en juin 2025, retardée à septembre dans la [[Réunion 2025-04-02]].
#projet/infra
`, `
aliases: [Cloud, Migration]
tags: [projet]
type: Projet
`);
note('Projets/Projet Aurore.md', `
# Projet Aurore
Projet de bien-être des salariés, porté par [[Sophie Martin]]. Il s'inspire du livre [[Atomic Habits]] et du [[Sommeil]].
#projet/aurore #santé
`, 'tags: [projet]\ntype: Projet');
note('Projets/Budget 2025.md', `
# Budget 2025
## Phoenix
Budget de 120 k€ pour le [[Projet Phoenix]], validé par [[Claire Dubois]].
## Aurore
Budget de 15 k€ pour le [[Projet Aurore]].
## Infra
La [[Migration Cloud]] coûte 60 k€ chez [[Nordtech]].
`, 'tags: [finance]');
note('Archive/Budget 2025.md', 'Ancienne version du budget, doublon volontaire du nom de fichier. Voir [[Projet Phoenix]].');

// ── Personnes
note('Personnes/Claire Dubois.md', `
# Claire Dubois
Cheffe de projet chez Atelier Lumière. Elle pilote le [[Projet Phoenix]] et travaille avec [[Marc Lefèvre]].
Elle pratique la [[Méthode Agile]] depuis 2019 et lit beaucoup sur le [[Sommeil]].
#personne
`, 'aliases: [Claire, C. Dubois]\ntags: [personne]\ntype: Personne');
note('Personnes/Marc Lefèvre.md', `
# Marc Lefèvre
Ingénieur infrastructure. Responsable de la [[Migration Cloud]]. Collabore avec [[Nordtech]] et avec [[Claire Dubois]].
`, 'aliases: [Marc, M. Lefevre]\ntags: [personne]\ntype: Personne');
note('Personnes/Sophie Martin.md', `
# Sophie Martin
Responsable RH, elle porte le [[Projet Aurore]]. Pratique le [[Sport]] le matin.
#personne #santé
`, 'aliases: [Sophie]\ntype: Personne');
note('Personnes/Julien Roche.md', `
# Julien Roche
Consultant externe chez [[Nordtech]]. A conseillé Claire sur la [[Méthode Agile]]. Voir [[Contacts#Julien]].
`, 'tags: [personne, externe]\ntype: Personne');
note('Personnes/Contacts.md', `
# Contacts
## Julien
Julien Roche, joignable via [[Nordtech]].
## Autres
Voir [[Personne inconnue]].
`);

// ── Organisations / concepts
note('Organisations/Nordtech.md', `
# Nordtech
Prestataire d'hébergement cloud. Contrat signé en 2025 avec Atelier Lumière pour la [[Migration Cloud]]. Contact principal : [[Julien Roche]].
`, 'tags: [organisation]\ntype: Organisation');
note('Organisations/Atelier Lumière.md', `
# Atelier Lumière
Entreprise fictive de 80 personnes. Projets en cours : [[Projet Phoenix]], [[Projet Aurore]], [[Migration Cloud]].
Direction : [[Claire Dubois]] (projets) et [[Sophie Martin]] (RH).
`, 'aliases: [AL, Lumière]\ntype: Organisation');
note('Concepts/Méthode Agile.md', `
# Méthode Agile
Approche itérative de gestion de projet : sprints courts, rétrospectives, backlog. Utilisée sur le [[Projet Phoenix]].
La méthode **soutient** la livraison continue mais **contredit** la planification rigide de la [[Migration Cloud]].
#méthode #gestion/projet
`, 'aliases: [Agile, Scrum]\ntype: Concept');
note('Concepts/Sommeil.md', `
# Sommeil
Dormir 7 à 8 heures améliore la concentration. Le manque de sommeil **cause** une baisse de productivité.
Lié aux habitudes décrites dans [[Atomic Habits]]. Tags : #santé/sommeil #bien-être
`, 'aliases: [Dormir]\ntype: Concept');
note('Concepts/Sport.md', `
# Sport
Trois séances par semaine. [[Sophie Martin]] recommande la marche rapide. Effets sur le [[Sommeil]].
#santé/sport
`, 'tags: [santé]');
note('Concepts/Productivité.md', `
# Productivité
Idées : deep work, blocs de 90 minutes, pas de réunions le matin. Voir [[Atomic Habits]] et [[Méthode Agile]].
\`\`\`js
// ce [[faux lien]] dans un bloc de code doit être ignoré
const tag = "#pas-un-tag";
\`\`\`
Un \`[[autre faux lien]]\` en ligne aussi.
`);

// ── Lectures
note('Lectures/Atomic Habits.md', `
# Atomic Habits
Livre de James Clear sur les habitudes. Idée centrale : de petits changements réguliers produisent de grands résultats.
> [!note] Citation
> « Vous ne vous élevez pas au niveau de vos objectifs, vous tombez au niveau de vos systèmes. »
Applications : [[Sommeil]], [[Sport]], [[Productivité]].
#livre #lecture/2025
`, 'aliases: [Habitudes atomiques]\ntype: Œuvre\ndate: 2025-01-15');
note('Lectures/Deep Work.md', `
# Deep Work
Cal Newport défend le travail en profondeur. Complète [[Productivité]]. Pas de lien avec le [[Projet Phoenix]] mais utile à [[Claire Dubois]].
#livre #lecture/2024
`, 'type: Œuvre');
note('Lectures/Thinking Fast and Slow.md', `
# Thinking, Fast and Slow
Daniel Kahneman : système 1 (rapide) et système 2 (lent). Pertinent pour les décisions du [[Projet Phoenix]].
#livre #lecture/2023
`);

// ── Réunions
note('Réunions/Réunion 2025-03-12.md', `
# Réunion 2025-03-12
Participants : [[Claire Dubois]], [[Marc Lefèvre]], [[Julien Roche]].
Ordre du jour : avancement du [[Projet Phoenix]].
## Décisions
Décision : geler le périmètre de Phoenix jusqu'à la fin de la [[Migration Cloud]]. ^decision
## Actions
- Marc finalise le plan de migration.
- Claire présente le budget.
#réunion #projet/phoenix
`, 'date: 2025-03-12\ntype: Événement\ntags: [réunion]');
note('Réunions/Réunion 2025-04-02.md', `
# Réunion 2025-04-02
La [[Migration Cloud]] est retardée de juin à septembre à cause d'un incident chez [[Nordtech]]. [[Claire Dubois]] doit prévenir la direction.
Le [[Projet Phoenix]] est donc décalé d'un trimestre.
#réunion
`, 'date: 2025-04-02\ntype: Événement\ntags: [réunion]');
note('Réunions/Réunion 2025-05-20.md', `
# Réunion 2025-05-20
Point sur le [[Projet Aurore]] avec [[Sophie Martin]]. Premiers retours positifs sur le [[Sport]] collectif.
Contradiction : le budget annoncé en mars (voir [[Budget 2025]]) était de 12 k€, il est désormais de 15 k€.
`, 'date: 2025-05-20\ntype: Événement');
note('Réunions/Réunion 2024-11-05.md', `
# Réunion 2024-11-05
Lancement de la réflexion sur la refonte. Première mention de [[Phoenix]] et de l'idée d'utiliser la [[Méthode Agile]].
`, 'date: 2024-11-05\ntype: Événement');

// ── Journal et divers
for (let d = 1; d <= 6; d++) {
  note(`Journal/2025-06-0${d}.md`, `
# Journal 2025-06-0${d}
${['Bonne nuit de [[Sommeil]], 8 heures.', 'Séance de [[Sport]] puis travail sur le [[Projet Phoenix]].', 'Lu un chapitre de [[Atomic Habits]].', 'Réunion longue avec [[Marc Lefèvre]] sur la [[Migration Cloud]].', 'Journée calme, rangement des notes.', 'Mauvaise nuit, peu de [[Sommeil]].'][d - 1]}
#journal #santé/sommeil
`, `date: 2025-06-0${d}\ntags: [journal]`);
}
note('Divers/Idées.md', `
# Idées
- Écrire un article sur le [[Projet Phoenix]]
- Tester le [[Café Mokka]] du quartier
- Embed d'une note : ![[Sport]]
- Image : ![[schema.png]]
- Lien interne : [[#Idées]]
#idée
`);
note('Divers/Note vide.md', '');
note('Divers/Note presque vide.md', '---\ntitle: Titre seul\n---\n');
note('Divers/Voyage à Lisbonne.md', `
# Voyage à Lisbonne
Séjour en septembre 2024. Visite du quartier d'Alfama, pastéis de nata, trams. Aucun lien avec le travail.
#voyage #lieu
`, 'type: Lieu\ntags: [voyage]');
note('Divers/Recettes.md', `
# Recettes
Ratatouille : aubergines, courgettes, poivrons, tomates, mijoter 45 minutes. Gratin dauphinois : pommes de terre, crème, ail.
#cuisine
`);
note('Divers/Café Mokka.md', 'Un petit café proche du bureau, très calme pour la [[Productivité]].', 'tags: [lieu]');

fs.rmSync(root, { recursive: true, force: true });
for (const [p, c] of Object.entries(N)) {
  const f = path.join(root, p);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, c);
}
// dossiers à exclure : doivent être ignorés par l'ingestion
fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true });
fs.writeFileSync(path.join(root, '.obsidian', 'workspace.md'), '# config [[Ne pas ingérer]]');
fs.mkdirSync(path.join(root, '_graph'), { recursive: true });
fs.writeFileSync(path.join(root, '_graph', 'ancien.md'), '# sortie générée');
console.log(Object.keys(N).length + ' notes générées dans ' + root);
