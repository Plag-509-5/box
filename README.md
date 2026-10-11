# Box — par Plag

Box est un jeu de fermeture de carrés, jouable en local ou avec des amis en ligne. L’application comprend un client React/Vite, une API Express et un serveur de signalisation PeerJS auto-hébergé.

## Démarrage rapide

1. Installe Node.js 22.12+ et prépare MongoDB Atlas.
2. Copie `.env.example` vers `.env`, puis renseigne `MONGODB_URI` et `JWT_SECRET`.
3. Lance `npm ci`, puis `npm run dev`.
4. Ouvre `http://localhost:8787`.

La connexion Google est optionnelle et s’active en configurant `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et `GOOGLE_REDIRECT_URI` dans l’environnement privé du serveur. Les comptes, OAuth, Docker et le déploiement sont détaillés dans [DEPLOYMENT.md](./DEPLOYMENT.md).

Le serveur PeerJS intégré fournit la signalisation des parties en ligne sur `/peerjs`. Les données de jeu circulent ensuite directement entre joueurs via WebRTC ; un serveur TURN/Coturn peut être nécessaire pour certains réseaux.

## Installer sur un téléphone

Box peut être installée comme une **PWA** (application web) depuis une adresse HTTPS : déploie d’abord l’application, ouvre son URL sur le téléphone, puis choisis **Installer l’application** dans Chrome (Android) ou **Partager → Sur l’écran d’accueil** dans Safari (iPhone). La PWA met en cache l’interface pour permettre de lancer le jeu local hors ligne ; les comptes et les parties en ligne nécessitent toujours Internet.
