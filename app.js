/* =====================================================================
   app.js – Martin: domácí cvičení (vlastní váha), progrese podle zpětné vazby,
   hubnutí, připomínky pitného režimu, volitelný AI trenér (OpenAI).
   Data jen v tomto zařízení (localStorage). OpenAI klíč zvlášť, nejde do zálohy.
   ===================================================================== */
'use strict';

const STORE_KEY = 'martin_cviceni_v1';
const OAI_KEY_STORE = 'martin_openai_key';
const EX = window.CVIKY.by, DNY = window.CVIKY.dny;

/* ------------------------------ stav ------------------------------ */
const DEF = () => ({
  v: 1,
  level: 0,                 // úroveň L (desetinné číslo; zpětná vazba ji posouvá)
  exOff: {},                // osobní posun úrovně pro cvik / rodinu (tlačítka Lehčí/Těžší)
  dayIdx: 0,                // který typ dne je na řadě (A/B/C)
  sessions: [],             // {date, day, min, fb, l0, l1, items:[id], done, total}
  weights: [],              // {d, kg}
  goal: { start: null, startDate: null, target: null, targetDate: null, perDay: 0.1, height: null },
  settings: { maxMin: 30, shoulder: 'mirne', sound: true, voice: true, drinkNag: true, remindTimes: ['09:00', '13:00', '17:00'], trainTime: '18:30' },
  ai: { month: '', calls: 0, tokIn: 0, tokOut: 0, model: null, last: '', lastDate: '' },
  lastDecayFor: null
});
let S = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw), d = DEF();
      return Object.assign(d, s, { goal: Object.assign(d.goal, s.goal), settings: Object.assign(d.settings, s.settings), ai: Object.assign(d.ai, s.ai) });
    }
  } catch (e) {}
  return DEF();
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { toast('⚠️ Nepodařilo se uložit data'); } }

/* ------------------------------ pomůcky ------------------------------ */
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function dateStr(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function parseD(iso) { return new Date(iso + 'T12:00:00'); }
function daysBetween(a, b) { return Math.round((parseD(b) - parseD(a)) / 864e5); }
function addDays(iso, n) { const d = parseD(iso); d.setDate(d.getDate() + n); return dateStr(d); }
const MES = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
const DNYT = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
function fmtD(iso, long) { const d = parseD(iso); return long ? d.getDate() + '. ' + MES[d.getMonth()] + ' ' + d.getFullYear() : d.getDate() + '. ' + (d.getMonth() + 1) + '.'; }
function num(v, dec) { return (+v).toFixed(dec == null ? 1 : dec).replace('.', ','); }
function pnum(v) { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; }
function mmss(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function plural(n, a, b, c) { return n === 1 ? a : (n >= 2 && n <= 4 ? b : c); }
function dayOfYear() { const d = new Date(); return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5); }
function toast(msg, ms) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), ms || 2600);
}
function modal(html) { $('#modalRoot').innerHTML = '<div class="modalbg" onclick="if(event.target===this)closeModal()"><div class="modal">' + html + '</div></div>'; }
function closeModal() { $('#modalRoot').innerHTML = ''; }

/* ======================= cviky, úroveň a dávkování ======================= */
const FB = [
  null,
  { e: '😵', t: 'Velmi těžké', s: 'Nedal jsem všechna opakování – uber', d: -1.0 },
  { e: '😓', t: 'Těžké', s: 'Na hraně – nech to, nebo uber jen kousek', d: -0.2 },
  { e: '🙂', t: 'Akorát', s: 'Standard – přidej jen trošičku', d: 0.25 },
  { e: '😎', t: 'Snadné', s: 'Šlo to dobře – přidej trochu', d: 0.6 },
  { e: '🚀', t: 'Velmi snadné', s: 'Příště mi naložte mnohem víc', d: 1.5 }
];
const LMIN = -4, LMAX = 40;
const offKey = e => e.fam || e.id;
const lx = e => S.level + (S.exOff[offKey(e)] || 0);
const allowed = e => !(S.settings.shoulder === 'prisne' && e.sh > 0);
function famList(key) { const l = window.CVIKY.list.filter(e => e.fam === key); return l.length ? l : (EX[key] ? [EX[key]] : []); }
/* aktuální varianta pro rodinu / cvik (null = ještě zamčeno nebo nepovoleno) */
function resolve(key) {
  const vars = famList(key); if (!vars.length) return null;
  const x = S.level + (S.exOff[vars[0].fam || vars[0].id] || 0);
  let pick = null;
  vars.forEach((e, i) => { if ((e.unlock || 0) <= x || (i === 0 && !e.unlock)) pick = e; });
  if (!pick) return null;
  if (!allowed(pick)) { const a = pick.alt && EX[pick.alt]; return a && allowed(a) ? a : null; }
  return pick;
}
function dose(e, Lover) {
  const [a, b, lo, hi] = e.lad, x = Lover != null ? Lover + (S.exOff[offKey(e)] || 0) : lx(e);
  let v;
  if (x < a) v = lo * Math.max(0.6, 1 + (x - a) * 0.1);   // pod startovní úrovní ubíráme (jen první variant)
  else v = lo + (hi - lo) * clamp((x - a) / (b - a), 0, 1);
  return e.type === 'time' ? Math.max(10, Math.round(v / 5) * 5) : Math.max(3, Math.round(v));
}
function doseTxt(e, d, short) {
  const side = e.sides ? (short ? '/str.' : ' na každou stranu') : '';
  return e.type === 'time' ? d + ' s' + side : d + '×' + side;
}
function estSec(e, d) {
  const k = e.sides ? 2 : 1;
  return e.type === 'time' ? d * k + 6 * k : d * (e.spr || 3) * k + (e.sides ? 6 : 0) + 4;
}
function lvlTxt(l) { return num(Math.max(0, l + 1), 1); }   // zobrazujeme od 1

/* ----------------------------- sestavení tréninku ----------------------------- */
function targetMin(over) {
  if (over) return over;
  return clamp(Math.round(15 + Math.max(0, S.level) * 0.75), 15, S.settings.maxMin || 30);
}
function buildPlan(dayIdx, over) {
  const day = DNY[dayIdx % DNY.length], T = targetMin(over) * 60;
  const L = Math.max(0, S.level);
  const restEx = L < 8 ? 25 : L < 16 ? 20 : 15, restRound = L < 8 ? 60 : L < 16 ? 50 : 45;
  const uniq = arr => { const seen = {}; return arr.filter(e => e && !seen[e.id] && (seen[e.id] = 1)); };
  const warm = uniq(day.warm.map(resolve)).map(e => ({ id: e.id, d: dose(e) }));
  const mob = uniq(day.mob.map(resolve)).map(e => ({ id: e.id, d: dose(e) }));
  const cands = uniq(day.main.map(resolve)).map(e => ({ id: e.id, d: dose(e) }));
  const sumEst = (items, gap) => items.reduce((s, it) => s + estSec(EX[it.id], it.d) + gap, 0);
  const fixed = sumEst(warm, 8) + sumEst(mob, 10) + 20;
  const mainEst = (n, r) => { const it = cands.slice(0, n); return r * sumEst(it, restEx) - restEx + (r - 1) * (restRound - restEx); };
  // vybere počet cviků a kol, aby odhad co nejlépe seděl na cílovou délku (radši víc cviků než kol)
  const maxN = Math.min(6, cands.length), maxR = T >= 25 * 60 ? 4 : 3;
  let n = Math.min(4, cands.length), r = 2, best = Infinity;
  for (let nn = Math.min(3, maxN); nn <= maxN; nn++) for (let rr = 2; rr <= maxR; rr++) {
    const est = fixed + mainEst(nn, rr);
    const cost = Math.abs(est - T) + (est > T + 150 ? 120 : 0) + (nn < 4 ? 180 : 0) + (rr > 3 ? 40 : 0) + (rr > nn - 1 ? 30 : 0);
    if (cost < best) { best = cost; n = nn; r = rr; }
  }
  const main = cands.slice(0, n);
  return { day, dayIdx: dayIdx % DNY.length, warm, main, mob, rounds: r, restEx, restRound,
    est: Math.round((fixed + mainEst(n, r)) / 60), target: Math.round(T / 60) };
}
function planSteps(p) {
  const st = [];
  const pushEx = (it, block, round) => {
    const e = EX[it.id];
    if (e.type === 'time' && e.sides) {
      st.push({ t: 'ex', id: it.id, d: it.d, block, round, side: 'Pravá strana' });
      st.push({ t: 'ex', id: it.id, d: it.d, block, round, side: 'Levá strana' });
    } else st.push({ t: 'ex', id: it.id, d: it.d, block, round, side: e.sides ? 'Na každou stranu' : '' });
  };
  p.warm.forEach(it => pushEx(it, 'Rozcvička'));
  st.push({ t: 'rest', sec: 20, label: 'Připrav se na hlavní část', drink: true });
  for (let r = 1; r <= p.rounds; r++) {
    p.main.forEach((it, i) => {
      pushEx(it, 'Hlavní část', r);
      const last = i === p.main.length - 1;
      if (!last) st.push({ t: 'rest', sec: p.restEx, label: 'Pauza' });
      else if (r < p.rounds) st.push({ t: 'rest', sec: p.restRound, label: 'Pauza mezi koly', drink: true });
    });
  }
  st.push({ t: 'rest', sec: 15, label: 'Na podložku – protažení', drink: true });
  p.mob.forEach(it => pushEx(it, 'Protažení'));
  st.forEach((s, i) => { if (s.t === 'rest') { const nx = st.slice(i + 1).find(x => x.t === 'ex'); s.next = nx || null; } });
  return st;
}

