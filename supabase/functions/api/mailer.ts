// Bonaasina — notifikasi email lewat Resend (https://resend.com).
// Secret fungsi: RESEND_API_KEY (wajib; tanpa ini email dilewati diam-diam), EMAIL_FROM (bawaan
// "Bonaasina <notifikasi@kabar.bonaasina.my.id>", domainnya harus sudah diverifikasi di Resend), EMAIL_REPLY_TO (opsional).
// Email selalu dikirim di latar belakang: kegagalan kirim tidak pernah menggagalkan aksi pengguna.
// Setiap email punya dedupeKey (unik di tabel email_log, juga dipakai sebagai Idempotency-Key Resend),
// jadi satu kejadian tidak terkirim dua kali walau kodenya terpanggil ulang.
type Row = Record<string, any>;

export type Mail = {
  to: string | string[];
  subject: string;
  title: string;                       // judul besar di badan email
  intro?: string;                      // paragraf pembuka
  rows?: [string, string][];           // tabel ringkas: label → nilai
  note?: string;                       // paragraf penutup / langkah berikutnya
  cta?: { label: string; url: string };
  kind: string;                        // jenis, untuk tag & log (mis. "invoice.new")
  dedupeKey?: string | null;
};

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
export const isEmail = (s: unknown) => typeof s === 'string' && s.length <= 120 && EMAIL_RE.test(s);

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const nl2br = (s: string) => esc(s).replace(/\n/g, '<br>');

export function renderMail(m: Mail, site: string) {
  const rows = (m.rows || []).filter(([, v]) => v !== '' && v != null);
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:0;background:#F7EDE3;font-family:Arial,Helvetica,sans-serif;color:#24160F">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7EDE3;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#8E1B1B;padding:18px 24px;color:#F7EDE3;font-size:18px;font-weight:bold;letter-spacing:.5px">Bonaasina</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#24160F">${esc(m.title)}</h1>
${m.intro ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.55">${nl2br(m.intro)}</p>` : ''}
${rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;font-size:14px">${rows.map(([k, v]) =>
    `<tr><td style="padding:7px 10px 7px 0;color:#6b5a4e;vertical-align:top;white-space:nowrap;border-bottom:1px solid #efe4d8">${esc(k)}</td><td style="padding:7px 0;vertical-align:top;border-bottom:1px solid #efe4d8">${nl2br(v)}</td></tr>`).join('')}</table>` : ''}
${m.note ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.55">${nl2br(m.note)}</p>` : ''}
${m.cta ? `<p style="margin:20px 0 4px"><a href="${esc(m.cta.url)}" style="display:inline-block;background:#8E1B1B;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;font-size:15px">${esc(m.cta.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:16px 24px;background:#faf5ef;color:#6b5a4e;font-size:12px;line-height:1.5">Email otomatis dari Bonaasina (Kos Asina &amp; Kos Bona). Anda menerimanya karena email ini dicantumkan di <a href="${esc(site)}" style="color:#8E1B1B">${esc(site.replace(/^https?:\/\//, ''))}</a>. Bila bukan Anda, abaikan saja email ini.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    m.title, '', m.intro || '', ...(rows.length ? ['', ...rows.map(([k, v]) => `${k}: ${v}`)] : []), m.note ? `\n${m.note}` : '',
    m.cta ? `\n${m.cta.label}: ${m.cta.url}` : '', '', '— Bonaasina', site,
  ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim();
  return { html, text };
}

export function createMailer(H: Record<string, any>) {
  const { sb, background, SITE_URL } = H;
  const KEY = Deno.env.get('RESEND_API_KEY') || '';
  const FROM = Deno.env.get('EMAIL_FROM') || 'Bonaasina <notifikasi@kabar.bonaasina.my.id>';
  const REPLY_TO = Deno.env.get('EMAIL_REPLY_TO') || '';
  const API = Deno.env.get('RESEND_API_URL') || 'https://api.resend.com/emails';

  async function deliver(m: Mail) {
    const to = [...new Set((Array.isArray(m.to) ? m.to : [m.to]).map((x) => String(x || '').trim().toLowerCase()).filter(isEmail))].slice(0, 20);
    if (!to.length || !KEY) return null;
    const subject = String(m.subject).slice(0, 180);
    const key = m.dedupeKey ? String(m.dedupeKey).slice(0, 250) : null;
    // Catat dulu: bila kunci yang sama sudah ada, email ini sudah pernah dikirim.
    const { data: logRow, error: logErr } = await sb.from('email_log').insert({ dedupe_key: key, kind: m.kind, to_email: to.join(', '), subject }).select('id').single();
    if (logErr) { if (logErr.code !== '23505') console.error('email_log', logErr); return null; }
    const { html, text } = renderMail(m, SITE_URL);
    const headers: Record<string, string> = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    let resendId: string | null = null; let error: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(API, {
          method: 'POST', headers,
          body: JSON.stringify({ from: FROM, to, subject, html, text, ...(REPLY_TO ? { reply_to: REPLY_TO } : {}), tags: [{ name: 'kind', value: m.kind.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) }] }),
        });
        const out = await res.json().catch(() => ({}));
        if (res.ok) { resendId = out.id || null; error = null; break; }
        error = `${res.status} ${out.message || out.name || ''}`.trim();
        if (res.status < 500 && res.status !== 429) break; // salah alamat/domain belum diverifikasi: jangan diulang
      } catch (e) { error = String((e as Error)?.message || e); }
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
    if (error) console.error('resend', m.kind, error);
    if (logRow?.id) await sb.from('email_log').update({ status: error ? 'gagal' : 'dikirim', resend_id: resendId, error }).eq('id', logRow.id);
    return resendId;
  }

  // Kirim di latar belakang. Aman dipanggil tanpa alamat (dilewati).
  const send = (m: Mail) => { background(deliver(m)); };

  // Penerima email admin: pengaturan "Email notifikasi admin", atau semua email di tabel admins.
  async function adminEmails(): Promise<string[]> {
    const { data: s } = await sb.from('settings').select('data').eq('id', 1).maybeSingle();
    const list = String(s?.data?.notifyEmail || '').split(/[\s,;]+/).filter(isEmail);
    if (list.length) return list;
    const { data } = await sb.from('admins').select('email');
    return ((data as Row[]) || []).map((a) => a.email).filter(isEmail);
  }
  const sendAdmin = (m: Omit<Mail, 'to'>) => { background((async () => deliver({ ...m, to: await adminEmails() }))()); };

  return { send, sendAdmin, deliver, adminEmails, enabled: !!KEY };
}
