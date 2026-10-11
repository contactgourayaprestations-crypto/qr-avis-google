# SaaS v2 — état et instructions de déploiement

## Contenu
- `index.html` : frontend complet (SEO, FAQ, AvisBoost, premium, guide) + UI auth (nav, modale, bouton sauvegarder)
- `dashboard.html` : tableau de bord (liste/création/suppression des QR)
- `netlify/functions/` : 7 functions monofichiers, **zéro dépendance npm** (client Blobs minimal réécrit en REST direct, scrypt natif)
- `netlify.toml` : `[build] functions = "netlify/functions"`
- `_headers`, guides HTML/PDF

## Code : PRÊT et VÉRIFIÉ
- Les 7 functions passent `node --check`.
- Logique pure testée : hash scrypt / vérification / tokens / validation email / rate-limit / parsing.
- Protocole Blobs recopié depuis le client officiel `@netlify/blobs` v11 (contexte `event.blobs` + header `x-nf-site-id`, signed URLs via `api.netlify.com`).

## Déploiement : BLOQUÉ par la méthode API zip
Testé 2 fois (site `qr-saas-v2-test`, deploy `6aca14c79108bd8656c94854`) :
- pages statiques : 200 OK
- `/.netlify/functions/*` : 404, `available_functions: []`

**Cause** : `POST /sites/{id}/deploys` (zip) contourne le pipeline de build Netlify,
et c'est pendant ce pipeline (ou via le bundling local du CLI) que les functions sont
détectées/empaquetées. Le zip brut ne déclenche pas cette étape, même avec des
functions monofichiers sans dépendances. Le `netlify.toml` seul ne suffit pas.

## Options pour mettre le SaaS en ligne
### A. Git-based deploy (recommandé, 1 action de jil)
jil connecte un repo GitHub au site Netlify (2 min dans son navigateur).
Ensuite chaque `git push` déploie statique + functions automatiquement.
Ce dossier est prêt à être poussé tel quel.

### B. Version v1 sans functions (100 % autonome, sans jil)
Frontend avec persistance `localStorage` : sauvegarde des QR **par appareil**,
pas de comptes, pas de synchro. Honnête si présenté comme v1.
À construire sur demande.

### C. Répliquer l'upload de functions du CLI via l'API (autonomie totale)
Le CLI Netlify bundle les functions en local et les envoie via l'API digest-based
avec manifestes spéciaux. Reproductible, mais demande un travail de R&D
(étudier le protocole exact du CLI). Tâche de suivi possible.

## NE PAS déployer en production
Le frontend de saas-v2 contient l'UI d'auth : sans functions, « Créer un compte »
afficherait une erreur. Garder la production actuelle (statique, fonctionnelle).