/* ============================== připomínky ============================== */
const DRINK = [
  '💧 Hodně pij! Napij se hned teď – celá sklenice vody.',
  '💧 Napij se! Měj láhev vody pořád na očích.',
  '💧 Než si sedneš k práci, vypij sklenici vody.',
  '💧 Žízeň = už pozdě. Napij se teď.',
  '💧 Ke každému jídlu sklenici vody. A teď jednu navíc!',
  '💧 Voda pomáhá hubnout i regeneraci po cvičení. Napij se!',
  '💧 Dnes cíl: aspoň 2,5 litru vody. Napij se!'
];
const RULES = [
  '🚫 Dnes žádné brambůrky – ani „jen pár“.',
  '🍬 Sladkosti dnes nech být. Když chuť, tak ovoce.',
  '🍟 Nic smaženého – raději vařené, pečené nebo grilované.',
  '🥤 Žádné slazené pití – voda, minerálka, neslazený čaj.',
  '🍺 Pivo dnes vynech – má spoustu kalorií a zpomaluje hubnutí.',
  '🍫 Na sladké nechoď – za 15 minut chuť přejde.',
  '🥨 Chuť na slané? Napij se vody a dej si zeleninu, ne brambůrky.'
];

/* ============================== render: Dnes ============================== */
let todayOver = null, todayDay = null;
function lastSession() { return S.sessions.length ? S.sessions[S.sessions.length - 1] : null; }
function doneToday() { return S.sessions.some(s => s.date === dateStr()); }
function weekCount() {
  const t = new Date(); const dow = (t.getDay() + 6) % 7; const mon = addDays(dateStr(), -dow);
  return S.sessions.filter(s => s.date >= mon).length;
}
function streak() {
  const set = new Set(S.sessions.map(s => s.date)); let d = dateStr(), n = 0;
  if (!set.has(d)) d = addDays(d, -1);
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
function renderHeader() {
  const d = new Date();
  $('#today').textContent = DNYT[d.getDay()] + ' ' + fmtD(dateStr(), true);
  $('#lvlBadge').textContent = '💪 Úroveň ' + lvlTxt(S.level);
}
function renderDnes() {
  const doy = dayOfYear(), di = todayDay != null ? todayDay : S.dayIdx, p = buildPlan(di, todayOver);
  const done = doneToday(), ls = lastSession();
  const exRow = (it, mult) => { const e = EX[it.id]; return '<div class="exl"><span>' + esc(e.name) + (e.sh ? '<span class="tag sh">rameno</span>' : '') + '</span><span class="d">' + doseTxt(e, it.d, true) + (mult || '') + '</span></div>'; };
  const rules = [RULES[doy % RULES.length], RULES[(doy + 3) % RULES.length]];
  let h = '';
  h += '<div class="card remind"><div class="big">' + esc(DRINK[doy % DRINK.length]) + '</div>' +
    '<div class="small" style="margin-top:8px;">' + esc(rules[0]) + '<br>' + esc(rules[1]) + '</div>' +
    '<div class="rules"><span>🍟 brambůrky</span><span>🍬 sladkosti</span><span>🍳 smažené</span><span>🥤 slazené pití</span><span>🍺 pivo</span></div></div>';
  h += '<div class="card"><div class="row between"><h3 style="margin:0;">' + p.day.emoji + ' Dnešní trénink: ' + esc(p.day.name) + '</h3></div>';
  h += '<div class="small muted" style="margin-top:4px;">≈ ' + p.est + ' min · hlavní část ' + p.rounds + '× kolo · bez pomůcek, jen židle, stupínek a podložka</div>';
  if (done) h += '<div class="small" style="margin-top:8px;color:var(--accent);font-weight:700;">✅ Dnes už máš odcvičeno. Klidně si dej i další, ale odpočinek je taky trénink.</div>';
  h += '<div class="chips" style="margin-top:12px;">' + DNY.map((d, i) => '<button class="chip' + (i === p.dayIdx ? ' on' : '') + '" onclick="setTodayDay(' + i + ')">' + d.emoji + ' ' + d.id + '</button>').join('') +
    '<span style="flex:1"></span>' + [[null, 'Auto'], [15, '15'], [20, '20'], [30, '30']].map(([v, t]) => '<button class="chip' + (todayOver === v ? ' on' : '') + '" onclick="setTodayOver(' + v + ')">' + t + (v ? ' min' : '') + '</button>').join('') + '</div>';
  h += '<div class="blk"><h4>Rozcvička</h4>' + p.warm.map(it => exRow(it)).join('') + '</div>';
  h += '<div class="blk"><h4>Hlavní část · ' + p.rounds + ' ' + plural(p.rounds, 'kolo', 'kola', 'kol') + '</h4>' + p.main.map(it => exRow(it)).join('') + '</div>';
  h += '<div class="blk"><h4>Protažení (kyčle & fotbal)</h4>' + p.mob.map(it => exRow(it)).join('') + '</div>';
  h += '<button class="btn primary big" style="margin-top:14px;" onclick="startRun()">▶ Začít trénink</button></div>';
  h += '<div class="grid3"><div class="stat"><span>Tento týden</span><b>' + weekCount() + '×</b></div><div class="stat"><span>Série dní</span><b>' + streak() + '</b></div><div class="stat"><span>Celkem</span><b>' + S.sessions.length + '</b></div></div>';
  const w = lastWeight();
  if (w && S.goal.target) {
    const rest = w.kg - S.goal.target;
    h += '<div class="card soft"><div class="row between"><span>⚖️ Poslední váha <b>' + num(w.kg) + ' kg</b></span><span class="muted small">' + (rest > 0 ? 'do cíle ' + num(rest) + ' kg' : '🎉 cíl splněn') + '</span></div></div>';
  } else h += '<div class="card soft small muted">⚖️ Nastav si cíl hubnutí a zapisuj váhu v záložce <b>Váha</b>.</div>';
  if (ls) h += '<div class="small muted" style="text-align:center;margin:8px 0;">Poslední trénink: ' + fmtD(ls.date) + ' · ' + (FB[ls.fb] ? FB[ls.fb].e + ' ' + FB[ls.fb].t : 'neohodnoceno') + '</div>';
  $('#v-dnes').innerHTML = h;
}
function setTodayDay(i) { todayDay = i; renderDnes(); }
function setTodayOver(v) { todayOver = v; renderDnes(); }

/* ============================ průvodce tréninkem ============================ */
let R = null, tickH = null, wakeLock = null;
function startRun() {
  const di = todayDay != null ? todayDay : S.dayIdx, p = buildPlan(di, todayOver);
  R = { p, steps: planSteps(p), i: 0, t0: Date.now(), phase: null, left: 0, total: 0, paused: false, endAt: 0, items: {}, swapped: {} };
  requestWake();
  audioInit();
  enterStep();
}
function curStep() { return R && R.steps[R.i]; }
function enterStep() {
  const s = curStep();
  if (!s) return showFeedback();
  R.paused = false;
  if (s.t === 'rest') { setTimer(s.sec, 'rest'); if (s.next) say((s.label === 'Pauza' ? 'Pauza. ' : s.label + '. ') + 'Další: ' + EX[s.next.id].name); }
  else {
    const e = EX[s.id];
    if (e.type === 'time') { setTimer(5, 'prep'); say(e.name + (s.side && s.side !== 'Na každou stranu' ? ', ' + s.side : '') + '. ' + s.d + ' sekund. Připrav se.'); }
    else { R.phase = 'reps'; clearInterval(tickH); say(e.name + '. ' + s.d + ' opakování' + (e.sides ? ' na každou stranu' : '')); }
  }
  renderRun();
}
setInterval(() => { const el = document.getElementById('runEl'); if (el && R) el.textContent = mmss((Date.now() - R.t0) / 1000); }, 1000);
function setTimer(sec, phase) {
  R.phase = phase; R.total = sec; R.left = sec; R.endAt = Date.now() + sec * 1000; R.lastBeep = null;
  clearInterval(tickH); tickH = setInterval(tick, 200);
}
function tick() {
  if (!R || R.paused || !R.phase || R.phase === 'reps') return;
  const left = Math.max(0, (R.endAt - Date.now()) / 1000), whole = Math.ceil(left);
  if (whole !== Math.ceil(R.left)) {
    if (whole <= 3 && whole > 0 && R.lastBeep !== whole) { R.lastBeep = whole; beep(880, 0.08, 0.15); vib(30); }
  }
  R.left = left;
  const el = $('#runTimer'); if (el) el.textContent = R.phase === 'prep' ? Math.ceil(left) : mmss(Math.ceil(left));
  const bar = $('#runTbar'); if (bar) bar.style.width = (100 * (1 - left / R.total)) + '%';
  if (left <= 0) {
    clearInterval(tickH);
    if (R.phase === 'prep') { beep(1320, 0.18, 0.2); vib(80); setTimer(curStep().d, 'work'); renderRun(); }
    else if (R.phase === 'work') { beep(660, 0.25, 0.22); setTimeout(() => beep(990, 0.3, 0.22), 260); vib([90, 60, 90]); markDone(); next(); }
    else { beep(1320, 0.2, 0.2); vib(60); next(); }
  }
}
function markDone() { const s = curStep(); if (s && s.t === 'ex') R.items[s.id] = (R.items[s.id] || 0) + 1; }
function next() { R.i++; enterStep(); }
function prev() { if (R.i > 0) { R.i--; enterStep(); } }
function repsDone() { beep(990, 0.12, 0.18); vib(40); markDone(); next(); }
function togglePause() {
  if (!R) return;
  if (R.paused) { R.paused = false; R.endAt = Date.now() + R.left * 1000; } else R.paused = true;
  renderRun();
}
function addRest(sec) { R.endAt += sec * 1000; R.total += sec; R.left += sec; }
function exOffset(id, delta) {
  const e = EX[id], k = offKey(e);
  S.exOff[k] = clamp((S.exOff[k] || 0) + delta, -8, 8); if (Math.abs(S.exOff[k]) < 0.01) delete S.exOff[k];
  save(); toast(delta < 0 ? '👍 Příště u „' + e.name + '“ uberu' : '💪 Příště u „' + e.name + '“ přidám');
}
function swapEx() {
  const s = curStep(), e = EX[s.id], a = e.alt && EX[e.alt];
  if (!a) return;
  R.steps.forEach(x => { if (x.id === s.id) { x.id = a.id; x.d = dose(a); } if (x.next && x.next.id === e.id) x.next = Object.assign({}, x.next, { id: a.id }); });
  toast('🔁 Vyměněno za: ' + a.name); enterStep();
}
function runBlockLabel(s) {
  if (s.t === 'rest') return s.label;
  return s.block + (s.round ? ' · kolo ' + s.round + '/' + R.p.rounds : '');
}
function renderRun() {
  const s = curStep(); if (!s) return;
  const exSteps = R.steps.filter(x => x.t === 'ex').length, doneEx = R.steps.slice(0, R.i).filter(x => x.t === 'ex').length;
  let h = '<div class="run"><div class="top"><button class="btn sm" onclick="askQuit()">✕</button><div class="lbl"><b>' + esc(runBlockLabel(s)) + '</b>cvik ' + Math.min(exSteps, doneEx + (s.t === 'ex' ? 1 : 0)) + ' / ' + exSteps + ' · <span id="runEl">' + mmss((Date.now() - R.t0) / 1000) + '</span></div>' +
    '<button class="btn sm" onclick="prev()" title="Zpět">⏮</button><button class="btn sm" onclick="next()" title="Přeskočit">⏭</button></div>' +
    '<div class="bar"><i style="width:' + (100 * doneEx / exSteps) + '%"></i></div><div class="body">';
  if (s.t === 'rest') {
    h += '<div class="timer rest" id="runTimer">' + mmss(R.left) + '</div><div class="bar" style="margin:0 0 10px;"><i id="runTbar" style="width:0"></i></div>';
    h += '<div class="row" style="justify-content:center;"><button class="btn sm" onclick="addRest(15)">+15 s</button><button class="btn sm" onclick="togglePause()">' + (R.paused ? '▶ Pokračovat' : '⏸ Pauza') + '</button><button class="btn sm primary" onclick="next()">Jdu na to ▶</button></div>';
    if (s.drink) h += '<div class="drink">💧 Napij se! Pár doušků vody.</div>';
    if (s.next) {
      const e = EX[s.next.id];
      h += '<div class="small muted" style="margin-top:14px;">Další cvik</div><div class="exname" style="margin-top:2px;">' + esc(e.name) + '</div><div class="muted">' + doseTxt(e, s.next.d) + (s.next.side && s.next.side !== 'Na každou stranu' ? ' · ' + s.next.side : '') + '</div>';
      h += '<canvas class="fitanim" data-anim="' + e.id + '" style="margin-top:10px;"></canvas>';
      h += '<ul class="cues">' + e.cues.map(c => '<li>' + esc(c) + '</li>').join('') + '</ul>';
    }
  } else {
    const e = EX[s.id];
    h += '<canvas class="fitanim" data-anim="' + e.id + '" id="runCv"></canvas><div class="phase" id="runPhase"></div>';
    h += '<div class="exname">' + esc(e.name) + '</div>' + (s.side ? '<div class="muted" style="font-weight:700;">' + esc(s.side) + '</div>' : '');
    if (e.type === 'time') {
      if (R.phase === 'prep') h += '<div class="small muted" style="text-align:center;margin-top:10px;">Připrav se – ' + s.d + ' s</div><div class="timer prep" id="runTimer">' + Math.ceil(R.left) + '</div>';
      else h += '<div class="timer" id="runTimer">' + mmss(R.left) + '</div>';
      h += '<div class="bar" style="margin:0 0 12px;"><i id="runTbar" style="width:0"></i></div>';
      h += '<div class="row" style="justify-content:center;"><button class="btn" onclick="togglePause()">' + (R.paused ? '▶ Pokračovat' : '⏸ Pauza') + '</button><button class="btn" onclick="markDone();next()">Hotovo ✓</button></div>';
    } else {
      h += '<div class="dose">' + s.d + '× <small>' + (e.sides ? 'na každou stranu' : 'opakování') + '</small></div>';
      h += '<button class="btn primary big" onclick="repsDone()">Hotovo ✓</button>';
    }
    h += '<ul class="cues">' + e.cues.map(c => '<li>' + esc(c) + '</li>').join('') + '</ul><div class="why">⚽ ' + esc(e.why) + '</div>';
    h += '<div class="row wrapf" style="margin-top:14px;"><button class="btn sm" onclick="exOffset(\'' + e.id + '\',-1.5)">😓 Příště lehčí</button><button class="btn sm" onclick="exOffset(\'' + e.id + '\',1.5)">💪 Příště těžší</button>' +
      (e.alt && EX[e.alt] && allowed(EX[e.alt]) ? '<button class="btn sm" onclick="swapEx()">🔁 Vyměnit (' + esc(EX[e.alt].name) + ')</button>' : '') + '</div>';
    if (e.sh) h += '<div class="note warn" style="margin-top:8px;">🦾 Mírně zatěžuje rameno. Při bolesti hned přestaň a dej „Vyměnit“.</div>';
  }
  h += '</div></div>';
  $('#runRoot').innerHTML = h;
  const cv = document.getElementById('runCv'); if (cv) cv._label = document.getElementById('runPhase');
}
if (window.FitAnim) window.FitAnim.onPhase = (cv, info) => { if (cv._label) cv._label.textContent = info.label || ''; };
function askQuit() {
  modal('<h3>Ukončit trénink?</h3><p class="small muted">Odcvičeno ' + mmss((Date.now() - R.t0) / 1000) + '. Můžeš ho i tak ohodnotit – úroveň se pak upraví.</p>' +
    '<div class="fb"><button onclick="closeModal()">▶ Pokračovat v tréninku</button><button onclick="closeModal();showFeedback(true)">✔ Ukončit a ohodnotit</button><button class="danger" onclick="closeModal();endRun()">🗑 Zahodit (neukládat)</button></div>');
}
function endRun() { clearInterval(tickH); R = null; $('#runRoot').innerHTML = ''; releaseWake(); try { speechSynthesis.cancel(); } catch (e) {} renderAll(); }
function showFeedback(partial) {
  clearInterval(tickH);
  R.partial = !!partial; R.min = Math.max(1, Math.round((Date.now() - R.t0) / 60000));
  say('Hotovo! Jak to šlo?');
  let h = '<div class="run"><div class="body" style="padding-top:28px;"><div style="font-size:48px;text-align:center;">🏁</div><div class="exname" style="text-align:center;">' + (partial ? 'Trénink ukončen' : 'Skvělá práce, Martine!') + '</div>' +
    '<div class="muted" style="text-align:center;">' + R.min + ' min · ' + esc(R.p.day.name) + '</div><div class="drink">💧 Teď hned vypij velkou sklenici vody!</div>' +
    '<h3 style="margin-top:18px;">Jak náročné to bylo?</h3><div class="fb">';
  for (let i = 1; i <= 5; i++) h += '<button onclick="finishRun(' + i + ')"><span class="e">' + FB[i].e + '</span><span>' + FB[i].t + '<small>' + FB[i].s + '</small></span></button>';
  h += '</div></div></div>';
  $('#runRoot').innerHTML = h;
}
function finishRun(fb) {
  const l0 = S.level, mainIds = R.p.main.map(it => it.id);
  let d = FB[fb].d;
  if (R.partial && d > 0) d = d / 2;                       // nedokončený trénink přidává jen napůl
  const prevS = lastSession();
  if (fb === 1 && prevS && prevS.fb === 1) d = -1.5;        // podruhé za sebou velmi těžké – uber víc
  const unlockedBefore = window.CVIKY.list.filter(e => (e.unlock || 0) <= l0).map(e => e.id);
  const before = {}; mainIds.forEach(id => { before[id] = dose(EX[id]); });
  S.level = clamp(Math.round((l0 + d) * 100) / 100, LMIN, LMAX);
  S.sessions.push({ date: dateStr(), day: R.p.day.id, min: R.min, fb, l0, l1: S.level, items: mainIds, done: R.steps.slice(0, R.i).filter(x => x.t === 'ex').length, total: R.steps.filter(x => x.t === 'ex').length });
  S.dayIdx = (R.p.dayIdx + 1) % DNY.length; todayDay = null;
  save();
  const changes = [];
  mainIds.forEach(id => { const e = EX[id], b = before[id], a = dose(e); if (a !== b) changes.push(e.name + ': ' + doseTxt(e, b, true) + ' → ' + doseTxt(e, a, true)); });
  const nowUnl = window.CVIKY.list.filter(e => (e.unlock || 0) <= S.level && unlockedBefore.indexOf(e.id) < 0 && allowed(e));
  const nextDay = DNY[S.dayIdx];
  let h = '<div class="run"><div class="body" style="padding-top:28px;"><div style="font-size:48px;text-align:center;">' + FB[fb].e + '</div><div class="exname" style="text-align:center;">Uloženo</div>' +
    '<div class="card"><div class="row between"><span>Úroveň</span><b>' + lvlTxt(l0) + ' → ' + lvlTxt(S.level) + '</b></div>' +
    '<div class="small muted" style="margin-top:6px;">' + (d > 0.9 ? 'Příště ti pořádně přidám 🚀' : d > 0.4 ? 'Příště trochu přidám 💪' : d > 0 ? 'Příště jen o chloupek víc.' : d === 0 ? 'Příště stejně.' : d > -0.5 ? 'Příště skoro stejně, jen kousek uberu.' : 'Příště uberu, ať to zvládneš celé 👍') + '</div>' +
    (changes.length ? '<div class="small" style="margin-top:8px;">' + changes.slice(0, 6).map(esc).join('<br>') + '</div>' : '') + '</div>';
  if (nowUnl.length) h += '<div class="card"><b>🔓 Nově odemčeno:</b><div class="small" style="margin-top:6px;">' + nowUnl.map(e => esc(e.name)).join('<br>') + '</div></div>';
  h += '<div class="card soft small">Příští trénink: <b>' + nextDay.emoji + ' ' + esc(nextDay.name) + '</b><br>' + esc(RULES[(dayOfYear() + 1) % RULES.length]) + '</div>';
  h += '<button class="btn primary big" onclick="endRun()">Zavřít</button></div></div>';
  $('#runRoot').innerHTML = h;
  R.finished = true;
}
/* zvuk, hlas, vibrace, wake lock */
let AC = null;
function audioInit() { try { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) {} }
function beep(f, dur, vol) {
  if (!S.settings.sound || !AC) return;
  try { const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(vol, AC.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + dur + 0.02); } catch (e) {}
}
function vib(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
let csVoice = null;
function say(txt) {
  if (!S.settings.voice || !window.speechSynthesis) return;
  try {
    if (!csVoice) csVoice = speechSynthesis.getVoices().find(v => /^cs/i.test(v.lang)) || null;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(txt); u.lang = 'cs-CZ'; if (csVoice) u.voice = csVoice; u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch (e) {}
}
async function requestWake() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }
function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && R && !R.finished) requestWake(); });

