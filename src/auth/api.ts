export interface UserPreferences {
  language: 'fr' | 'en' | 'es' | 'de' | 'pt';
  sound: boolean;
  reducedMotion: boolean;
  friendRequests: boolean;
  game: {
    size: number;
    turnLimit: number;
    difficulty: 'chill' | 'sharp' | 'ruthless';
    playerCount: number;
  };
}

export interface BoxUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  hasPassword: boolean;
  preferences: UserPreferences;
  stats: { games: number; wins: number; boxes: number };
  createdAt: string;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  stats: { games: number; wins: number; boxes: number };
}

export interface Friendship {
  id: string;
  status: 'pending' | 'accepted';
  direction: 'incoming' | 'outgoing';
  user: PublicUser;
  updatedAt: string;
}

export interface CloudMatch {
  _id: string;
  mode: 'local' | 'online';
  size: number;
  names: string[];
  scores: number[];
  myIndex: number;
  won: boolean;
  createdAt: string;
}

const configuredBase = import.meta.env.VITE_API_URL?.replace(/\/$/, '');

function apiCandidates() {
  if (configuredBase) return [configuredBase];
  const sameOrigin = `${window.location.origin}/api`;
  const localApi = `${window.location.protocol}//${window.location.hostname}:8787/api`;
  // Vite preview (4173) and the dev server (5173) do not serve Express routes.
  return ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? [localApi, sameOrigin]
    : [sameOrigin];
}

export const API_BASE = apiCandidates()[0];

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let lastError: unknown;
  const bases = apiCandidates();
  for (const base of bases) {
    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers,
        credentials: 'include',
      });
      const type = response.headers.get('content-type') || '';
      // A static Vite server answers unknown /api routes with HTML/404. Try the API candidate.
      if (response.status === 404 && !type.includes('application/json') && base !== bases[bases.length - 1])
        continue;
      if (!response.ok) {
        const data = type.includes('application/json') ? await response.json().catch(() => ({})) : {};
        throw new ApiError(
          data.error || (response.status === 404 ? 'API_UNAVAILABLE' : `HTTP_${response.status}`),
          response.status,
        );
      }
      if (response.status === 204) return undefined as T;
      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      lastError = error;
    }
  }
  throw lastError || new ApiError('API_UNAVAILABLE', 503);
}

export function avatarSrc(url: string) {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  return `${API_BASE.replace(/\/api$/, '')}${url}`;
}

export const ERROR_LABELS: Record<string, string> = {
  INVALID_EMAIL: 'Adresse email invalide.',
  INVALID_USERNAME: 'Le pseudo doit contenir 3 à 14 lettres, chiffres, - ou _.',
  WEAK_PASSWORD: 'Le mot de passe doit contenir au moins 8 caractères.',
  EMAIL_TAKEN: 'Cette adresse email est déjà utilisée.',
  USERNAME_TAKEN: 'Ce pseudo est déjà pris.',
  INVALID_CREDENTIALS: 'Email ou mot de passe incorrect.',
  PASSWORD_NOT_SET: 'Ce compte n’a pas encore de mot de passe. Connecte-toi avec Google ou définis-en un depuis une session active.',
  GOOGLE_NOT_CONFIGURED: 'La connexion Google n’est pas encore configurée sur le serveur.',
  GOOGLE_AUTH_FAILED: 'La connexion Google a échoué ou a été annulée. Réessaie.',
  IMAGE_TOO_LARGE: 'La photo dépasse la taille autorisée (3 Mo).',
  INVALID_IMAGE: 'Choisis une image JPG, PNG ou WebP.',
  REQUESTS_DISABLED: 'Ce joueur n’accepte pas les demandes d’amis.',
  CANNOT_ADD_SELF: 'Tu ne peux pas t’ajouter toi-même.',
  SERVER_ERROR: 'Le serveur a rencontré un problème. Réessaie.',
  API_UNAVAILABLE: 'Le service de compte n’est pas démarré. Lance l’API Box sur le port 8787.',
  HTTP_404: 'Le service de compte est introuvable.',
  NETWORK: 'Le serveur est indisponible. Vérifie ta connexion.',
};

export function errorLabel(error: unknown) {
  if (error instanceof ApiError) return ERROR_LABELS[error.code] || error.code;
  return ERROR_LABELS.NETWORK;
}