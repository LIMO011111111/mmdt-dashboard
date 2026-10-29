// Mock der Edge Function `mmdt` nach mmdt-api.md. Aufruf: node cockpit-mock.js [port] [token]
// GET /mmdt -> alles; POST /mmdt -> neu | erledigt | offen | verworfen (merkt sich Aenderungen); OPTIONS -> 204.
// Zusatz fuer Tests: GET /__log -> alle POST-Bodies, GET /__fail?n=1 -> die naechsten n POSTs antworten 500,
// GET /__delay?ms=1500&what=get|post -> die naechste Anfrage dieser Art antwortet verzoegert (GET mit dem Stand von vorher).
const http = require('http');
const PORT = +(process.argv[2] || 8787), TOKEN = process.argv[3] || 'geheim-123';
const KURS_RE = /\b[A-Z]{2,6}\d{4,6}[A-Z]?\b/;
const pad = n => String(n).padStart(2, '0');
const day = k => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + k); return d; };
const iso = k => { const d = day(k); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const at = (k, h, m) => { const d = day(k); d.setHours(h, m, 0, 0); return d.toISOString().replace('Z', '+00:00'); };
const berlin = (k, h, m) => { const d = day(k); d.setHours(h, m, 0, 0); const o = -d.getTimezoneOffset(); return `${iso(k)}T${pad(h)}:${pad(m)}:00${o >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(o) / 60))}:${pad(Math.abs(o) % 60)}`; };
let seq = 0;
const uid = () => '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0');
const now = () => new Date().toISOString();
const A = (titel, notiz, faellig, status = 'offen', erledigtVor = null, prio = 3) => {
  const kurs = ((titel + ' ' + notiz).match(KURS_RE) || [null])[0];
  return { id: uid(), titel, notiz, kurs, status, prio, faellig, heute_am: null, ueberfaellig: false,
    erledigt_am: erledigtVor == null ? null : new Date(Date.now() - erledigtVor * 864e5).toISOString(), quelle: 'gtasks', link: null, geaendert_am: now() };
};
const aufgaben = [
  A('MR: Case Study 1 Gliederung', 'Kurs MGTHN0189 · Marketing Research', iso(4), 'offen', null, 2),
  A('Paper lesen <b>Kap. 3</b> & Notizen', 'Kurs MGTHN0111 · Industry 4.0', iso(12)),
  A('Causal Data Science Übungsblatt 2', 'MGTHN0207', iso(-2)),                       // ueberfaellig
  A('Bibliotheksausweis verlängern', '', null),                           // ohne Kurs
  A('Lerngruppe für Klausuren organisieren', '', iso(1)),                 // ohne Kurs
  A('Moodle-Quiz MGTHN0189 Woche 2', '', null, 'erledigt', 2),            // erledigt vor 2 Tagen
];
aufgaben[1].link = 'https://www.moodle.tum.de/';
aufgaben[5].quelle = 'app';
const F = (titel, kurs, art, faellig_am, ganztags = false) => ({ id: uid(), titel, kurs, art, faellig_am, ganztags, ort: null, link: null, status: 'offen', quelle: 'ics' });
const fristen = [
  F('Abgabe Case Study 2', 'MGTHN0189', 'abgabe', at(4, 22, 59)),             // gehoert zu Aufgabe 1 (aufgabe_id) -> nicht doppelt in Demnaechst
  F('Abgabe Case Study 1', 'MGTHN0189', 'abgabe', at(9, 22, 59)),              // gleicher Tag + Kurs wie Kalender-DEADLINE -> dedupliziert
  F('Zwischenpräsentation Industry 4.0', 'MGTHN0111', 'praesentation', at(16, 9, 0)),
  F('Klausur GenAI Marketing', 'MGTHN0121', 'pruefung', iso(95), true),
  F('Anmeldung Prüfungen', null, 'anmeldung', at(6, 22, 59)),
];
fristen[0].aufgabe_id = aufgaben[0].id;
const ev = (title, k, h1, h2, extra = {}) => Object.assign({ id: 'ev-' + title.replace(/\W+/g, '') + k, title, start: berlin(k, h1, 0), end: berlin(k, h2, 0), allDay: false,
  location: '', colorId: '', code: '', uni: false, online: false, free: false, wichtig: null }, extra);