/* ============================== Váha ============================== */
function lastWeight() { const w = S.weights.slice().sort((a, b) => a.d < b.d ? -1 : 1); return w.length ? w[w.length - 1] : null; }
function sortedW() { return S.weights.slice().sort((a, b) => a.d < b.d ? -1 : 1); }
function trend() {   // lineární regrese posledních 21 dní (kg/den)
  const w = sortedW(); if (w.length < 3) return null;
  const lastD = w[w.length - 1].d, pts = w.filter(x => daysBetween(x.d, lastD) <= 21);
  if (pts.length < 3) return null;
  const xs = pts.map(p => daysBetween(pts[0].d, p.d)), ys = pts.map(p => p.kg), n = xs.length;
  const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  if (sxx < 1) return null;
  return { slope: sxy / sxx, span: xs[n - 1] };
}
function goalStats() {
  const g = S.goal, w = lastWeight(), t = dateStr();
  if (g.start == null || g.target == null) return null;
  const sd = g.startDate || t, cur = w ? w.kg : g.start, out = { cur, lost: g.start - cur, left: cur - g.target };
  if (g.perDay > 0) {
    out.planToday = Math.max(g.target, g.start - g.perDay * Math.max(0, daysBetween(sd, t)));
    out.diff = cur - out.planToday;
    out.etaRate = addDays(sd, Math.ceil((g.start - g.target) / g.perDay));
  }
  if (g.targetDate) {
    out.daysLeft = daysBetween(t, g.targetDate);
    if (out.daysLeft > 0 && out.left > 0) out.needPerDay = out.left / out.daysLeft;
  }
  const tr = trend();
  if (tr) { out.trend = tr.slope; if (tr.slope < -0.005 && out.left > 0) out.etaTrend = addDays(w.d, Math.ceil(out.left / -tr.slope)); }
  return out;
}
function renderVaha() {
  const g = S.goal, gs = goalStats(), w = lastWeight();
  let h = '<div class="card"><h3>Zapsat váhu</h3><div class="grid2"><div><label class="f">Datum</label><input type="date" id="wD" value="' + dateStr() + '"></div>' +
    '<div><label class="f">Váha (kg)</label><input id="wKg" inputmode="decimal" placeholder="' + (w ? num(w.kg) : 'např. 92,5') + '"></div></div>' +
    '<button class="btn primary big" style="margin-top:12px;" onclick="logWeight()">Uložit váhu</button><div class="note" style="margin-top:8px;">Važ se ideálně ráno, po záchodě, před jídlem – ať jsou čísla srovnatelná.</div></div>';
  if (gs) {
    h += '<div class="grid3"><div class="stat"><span>Aktuálně</span><b>' + num(gs.cur) + '</b></div><div class="stat"><span>Zhubnuto</span><b>' + (gs.lost >= 0 ? '−' : '+') + num(Math.abs(gs.lost)) + '</b></div><div class="stat"><span>Zbývá</span><b>' + num(Math.max(0, gs.left)) + '</b></div></div>';
    h += '<div class="card">' + weightChart() + '<div class="small" style="margin-top:10px;line-height:1.6;">';
    if (gs.planToday != null) h += 'Podle tempa <b>' + num(g.perDay, 2) + ' kg/den</b> bys dnes měl mít <b>' + num(gs.planToday) + ' kg</b> → jsi ' + (Math.abs(gs.diff) < 0.15 ? '<b style="color:var(--accent)">přesně v plánu</b>' : gs.diff > 0 ? '<b class="warn">' + num(gs.diff) + ' kg nad plánem</b>' : '<b style="color:var(--accent)">' + num(-gs.diff) + ' kg pod plánem 🎉</b>') + '.<br>';
    if (gs.etaRate) h += 'Tímto tempem cíl <b>' + num(g.target) + ' kg</b> padne <b>' + fmtD(gs.etaRate, true) + '</b>.<br>';
    if (g.targetDate) {
      if (gs.daysLeft <= 0) h += 'Cílové datum <b>' + fmtD(g.targetDate, true) + '</b> už je za tebou.<br>';
      else if (gs.needPerDay) h += 'Do <b>' + fmtD(g.targetDate, true) + '</b> (' + gs.daysLeft + ' dní) potřebuješ <b>' + num(gs.needPerDay, 2) + ' kg/den</b> (' + num(gs.needPerDay * 7, 1) + ' kg/týden).' + (gs.needPerDay > 0.15 ? ' <span class="warn">To je hodně rychlé – zvaž pozdější datum.</span>' : '') + '<br>';
    }
    if (gs.trend != null) h += 'Skutečný trend (posl. 3 týdny): <b>' + (gs.trend <= 0 ? '−' : '+') + num(Math.abs(gs.trend * 7), 2) + ' kg/týden</b>' + (gs.etaTrend ? ' → cíl kolem <b>' + fmtD(gs.etaTrend, true) + '</b>' : '') + '.<br>';
    if (g.height) { const bmi = gs.cur / ((g.height / 100) ** 2); h += 'BMI: <b>' + num(bmi) + '</b>.'; }
    h += '</div></div>';
  } else h += '<div class="card soft small muted">Nastav si níže startovní a cílovou váhu – pak uvidíš graf, plán na každý den a odhad, kdy cíle dosáhneš.</div>';
  h += '<div class="card"><h3>🎯 Cíl hubnutí</h3><div class="grid2">' +
    '<div><label class="f">Startovní váha (kg)</label><input id="gS" inputmode="decimal" value="' + (g.start != null ? num(g.start) : '') + '"></div>' +
    '<div><label class="f">Datum startu</label><input type="date" id="gSD" value="' + (g.startDate || dateStr()) + '"></div>' +
    '<div><label class="f">Cílová váha (kg)</label><input id="gT" inputmode="decimal" value="' + (g.target != null ? num(g.target) : '') + '"></div>' +
    '<div><label class="f">Zhubnout do</label><input type="date" id="gTD" value="' + (g.targetDate || '') + '"></div>' +
    '<div><label class="f">Plán: kg za den</label><input id="gP" inputmode="decimal" value="' + (g.perDay != null ? num(g.perDay, 2) : '') + '"></div>' +
    '<div><label class="f">Výška (cm, pro BMI)</label><input id="gH" inputmode="numeric" value="' + (g.height || '') + '"></div></div>' +
    '<div class="note" style="margin-top:8px;">Zdravé a udržitelné tempo je zhruba 0,5–1 kg týdně, tj. <b>0,07–0,14 kg/den</b>.</div>' +
    '<button class="btn primary big" style="margin-top:12px;" onclick="saveGoal()">Uložit cíl</button></div>';
  const ws = sortedW().reverse();
  if (ws.length) h += '<div class="card"><h3>Záznamy</h3>' + ws.slice(0, 60).map(x => '<div class="hist"><span>' + fmtD(x.d, true) + '</span><span><b>' + num(x.kg) + ' kg</b> <button class="btn sm ghost" onclick="delWeight(\'' + x.d + '\')">✕</button></span></div>').join('') + '</div>';
  $('#v-vaha').innerHTML = h;
}
function logWeight() {
  const kg = pnum($('#wKg').value), d = $('#wD').value || dateStr();
  if (!kg || kg < 30 || kg > 300) { toast('Zadej váhu v kg 🙂'); return; }
  S.weights = S.weights.filter(x => x.d !== d); S.weights.push({ d, kg });
  if (S.goal.start == null) { S.goal.start = kg; S.goal.startDate = d; }
  save(); renderVaha(); renderDnes();
  const gs = goalStats();
  toast(gs && gs.diff != null ? (gs.diff <= 0 ? '🎉 Jsi v plánu! Napij se vody.' : 'Zapsáno. Jsi ' + num(gs.diff) + ' kg nad plánem – vydrž!') : 'Zapsáno ✅');
}
function delWeight(d) { if (!confirm('Smazat záznam z ' + fmtD(d, true) + '?')) return; S.weights = S.weights.filter(x => x.d !== d); save(); renderVaha(); }
function saveGoal() {
  const g = S.goal;
  g.start = pnum($('#gS').value); g.startDate = $('#gSD').value || dateStr(); g.target = pnum($('#gT').value);
  g.targetDate = $('#gTD').value || null; g.perDay = pnum($('#gP').value); g.height = pnum($('#gH').value);
  if (g.start != null && g.target != null && g.target >= g.start) toast('Cílová váha má být nižší než startovní 🙂');
  else toast('Cíl uložen ✅');
  if (g.perDay != null && g.perDay > 0.2) toast('⚠️ ' + num(g.perDay, 2) + ' kg/den je hodně – zdravě je to do ~0,14.', 3500);
  save(); renderVaha(); renderDnes();
}
function weightChart() {
  const g = S.goal, ws = sortedW(), W = 340, H = 190, pl = 34, pr = 8, pt = 10, pb = 22;
  const t0 = g.startDate || (ws[0] && ws[0].d) || dateStr();
  let t1 = addDays(dateStr(), 14);
  [g.targetDate, ws.length && ws[ws.length - 1].d].forEach(x => { if (x && x > t1) t1 = x; });
  const gs = goalStats(); if (gs && gs.etaRate && gs.etaRate > t1 && daysBetween(t0, gs.etaRate) < 900) t1 = gs.etaRate;
  const span = Math.max(7, daysBetween(t0, t1));
  const vals = ws.map(x => x.kg).concat([g.start, g.target].filter(v => v != null));
  let lo = Math.min.apply(null, vals) - 1, hi = Math.max.apply(null, vals) + 1;
  if (!isFinite(lo)) { lo = 70; hi = 100; }
  const X = d => pl + (W - pl - pr) * clamp(daysBetween(t0, d) / span, -0.05, 1.05), Y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block">';
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '" stroke="#28403a" stroke-width="1"/><text x="' + (pl - 4) + '" y="' + (y + 4) + '" fill="#8fb0a6" font-size="10" text-anchor="end">' + Math.round(v) + '</text>'; }
  s += '<text x="' + pl + '" y="' + (H - 6) + '" fill="#8fb0a6" font-size="10">' + fmtD(t0) + '</text><text x="' + (W - pr) + '" y="' + (H - 6) + '" fill="#8fb0a6" font-size="10" text-anchor="end">' + fmtD(t1) + '</text>';
  if (g.target != null) s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(g.target) + '" y2="' + Y(g.target) + '" stroke="#34d399" stroke-width="1.2" stroke-dasharray="2 3"/><text x="' + (W - pr) + '" y="' + (Y(g.target) - 4) + '" fill="#34d399" font-size="10" text-anchor="end">cíl ' + num(g.target) + '</text>';
  if (g.start != null && g.perDay > 0 && g.target != null) {
    const end = addDays(t0, Math.ceil((g.start - g.target) / g.perDay));
    s += '<line x1="' + X(t0) + '" y1="' + Y(g.start) + '" x2="' + X(end) + '" y2="' + Y(g.target) + '" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="5 4"/>';
  }
  if (g.start != null && g.target != null && g.targetDate) s += '<line x1="' + X(t0) + '" y1="' + Y(g.start) + '" x2="' + X(g.targetDate) + '" y2="' + Y(g.target) + '" stroke="#60a5fa" stroke-width="1.2" stroke-dasharray="1.5 3"/>';
  const tx = X(dateStr()); s += '<line x1="' + tx + '" x2="' + tx + '" y1="' + pt + '" y2="' + (H - pb) + '" stroke="#8fb0a6" stroke-width="0.8" stroke-dasharray="2 2"/>';
  if (ws.length) {
    s += '<polyline fill="none" stroke="#eef6f3" stroke-width="2" points="' + ws.map(x => X(x.d).toFixed(1) + ',' + Y(x.kg).toFixed(1)).join(' ') + '"/>';
    s += ws.map(x => '<circle cx="' + X(x.d).toFixed(1) + '" cy="' + Y(x.kg).toFixed(1) + '" r="2.8" fill="#34d399"/>').join('');
  }
  s += '</svg><div class="tiny muted row wrapf" style="gap:12px;margin-top:4px;"><span>⚪ skutečnost</span><span style="color:#fbbf24">– – plán podle kg/den</span>' + (g.targetDate ? '<span style="color:#60a5fa">··· k cílovému datu</span>' : '') + '<span style="color:#34d399">cíl</span></div>';
  return s;
}

