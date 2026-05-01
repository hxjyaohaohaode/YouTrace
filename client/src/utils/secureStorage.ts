function getKey(): string {
  const stored = localStorage.getItem('_ek');
  if (stored) return stored;
  const key = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  localStorage.setItem('_ek', key);
  return key;
}

async function getSubtleKey(): Promise<CryptoKey> {
  const keyStr = getKey();
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyStr.slice(0, 32));
  return crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function isSecureContext(): boolean {
  return window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost';
}

async function encryptData(plaintext: string): Promise<string> {
  if (!isSecureContext()) {
    console.warn('[SecureStorage] Non-secure context detected. Token storage may be less secure.');
  }
  const key = await getSubtleKey();
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptData(encrypted: string): Promise<string | null> {
  try {
    const key = await getSubtleKey();
    const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

const TOKEN_KEY = 'youji_auth';
const USER_KEY = 'youji_user_data';

export async function setSecureToken(token: string): Promise<void> {
  const encrypted = await encryptData(token);
  localStorage.setItem(TOKEN_KEY, encrypted);
}

export async function getSecureToken(): Promise<string | null> {
  const encrypted = localStorage.getItem(TOKEN_KEY);
  if (!encrypted) return null;
  return decryptData(encrypted);
}

export async function setUserData(user: unknown): Promise<void> {
  const json = JSON.stringify(user);
  const encrypted = await encryptData(json);
  localStorage.setItem(USER_KEY, encrypted);
}

export async function getUserData(): Promise<unknown | null> {
  const encrypted = localStorage.getItem(USER_KEY);
  if (!encrypted) return null;
  const decrypted = await decryptData(encrypted);
  if (!decrypted) return null;
  try {
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

export function clearAuthData(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