const kalender = { stand: new Date().toISOString().slice(0, 16), events: [
  ev('COCKPIT Standup', 0, 8, 9, { location: 'Teams', online: true }),
  ev('Marketing Research VL (MGTHN0189)', 0, 10, 13, { code: 'MGTHN0189', uni: true, location: 'L.1.11' }),
  ev('COCKPIT Kundencall', 0, 15, 16),
  ev('Causal Data Science VO (MGTHN0207)', 1, 9, 12, { code: 'MGTHN0207', uni: true }),
  ev('DEADLINE MR: Case Study 1', 9, 23, 23, { code: 'MGTHN0189', uni: true, end: berlin(9, 23, 59), wichtig: { kurs: 'MR', was: 'Case Study 1', abgabe: true } }),
  ev('Klausur Causal Data Science', 80, 9, 11, { code: 'MGTHN0207', uni: true, wichtig: { kurs: 'Causal Data Science', was: 'Klausur', abgabe: false } }),
] };
const log = [];
let failNext = 0, delay = { get: 0, post: 0 }, gets = 0;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-geraet-token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400' };
const send = (res, code, obj) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors)); res.end(JSON.stringify(obj)); };
const view = () => {
  const today = iso(0), weekAgo = Date.now() - 7 * 864e5;
  const list = aufgaben.filter(a => ['inbox', 'offen', 'wartet'].includes(a.status) || (a.status === 'erledigt' && Date.parse(a.erledigt_am) >= weekAgo))
    .map(a => Object.assign({}, a, { ueberfaellig: a.status !== 'erledigt' && !!a.faellig && a.faellig < today }));
  list.sort((a, b) => (a.status === 'erledigt') - (b.status === 'erledigt') || (a.faellig || '9999').localeCompare(b.faellig || '9999') || a.prio - b.prio);
  return list;
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__log') return send(res, 200, log);
  if (url.pathname === '/__gets') return send(res, 200, { gets });
  if (url.pathname === '/__delay') { delay[url.searchParams.get('what') || 'get'] = +(url.searchParams.get('ms') || 1000); return send(res, 200, delay); }
  if (url.pathname === '/__fail') { failNext = +(url.searchParams.get('n') || 1); return send(res, 200, { failNext }); }
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (url.pathname !== '/mmdt' && url.pathname !== '/functions/v1/mmdt') return send(res, 404, { ok: false, fehler: 'Nicht gefunden' });
  if (req.headers['x-geraet-token'] !== TOKEN) return send(res, 401, { ok: false, fehler: 'Token ungültig' });
  if (req.method === 'GET') {
    const a = view(), ms = delay.get; delay.get = 0; gets++;
    const out = (c, o) => ms ? setTimeout(() => send(res, c, o), ms) : send(res, c, o);
    return out(200, { ok: true, stand: now(), version: '2026-10-28', aufgaben: a, fristen, kalender, kalender_fehler: null,
      zaehler: { aufgaben_offen: a.filter(x => x.status !== 'erledigt').length, aufgaben_ueberfaellig: a.filter(x => x.ueberfaellig).length, fristen_offen: fristen.filter(f => f.status === 'offen').length } });
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, fehler: 'Methode nicht erlaubt' });
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => { const ms = delay.post; delay.post = 0; setTimeout(() => handlePost(raw, req, res), ms); });
});
function handlePost(raw, req, res) {
  {
    let b; try { b = JSON.parse(raw); } catch (e) { return send(res, 400, { ok: false, fehler: 'Kein JSON' }); }
    log.push(b);
    if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 400, { ok: false, fehler: 'content-type' });
    if (failNext > 0) { failNext--; return send(res, 500, { ok: false, fehler: 'Testfehler' }); }
    if (b.aktion === 'neu') {
      const titel = String(b.titel || '').trim();
      if (!titel || titel.length > 300) return send(res, 400, { ok: false, fehler: 'titel 1–300 Zeichen' });
      if (b.kurs != null && !/^[A-Z]{2,6}\d{4,6}[A-Z]?$/.test(b.kurs)) return send(res, 400, { ok: false, fehler: 'kurs ungültig' });
      if (b.kursname != null && String(b.kursname).length > 120) return send(res, 400, { ok: false, fehler: 'kursname zu lang' });
      if (b.faellig != null && !/^\d{4}-\d{2}-\d{2}$/.test(b.faellig)) return send(res, 400, { ok: false, fehler: 'faellig ungültig' });
      const a = A(titel, b.kurs ? `Kurs ${b.kurs} · ${b.kursname || ''}` : '', b.faellig || null);
      a.quelle = 'app'; aufgaben.push(a);
      return send(res, 200, { ok: true, aufgabe: view().find(x => x.id === a.id) || a });
    }
    if (b.aktion === 'frist') {   // Frist (+ verknuepfte Aufgabe); idempotent ueber quelle_marker, zusaetzlich Kurs+Art+Tag
      const ARTEN = ['abgabe', 'pruefung', 'praesentation', 'anmeldung', 'sonstig'], titel = String(b.titel || '').trim();
      if (!titel || titel.length > 300) return send(res, 400, { ok: false, fehler: 'titel 1–300 Zeichen' });
      if (!ARTEN.includes(b.art)) return send(res, 400, { ok: false, fehler: 'art ungültig' });
      if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z))?$/.test(String(b.faellig_am))) return send(res, 400, { ok: false, fehler: 'faellig_am ungültig' });
      if (!/^[A-Za-z0-9._:-]{1,80}$/.test(String(b.quelle_marker))) return send(res, 400, { ok: false, fehler: 'quelle_marker ungültig' });
      if (b.kurs != null && !/^[A-Z]{2,6}\d{4,6}[A-Z]?$/.test(b.kurs)) return send(res, 400, { ok: false, fehler: 'kurs ungültig' });
      const tag = b.faellig_am.slice(0, 10);
      const alt = fristen.find(f => f.quelle_marker === b.quelle_marker) || (b.kurs ? fristen.find(f => f.kurs === b.kurs && f.art === b.art && f.faellig_am.slice(0, 10) === tag) : null);
      if (alt) return send(res, 200, { ok: true, frist: alt, aufgabe: aufgaben.find(a => a.id === alt.aufgabe_id) || null, neu: false });
      const a = b.aufgabe ? A(titel, b.kurs ? `Kurs ${b.kurs}` : '', tag) : null;
      if (a) { a.quelle = 'app'; aufgaben.push(a); }
      const f = F(titel, b.kurs || null, b.art, b.faellig_am, !!b.ganztags);
      Object.assign(f, { quelle: 'app', quelle_marker: b.quelle_marker, link: b.link || null, aufgabe_id: a ? a.id : null });
      fristen.push(f);
      return send(res, 200, { ok: true, frist: f, aufgabe: a, neu: true });
    }
    const a = aufgaben.find(x => x.id === b.id);
    if (!a) return send(res, 404, { ok: false, fehler: 'Aufgabe nicht gefunden' });
    if (b.aktion === 'erledigt') { a.status = 'erledigt'; a.erledigt_am = now(); }
    else if (b.aktion === 'offen') { a.status = 'offen'; a.erledigt_am = null; }
    else if (b.aktion === 'verworfen') { a.status = 'verworfen'; }
    else return send(res, 400, { ok: false, fehler: 'aktion unbekannt' });
    a.geaendert_am = now();
    send(res, 200, { ok: true, aufgabe: Object.assign({}, a, { ueberfaellig: a.status !== 'erledigt' && !!a.faellig && a.faellig < iso(0) }) });
  }
}
server.listen(PORT, '127.0.0.1', () => console.log('cockpit-mock on', PORT));