/* ============================== Pokrok ============================== */
function renderPokrok() {
  const totalMin = S.sessions.reduce((a, s) => a + (s.min || 0), 0);
  let h = '<div class="grid2"><div class="stat"><span>Úroveň</span><b>' + lvlTxt(S.level) + '</b></div><div class="stat"><span>Délka tréninku teď</span><b>≈ ' + buildPlan(S.dayIdx).est + ' min</b></div>' +
    '<div class="stat"><span>Tréninků</span><b>' + S.sessions.length + '</b></div><div class="stat"><span>Odcvičeno</span><b>' + Math.floor(totalMin / 60) + ' h ' + (totalMin % 60) + ' min</b></div></div>';
  // kalendář posledních 5 týdnů
  const set = new Set(S.sessions.map(s => s.date)), t = dateStr(), dow = (new Date().getDay() + 6) % 7, startC = addDays(t, -dow - 28);
  h += '<div class="card"><h3>Posledních 5 týdnů</h3><div class="cal">' + ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map(d => '<div style="background:none">' + d + '</div>').join('');
  for (let i = 0; i < 35; i++) { const d = addDays(startC, i); h += '<div class="' + (set.has(d) ? 'done ' : '') + (d === t ? 'today ' : '') + (d > t ? 'fut' : '') + '">' + parseD(d).getDate() + '</div>'; }
  h += '</div></div>';
  // co se odemkne
  const upcoming = window.CVIKY.list.filter(e => (e.unlock || 0) > S.level && allowed(e)).sort((a, b) => a.unlock - b.unlock).slice(0, 4);
  if (upcoming.length) h += '<div class="card"><h3>🔒 Brzy se odemkne</h3>' + upcoming.map(e => '<div class="exl"><span>' + esc(e.name) + '</span><span class="d">úroveň ' + lvlTxt(e.unlock) + '</span></div>').join('') + '</div>';
  // AI trenér
  const hasKey = !!oaiKey();
  h += '<div class="card"><h3>🤖 AI trenér</h3>';
  if (!hasKey) h += '<div class="small muted">Volitelné: vlož OpenAI API klíč v Nastavení a trenér ti zhodnotí pokrok, hubnutí a odpoví na otázky (např. „bolí mě koleno, co vynechat?“). Stojí zlomky haléře za dotaz.</div>';
  else {
    h += '<button class="btn" onclick="aiReview()">📋 Zhodnoť můj pokrok</button>' +
      '<label class="f">Zeptej se trenéra</label><textarea id="aiQ" placeholder="Např. Po bulharských dřepech mě pobolívá koleno, co s tím?"></textarea><button class="btn" style="margin-top:8px;" onclick="aiAsk()">Zeptat se</button>';
    h += '<div id="aiOut">' + (S.ai.last ? '<div class="ai">' + esc(S.ai.last) + '</div><div class="tiny muted" style="margin-top:4px;">' + fmtD(S.ai.lastDate || dateStr(), true) + '</div>' : '') + '</div>';
  }
  h += '</div>';
  // osobní úpravy cviků
  const offs = Object.keys(S.exOff);
  if (offs.length) h += '<div class="card"><h3>Osobní úpravy cviků</h3>' + offs.map(k => { const e = famList(k)[0]; return '<div class="exl"><span>' + esc(e ? (e.fam ? famList(k).map(x => x.name).join(' / ') : e.name) : k) + '</span><span class="d">' + (S.exOff[k] > 0 ? '+' : '') + num(S.exOff[k]) + ' <button class="btn sm ghost" onclick="resetOff(\'' + k + '\')">✕</button></span></div>'; }).join('') + '</div>';
  // historie
  h += '<div class="card"><h3>Historie</h3>' + (S.sessions.length ? S.sessions.slice().reverse().slice(0, 50).map((s, ri) => {
    const i = S.sessions.length - 1 - ri, d = DNY.find(x => x.id === s.day) || DNY[0];
    return '<div class="hist"><span>' + fmtD(s.date) + ' ' + d.emoji + ' <span class="muted small">' + esc(d.name) + ' · ' + s.min + ' min</span></span><span>' + (FB[s.fb] ? FB[s.fb].e : '') + ' <span class="muted small">' + lvlTxt(s.l0) + '→' + lvlTxt(s.l1) + '</span> <button class="btn sm ghost" onclick="delSession(' + i + ')">✕</button></span></div>';
  }).join('') : '<div class="small muted">Zatím nic – první trénink tě čeká na záložce Dnes 💪</div>') + '</div>';
  $('#v-pokrok').innerHTML = h;
}
function resetOff(k) { delete S.exOff[k]; save(); renderPokrok(); }
function delSession(i) {
  const s = S.sessions[i]; if (!s || !confirm('Smazat trénink z ' + fmtD(s.date, true) + '? (úroveň se vrátí o jeho změnu)')) return;
  S.level = clamp(S.level - ((s.l1 || 0) - (s.l0 || 0)), LMIN, LMAX); S.sessions.splice(i, 1); save(); renderAll();
}

