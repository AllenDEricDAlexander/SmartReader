// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createVaultKey,
  decryptData,
  decryptFile,
  decryptJson,
  deriveVaultKey,
  encryptData,
  encryptFile,
  encryptJson,
} from './libraryCrypto';

describe('library encryption', () => {
  let key: CryptoKey;
  let salt: string;

  beforeAll(async () => {
    ({ key, salt } = await createVaultKey('private research password'));
  });

  it('creates independent non-exportable AES keys with random salts', async () => {
    const second = await createVaultKey('private research password');
    expect(second.salt).not.toBe(salt);
    expect(atob(salt)).toHaveLength(16);
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('rejects short new passwords and invalid salts without trimming passwords', async () => {
    await expect(createVaultKey('')).rejects.toThrow(/至少 8/);
    await expect(createVaultKey('        ')).rejects.toThrow(/至少 8/);
    await expect(createVaultKey('short')).rejects.toThrow(/至少 8/);
    await expect(deriveVaultKey('password', 'not-base64!')).rejects.toThrow(/盐/);
    await expect(deriveVaultKey('password', btoa('short'))).rejects.toThrow(/盐/);
    const spaced = await createVaultKey('  password  ');
    const encrypted = await encryptData(spaced.key, new Uint8Array([1]), 'paper:p1:metadata');
    const trimmed = await deriveVaultKey('password', spaced.salt);
    await expect(decryptData(trimmed, encrypted, 'paper:p1:metadata')).rejects.toThrow();
    // Derivation does not impose a new-password policy on an existing vault.
    await expect(deriveVaultKey('short', salt)).resolves.toBeDefined();
  });

  it('roundtrips binary and empty data with a fresh IV for every encryption', async () => {
    const bytes = new Uint8Array([0, 127, 128, 255, 37, 80, 68, 70]);
    const encrypted = await encryptData(key, bytes, 'paper:p1:metadata');
    const second = await encryptData(key, bytes, 'paper:p1:metadata');
    expect(encrypted.iv).not.toBe(second.iv);
    expect(atob(encrypted.iv)).toHaveLength(12);
    expect(encrypted.data).not.toBe(btoa(String.fromCharCode(...bytes)));
    const restored = await deriveVaultKey('private research password', salt);
    await expect(decryptData(restored, encrypted, 'paper:p1:metadata')).resolves.toEqual(bytes);
    const empty = await encryptData(key, new Uint8Array(), 'paper:p1:file');
    await expect(decryptData(key, empty, 'paper:p1:file')).resolves.toEqual(new Uint8Array());
    await expect(encryptData(key, bytes, '')).rejects.toThrow(/上下文/);
  });

  it('rejects wrong passwords, different papers or payload types, and tampered ciphertext', async () => {
    const encrypted = await encryptData(key, new Uint8Array([10, 20, 30]), 'paper:p1:metadata');
    const wrong = await deriveVaultKey('wrong password', salt);
    await expect(decryptData(wrong, encrypted, 'paper:p1:metadata')).rejects.toThrow();
    await expect(decryptData(key, encrypted, 'paper:p2:metadata')).rejects.toThrow();
    await expect(decryptData(key, encrypted, 'paper:p1:file')).rejects.toThrow();
    const modified = Uint8Array.from(atob(encrypted.data), (character) => character.charCodeAt(0));
    modified[0] ^= 1;
    await expect(decryptData(key, { ...encrypted, data: btoa(String.fromCharCode(...modified)) }, 'paper:p1:metadata')).rejects.toThrow();
    await expect(decryptData(key, { iv: btoa('short'), data: encrypted.data }, 'paper:p1:metadata')).rejects.toThrow();
    await expect(decryptData(key, { ...encrypted, data: '!!' }, 'paper:p1:metadata')).rejects.toThrow();
  });

  it('encrypts versioned binary files and rejects truncated, changed and unencrypted files', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nsecret research');
    const encrypted = await encryptFile(key, bytes, 'paper:p1:file');
    expect(encrypted).not.toEqual(bytes);
    await expect(decryptFile(key, encrypted, 'paper:p1:file')).resolves.toEqual(bytes);
    await expect(decryptFile(key, encrypted, 'paper:p2:file')).rejects.toThrow();
    await expect(decryptFile(key, encrypted.slice(0, 20), 'paper:p1:file')).rejects.toThrow();
    await expect(decryptFile(key, bytes, 'paper:p1:file')).rejects.toThrow();
    const modified = encrypted.slice();
    modified[0] ^= 1;
    await expect(decryptFile(key, modified, 'paper:p1:file')).rejects.toThrow();
    modified.set(encrypted);
    modified[modified.length - 1] ^= 1;
    await expect(decryptFile(key, modified, 'paper:p1:file')).rejects.toThrow();
    const empty = await encryptFile(key, new Uint8Array(), 'paper:p1:file');
    await expect(decryptFile(key, empty, 'paper:p1:file')).resolves.toEqual(new Uint8Array());
  });

  it('preserves Unicode JSON metadata, annotations and arrays', async () => {
    const value = { title: '认知神经科学 🧠', authors: ['张三'], annotations: [{ text: '重要段落' }] };
    const encrypted = await encryptJson(key, value, 'paper:p1:metadata');
    await expect(decryptJson<typeof value>(key, encrypted, 'paper:p1:metadata')).resolves.toEqual(value);
    await expect(encryptJson(key, undefined, 'paper:p1:metadata')).rejects.toThrow();
  });
});
