// Filenames from the other device are untrusted input.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizeFilename(raw) {
  let n = String(raw ?? '').normalize('NFC');
  n = n.split(/[\\/]/).pop();
  n = n.replace(/[\u202a-\u202e\u2066-\u2069\u200e\u200f]/g, ''); // bidi controls (extension spoofing)
  n = n.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_');
  n = n.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!n) n = 'file';
  const dot = n.lastIndexOf('.');
  let base = dot > 0 ? n.slice(0, dot) : n;
  let ext = dot > 0 ? n.slice(dot) : '';
  if (ext.length > 20) ext = ext.slice(0, 20);
  if (RESERVED.test(base)) base = '_' + base;
  const max = 180 - ext.length;
  if (base.length > max) base = base.slice(0, max);
  return base + ext;
}

/** Make `name` unique within `used` (a Set of lowercase names) and record it. */
export function uniqueName(name, used) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let cand = name;
  let i = 0;
  while (used.has(cand.toLowerCase())) {
    i += 1;
    cand = `${base} (${i})${ext}`;
  }
  used.add(cand.toLowerCase());
  return cand;
}

const RISKY = new Set(['apk', 'xapk', 'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'js', 'jar', 'sh', 'dmg', 'pkg', 'app', 'lnk', 'reg', 'iso']);
export function isRisky(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return !!m && RISKY.has(m[1].toLowerCase());
}

export function categoryOf(name, type = '') {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
  if (ext === 'apk' || ext === 'xapk') return 'App';
  if (type.startsWith('image/')) return 'Photo';
  if (type.startsWith('video/')) return 'Video';
  if (type.startsWith('audio/')) return 'Music';
  if (ext === 'pdf') return 'PDF';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'Word';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'Excel';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'PowerPoint';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'Archive';
  return 'File';
}
