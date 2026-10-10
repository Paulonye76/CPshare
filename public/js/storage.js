// Where received bytes go. Preferred: the browser's private on-disk file system
// (OPFS) so large files never sit in RAM. Fallback: in-memory Blob parts, which
// is limited. OPFS needs a secure context (HTTPS or localhost).
export const MEMORY_LIMIT_BYTES = 1024 ** 3; // 1 GiB per file in fallback mode
const DIR = 'cp-share';

export function opfsSupported() {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === 'function' &&
    typeof FileSystemFileHandle !== 'undefined' &&
    'createWritable' in FileSystemFileHandle.prototype
  );
}

export async function storageMode(pref = 'auto') {
  if (pref !== 'memory' && opfsSupported()) {
    try {
      await navigator.storage.getDirectory();
      return 'opfs';
    } catch {
      /* fall through */
    }
  }
  return 'memory';
}

export async function estimateFree() {
  try {
    const e = await navigator.storage.estimate();
    if (e && e.quota) return e.quota - (e.usage || 0);
  } catch {
    /* unknown */
  }
  return null;
}

async function stagingDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

/** Remove leftovers from earlier sessions (older than maxAgeMs). Safe to call at startup. */
export async function cleanupStaging(maxAgeMs = 6 * 3600 * 1000) {
  if (!opfsSupported()) return;
  try {
    const dir = await stagingDir();
    for await (const [name, handle] of dir.entries()) {
      try {
        const f = await handle.getFile();
        if (Date.now() - f.lastModified > maxAgeMs) await dir.removeEntry(name);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/** Returns {write(u8), close()->Blob, abort(), release()} */
export async function openSink({ mode, type }) {
  if (mode === 'opfs') {
    const dir = await stagingDir();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fh = await dir.getFileHandle(id, { create: true });
    const w = await fh.createWritable();
    return {
      write: (u8) => w.write(u8),
      close: async () => {
        await w.close();
        return fh.getFile();
      },
      abort: async () => {
        try { await w.abort(); } catch { /* ignore */ }
        try { await dir.removeEntry(id); } catch { /* ignore */ }
      },
      release: async () => {
        try { await dir.removeEntry(id); } catch { /* ignore */ }
      },
    };
  }
  let parts = [];
  return {
    write: async (u8) => { parts.push(u8); },
    close: async () => {
      const b = new Blob(parts, { type: type || 'application/octet-stream' });
      parts = [];
      return b;
    },
    abort: async () => { parts = []; },
    release: async () => {},
  };
}

/** Save a Blob/File through the browser's normal download mechanism. Never opens/executes it. */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
