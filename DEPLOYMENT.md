# Déployer Box

Box sert le jeu React, l’API de comptes et la signalisation PeerJS depuis le même serveur. MongoDB reste la base de données externe. Le serveur PeerJS est inclus : il n’y a plus de dépendance au serveur public PeerJS.

## 1. Préparer le serveur

Prérequis : Node.js 22.12+ (ou une version LTS plus récente), npm et une base MongoDB Atlas. Le mot de passe MongoDB précédemment partagé doit être considéré comme compromis : change-le dans Atlas, supprime l’ancien et limite l’accès réseau au serveur.

```sh
cp .env.example .env
npm ci
```

Dans `.env`, configure au minimum :

- `MONGODB_URI` et `MONGODB_DB=box` ;
- `JWT_SECRET` — une clé aléatoire d’au moins 32 caractères ;
- `APP_ORIGINS` — les origines HTTPS autorisées, séparées par des virgules ;
- `PORT` (optionnel ; `8787` par défaut, ou `SERVER_PORT` fourni par Pterodactyl) et `HOST` (`0.0.0.0`).

Exemple de génération du secret de session :

```sh
openssl rand -base64 48
```

Ne mets jamais `MONGODB_URI`, `JWT_SECRET` ou `GOOGLE_CLIENT_SECRET` dans une variable `VITE_*` : les variables Vite sont intégrées au JavaScript envoyé au navigateur. Ne versionne pas `.env`.

## 2. Réactiver Google OAuth

1. Dans Google Cloud Console, sélectionne ou crée un projet et configure l’écran de consentement OAuth. En mode test, ajoute les comptes Google autorisés comme utilisateurs de test.
2. Crée un identifiant client OAuth de type **Application Web**.
3. Ajoute l’origine publique du jeu à **Origines JavaScript autorisées**, par exemple `https://box.example`.
4. Ajoute cette URL exacte à **URI de redirection autorisés** :

   ```text
   https://box.example/api/auth/google/callback
   ```

5. Renseigne les valeurs privées dans `.env` :

   ```dotenv
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=https://box.example/api/auth/google/callback
   APP_URL=https://box.example
   ```

Pour un essai local, l’URI de redirection est `http://localhost:8787/api/auth/google/callback` et l’origine JavaScript `http://localhost:8787`. Le bouton Google s’active lorsque l’API confirme que ses identifiants sont configurés. Le serveur valide l’état OAuth, vérifie le jeton Google côté serveur et exige une adresse email vérifiée. Un compte Box existant avec la même adresse vérifiée est associé au compte Google sans remplacer son mot de passe.

Après configuration, vérifie `GET /api/config` : la réponse doit contenir `"auth":{"google":true}`. Aucun secret Google ne part au navigateur.

## 3. Lancer le site et l’API

En développement, une seule commande démarre le site, l’API, MongoDB et le serveur de signalisation :

```sh
npm run dev
```

Ouvre `http://localhost:8787`. `GET /api/health` renvoie `{ "ok": true }` si MongoDB répond. Si tu veux lancer Vite à part pour le développement UI, démarre d’abord l’API avec `npm run dev`, puis dans un second terminal `npm run dev:ui` ; le proxy Vite relaie `/api` et `/peerjs` vers le serveur Box.

Pour un lancement de production :

```sh
npm ci --include=dev
npm run build
npm start
```

`npm start` démarre le serveur en mode production. Le port est lu dans `PORT`, puis `SERVER_PORT`, puis vaut `8787` par défaut.

Le serveur doit être derrière HTTPS en production. Utilise un hôte permanent qui prend en charge les WebSockets ; un hébergement statique seul (par exemple un simple dépôt de fichiers) ne peut pas héberger l’API ni le jeu en ligne.

## 4. Installer Box sur un téléphone (PWA)

La compilation produit une application web installable, pas un APK :

```sh
npm run build
```

Déploie ensuite l’application complète sur une adresse **HTTPS**. Le site, l’API et PeerJS doivent être servis par ton serveur Box ; `npm run preview` seul ne suffit pas pour les comptes ou le multijoueur.

- **Android** : ouvre l’adresse HTTPS dans Chrome, puis le menu ⋮ → **Installer l’application** (ou **Ajouter à l’écran d’accueil**).
- **iPhone** : ouvre l’adresse dans Safari → **Partager** → **Sur l’écran d’accueil** → **Ajouter**.

La PWA met en cache l’interface et les fichiers statiques. Le jeu local peut donc s’ouvrir sans réseau après un premier chargement ; la connexion, les comptes et les parties en ligne nécessitent toujours Internet. Pour distribuer un APK sur Google Play ou une application native sur l’App Store, il faudra ensuite envelopper la PWA avec un outil comme Capacitor.

