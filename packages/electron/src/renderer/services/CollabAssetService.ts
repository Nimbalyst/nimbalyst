import type { UploadedEditorAsset } from '@nimbalyst/runtime';
import type { CollabDocumentConfig } from '../utils/collabDocumentOpener';
import { buildCollabAssetUri, parseCollabAssetUri } from '../utils/collabAssetUri';

const HEADER_IV = 'X-Collab-Asset-Iv';
const HEADER_METADATA = 'X-Collab-Asset-Metadata';
const HEADER_METADATA_IV = 'X-Collab-Asset-Metadata-Iv';
const HEADER_MIME = 'X-Collab-Asset-Mime-Type';
const HEADER_PLAINTEXT_SIZE = 'X-Collab-Asset-Plaintext-Size';
const PREVIEWABLE_MIME_PREFIXES = ['image/', 'text/'];
const PREVIEWABLE_MIME_TYPES = new Set(['application/pdf']);
const OBJECT_URL_REVOKE_DELAY_MS = 60_000;

interface AssetMetadataPayload {
  name?: string;
}

interface FetchedAsset {
  blob: Blob;
  fileName: string;
  mimeType: string;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let result = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    result += String.fromCharCode(...chunk);
  }
  return btoa(result);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getApiBase(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function getAssetEndpoint(apiBase: string, documentId: string, assetId: string): string {
  return `${apiBase}/api/collab/docs/${encodeURIComponent(documentId)}/assets/${encodeURIComponent(assetId)}`;
}

async function encryptBytes(
  bytes: Uint8Array,
  key: CryptoKey
): Promise<{ ciphertext: Uint8Array; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes as BufferSource);
  return {
    ciphertext: new Uint8Array(encrypted),
    iv: uint8ArrayToBase64(iv),
  };
}

async function decryptBytes(
  ciphertext: ArrayBuffer,
  ivBase64: string,
  key: CryptoKey
): Promise<Uint8Array> {
  const iv = base64ToUint8Array(ivBase64);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertext);
  return new Uint8Array(decrypted);
}

async function encryptMetadata(
  metadata: AssetMetadataPayload,
  key: CryptoKey
): Promise<{ encryptedMetadata: string; metadataIv: string }> {
  const plaintext = new TextEncoder().encode(JSON.stringify(metadata));
  const { ciphertext, iv } = await encryptBytes(plaintext, key);
  return {
    encryptedMetadata: uint8ArrayToBase64(ciphertext),
    metadataIv: iv,
  };
}

async function decryptMetadata(
  encryptedMetadata: string | null,
  metadataIv: string | null,
  key: CryptoKey
): Promise<AssetMetadataPayload | null> {
  if (!encryptedMetadata || !metadataIv) {
    return null;
  }

  const ciphertext = base64ToUint8Array(encryptedMetadata);
  const plaintext = await decryptBytes(ciphertext.buffer as ArrayBuffer, metadataIv, key);
  return JSON.parse(new TextDecoder().decode(plaintext)) as AssetMetadataPayload;
}

function shouldPreviewInline(mimeType: string): boolean {
  return PREVIEWABLE_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix))
    || PREVIEWABLE_MIME_TYPES.has(mimeType);
}

export class CollabAssetService {
  private readonly apiBase: string;
  private readonly objectUrlCache = new Map<string, string>();
  private readonly imageUrlPromiseCache = new Map<string, Promise<string>>();

  constructor(private readonly config: CollabDocumentConfig) {
    this.apiBase = getApiBase(config.serverUrl);
  }

  dispose(): void {
    for (const url of this.objectUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.objectUrlCache.clear();
    this.imageUrlPromiseCache.clear();
  }

  async uploadFile(file: File): Promise<UploadedEditorAsset> {
    const assetId = crypto.randomUUID();
    const endpoint = getAssetEndpoint(this.apiBase, this.config.documentId, assetId);
    const authToken = await this.config.getJwt();
    const plaintextBytes = new Uint8Array(await file.arrayBuffer());
    const { ciphertext, iv } = await encryptBytes(plaintextBytes, this.config.documentKey);
    const { encryptedMetadata, metadataIv } = await encryptMetadata({ name: file.name }, this.config.documentKey);
    const mimeType = file.type || 'application/octet-stream';

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${authToken}`,
        [HEADER_IV]: iv,
        [HEADER_METADATA]: encryptedMetadata,
        [HEADER_METADATA_IV]: metadataIv,
        [HEADER_MIME]: mimeType,
        [HEADER_PLAINTEXT_SIZE]: String(plaintextBytes.byteLength),
      },
      body: ciphertext as BodyInit,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Attachment upload failed (${response.status})`);
    }

    return {
      kind: mimeType.startsWith('image/') ? 'image' : 'file',
      src: buildCollabAssetUri(this.config.documentId, assetId),
      name: file.name,
      altText: file.name,
    };
  }

  async resolveImageSrc(src: string): Promise<string | null> {
    const parsed = parseCollabAssetUri(src);
    if (!parsed) {
      return null;
    }

    const cached = this.objectUrlCache.get(src);
    if (cached) {
      return cached;
    }

    const inflight = this.imageUrlPromiseCache.get(src);
    if (inflight) {
      return inflight;
    }

    const promise = this.fetchAsset(src).then(({ blob }) => {
      const objectUrl = URL.createObjectURL(blob);
      this.objectUrlCache.set(src, objectUrl);
      this.imageUrlPromiseCache.delete(src);
      return objectUrl;
    }).catch(error => {
      this.imageUrlPromiseCache.delete(src);
      throw error;
    });

    this.imageUrlPromiseCache.set(src, promise);
    return promise;
  }

  async openAssetLink(href: string): Promise<void> {
    const parsed = parseCollabAssetUri(href);
    if (!parsed) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }

    const { blob, fileName, mimeType } = await this.fetchAsset(href);
    const objectUrl = URL.createObjectURL(blob);

    if (shouldPreviewInline(mimeType)) {
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_REVOKE_DELAY_MS);
      return;
    }

    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener noreferrer';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  private async fetchAsset(uri: string): Promise<FetchedAsset> {
    const parsed = parseCollabAssetUri(uri);
    if (!parsed) {
      throw new Error(`Invalid collaborative asset URI: ${uri}`);
    }

    const endpoint = getAssetEndpoint(this.apiBase, parsed.documentId, parsed.assetId);
    const authToken = await this.config.getJwt();
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Attachment fetch failed (${response.status})`);
    }

    const iv = response.headers.get(HEADER_IV);
    if (!iv) {
      throw new Error('Attachment response missing IV header');
    }

    const mimeType = response.headers.get(HEADER_MIME) || 'application/octet-stream';
    const encryptedMetadata = response.headers.get(HEADER_METADATA);
    const metadataIv = response.headers.get(HEADER_METADATA_IV);
    const metadata = await decryptMetadata(encryptedMetadata, metadataIv, this.config.documentKey);
    const ciphertext = await response.arrayBuffer();
    const plaintext = await decryptBytes(ciphertext, iv, this.config.documentKey);

    return {
      blob: new Blob([plaintext as BlobPart], { type: mimeType }),
      fileName: metadata?.name || `${parsed.assetId}.bin`,
      mimeType,
    };
  }
}