/* ============================== Cviky ============================== */
const CATS = [['warm', '🔥 Rozcvička'], ['legs', '🦵 Nohy & síla'], ['power', '⚡ Výbušnost'], ['core', '🧱 Zpevnění'], ['mob', '🧘 Protažení & kyčle']];
function renderCviky() {
  let h = '<div class="note" style="margin-top:6px;">Klepni na cvik pro animaci a techniku. Dávky jsou spočítané pro tvou aktuální úroveň.</div>';
  CATS.forEach(([c, t]) => {
    const list = window.CVIKY.list.filter(e => e.cat === c);
    h += '<h2>' + t + '</h2><div class="card">' + list.map(e => {
      const locked = (e.unlock || 0) > S.level + (S.exOff[offKey(e)] || 0), blocked = !allowed(e);
      return '<div class="exc" id="exc-' + e.id + '"><button class="hd" onclick="toggleExc(\'' + e.id + '\')"><span>' + esc(e.name) + (e.sh ? '<span class="tag sh">rameno</span>' : '') + '</span><span class="d small muted">' +
        (blocked ? '🚫 vypnuto' : locked ? '🔒 úr. ' + lvlTxt(e.unlock) : doseTxt(e, dose(e), true)) + '</span></button><div class="det"></div></div>';
    }).join('') + '</div>';
  });
  $('#v-cviky').innerHTML = h;
}
function toggleExc(id) {
  const el = document.getElementById('exc-' + id), e = EX[id], det = el.querySelector('.det');
  if (el.classList.toggle('open')) {
    det.innerHTML = '<canvas class="fitanim" data-anim="' + id + '"></canvas><div class="phase small" style="text-align:center;color:var(--orange);font-weight:700;min-height:18px;margin-top:4px;"></div>' +
      '<ul class="cues">' + e.cues.map(c => '<li>' + esc(c) + '</li>').join('') + '</ul><div class="why">⚽ ' + esc(e.why) + '</div>' +
      (e.sh ? '<div class="note warn" style="margin-top:6px;">🦾 Opora o předloktí/ruce – mírná zátěž ramene.' + (e.alt ? ' Náhrada: ' + esc(EX[e.alt].name) + '.' : '') + '</div>' : '');
    const cv = det.querySelector('canvas'); cv._label = det.querySelector('.phase');
  } else det.innerHTML = '';
}

