/*
 * A extração abaixo deriva do projeto MIT
 * marcoscarraro/whatsapp-session-extractor.
 * Ela só é executada após consentimento explícito, em web.whatsapp.com, e o
 * resultado não é salvo, copiado para a área de transferência nem baixado.
 */

const bufferValue = (base64) => ({ type: 'Buffer', data: base64 });

function decodeBase64(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

function encodeBase64(bytes) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

async function selectNoiseCandidate(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) {
    throw new Error('NOISE_KEY_MISSING');
  }

  const basePoint = new Uint8Array(32);
  basePoint[0] = 9;
  const baseKey = await crypto.subtle.importKey(
    'raw',
    basePoint,
    { name: 'X25519' },
    false,
    [],
  );

  for (const candidate of candidates) {
    try {
      const privateRaw = decodeBase64(candidate.private);
      const expectedPublic = decodeBase64(candidate.public);
      if (privateRaw.length !== 32 || expectedPublic.length !== 32) continue;

      const header = Uint8Array.from([
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
        0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
      ]);
      const pkcs8 = new Uint8Array(header.length + privateRaw.length);
      pkcs8.set(header);
      pkcs8.set(privateRaw, header.length);
      const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        pkcs8,
        { name: 'X25519' },
        false,
        ['deriveBits'],
      );
      const derived = new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'X25519', public: baseKey },
        privateKey,
        256,
      ));
      if (
        derived.length === expectedPublic.length &&
        derived.every((byte, index) => byte === expectedPublic[index])
      ) {
        return candidate;
      }
    } catch {
      // Candidato inválido: continua apenas na validação local.
    }
  }

  throw new Error('NOISE_KEY_NOT_VALIDATED');
}

function signalPublicKey(base64) {
  const raw = decodeBase64(base64);
  const prefixed = new Uint8Array(raw.length + 1);
  prefixed[0] = 5;
  prefixed.set(raw, 1);
  return encodeBase64(prefixed);
}

export async function buildEvolutionCredsJson(data) {
  if (!data?.identityKey || !data?.account || !data?.signedPreKey || !data?.id) {
    throw new Error('SESSION_DATA_INCOMPLETE');
  }

  const noise = await selectNoiseCandidate(data.noiseCandidates);
  const ephemeral = data.pairingEphemeralKeyPair;
  const signedPreKey = data.signedPreKey;
  const phone = String(data.id).match(/^(\d{8,15})(?::\d+)?@/)?.[1];
  if (!phone) throw new Error('PHONE_NOT_DETECTED');

  const creds = {
    noiseKey: {
      private: bufferValue(noise.private),
      public: bufferValue(noise.public),
    },
    pairingEphemeralKeyPair: ephemeral
      ? {
          private: bufferValue(ephemeral.private),
          public: bufferValue(ephemeral.public),
        }
      : null,
    signedIdentityKey: {
      private: bufferValue(data.identityKey.private),
      public: bufferValue(data.identityKey.public),
    },
    signedPreKey: {
      keyPair: {
        private: bufferValue(signedPreKey.private),
        public: bufferValue(signedPreKey.public),
      },
      signature: bufferValue(signedPreKey.signature),
      keyId: signedPreKey.keyId,
    },
    registrationId: data.registrationId,
    advSecretKey: data.advSecretKey,
    processedHistoryMessages: [],
    nextPreKeyId: 1,
    firstUnuploadedPreKeyId: 1,
    accountSyncCounter: 0,
    accountSettings: { unarchiveChats: false },
    registered: true,
    account: {
      details: bufferValue(data.account.details),
      accountSignatureKey: bufferValue(data.account.accountSignatureKey),
      accountSignature: bufferValue(data.account.accountSignature),
      deviceSignature: bufferValue(data.account.deviceSignature),
    },
    me: {
      id: data.id,
      name: data.pushName || '',
      lid: data.lid || null,
    },
    signalIdentities: data.lid
      ? [{
          identifier: {
            name: data.lid.replace('@s.whatsapp.net', '@lid'),
            deviceId: 0,
          },
          identifierKey: bufferValue(
            signalPublicKey(data.account.accountSignatureKey),
          ),
        }]
      : [],
    platform: data.platform || 'android',
    routingInfo: data.routingInfo ? bufferValue(data.routingInfo) : null,
    lastAccountSyncTimestamp: 0,
    myAppStateKeyId: null,
    reachoutTimeLock: { isActive: false, enforcementType: 'DEFAULT' },
    lastPropHash: null,
  };

  const inner = JSON.stringify(creds);
  return {
    credsJson: JSON.stringify(inner),
    detectedPhone: phone,
  };
}

