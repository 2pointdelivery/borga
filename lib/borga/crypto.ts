'use client';

/**
 * End-to-end encryption helpers for live chat.
 *
 * Model: each user generates an ECDH P-256 keypair on-device. The public key
 * is shared with peers; both sides derive the same AES-GCM-256 key via ECDH.
 * Only ciphertext + IV are ever persisted or transmitted. Plaintext exists
 * exclusively in the memory of the participants' browsers.
 */

const IDENTITY_KEY = 'borga-e2e-identity';

export interface StoredIdentity {
  userId: string;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  fingerprint: string;
}

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function fingerprintOf(jwk: JsonWebKey): Promise<string> {
  if (!jwk.x || !jwk.y) return 'unknown';
  const data = new TextEncoder().encode(`${jwk.x}|${jwk.y}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
}

export async function getIdentity(userId: string): Promise<StoredIdentity | null> {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (raw) return JSON.parse(raw) as StoredIdentity;
  } catch { /* fall through */ }

  try {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const identity: StoredIdentity = {
      userId,
      privateJwk,
      publicJwk,
      fingerprint: await fingerprintOf(publicJwk),
    };
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
    return identity;
  } catch {
    return null;
  }
}

export async function resetIdentity(): Promise<void> {
  try {
    localStorage.removeItem(IDENTITY_KEY);
  } catch { /* ignore */ }
}

/** Derive the shared symmetric key between me and a peer. */
export async function deriveSharedKey(
  myPrivateJwk: JsonWebKey,
  peerPublicJwk: JsonWebKey,
): Promise<CryptoKey | null> {
  try {
    const priv = await crypto.subtle.importKey('jwk', myPrivateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
    const pub = await crypto.subtle.importKey('jwk', peerPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
    return await crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}

export interface SealedPayload {
  ciphertext: string;
  iv: string;
}

export async function seal(key: CryptoKey, text: string): Promise<SealedPayload | null> {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder().encode(text);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
    return { ciphertext: toB64(ct), iv: toB64(iv.buffer as ArrayBuffer) };
  } catch {
    return null;
  }
}

export async function open(key: CryptoKey, payload: SealedPayload): Promise<string> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(payload.iv) },
      key,
      fromB64(payload.ciphertext),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return '🔒 Unable to decrypt this message with your current keys.';
  }
}

/**
 * Deterministic peer public key for demo contacts without a device of their
 * own: one stable ECDH keypair per contact id is generated locally and
 * persisted, so the local user can still exercise the full encrypt/decrypt
 * path end-to-end. In a real deployment the peer publishes their own JWK.
 */
export async function derivePeerPublicJwk(contactId: string): Promise<JsonWebKey | null> {
  try {
    const storeKey = `borga-peer-key::${contactId}`;
    const cached = localStorage.getItem(storeKey);
    if (cached) return JSON.parse(cached) as JsonWebKey;
    const fresh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const jwk = await crypto.subtle.exportKey('jwk', fresh.publicKey);
    localStorage.setItem(storeKey, JSON.stringify(jwk));
    return jwk;
  } catch {
    return null;
  }
}