/* ============================== Nastavení ============================== */
function renderNast() {
  const st = S.settings, hasKey = !!oaiKey();
  let h = '<div class="card"><h3>Trénink</h3>' +
    '<label class="f">Maximální délka tréninku: <b id="mmV">' + st.maxMin + ' min</b></label><input type="range" min="15" max="30" step="5" value="' + st.maxMin + '" oninput="$(\'#mmV\').textContent=this.value+\' min\'" onchange="setS(\'maxMin\',+this.value)">' +
    '<div class="note">Délka roste s úrovní automaticky: začínáš na ~15 min, kolem úrovně 7 je to ~20 min a dál až k tomuto maximu.</div>' +
    '<label class="f">Šetření ramene</label><div class="chips"><button class="chip' + (st.shoulder === 'mirne' ? ' on' : '') + '" onclick="setS(\'shoulder\',\'mirne\')">Mírné (plank na předloktích OK)</button><button class="chip' + (st.shoulder === 'prisne' ? ' on' : '') + '" onclick="setS(\'shoulder\',\'prisne\')">Přísné (žádná opora o ruce)</button></div>' +
    '<div class="note">Žádné kliky, shyby, tlaky nad hlavu ani zátěž na natažené paže – v aplikaci vůbec nejsou.</div>' +
    '<div class="row between" style="margin-top:12px;"><span>🔊 Zvuky a odpočítávání</span><button class="chip' + (st.sound ? ' on' : '') + '" onclick="setS(\'sound\',' + !st.sound + ')">' + (st.sound ? 'Zapnuto' : 'Vypnuto') + '</button></div>' +
    '<div class="row between" style="margin-top:8px;"><span>🗣 Hlasové pokyny (česky)</span><button class="chip' + (st.voice ? ' on' : '') + '" onclick="setS(\'voice\',' + !st.voice + ')">' + (st.voice ? 'Zapnuto' : 'Vypnuto') + '</button></div>' +
    '<div class="row between" style="margin-top:12px;"><span>Úroveň: <b>' + lvlTxt(S.level) + '</b></span><span><button class="btn sm" onclick="nudgeLevel(-1)">−1</button> <button class="btn sm" onclick="nudgeLevel(1)">+1</button></span></div></div>';
  h += '<div class="card"><h3>💧 Připomínky</h3>' +
    '<div class="row between"><span>„Napij se!“ každých 45 min, když je aplikace otevřená</span><button class="chip' + (st.drinkNag ? ' on' : '') + '" onclick="setS(\'drinkNag\',' + !st.drinkNag + ')">' + (st.drinkNag ? 'Zapnuto' : 'Vypnuto') + '</button></div>' +
    '<div class="note" style="margin-top:10px;">Aby ti telefon připomínal každý den i se zavřenou aplikací, stáhni si připomínky do kalendáře (soubor .ics – otevři ho v telefonu a potvrď přidání do kalendáře).</div>' +
    '<label class="f">Časy připomínek pití a jídelních zákazů</label><div class="grid3">' + st.remindTimes.map((t, i) => '<input type="time" value="' + t + '" onchange="setRemind(' + i + ',this.value)">').join('') + '</div>' +
    '<label class="f">Připomínka tréninku</label><input type="time" value="' + st.trainTime + '" onchange="setS(\'trainTime\',this.value,true)">' +
    '<button class="btn" style="margin-top:12px;width:100%;" onclick="downloadIcs()">📅 Stáhnout denní připomínky do kalendáře</button></div>';
  h += '<div class="card"><h3>🤖 AI trenér (OpenAI)</h3><div class="note">Volitelné. Klíč z <b>platform.openai.com → API keys</b>; na OpenAI si nastav měsíční limit (např. 2 USD). Klíč se ukládá jen v tomto zařízení a nejde do zálohy. Jeden dotaz stojí zlomek haléře.</div>' +
    (hasKey ? '<div class="small" style="margin-top:10px;">✅ Klíč je uložený' + (S.ai.model ? ' · model <b>' + esc(S.ai.model) + '</b>' : '') + '</div><div class="small muted" id="oaiStatus"></div>' +
      '<div class="small muted" style="margin-top:6px;">Tento měsíc: ' + (S.ai.month === dateStr().slice(0, 7) ? S.ai.calls + ' dotazů, ' + (S.ai.tokIn + S.ai.tokOut) + ' tokenů' : '0 dotazů') + '</div>' +
      '<div class="row" style="margin-top:10px;"><button class="btn sm" onclick="testKey()">Ověřit</button><button class="btn sm danger" onclick="removeKey()">Odebrat klíč</button></div>'
      : '<input id="oaiKey" type="password" placeholder="sk-..." autocomplete="off" style="margin-top:10px;"><button class="btn" style="margin-top:8px;" onclick="saveKey()">Uložit klíč</button><div class="small muted" id="oaiStatus"></div>') + '</div>';
  h += '<div class="card"><h3>💾 Záloha dat</h3><div class="note">Data jsou jen v tomto prohlížeči. Občas si stáhni zálohu.</div><div class="row wrapf" style="margin-top:10px;"><button class="btn sm" onclick="exportData()">⬇ Stáhnout zálohu</button><label class="btn sm">⬆ Obnovit ze zálohy<input type="file" accept=".json,application/json" style="display:none" onchange="importData(this)"></label><button class="btn sm danger" onclick="resetAll()">Smazat vše</button></div></div>';
  h += '<div class="note" style="text-align:center;margin:16px 0;">Při ostré bolesti (hlavně v rameni, koleni, zádech) cvik vynech. Aplikace nenahrazuje lékaře ani fyzioterapeuta.</div>';
  $('#v-nast').innerHTML = h;
}
function setS(k, v, quiet) { S.settings[k] = v; save(); if (k === 'drinkNag') setupNag(); if (!quiet) { renderNast(); renderDnes(); } }
function setRemind(i, v) { S.settings.remindTimes[i] = v; save(); }
function nudgeLevel(d) { S.level = clamp(Math.round((S.level + d) * 100) / 100, LMIN, LMAX); save(); renderAll(); }
function downloadIcs() {
  const pad = n => String(n).padStart(2, '0'), d = new Date(), ds = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = (time, sum, desc, i) => { const t = time.replace(':', '') + '00';
    return ['BEGIN:VEVENT', 'UID:martin-cviceni-' + i + '-' + ds + '@local', 'DTSTAMP:' + stamp, 'DTSTART:' + ds + 'T' + t, 'DURATION:PT5M', 'RRULE:FREQ=DAILY', 'SUMMARY:' + sum, 'DESCRIPTION:' + desc,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + sum, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT'].join('\r\n'); };
  const evs = S.settings.remindTimes.filter(Boolean).map((t, i) => ev(t, ['💧 Napij se! Celá sklenice vody', '💧 Napij se! Žádné brambůrky ani sladkosti', '💧 Napij se! Večer bez piva a slazeného pití'][i % 3],
    'Hodně pij. Dnes žádné brambůrky\\, sladkosti\\, smažené\\, slazené pití ani pivo.', i));
  if (S.settings.trainTime) evs.push(ev(S.settings.trainTime, '🏃 Dnešní cvičení (15–20 min)', 'Otevři aplikaci Martin – Cvičení a dej si dnešní trénink.', 9));
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Martin cviceni//CZ', 'CALSCALE:GREGORIAN'].concat(evs, ['END:VCALENDAR']).join('\r\n');
  dl(new Blob([ics], { type: 'text/calendar' }), 'pripominky-martin.ics');
  toast('📅 Otevři stažený soubor a přidej do kalendáře');
}
function dl(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function exportData() { dl(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }), 'martin-cviceni-zaloha-' + dateStr() + '.json'); }
function importData(inp) {
  const f = inp.files && inp.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try { const s = JSON.parse(r.result); if (!s || !Array.isArray(s.sessions)) throw 0; if (!confirm('Přepsat současná data zálohou?')) return; localStorage.setItem(STORE_KEY, JSON.stringify(s)); S = load(); renderAll(); toast('Obnoveno ✅'); } catch (e) { toast('⚠️ To není platná záloha'); } };
  r.readAsText(f);
}
function resetAll() { if (!confirm('Opravdu smazat všechna data (tréninky, váhu, cíl)?')) return; if (!confirm('Fakt? Nejde to vrátit.')) return; S = DEF(); save(); renderAll(); }