export function extractWhatsAppSession() {
  return (async () => {
    const b64 = (bytes) => {
      const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes)
        : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : new Uint8Array(bytes);
      let s = ''; for (const x of arr) s += String.fromCharCode(x); return btoa(s);
    };
    const fromB64 = (v) => Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
    const ls = (k) => localStorage.getItem(k);
    const lsj = (k) => { const v = ls(k); if (v == null) return null; try { return JSON.parse(v); } catch { return v; } };

    const getRecord = (dbName, storeName, key) => new Promise((res, rej) => {
      const r = indexedDB.open(dbName);
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const db = r.result; const tx = db.transaction(storeName, 'readonly');
        const g = tx.objectStore(storeName).get(key);
        g.onsuccess = () => { db.close(); res(g.result); };
        g.onerror = () => { db.close(); rej(g.error); };
      };
    });

    const getAllRecords = (dbName, storeName) => new Promise((res, rej) => {
      const r = indexedDB.open(dbName);
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const db = r.result; const tx = db.transaction(storeName, 'readonly');
        const g = tx.objectStore(storeName).getAll();
        g.onsuccess = () => { db.close(); res(g.result || []); };
        g.onerror = () => { db.close(); rej(g.error); };
      };
    });

    // AES-CTR (contador zero) — mesmo esquema que o WhatsApp Web usa para os
    // campos privados guardados junto de um `encKey` (identidade estática, etc.).
    const decCtr = (encKey, valueBuf) => crypto.subtle.decrypt(
      { name: 'AES-CTR', counter: new Uint8Array(16), length: 64 }, encKey, valueBuf);

    // Devolve um campo do IndexedDB em base64, decriptando se vier no formato
    // { encKey, value }; caso contrário trata como bytes crus (públicos).
    const maybeField = async (f) => {
      if (f && f.encKey && f.value) return b64(await decCtr(f.encKey, f.value));
      return b64(f);
    };

    // Gera um par efêmero X25519 (pairingEphemeralKeyPair). Só precisa existir e
    // ser bem-tipado — não é usado após o pareamento. Fallback: bytes aleatórios.
    const genX25519 = async () => {
      try {
        const kp = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
        const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
        const pk8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
        return { private: b64(pk8.slice(pk8.length - 32)), public: b64(pub) };
      } catch {
        return {
          private: b64(crypto.getRandomValues(new Uint8Array(32))),
          public: b64(crypto.getRandomValues(new Uint8Array(32))),
        };
      }
    };

    // Detecção best-effort da versão do WhatsApp Web (multi-fonte, com fallback null).
    const detectWaVersion = () => {
      const semver = /\d+\.\d+\.\d+(?:\.\d+)?/;
      try {
        const v = window.Debug && window.Debug.VERSION;
        if (v && semver.test(String(v))) return String(v).match(semver)[0];
      } catch { /* ignore */ }
      try {
        const meta = document.querySelector('meta[name="version"]');
        if (meta && meta.content && semver.test(meta.content)) return meta.content.match(semver)[0];
      } catch { /* ignore */ }
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !/version/i.test(k)) continue;
          const val = localStorage.getItem(k) || '';
          const m = val.match(semver);
          if (m) return m[0];
        }
      } catch { /* ignore */ }
      return null;
    };

    try {
      // ---- Noise keypair: candidatos (o whatsmeow escolhe o válido via priv->pub) ----
      const dbKey = (await getRecord('wawc_db_enc', 'keys', 1)).key; // CryptoKey não-extraível
      const salt = fromB64(lsj('WAWebEncKeySalt'));
      const ivs = (lsj('WANoiseInfoIv') || []).map(fromB64);
      const noise = lsj('WANoiseInfo');
      const noisePriv = fromB64(noise.privKey), noisePub = fromB64(noise.pubKey);
      const noiseCandidates = [];
      for (let i = 0; i < ivs.length; i++) for (let j = 0; j < ivs.length; j++) {
        try {
          const key = await crypto.subtle.deriveKey(
            { name: 'HKDF', hash: 'SHA-256', salt, info: new Uint8Array([0]) },
            dbKey, { name: 'AES-CBC', length: 128 }, false, ['decrypt']);
          const pv = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivs[i] }, key, noisePriv);
          const pb = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivs[j] }, key, noisePub);
          if (pv.byteLength === 32 && pb.byteLength === 32)
            noiseCandidates.push({ private: b64(pv), public: b64(pb) });
        } catch { /* combinação de IV inválida */ }
      }

      // ---- Identidade Signal estática (AES-CTR com o encKey do próprio registro) ----
      const decStatic = async (name) => {
        const rec = await getRecord('signal-storage', 'signal-meta-store', name);
        const pt = await decCtr(rec.value.encKey, rec.value.value);
        if (pt.byteLength !== 32) throw new Error(name + ' tamanho inesperado ' + pt.byteLength);
        return b64(pt);
      };
      const identityKey = {
        private: await decStatic('signal_static_privkey'),
        public: await decStatic('signal_static_pubkey'),
      };

      // ---- ADV signed identity + registration id ----
      const adv = (await getRecord('signal-storage', 'signal-meta-store', 'adv_signed_identity')).value;
      const account = {
        details: b64(adv.details),
        accountSignatureKey: b64(adv.accountSignatureKey),
        accountSignature: b64(adv.accountSignature),
        deviceSignature: b64(adv.deviceSignature),
      };
      const registrationId = Number((await getRecord('signal-storage', 'signal-meta-store', 'signal_reg_id')).value);

      // ---- JIDs (companion device) ----
      const norm = (v) => (v == null ? null : String(v).replace('@c.us', '@s.whatsapp.net'));
      const id = norm(lsj('last-wid-md'));
      const lid = norm(lsj('WALid'));

      // ---- Signed pre-key (signal-storage/signed-prekey-store) ----
      // Registro { keyId, keyPair:{pubKey,privKey}, signature }. Campos privados
      // podem vir cifrados ({encKey,value}) ou crus — maybeField trata os dois.
      let signedPreKey = null;
      try {
        const recs = await getAllRecords('signal-storage', 'signed-prekey-store');
        const rec = recs.length
          ? recs.reduce((a, b) => (Number(b.keyId) > Number(a.keyId) ? b : a))
          : null;
        if (rec && rec.keyPair) {
          signedPreKey = {
            keyId: Number(rec.keyId),
            private: await maybeField(rec.keyPair.privKey),
            public: await maybeField(rec.keyPair.pubKey),
            signature: await maybeField(rec.signature),
          };
          const privLen = fromB64(signedPreKey.private).length;
          const sigLen = fromB64(signedPreKey.signature).length;
          console.log('[extract] signedPreKey', { keyId: signedPreKey.keyId, privLen, sigLen });
          if (privLen !== 32) console.warn('[extract] signedPreKey.private len inesperado:', privLen);
          if (sigLen !== 64) console.warn('[extract] signedPreKey.signature len inesperado:', sigLen);
        } else {
          console.warn('[extract] signed-prekey-store vazio');
        }
      } catch (e) {
        console.warn('[extract] falha ao ler signed-prekey-store:', e);
      }

      // ---- Par efêmero de pareamento (gerado; não persistido pelo WA Web) ----
      const pairingEphemeralKeyPair = await genX25519();

      // ---- Push name (model-storage/contact do próprio JID), best-effort ----
      let pushName = null;
      try {
        const own = await getRecord('model-storage', 'contact', id);
        pushName = (own && (own.pushname || own.name)) || null;
      } catch { /* sem contato próprio */ }

      // ---- Routing info (localStorage, chave incerta), best-effort ----
      // Campo opcional no Baileys; só usamos se o valor já parecer base64,
      // para não arriscar dupla codificação. Senão fica null.
      let routingInfo = null;
      try {
        const isB64 = (s) => /^[A-Za-z0-9+/]{2,}={0,2}$/.test(s);
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && /rout/i.test(k)) {
            const raw = (ls(k) || '').trim();
            if (raw && isB64(raw)) { routingInfo = raw; break; }
          }
        }
      } catch { /* ignore */ }

      const waWebVersion = detectWaVersion();

      const out = {
        noiseCandidates, identityKey, registrationId,
        advSecretKey: noise.recoveryToken ?? null,
        account, id, lid, platform: 'android',
        signedPreKey, pairingEphemeralKeyPair, pushName, routingInfo,
        _meta: {
          waWebVersion,
          extractedAt: new Date().toISOString(),
          userAgent: navigator.userAgent,
          extractorVersion: '1.2',
        },
        _raw: { lastWidMd: ls('last-wid-md'), waLid: ls('WALid') },
      };

      const json = JSON.stringify(out, null, 2);
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15); // YYYYMMDD-HHmmss-ish
      const filename = `wa-session-${stamp.slice(0, 8)}-${stamp.slice(8)}.json`;

      console.log('%c[extract] OK', 'color:green;font-weight:bold',
        { noiseCandidates: noiseCandidates.length, id, lid, registrationId, waWebVersion,
          signedPreKey: !!signedPreKey, pushName, routingInfo: !!routingInfo });

      return { success: true, json, filename, meta: out._meta, data: out };
    } catch (error) {
      console.error('[extract] erro:', error);
      return { success: false, error: String(error && error.message ? error.message : error) };
    }
  })();
}