### Docker

Le Dockerfile construit le front puis démarre l’application en mode production. Fournis `.env` au runtime, sans l’ajouter à l’image :

```sh
docker build -t box .
docker run --name box --env-file .env -p 8787:8787 box
```

MongoDB Atlas doit être accessible depuis le conteneur. Termine TLS au niveau du proxy ou de la plateforme d’hébergement et transmets les requêtes WebSocket au même port.

## 5. Pterodactyl — egg Node.js

Le déploiement Pterodactyl se fait avec un egg Node.js et une image **Node 22.12+**. Le build est fait avant l’envoi sur le panel ; Pterodactyl n’a donc pas besoin des dépendances de développement.

Depuis le dépôt, construis l’application et crée un paquet contenant les fichiers runtime :

```sh
npm ci
npm run build
zip -r Box-Pterodactyl.zip package.json package-lock.json server dist DEPLOYMENT.md
```

Téléverse et extrais le ZIP à la racine du serveur Pterodactyl. Configure le script d’installation de l’egg pour installer uniquement les dépendances de production :

```sh
npm ci --omit=dev
```

**Commande de démarrage** dans Startup :

```sh
npm start
```

`npm start` sert directement le dossier `dist/` et s’arrête avec un message explicite si le build manque. Après une mise à jour du code, reconstruis le paquet localement et retéléverse-le ; ne lance pas `npm run build` sur le panel.

Dans l’onglet Variables du serveur, ajoute les variables suivantes. Ne mets pas de vrais secrets dans le dépôt :

- `MONGODB_URI` : URI de MongoDB Atlas ;
- `MONGODB_DB` : `box` ;
- `JWT_SECRET` : clé aléatoire longue ;
- `APP_ORIGINS` : origine publique du site, par exemple `https://box.example` ;
- Google OAuth, si utilisé : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=https://box.example/api/auth/google/callback` et `APP_URL=https://box.example`.

Associe au serveur l’allocation réseau Pterodactyl. L’application écoute sur `PORT` si cette variable est définie, sinon sur `SERVER_PORT` fourni par certains eggs, sinon sur `8787`, et se lie à `0.0.0.0`. Si ton egg ne fournit ni `PORT` ni `SERVER_PORT`, définis `PORT` à la valeur de l’allocation.

Pour installer la PWA sur un téléphone, expose ensuite le serveur avec un domaine **HTTPS** et un proxy compatible WebSocket. Configure MongoDB Atlas pour autoriser les connexions sortantes du nœud Pterodactyl. Les redémarrages normaux utilisent uniquement `npm start` ; relance le script d’installation/build après un changement de code.

## 6. Serveur du jeu en ligne

Le serveur de signalisation PeerJS est intégré à l’API sur `/peerjs` et démarre automatiquement avec Box. Le client utilise cette instance privée pour établir les connexions ; les salles, les invitations et les amis ne dépendent donc plus du service de signalisation public PeerJS. La limite de connexions simultanées est réglable avec `PEER_CONCURRENT_LIMIT`.

Les coups transitent ensuite directement entre l’hôte de la salle et les autres joueurs par WebRTC, ce qui évite un aller-retour serveur à chaque coup. Le serveur PeerJS négocie les connexions, mais ne relaie pas le trafic du jeu et n’est pas un serveur de jeu autoritaire. Certaines configurations NAT ou pare-feu peuvent encore nécessiter un serveur TURN/Coturn. Les résultats terminés sont enregistrés dans MongoDB quand le joueur est connecté à son compte ; les coups et salles en cours restent temporaires.

Sur le reverse proxy, conserve l’en-tête `Upgrade`/`Connection` pour WebSockets et autorise les connexions WebSocket sécurisées (`wss://`) sur le chemin `/peerjs`. Le site, l’API, OAuth et PeerJS sont prévus pour partager la même origine HTTPS. Si tu les sépares, configure les origines autorisées et le retour OAuth avant le déploiement.

## 7. Données et sécurité

- `users` : profils, préférences, identifiants Google et mots de passe hachés avec bcrypt ;
- `friendships` : demandes et relations d’amitié ;
- `matches` : historique des parties terminées ;
- `avatars.files` et `avatars.chunks` : avatars stockés avec GridFS.
- Les sessions utilisent un cookie HTTP-only signé, limité à 14 jours ; HTTPS est requis en production.
- Les mots de passe MongoDB, le secret JWT et le secret client Google restent uniquement sur le serveur.
- Limite l’accès réseau MongoDB et garde `APP_ORIGINS` limité aux domaines utilisés.
- Les avatars sont limités à JPG, PNG ou WebP et à 3 Mo.
