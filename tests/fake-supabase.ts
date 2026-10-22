// Klien Supabase palsu di memori untuk uji alur API (subset yang dipakai fungsi api).
type Row = Record<string, any>;
export const db: Record<string, Row[]> = {};
export const files = new Map<string, Uint8Array>();
let seq = 1000;
const uid = () => crypto.randomUUID().replace(/-/g, '');
const PREFIX: Record<string, string> = { rooms: 'rm_', tenants: 'tn_', invoices: 'inv_', surveys: 'srv_', owners: 'own_', leads: 'ld_', contracts: 'ctr_', waitlist: 'wl_', announcements: 'ann_', issues: 'iss_', expenses: 'exp_' };
const IDENTITY = new Set(['messages', 'notifications', 'activity_log']);
const DEFAULTS: Record<string, Row> = {
  properties: { kind: 'sendiri', status: 'aktif', periods: ['bulanan', 'tahunan'], city: '', whatsapp: '', bank_info: '', chat_enabled: true, wa_enabled: true, min_booking: 0, booking_policy: '', visit_hours: '', fee_type: null, fee_value: null, review_note: '', facilities: [], rules: [], nearby: [], photos: [], sort: 0, owner_id: null },
  rooms: { status: 'kosong', hidden: false, price_daily: 0, price_monthly: 0, price_semester: 0, price_yearly: 0, capacity: 1, extra_person_fee: 0, facilities: [], photos: [], note: '', type: '', size_m2: '', floor: '' },
  owners: { must_change: true, status: 'aktif', note: '', phone: '', email: '' },
  leads: { must_change: true, login_enabled: true, owner_read_msg: 0, customer_read_msg: 0, fee_amount: 0, reject_reason: '', cancel_reason: '', owner_message: '', dp_reject_note: '', fee_note: '', refund_reason: '', refund_account: '', refund_note: '', visit_time: '', visit_note: '', occupation: '', note: '', people: 1, duration: 1 },
  tenants: { status: 'aktif', login_enabled: false, co_name: '', co_phone: '', co_relation: '', co_occupation: '', deposit: 0, rent_cycle: 'bulanan' },
  invoices: { status: 'belum' },
  surveys: { status: 'baru' },
  activity_log: { ok: true },
  partner_applications: { status: 'baru', admin_note: '', address: '', note: '' },
  listings: { status: 'baru', description: '', price: null, price_note: '', photos: [], seller_info: '', area: '', admin_note: '', featured: false, expires_on: null, approved_at: null, ip: '' },
  places: { status: 'aktif', description: '', address: '', maps_query: '', whatsapp: '', open_hours: '', price_note: '', distance_note: '', photo: '', suggested_by: '', admin_note: '', sort: 50, ip: '' },
};
const UNIQUE: Record<string, string[]> = { leads: ['code', 'username'], owners: ['username'], properties: ['slug'] };
function fill(table: string, r: Row) {
  const now = new Date().toISOString();
  const out: Row = { ...(DEFAULTS[table] || {}), created_at: now, updated_at: now, ...r };
  if (IDENTITY.has(table) && out.id == null) out.id = ++seq;
  if (!IDENTITY.has(table) && out.id == null && table !== 'settings' && !table.endsWith('_sessions')) out.id = (PREFIX[table] || 'x_') + uid();
  return out;
}
const lower = (v: any) => String(v ?? '').toLowerCase();
class Query {
  filters: ((r: Row) => boolean)[] = []; op = 'select'; payload: any = null; orderBy: [string, boolean][] = []; lim = 0; one: 'single' | 'maybe' | null = null;
  head = false; countMode = false; returning = false; upsertOpts: Row | null = null;
  constructor(public table: string) { db[table] ||= []; }
  select(_c?: string, o?: Row) { if (this.op !== 'select') this.returning = true; if (o?.count) this.countMode = true; if (o?.head) this.head = true; return this; }
  insert(p: any) { this.op = 'insert'; this.payload = p; return this; }
  update(p: any) { this.op = 'update'; this.payload = p; return this; }
  upsert(p: any, o?: Row) { this.op = 'upsert'; this.payload = p; this.upsertOpts = o || {}; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(k: string, v: any) { this.filters.push((r) => r[k] === v); return this; }
  neq(k: string, v: any) { this.filters.push((r) => r[k] !== v); return this; }
  gt(k: string, v: any) { this.filters.push((r) => r[k] != null && r[k] > v); return this; }
  gte(k: string, v: any) { this.filters.push((r) => r[k] != null && r[k] >= v); return this; }
  lt(k: string, v: any) { this.filters.push((r) => r[k] != null && r[k] < v); return this; }
  lte(k: string, v: any) { this.filters.push((r) => r[k] != null && r[k] <= v); return this; }
  in(k: string, v: any[]) { this.filters.push((r) => v.includes(r[k])); return this; }
  is(k: string, v: any) { this.filters.push((r) => (v === null ? r[k] == null : r[k] === v)); return this; }
  ilike(k: string, v: string) { const re = new RegExp('^' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i'); this.filters.push((r) => re.test(String(r[k] ?? ''))); return this; }
  or(_s: string) { return this; }
  order(k: string, o?: Row) { this.orderBy.push([k, o?.ascending !== false]); return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  match(r: Row) { return this.filters.every((f) => f(r)); }
  run(): { data: any; error: any; count?: number } {
    const rows = db[this.table];
    if (this.op === 'insert' || this.op === 'upsert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p: Row) => fill(this.table, p));
      const out: Row[] = [];
      for (const r of list) {
        if (this.op === 'upsert') {
          const keys = (this.upsertOpts?.onConflict || 'id').split(',');
          const ex = rows.find((x) => keys.every((k: string) => x[k] === r[k]));
          if (ex) { if (!this.upsertOpts?.ignoreDuplicates) Object.assign(ex, r); continue; }
        }
        for (const k of UNIQUE[this.table] || []) if (r[k] != null && rows.some((x) => lower(x[k]) === lower(r[k]))) return { data: null, error: { code: '23505', message: `duplicate ${k}` } };
        rows.push(r); out.push(r);
      }
      const data = structuredClone(out);
      return { data: this.one ? data[0] ?? null : data, error: null };
    }
    let hit = rows.filter((r) => this.match(r));
    if (this.op === 'update') {
      for (const r of hit) Object.assign(r, this.payload, { updated_at: new Date().toISOString() });
      const data = structuredClone(hit);
      return { data: this.one ? data[0] ?? null : data, error: null };
    }
    if (this.op === 'delete') { db[this.table] = rows.filter((r) => !this.match(r)); return { data: null, error: null }; }
    for (const [k, asc] of [...this.orderBy].reverse()) hit = [...hit].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1));
    const count = hit.length;
    if (this.lim) hit = hit.slice(0, this.lim);
    if (this.head) return { data: null, error: null, count };
    const data = structuredClone(hit);
    if (this.one) { if (this.one === 'single' && data.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'not single' } }; return { data: data[0] ?? null, error: null, count }; }
    return { data, error: null, count };
  }
  then(res: any, rej: any) { try { return Promise.resolve(this.run()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } }
}
const docSeq: Record<string, number> = {};
export function createClient() {
  return {
    from: (t: string) => new Query(t),
    rpc: async (_fn: string, a: Row) => { docSeq[a.kind] = (docSeq[a.kind] || 0) + 1; const pre: Row = { kontrak: 'KTR', kuitansi: 'KW', booking: 'BK', fee: 'FEE' }; return { data: `BNS/${pre[a.kind]}/2026/${String(docSeq[a.kind]).padStart(4, '0')}`, error: null }; },
    storage: { from: (b: string) => ({
      upload: async (p: string, buf: Uint8Array) => { files.set(`${b}/${p}`, buf); return { error: null }; },
      createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed/${p}` }, error: files.has(`private/${p}`) ? null : { message: 'nf' } }),
      createSignedUrls: async (ps: string[]) => ({ data: ps.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null }),
      remove: async (ps: string[]) => { ps.forEach((x) => files.delete(`${b}/${x}`)); return { data: null, error: null }; },
      download: async (p: string) => (files.has(`${b}/${p}`) ? { data: new Blob([files.get(`${b}/${p}`)!]), error: null } : { data: null, error: { message: 'nf' } }),
    }) },
    auth: {
      getUser: async (t: string) => (t === 'admin-token' ? { data: { user: { email: 'bonaasinaa@gmail.com' } }, error: null } : { data: null, error: { message: 'bad' } }),
      admin: { listUsers: async () => ({ data: { users: [] } }), updateUserById: async () => ({}), createUser: async () => ({}) },
      signInWithPassword: async () => ({ data: null, error: { message: 'x' } }),
    },
  };
}
export type SupabaseClient = any;
