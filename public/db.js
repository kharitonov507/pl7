export function openStore(deviceId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`dooh-player-${deviceId}`, 1);
    request.onupgradeneeded = () => {
      for (const name of ['meta', 'assets', 'events']) request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function storeAction(db, store, action, ...args) {
  return new Promise((resolve, reject) => {
    const write = ['put', 'delete', 'clear'].includes(action);
    const tx = db.transaction(store, write ? 'readwrite' : 'readonly');
    const request = tx.objectStore(store)[action](...args);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}
