import type { EncryptedData } from './libraryModels';

const iterations = 310_000;
const saltLength = 16;
const ivLength = 12;
const tagLength = 16;
const fileHeader = new Uint8Array([83, 82, 76, 73, 66, 1]);
const encoder = new TextEncoder();

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持安全加密，请在桌面应用中操作。');
  }
  return globalThis.crypto;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('加密数据格式无效。');
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function additionalData(aad: string): Uint8Array<ArrayBuffer> {
  if (typeof aad !== 'string' || !aad.trim()) {
    throw new Error('加密上下文不能为空。');
  }
  return encoder.encode(aad);
}

export async function createVaultKey(password: string): Promise<{ key: CryptoKey; salt: string }> {
  if (!password.trim() || password.length < 8) {
    throw new Error('加密密码至少 8 个字符。');
  }
  const salt = encodeBase64(webCrypto().getRandomValues(new Uint8Array(saltLength)));
  return { key: await deriveVaultKey(password, salt), salt };
}

export async function deriveVaultKey(password: string, salt: string): Promise<CryptoKey> {
  let saltBytes: Uint8Array;
  try {
    saltBytes = decodeBase64(salt);
    if (saltBytes.length !== saltLength) throw new Error('invalid salt length');
  } catch {
    throw new Error('加密盐格式无效，无法解锁。');
  }
  const crypto = webCrypto();
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(saltBytes), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptBytes(key: CryptoKey, bytes: Uint8Array, aad: string) {
  const crypto = webCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(ivLength));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(aad), tagLength: tagLength * 8 },
    key,
    new Uint8Array(bytes),
  );
  return { iv, cipher: new Uint8Array(cipher) };
}

async function decryptBytes(key: CryptoKey, iv: Uint8Array, bytes: Uint8Array, aad: string): Promise<Uint8Array> {
  const context = additionalData(aad);
  if (iv.length !== ivLength || bytes.length < tagLength) {
    throw new Error('加密数据不完整或格式无效。');
  }
  try {
    const plain = await webCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv), additionalData: context, tagLength: tagLength * 8 },
      key,
      new Uint8Array(bytes),
    );
    return new Uint8Array(plain);
  } catch (cause) {
    throw new Error('无法解密：密码错误、加密上下文不匹配或数据已损坏。', { cause });
  }
}

export async function encryptData(key: CryptoKey, bytes: Uint8Array, aad: string): Promise<EncryptedData> {
  const { iv, cipher } = await encryptBytes(key, bytes, aad);
  return { iv: encodeBase64(iv), data: encodeBase64(cipher) };
}

export async function decryptData(key: CryptoKey, encrypted: EncryptedData, aad: string): Promise<Uint8Array> {
  return decryptBytes(key, decodeBase64(encrypted.iv), decodeBase64(encrypted.data), aad);
}

export async function encryptFile(key: CryptoKey, bytes: Uint8Array, aad: string): Promise<Uint8Array> {
  const { iv, cipher } = await encryptBytes(key, bytes, aad);
  const result = new Uint8Array(fileHeader.length + iv.length + cipher.length);
  result.set(fileHeader);
  result.set(iv, fileHeader.length);
  result.set(cipher, fileHeader.length + iv.length);
  return result;
}

export async function decryptFile(key: CryptoKey, bytes: Uint8Array, aad: string): Promise<Uint8Array> {
  if (bytes.length < fileHeader.length + ivLength + tagLength || !fileHeader.every((byte, index) => bytes[index] === byte)) {
    throw new Error('加密文件格式或版本无效。');
  }
  return decryptBytes(
    key,
    bytes.subarray(fileHeader.length, fileHeader.length + ivLength),
    bytes.subarray(fileHeader.length + ivLength),
    aad,
  );
}

export function encryptJson<T>(key: CryptoKey, value: T, aad: string): Promise<EncryptedData> {
  const json = JSON.stringify(value);
  if (json === undefined) return Promise.reject(new Error('无法保存空的 JSON 数据。'));
  return encryptData(key, encoder.encode(json), aad);
}

export async function decryptJson<T>(key: CryptoKey, encrypted: EncryptedData, aad: string): Promise<T> {
  const bytes = await decryptData(key, encrypted, aad);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
}
