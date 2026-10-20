// Minimal IndexedDB key/value store for the playlist and the EPG (too big for localStorage).
let dbp;
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('vysielac', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
function tx(mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction('kv', mode);
    const req = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
export const idbGet = key => tx('readonly', s => s.get(key)).catch(() => undefined);
export const idbSet = (key, val) => tx('readwrite', s => s.put(val, key));
export const idbDel = key => tx('readwrite', s => s.delete(key)).catch(() => {});