/* ============================== OpenAI ============================== */
const OAI_API = 'https://api.openai.com/v1/', OAI_DEFAULT_MODEL = 'gpt-5.6-luna';
function oaiKey() { try { return localStorage.getItem(OAI_KEY_STORE) || ''; } catch (e) { return ''; } }
function saveKey() { const v = ($('#oaiKey').value || '').trim(); if (!v) { toast('Vlož klíč 🙂'); return; } try { localStorage.setItem(OAI_KEY_STORE, v); } catch (e) {} S.ai.model = null; save(); renderNast(); renderPokrok(); testKey(); }
function removeKey() { if (!confirm('Odebrat OpenAI klíč z tohoto zařízení?')) return; try { localStorage.removeItem(OAI_KEY_STORE); } catch (e) {} S.ai.model = null; save(); renderNast(); renderPokrok(); }
async function oaiFetch(path, opts) {
  const r = await fetch(OAI_API + path, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + oaiKey() }, (opts && opts.headers) || {}) }));
  let body = null; try { body = await r.json(); } catch (e) {}
  if (!r.ok) { const er = (body && body.error) || {}; const err = new Error(er.message || ('HTTP ' + r.status)); err.status = r.status; err.code = er.code || ''; throw err; }
  return body;
}
async function oaiModel() {
  if (S.ai.model) return S.ai.model;
  let pick = OAI_DEFAULT_MODEL;
  try {
    const res = await oaiFetch('models', { method: 'GET' });
    const ids = (res.data || []).map(m => m.id).filter(id => /luna/i.test(id) && !/audio|realtime|search|transcribe|tts|image/i.test(id));
    const ver = id => { const m = id.match(/gpt-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
    ids.sort((a, b) => (ver(b) - ver(a)) || ((/\d{4}-\d{2}-\d{2}/.test(a) ? 1 : 0) - (/\d{4}-\d{2}-\d{2}/.test(b) ? 1 : 0)));
    if (ids.length) pick = ids[0];
  } catch (e) { if (e.status === 401) throw e; }
  S.ai.model = pick; save(); return pick;
}
function oaiErr(e) {
  const m = (e.message || '') + ' ' + (e.code || '');
  if (!navigator.onLine) return 'Jsi offline.';
  if (e.status === 401) return 'Klíč není platný (začíná „sk-“?).';
  if (/insufficient_quota|billing|quota/i.test(m)) return 'Došel kredit nebo je vyčerpaný měsíční limit na OpenAI.';
  if (e.status === 429) return 'OpenAI je přetížené – zkus to za chvilku.';
  if (e instanceof TypeError) return 'Nepodařilo se spojit s OpenAI.';
  return 'OpenAI: ' + (e.message || 'neznámá chyba');
}
async function testKey() {
  const st = $('#oaiStatus'); if (st) st.textContent = '⏳ Ověřuji…';
  try { S.ai.model = null; const m = await oaiModel(); if (st) st.textContent = '✅ Funguje, model ' + m; renderNast(); toast('Klíč funguje ✅'); }
  catch (e) { if (st) st.textContent = '⚠️ ' + oaiErr(e); }
}
function aiContext() {
  const g = S.goal, gs = goalStats();
  return {
    dnes: dateStr(), uroven: +lvlTxt(S.level).replace(',', '.'), setreni_ramene: S.settings.shoulder,
    cil: { start_kg: g.start, start_datum: g.startDate, cil_kg: g.target, cil_datum: g.targetDate, plan_kg_den: g.perDay, vyska_cm: g.height },
    vaha_stav: gs ? { aktualne: gs.cur, zhubnuto: +gs.lost.toFixed(1), zbyva: +gs.left.toFixed(1), trend_kg_tyden: gs.trend != null ? +(gs.trend * 7).toFixed(2) : null } : null,
    vahy_posledni: sortedW().slice(-20),
    treninky_posledni: S.sessions.slice(-20).map(s => ({ datum: s.date, typ: (DNY.find(d => d.id === s.day) || {}).name, minut: s.min, hodnoceni: FB[s.fb] ? FB[s.fb].t : null, hotovo_cviku: s.done + '/' + s.total })),
    dnesni_plan: (() => { const p = buildPlan(S.dayIdx); return p.main.map(it => EX[it.id].name + ' ' + doseTxt(EX[it.id], it.d, true)); })(),
    osobni_upravy: S.exOff
  };
}
const AI_SYS = 'Jsi kondiční trenér amatérského fotbalisty Martina. Cvičí doma 15–30 min denně jen s vlastní vahou (židle, stupínek 20 cm, podložka), musí šetřit rameno (žádné kliky, shyby, tlaky nad hlavu, opory o natažené paže). ' +
  'Cíle: zhubnout, větší hybnost a rozsah kyčlí, lepší zpevnění těla pro kontrolu míče, silnější střela. Aplikace sama řídí progresi podle jeho hodnocení po každém tréninku – neměň plán, jen raď. ' +
  'Jídlo neřeší; smíš jen připomenout: hodně pít vodu, vyhnout se brambůrkům, sladkostem, smaženému, slazenému pití a pivu. Při bolesti doporuč vynechat cvik a případně fyzioterapeuta. ' +
  'Odpovídej česky, tykej, stručně a konkrétně (max. 170 slov), bez nadpisů a markdownu, odrážky jako „• “.';
async function aiCall(user) {
  const out = $('#aiOut'); if (out) out.innerHTML = '<div class="ai">⏳ Trenér přemýšlí…</div>';
  try {
    const model = await oaiModel();
    const res = await oaiFetch('chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: AI_SYS }, { role: 'user', content: user }], reasoning_effort: 'low', max_completion_tokens: 1500 }) });
    const txt = ((res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || '').trim() || '(prázdná odpověď)';
    const mo = dateStr().slice(0, 7); if (S.ai.month !== mo) { S.ai.month = mo; S.ai.calls = 0; S.ai.tokIn = 0; S.ai.tokOut = 0; }
    S.ai.calls++; if (res.usage) { S.ai.tokIn += res.usage.prompt_tokens || 0; S.ai.tokOut += res.usage.completion_tokens || 0; }
    S.ai.last = txt; S.ai.lastDate = dateStr(); save(); renderPokrok();
  } catch (e) { if (out) out.innerHTML = '<div class="ai">⚠️ ' + esc(oaiErr(e)) + '</div>'; }
}
function aiReview() { aiCall('Zhodnoť můj dosavadní pokrok v tréninku a hubnutí. Napiš: co jde dobře, na co si dát pozor a 2–3 konkrétní tipy na příští týden (cvičení doma + fotbal). Data:\n' + JSON.stringify(aiContext())); }
function aiAsk() { const q = ($('#aiQ').value || '').trim(); if (!q) { toast('Napiš otázku 🙂'); return; } aiCall('Otázka: ' + q + '\n\nKontext (moje data):\n' + JSON.stringify(aiContext())); }

/* ============================== navigace, start ============================== */
function switchView(v) {
  document.querySelectorAll('.view').forEach(x => x.classList.toggle('on', x.id === 'v-' + v));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  ({ dnes: renderDnes, vaha: renderVaha, pokrok: renderPokrok, cviky: renderCviky, nast: renderNast })[v]();
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => switchView(b.dataset.v)));
function renderAll() { renderHeader(); renderDnes(); renderVaha(); renderPokrok(); renderCviky(); renderNast(); }
let nagH = null;
function setupNag() {
  clearInterval(nagH);
  if (S.settings.drinkNag) nagH = setInterval(() => { if (document.visibilityState === 'visible' && !(R && !R.finished)) { toast(DRINK[Math.floor(Math.random() * DRINK.length)], 5000); vib(60); } }, 45 * 60 * 1000);
}
/* dlouhá pauza: po víc než týdnu bez tréninku mírně uber (jednou za pauzu) */
function checkBreak() {
  const ls = lastSession(); if (!ls) return;
  const gap = daysBetween(ls.date, dateStr());
  if (gap >= 8 && S.lastDecayFor !== ls.date) {
    const d = Math.min(3, 0.75 * Math.floor(gap / 7));
    S.level = clamp(S.level - d, LMIN, LMAX); S.lastDecayFor = ls.date; save();
    setTimeout(() => toast('Vítej zpět! Po ' + gap + ' dnech pauzy jsem trochu ubral (−' + num(d) + ' úrovně).', 4500), 600);
  }
}
checkBreak();
renderAll();
setupNag();
setTimeout(() => toast(DRINK[dayOfYear() % DRINK.length], 4000), 900);
if (window.FitAnim) window.FitAnim.start();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
