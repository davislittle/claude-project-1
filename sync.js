/**
 * AppSync — shared Supabase sync helper for all dashboard pages.
 *
 * API:
 *   AppSync.get(key)                   → parsed value from localStorage
 *   AppSync.set(key, value)            → write to localStorage + Supabase
 *   AppSync.del(key)                   → remove from localStorage + Supabase
 *   AppSync.pushRaw(key, rawJson)      → push a pre-serialized string to Supabase
 *   AppSync.pull({ keys, prefixes,     → load from Supabase on page init
 *                  apply, onUpdate })
 *   AppSync.pullRaw(keys)              → low-level: returns { data, error }
 *   AppSync.isEmpty(val)               → true when val has no meaningful data
 */
const AppSync = (() => {
  const SB_URL = 'https://onggaqxuriybodtyavsd.supabase.co';
  const SB_KEY = 'sb_publishable__D6jwlREF6WQiFeFZe6j1A_0N59qzPr';
  const TABLE  = 'app_state';

  let _db = null;
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    try { _db = window.supabase.createClient(SB_URL, SB_KEY); } catch(e) {}
  }

  /**
   * True when val carries no meaningful data:
   *   null/undefined → empty, [] → empty, {} with all-empty values → empty,
   *   0 / '' / false → empty (scalars treated as empty unless truthy).
   */
  function isEmpty(val) {
    if (val == null) return true;
    if (Array.isArray(val)) return val.length === 0;
    if (typeof val === 'object') return Object.values(val).every(isEmpty);
    return !val;
  }

  /** Read one key from localStorage (parsed). Returns null if missing or unparseable. */
  function get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? null : JSON.parse(raw);
    } catch(e) { return null; }
  }

  /** Write to localStorage AND push to Supabase. */
  function set(key, value) {
    const raw = JSON.stringify(value);
    try { localStorage.setItem(key, raw); } catch(e) {}
    _upsert(key, raw);
  }

  /** Remove from localStorage AND delete from Supabase. */
  function del(key) {
    localStorage.removeItem(key);
    if (!_db) return;
    _db.from(TABLE).delete().eq('id', key)
      .then(({ error }) => { if (error) console.error('[AppSync] delete failed:', key, error.message); });
  }

  /**
   * Push a pre-serialized JSON string to Supabase.
   * Use when the caller already has the raw string (e.g. localStorage.getItem result,
   * or a manually built JSON string for consolidated rows).
   */
  function pushRaw(key, rawJson) {
    _upsert(key, rawJson);
  }

  /**
   * Pull page data from Supabase on load, merge into localStorage.
   *
   * @param {object}   opts
   * @param {string[]} [opts.keys]     Exact Supabase row IDs to fetch.
   * @param {string[]} [opts.prefixes] Fetch all rows whose id starts with one of these.
   * @param {Function} [opts.apply]    Custom callback: (id, parsedValue) → boolean.
   *                                   Return true  = wrote to localStorage.
   *                                   Return false = remote was empty, push local up.
   *                                   Omit for default isEmpty-based logic.
   * @param {Function} [opts.onUpdate] Called once after remote data updated localStorage.
   * @returns {Promise<void>}
   */
  async function pull({ keys = [], prefixes = [], apply = null, onUpdate = null } = {}) {
    if (!_db || (!keys.length && !prefixes.length)) return;
    try {
      // Choose the most efficient query based on what was requested.
      let query = _db.from(TABLE).select('id, value');
      if (keys.length && !prefixes.length) {
        query = query.in('id', keys);
      } else if (!keys.length && prefixes.length === 1) {
        query = query.like('id', prefixes[0] + '%');
      }
      // Mixed (keys + prefixes): fetch all, filter client-side. Table is tiny.

      const { data, error } = await query;
      if (error) {
        console.error('[AppSync] pull failed:', error.message);
        _pushAllLocal(keys, prefixes);
        return;
      }

      const rows = (data || []).filter(r => _isRelevant(r.id, keys, prefixes));
      const seenIds = new Set(rows.map(r => r.id));
      let changed = false;

      for (const row of rows) {
        try {
          const parsed = row.value != null ? JSON.parse(row.value) : null;
          if (apply) {
            const wrote = apply(row.id, parsed);
            if (wrote) changed = true;
            else _upsert(row.id, localStorage.getItem(row.id));
          } else {
            if (isEmpty(parsed)) {
              _upsert(row.id, localStorage.getItem(row.id));
            } else if (localStorage.getItem(row.id) !== row.value) {
              localStorage.setItem(row.id, row.value);
              changed = true;
            }
          }
        } catch(e) {
          _upsert(row.id, localStorage.getItem(row.id));
        }
      }

      // Seed Supabase with any local keys it doesn't have yet.
      _getAllLocalKeys(keys, prefixes).forEach(k => {
        if (!seenIds.has(k)) _upsert(k, localStorage.getItem(k));
      });

      if (changed && onUpdate) onUpdate();
    } catch(e) {
      console.error('[AppSync] pull exception:', e);
    }
  }

  /**
   * Low-level fetch: returns the raw { data, error } from Supabase for specific keys.
   * Use when page-specific logic (e.g. consolidated row mapping) prevents using pull().
   */
  async function pullRaw(keys) {
    if (!_db) return { data: [], error: null };
    return _db.from(TABLE).select('id, value').in('id', keys);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  function _upsert(key, rawJson) {
    if (!_db || rawJson == null) return;
    _db.from(TABLE)
      .upsert({ id: key, value: rawJson }, { onConflict: 'id' })
      .then(({ error }) => { if (error) console.error('[AppSync] write failed:', key, error.message); });
  }

  function _isRelevant(id, keys, prefixes) {
    if (keys.includes(id)) return true;
    return prefixes.some(p => id.startsWith(p));
  }

  function _getAllLocalKeys(keys, prefixes) {
    const result = new Set(keys.filter(k => localStorage.getItem(k) != null));
    if (prefixes.length) {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && prefixes.some(p => k.startsWith(p))) result.add(k);
      }
    }
    return [...result];
  }

  function _pushAllLocal(keys, prefixes) {
    _getAllLocalKeys(keys, prefixes).forEach(k => _upsert(k, localStorage.getItem(k)));
  }

  return { get, set, del, pushRaw, pull, pullRaw, isEmpty };
})();
