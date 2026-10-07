/* =====================================================================
   anim-trup.js – cviky na střed těla (core) a hýždě, vlastní váha
   Klíče: most, most-pochod, most-1noha, most-zidle-1noha, kopenhagen, unozovani,
          dead-bug, bird-dog, plank, bocni-plank, hollow, rus-twist, superman
   Závisí na jádru anim-jadro.js (window.FitAnim). Všechny délky se berou z FitAnim.BODY.
   Opěrné body (chodidla, lokty, kolena) jsou v poloze pevné; končetiny se řeší přes ik2 / FK s pevnými
   délkami a kloubové řetězce přes průsečíky kružnic (délky segmentů se nikdy neroztahují).
   Většina cviků je v bočním pohledu; kodaňský plank, boční plank, unožování a ruská rotace
   jsou v čelním pohledu (postava leží na boku napříč scénou / sedí čelem k divákovi).
   ===================================================================== */
(function () {
  'use strict';

  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  var FA = root.FitAnim;
  if (!FA || typeof FA.register !== 'function') {
    if (typeof console !== 'undefined') console.warn('anim-trup.js: jádro FitAnim není načteno (anim-jadro.js musí být před tímto souborem).');
    return;
  }

  var PI = Math.PI, D2R = PI / 180, R2D = 180 / PI;

  /* ------------------------------ pomocné funkce ------------------------------ */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sq(v) { return v * v; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function P(base, angDeg, len) { return FA.pt(base, angDeg, len); }
  function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
  function d2(a, b) { return sq(a[0] - b[0]) + sq(a[1] - b[1]); }
  function copy(p) { return [p[0], p[1]]; }
  function ang(a, b) { return FA.ang(a, b); }
  function dirv(angDeg) { return [Math.cos(angDeg * D2R), Math.sin(angDeg * D2R)]; }
  function wave(time, period) { return Math.sin((time || 0) / 1000 * 2 * PI / (period || 3.8)); }

  /* 2-kloubové IK; strana kloubu se vybírá podle nápovědy (hint = bod, ke kterému má být kloub blíž) */
  function ik(base, target, l1, l2, hint) {
    var a = FA.ik2(base, target, l1, l2, 1), b = FA.ik2(base, target, l1, l2, -1);
    return d2(a.mid, hint) <= d2(b.mid, hint) ? a : b;
  }
  /* kloub ve směru (fx,fy) od spojnice base–target */
  function ikDir(base, target, l1, l2, fx, fy) {
    var m = mid(base, target);
    return ik(base, target, l1, l2, [m[0] + fx * 60, m[1] + fy * 60]);
  }
  /* průsečík dvou kružnic (sel = ±1 vybírá stranu od spojnice středů) */
  function circInt(c0, r0, c1, r1, sel) {
    var dx = c1[0] - c0[0], dy = c1[1] - c0[1], dl = Math.hypot(dx, dy) || 1e-6;
    var d = clamp(dl, Math.abs(r0 - r1) + 1e-3, r0 + r1 - 1e-3);
    var a = (r0 * r0 - r1 * r1 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r0 * r0 - a * a));
    var ux = dx / dl, uy = dy / dl;
    return [c0[0] + ux * a - uy * h * sel, c0[1] + uy * a + ux * h * sel];
  }
  /* totéž, ale vybere průsečík níž (lower) nebo výš na obrazovce */
  function circInt2(c0, r0, c1, r1, lower) {
    var a = circInt(c0, r0, c1, r1, 1), b = circInt(c0, r0, c1, r1, -1);
    return lower ? (a[1] >= b[1] ? a : b) : (a[1] <= b[1] ? a : b);
  }

  /* ---------- chodidlo: bota otočená o r stupňů (0 = naplocho špičkou doprava, -90 = špička nahoru, 62 = na špičce) ---------- */
  var SHOE = (function () {                               // obrys boty (kotník = [0,0]) – vzorkované křivky z jádra
    var pts = [[-8.5, 8], [17.2, 8]], i, q;
    function quad(p0, c0, p1) { for (var k = 1; k <= 4; k++) { q = k / 4; pts.push([(1 - q) * (1 - q) * p0[0] + 2 * (1 - q) * q * c0[0] + q * q * p1[0], (1 - q) * (1 - q) * p0[1] + 2 * (1 - q) * q * c0[1] + q * q * p1[1]]); } }
    quad([17.2, 8], [21.8, 8], [21, 4.1]); quad([21, 4.1], [19.5, 1], [11.7, -0.2]); quad([11.7, -0.2], [7, -0.6], [3.9, -5]);
    pts.push([-4.7, -3.8]); quad([-4.7, -3.8], [-8.6, 0.2], [-8.6, 4.9]);
    return pts;
  })();
  function footT(A, r) {                                  // bod J.toe*, kterým se bota natočí o r stupňů
    var a = r * D2R + Math.atan2(FA.BODY.ankleH, 20.5);
    return [A[0] + Math.cos(a) * FA.BODY.foot, A[1] + Math.sin(a) * FA.BODY.foot];
  }
  function shoeLow(r) {                                   // nejnižší bod boty (y) vůči kotníku
    var c = Math.cos(r * D2R), s = Math.sin(r * D2R), m = -1e9, i, y;
    for (i = 0; i < SHOE.length; i++) { y = SHOE[i][0] * s + SHOE[i][1] * c; if (y > m) m = y; }
    return m;
  }

  function cycIdx(info) {                                 // pořadí opakování (pro střídání stran)
    if (!info || info.phase === 'freeze' || info.phase === 'static') return 0;
    return info.phase === 'up' ? info.rep : info.rep - 1;
  }
  function side(info) { return ((cycIdx(info) % 2) + 2) % 2; }

  function matTop() { return FA.FLOOR - 4.2; }
  function mat(c, x1, x2) { FA.gear.mat(c, x1, x2); }

  var SH_OFF = 7.6, HIP_OFF = 12.2, HEAD_OFF = 12.6;       // výška osy ramene / kyčle / hlavy nad podložkou při ležení na zádech

  /* hlava ležící na podložce na zádech (hlava vlevo) */
  function headSupine(S) {
    var b = FA.BODY, R = b.neck + b.headR, dy = clamp((matTop() - HEAD_OFF) - S[1], -R * 0.9, R * 0.9);
    return [S[0] - Math.sqrt(R * R - dy * dy), S[1] + dy];
  }
  /* paže natažená po podložce (zápěstí o frac délky paže od ramene) */
  function armLie(S, frac) {
    var b = FA.BODY, top = matTop(), w = [S[0] + frac * (b.upperArm + b.forearm), top - 3.8];
    return ik(S, w, b.upperArm, b.forearm, [(S[0] + w[0]) / 2, top - 40]);
  }
  /* paže jako FK z úhlu a (deg) s lehkým ohnutím lokte bend (deg) */
  function armFK(S, a, bend) {
    var b = FA.BODY, e = P(S, a, b.upperArm);
    return { mid: e, end: P(e, a + (bend || 0), b.forearm * 0.995) };
  }
  function legFK(hip, aT, aS) {
    var b = FA.BODY, k = P(hip, aT, b.thigh);
    return { mid: k, end: P(k, aS, b.shin) };
  }
  function setLeg(J, which, k, a, r) {                    // which = 'N' | 'F'
    J['knee' + which] = k; J['ankle' + which] = a; J['toe' + which] = footT(a, r);
  }
  function setArm(J, which, e, w) { J['elbow' + which] = e; J['wrist' + which] = w; }

  /* ===================================================================
     MOST (+ varianty) – leh na zádech, pohled zboku, hlava vlevo
     =================================================================== */
  function bridgeGeo(mode) {
    var b = FA.BODY, top = matTop(), T = b.torso, th = b.thigh, sh = b.shin, L = th + sh, g = { mode: mode };
    var shY = top - SH_OFF, hipY0 = top - HIP_OFF;
    g.top = top; g.shY = shY; g.th0 = Math.asin(clamp((shY - hipY0) / T, -1, 1));
    if (mode === 'chair') {
      g.seatTop = FA.FLOOR - FA.CHAIR_H; g.rAnk = -95;
      var hx0 = T * Math.cos(g.th0), hy0 = shY - T * Math.sin(g.th0), ay = g.seatTop - shoeLow(g.rAnk);
      var d0 = 0.975 * L, dx = Math.sqrt(Math.max(0, d0 * d0 - sq(ay - hy0)));
      g.D = hx0 + dx; g.ay = ay; g.th1 = 32 * D2R;
      g.sx = FA.W / 2 - (g.D - 3) / 2; g.zoom = 1.4;
    } else {
      g.D = 1.02 * L; g.ay = top - b.ankleH;
      var Ls = T + th, c = (g.D * g.D + Ls * Ls - sh * sh) / (2 * g.D * Ls);
      g.th1 = Math.acos(clamp(c, -1, 1)); g.sx = FA.W / 2 - (g.D - 11) / 2; g.zoom = 1.5;
    }
    return g;
  }

  function bridgeSolve(mode, t, time, info) {
    var b = FA.BODY, g = bridgeGeo(mode), S = [g.sx, g.shY], A = [g.sx + g.D, g.ay];
    var e = mode === 'march' ? 1 : t;
    var th = lerp(g.th0, g.th1, e), hip = [S[0] + b.torso * Math.cos(th), S[1] - b.torso * Math.sin(th)];
    var m = mid(hip, A), sup = ik(hip, A, b.thigh, b.shin, [m[0], m[1] - 80]);
    var arm = armLie(S, 0.995);
    var J = { hip: hip, shoulder: S, head: headSupine(S), headRot: -90 };
    setArm(J, 'N', arm.mid, arm.end); setArm(J, 'F', copy(arm.mid), copy(arm.end));
    var rA = mode === 'chair' ? g.rAnk : 0;
    setLeg(J, 'N', sup.mid, sup.end, rA);
    if (mode === 'both') {
      setLeg(J, 'F', copy(sup.mid), copy(sup.end), rA);
    } else if (mode === 'single' || mode === 'chair') {          // volná noha natažená šikmo vzhůru
      var fa = lerp(-48, -(g.th1 * R2D + 9), t), fl = legFK(hip, fa, fa);
      setLeg(J, 'F', fl.mid, fl.end, fa - 72);
    } else if (mode === 'march') {                               // střídavě zvedá koleno
      var which = side(info) === 0 ? 'N' : 'F', other = which === 'N' ? 'F' : 'N';
      var a0t = ang(hip, sup.mid), a0s = ang(sup.mid, sup.end);
      var at = lerp(a0t, -84, t), as = lerp(a0s, -4, t), lg = legFK(hip, at, as);
      setLeg(J, which, lg.mid, lg.end, lerp(0, as - 82, sstep(0, 0.6, t)));
      setLeg(J, other, copy(sup.mid), copy(sup.end), 0);
    }
    return J;
  }

  function bridgeBack(mode) {
    return function (c) {
      var g = bridgeGeo(mode), x1 = g.sx - 46, x2 = g.sx + g.D + 40;
      if (mode === 'chair') { var X = g.sx + g.D - 7; mat(c, x1, X - 8); FA.gear.chair(c, X, 1); }
      else mat(c, x1, x2);
    };
  }

  FA.register('most', {
    title: 'Most (zvedání pánve)', view: 'side', facing: 1, zoom: 1.5,
    tempo: { up: 1.4, hold: 1.0, down: 1.8, pause: 0.6 },
    phases: { up: 'Zvedni pánev ⬆', hold: 'Stiskni hýždě', down: 'Pomalu dolů ⬇', pause: 'Paty blízko zadku' },
    solve: function (t, time, info) { return bridgeSolve('both', t, time, info); },
    back: bridgeBack('both'),
    highlight: function (t) { return { glutes: 0.12 + 0.88 * t, hamstrings: 0.1 + 0.45 * t, core: 0.1 + 0.25 * t, quads: 0.08 * t }; }
  });
  FA.register('most-pochod', {
    title: 'Most s pochodem', view: 'side', facing: 1, zoom: 1.5,
    tempo: { up: 0.9, hold: 0.35, down: 0.9, pause: 0.3 },
    phases: { up: 'Zvedni koleno ⬆', hold: 'Pánev drž rovně', down: 'Chodidlo dolů ⬇', pause: 'Střídej nohy' },
    solve: function (t, time, info) { return bridgeSolve('march', t, time, info); },
    back: bridgeBack('march'),
    highlight: function (t) { return { glutes: 0.55 + 0.25 * t, hamstrings: 0.3 + 0.2 * t, core: 0.3 + 0.45 * t, quads: 0.1 + 0.3 * t }; }
  });
  FA.register('most-1noha', {
    title: 'Most na jedné noze', view: 'side', facing: 1, zoom: 1.5,
    tempo: { up: 1.5, hold: 1.0, down: 1.9, pause: 0.5 },
    phases: { up: 'Tlač patou ⬆', hold: 'Stiskni hýždě', down: 'Pomalu dolů ⬇', pause: 'Boky rovně' },
    solve: function (t, time, info) { return bridgeSolve('single', t, time, info); },
    back: bridgeBack('single'),
    highlight: function (t) { return { glutes: 0.15 + 0.85 * t, hamstrings: 0.12 + 0.5 * t, core: 0.12 + 0.35 * t, quads: 0.05 + 0.1 * t }; }
  });
  FA.register('most-zidle-1noha', {
    title: 'Most na jedné noze s patou na židli', view: 'side', facing: 1, zoom: 1.4,
    tempo: { up: 1.6, hold: 1.0, down: 2.0, pause: 0.5 },
    phases: { up: 'Zvedni pánev ⬆', hold: 'Stiskni hýždě', down: 'Pomalu dolů ⬇', pause: 'Pata na sedáku' },
    solve: function (t, time, info) { return bridgeSolve('chair', t, time, info); },
    back: bridgeBack('chair'),
    highlight: function (t) { return { glutes: 0.15 + 0.85 * t, hamstrings: 0.2 + 0.7 * t, core: 0.12 + 0.3 * t, calves: 0.05 + 0.15 * t }; }
  });

  /* ===================================================================
     DEAD BUG – leh na zádech, tabletop, natahuje protilehlou ruku a nohu (animována jedna strana)
     =================================================================== */
  function deadGeo() {
    var b = FA.BODY, g = { top: matTop(), zoom: 1.4 };
    g.th0 = Math.asin((HIP_OFF - SH_OFF) / b.torso);
    g.sx = FA.W / 2 - (b.torso + b.thigh + b.shin + 12 - 33) / 2 + 4;
    return g;
  }
  function deadSolve(t) {
    var b = FA.BODY, g = deadGeo(), top = g.top, S = [g.sx, top - SH_OFF];
    var hip = [S[0] + b.torso * Math.cos(g.th0), S[1] - b.torso * Math.sin(g.th0)];
    var p = 0, th0d = g.th0 * R2D;                                   // jedna strana: blízká paže + vzdálená noha
    var J = { hip: hip, shoulder: S, head: headSupine(S), headRot: -90 };
    var tt0 = -(90 + th0d), ts0 = tt0 + 90;                      // tabletop: stehno kolmo na trup, holeň rovnoběžně s podložkou
    var aT = lerp(tt0, -16, t), aS = lerp(ts0, -16, sstep(0.05, 1, t));
    var act = legFK(hip, aT, aS), rest = legFK(hip, tt0, ts0);
    var legN = p === 1 ? act : rest, legF = p === 1 ? rest : act;
    setLeg(J, 'N', legN.mid, legN.end, (p === 1 ? aS : ts0) - 80);
    setLeg(J, 'F', legF.mid, legF.end, (p === 1 ? ts0 : aS) - 80);
    /* ruce: paže před hrudníkem vzhůru, protilehlá paže se jen mírně sklopí k tělu (ne za hlavu) */
    var aa = lerp(-92, -34, t), up = -92;
    var armN = armFK(S, p === 0 ? aa : up, 7), armF = armFK(S, p === 0 ? up : aa, 7);
    setArm(J, 'N', armN.mid, armN.end); setArm(J, 'F', armF.mid, armF.end);
    return J;
  }
  FA.register('dead-bug', {
    title: 'Mrtvý brouk (dead bug)', view: 'side', facing: 1, zoom: 1.4,
    tempo: { up: 1.6, hold: 0.3, down: 1.6, pause: 0.3 },
    phases: { up: 'Natáhni ruku a nohu ➡', hold: 'Bedra k zemi', down: 'Zpět do středu ⬅', pause: 'Vydechni' },
    solve: deadSolve,
    back: function (c) { var g = deadGeo(), b = FA.BODY; mat(c, g.sx - 46, g.sx + b.torso + b.thigh + b.shin + 40); },
    highlight: function (t) { return { core: 0.35 + 0.65 * t, quads: 0.12 + 0.15 * t, shoulders: 0.1 }; }
  });

  /* ===================================================================
     HOLLOW HOLD – lodička na zádech (výdrž)
     =================================================================== */
  function hollowGeo() {
    var b = FA.BODY, g = { hx: FA.W / 2 - 7, zoom: 1.5, top: matTop() };
    g.phi0 = -Math.asin((HIP_OFF - SH_OFF) / b.torso) * R2D;     // rameno těsně pod úrovní kyčle
    return g;
  }
  function hollowSolve(t, time) {
    var b = FA.BODY, g = hollowGeo(), top = g.top, br = wave(time, 3.8) * t;
    var H = [g.hx, top - HIP_OFF];
    var phi = lerp(g.phi0, 22, t) + br * 0.8;
    var S = [H[0] - b.torso * Math.cos(phi * D2R), H[1] - b.torso * Math.sin(phi * D2R)];
    var J = { hip: H, shoulder: S };
    /* hlava: z podložky se zvedá s trupem, brada k hrudi */
    var R = b.neck + b.headR, dy0 = clamp((top - HEAD_OFF) - (top - SH_OFF), -R * 0.9, R * 0.9), psi0 = Math.asin(-dy0 / R) * R2D;
    var psi = lerp(psi0, 36, t) + br * 0.8;
    J.head = [S[0] - R * Math.cos(psi * D2R), S[1] - R * Math.sin(psi * D2R)];
    J.headRot = lerp(-90, -52, t);
    /* nohy rovné, zvednuté nad podložku */
    var kRest = top - 7.3, ankRest = top - shoeLow(-95);
    var aT0 = Math.asin((kRest - H[1]) / b.thigh) * R2D;
    var kneeRest = P(H, aT0, b.thigh), aS0 = Math.asin(clamp((ankRest - kneeRest[1]) / b.shin, -1, 1)) * R2D;
    var lift = -19 - br * 0.9;
    var aT = lerp(aT0, lift, t), aS = lerp(aS0, lift, t), lg = legFK(H, aT, aS);
    var rf = lerp(-95, aS - 74, t);
    setLeg(J, 'N', lg.mid, lg.end, rf); setLeg(J, 'F', copy(lg.mid), copy(lg.end), rf);
    /* paže podél těla, lehce nad zemí */
    var tgt = P(S, lerp(3, -2, t), 0.995 * (b.upperArm + b.forearm));
    var arm = ik(S, tgt, b.upperArm, b.forearm, [mid(S, tgt)[0], mid(S, tgt)[1] - 40]);
    setArm(J, 'N', arm.mid, arm.end); setArm(J, 'F', copy(arm.mid), copy(arm.end));
    return J;
  }
  FA.register('hollow', {
    title: 'Hollow hold (lodička na zádech)', view: 'side', facing: 1, zoom: 1.5,
    tempo: { up: 1.8, hold: 4.5, down: 1.8, pause: 0.8 },
    phases: { up: 'Zvedni ramena a nohy ⬆', hold: 'Drž, dýchej', down: 'Pomalu dolů ⬇', pause: 'Bedra k zemi' },
    solve: hollowSolve,
    back: function (c) { var g = hollowGeo(), b = FA.BODY; mat(c, g.hx - b.torso - 48, g.hx + b.thigh + b.shin + 38); },
    highlight: function (t) { return { core: 0.45 + 0.5 * t, quads: 0.1 + 0.3 * t, shoulders: 0.1 * t }; }
  });

  /* ===================================================================
     SUPERMAN – leh na břiše, pohled zboku, hlava vpravo
     =================================================================== */
  function supGeo() { return { hx: FA.W / 2 + 24, top: matTop(), zoom: 1.45 }; }
  function supermanSolve(t, time) {
    var b = FA.BODY, g = supGeo(), top = g.top, br = wave(time, 3.8) * t;
    var Hy = top - 11.2, H = [g.hx, Hy];
    var phi = lerp(-2, 22, t) + br * 0.7;
    var S = [H[0] + b.torso * Math.cos(phi * D2R), H[1] - b.torso * Math.sin(phi * D2R)];
    var J = { hip: H, shoulder: S };
    var R = b.neck + b.headR, psi = lerp(6, 14, t) + br * 0.7;
    J.head = [S[0] + R * Math.cos(psi * D2R), S[1] - R * Math.sin(psi * D2R)];
    J.headRot = lerp(72, 40, t);
    /* nohy: v klidu leží nártem na podložce, zvedají se rovné (úhel 180+elevace = směr k chodidlům) */
    var r0 = 166, ankY = top - shoeLow(r0), kneeY = top - 7.5;
    var aT0 = 180 - Math.asin(clamp((kneeY - Hy) / b.thigh, -1, 1)) * R2D;
    var kr = P(H, aT0, b.thigh);
    var aS0 = 180 + Math.asin(clamp((kr[1] - ankY) / b.shin, -1, 1)) * R2D;
    var aT = lerp(aT0, 194, t) + br * 0.8, aS = lerp(aS0, 194, t) + br * 0.8;
    var lg = legFK(H, aT, aS);
    setLeg(J, 'N', lg.mid, lg.end, aS - 14); setLeg(J, 'F', copy(lg.mid), copy(lg.end), aS - 14);
    /* paže podél těla směrem k nohám, ve vzduchu */
    var tgt = P(S, lerp(174.5, 165, t), 0.995 * (b.upperArm + b.forearm));
    var arm = ik(S, tgt, b.upperArm, b.forearm, [S[0] - 25, S[1] - 20]);
    setArm(J, 'N', arm.mid, arm.end); setArm(J, 'F', copy(arm.mid), copy(arm.end));
    return J;
  }
  FA.register('superman', {
    title: 'Superman (ruce podél těla)', view: 'side', facing: 1, zoom: 1.45,
    tempo: { up: 1.4, hold: 1.4, down: 1.6, pause: 0.6 },
    phases: { up: 'Zvedni hrudník a nohy ⬆', hold: 'Drž, krk v prodloužení', down: 'Pomalu dolů ⬇', pause: 'Čelo k podložce' },
    solve: supermanSolve,
    back: function (c) { var g = supGeo(), b = FA.BODY; mat(c, g.hx - b.thigh - b.shin - 52, g.hx + b.torso + 50); },
    highlight: function (t) { return { back: 0.1 + 0.85 * t, glutes: 0.1 + 0.6 * t, hamstrings: 0.05 + 0.35 * t, shoulders: 0.05 * t }; }
  });

  /* ===================================================================
     BIRD DOG – na čtyřech, natahuje protilehlou ruku a nohu (jedna strana; pohled zboku, hlava vpravo)
     =================================================================== */
  function birdGeo() {
    var b = FA.BODY, top = matTop(), g = { top: top, kr: 7.5, zoom: 1.3 };
    g.hx = FA.W / 2 + 2; g.hipY = top - g.kr - b.thigh; g.Sy = top - 3.8 - 0.99 * (b.upperArm + b.forearm);
    g.Sx = g.hx + Math.sqrt(Math.max(1, sq(b.torso) - sq(g.hipY - g.Sy)));
    return g;
  }
  function birdSolve(t) {
    var b = FA.BODY, g = birdGeo(), top = g.top, H = [g.hx, g.hipY], S = [g.Sx, g.Sy], p = 0;     // jedna strana: blízká paže + vzdálená noha
    var J = { hip: H, shoulder: S };
    var R = b.neck + b.headR;
    J.head = P(S, -10 - 3 * t, R); J.headRot = 36;
    var La = b.upperArm + b.forearm;
    /* podpůrná paže (svisle k podložce) a pracovní paže (zvedne se a natáhne vpřed do výšky ramene) */
    var W0 = [S[0], top - 3.8], armR = ikDir(S, W0, b.upperArm, b.forearm, -1, 0.2);
    var al = lerp(90, -3, t), bump = Math.sin(PI * sstep(0, 0.6, t));
    var rad = lerp(Math.hypot(W0[0] - S[0], W0[1] - S[1]), 0.995 * La, t) * (1 - 0.2 * bump);
    var Wt = P(S, al, rad), armA = ikDir(S, Wt, b.upperArm, b.forearm, -0.5, 0.5);
    var armN = p === 0 ? armA : armR, armF = p === 0 ? armR : armA;
    setArm(J, 'N', armN.mid, armN.end); setArm(J, 'F', armF.mid, armF.end);
    /* noha: koleno pod kyčlí, holeň leží na podložce; při natažení se zvedá chodidlo, pak celá noha do vodorovné polohy */
    var r0 = 168, kneeRest = [H[0], top - g.kr], ankY = top - shoeLow(r0);
    var s0 = 180 + Math.asin(clamp((kneeRest[1] - ankY) / b.shin, -1, 1)) * R2D;
    var aT = lerp(90, 180, sstep(0.08, 1, t));
    var aS = lerp(s0, 180, sstep(0.3, 1, t)) + 20 * sstep(0, 0.3, t) * (1 - sstep(0.3, 0.8, t));
    var lg = legFK(H, aT, aS), rr = lerp(r0, 100, sstep(0.35, 1, t));
    var restLeg = { mid: kneeRest, end: [kneeRest[0] + b.shin * Math.cos(s0 * D2R), kneeRest[1] + b.shin * Math.sin(s0 * D2R)] };
    var legN = p === 1 ? lg : restLeg, legF = p === 1 ? restLeg : lg;
    setLeg(J, 'N', legN.mid, legN.end, p === 1 ? rr : r0);
    setLeg(J, 'F', legF.mid, legF.end, p === 1 ? r0 : rr);
    return J;
  }
  FA.register('bird-dog', {
    title: 'Ptakopes (bird dog)', view: 'side', facing: 1, zoom: 1.3,
    tempo: { up: 1.7, hold: 0.9, down: 1.7, pause: 0.4 },
    phases: { up: 'Natáhni ruku a nohu ➡', hold: 'Drž, záda rovná', down: 'Zpět ⬅', pause: 'Pánev se netočí' },
    solve: birdSolve,
    back: function (c) { var g = birdGeo(), b = FA.BODY; mat(c, g.hx - b.thigh - b.shin - 26, g.Sx + 36); },
    highlight: function (t) { return { core: 0.35 + 0.35 * t, glutes: 0.1 + 0.55 * t, back: 0.1 + 0.4 * t, shoulders: 0.1 + 0.3 * t }; }
  });

  /* ===================================================================
     PLANK na předloktích – výdrž (pohled zboku, hlava vpravo)
     t = 0: leh na břiše opřený o předloktí, t = 1: tělo v jedné linii na špičkách a předloktích
     =================================================================== */
  function plankGeo() {
    var b = FA.BODY, top = matTop(), g = { top: top, zoom: 1.4, rp: 62 };
    g.Ay = top - shoeLow(g.rp); g.Ey = top - 4.5; g.ua = b.upperArm; g.fa = b.forearm;
    g.Rt = b.torso; g.Rl = b.thigh + b.shin;
    var S0y = g.Ey - g.ua, dy = g.Ay - S0y, d1 = g.Rt + g.Rl - 0.02;
    g.dx = Math.sqrt(Math.max(1, d1 * d1 - dy * dy)); g.d1 = d1;
    g.ex = FA.W / 2 + g.dx / 2 - 11; g.A = [g.ex - g.dx, g.Ay]; g.E = [g.ex, g.Ey];
    g.k0 = 0;
    /* poloha t = 0: kyčle leží na podložce -> najdi sklon řetězce (lean ramen) */
    var target = top - 12.4, kmin = -Math.PI * 0.45, i, k, prev = 0, pk = 0, hp;
    g.k0 = kmin;
    for (i = 0; i <= 160; i++) {
      k = kmin * i / 160; hp = plankPose(g, k).hip;
      if (hp[1] >= target) { g.k0 = i ? lerp(pk, k, clamp((target - prev) / (hp[1] - prev), 0, 1)) : k; break; }
      prev = hp[1]; pk = k;
    }
    return g;
  }
  function plankPose(g, kap) {
    var dSA = Math.sqrt(sq(g.Rt) + sq(g.Rl) + 2 * g.Rt * g.Rl * Math.cos(kap));
    var S = circInt2(g.E, g.ua, g.A, dSA, false), hip = circInt2(S, g.Rt, g.A, g.Rl, kap < 0);
    return { S: S, hip: hip };
  }
  function plankSolve(t, time) {
    var b = FA.BODY, g = plankGeo(), top = g.top;
    var kap = lerp(g.k0, 0, t) - t * (1.4 * D2R) * (0.5 + 0.5 * wave(time, 3.8));        // jemné dýchání (břicho se o chlup prohne)
    var q = plankPose(g, kap), S = q.S, hip = q.hip;
    var J = { hip: hip, shoulder: S };
    J.head = P(S, ang(hip, S) + 6, b.neck + b.headR); J.headRot = 36;
    var knee = ik(hip, g.A, b.thigh, b.shin, [mid(hip, g.A)[0], mid(hip, g.A)[1] + 60]);
    setLeg(J, 'N', knee.mid, copy(g.A), g.rp); setLeg(J, 'F', copy(knee.mid), copy(g.A), g.rp);
    var wr = [g.E[0] + 0.99 * g.fa, top - 3.8];
    setArm(J, 'N', copy(g.E), wr); setArm(J, 'F', copy(g.E), copy(wr));
    return J;
  }
  FA.register('plank', {
    title: 'Plank na předloktích', view: 'side', facing: 1, zoom: 1.4,
    tempo: { up: 2.2, hold: 5, down: 2.2, pause: 0.8 },
    phases: { up: 'Zvedni se na špičky ⬆', hold: 'Drž, dýchej', down: 'Pomalu dolů ⬇', pause: 'Lokty pod rameny' },
    solve: plankSolve,
    back: function (c) { var g = plankGeo(); mat(c, g.A[0] - 30, g.ex + 50); },
    highlight: function (t) { return { core: 0.15 + 0.7 * t, glutes: 0.1 + 0.3 * t, shoulders: 0.1 + 0.25 * t, quads: 0.05 + 0.2 * t, chest: 0.05 + 0.1 * t }; }
  });

  /* ===================================================================
     ČELNÍ POHLED – postava leží na boku napříč scénou (hlava vlevo, čelem k divákovi)
     L = spodní (podpůrné) končetiny, R = horní. Řetězec předloktí – rameno – kyčel – opora (chodidlo / koleno
     na židli) se řeší průsečíky kružnic, takže se žádná kost neprotáhne a opory stojí na místě.
     t = 0: leh na boku opřený o předloktí (kyčle na podložce), t = 1: boky zvednuté, tělo v jedné linii.
     =================================================================== */
  function flGeo(mode) {
    var b = FA.BODY, top = matTop(), g = { mode: mode, top: top, zoom: 1.4 };
    g.ua = b.upperArm; g.fa = b.forearm; g.sh = b.shoulderHalf; g.hh = b.hipHalf; g.T = b.torso;
    g.th = b.thigh; g.shn = b.shin; g.L = g.th + g.shn;
    g.Rt = Math.hypot(g.sh, g.T); g.dt = Math.atan2(g.sh, g.T);
    if (mode === 'bocni') { g.Rl = Math.hypot(g.hh, g.L); g.dl = Math.atan2(g.hh, g.L); g.Ay = top - 6.6; g.rest = top - 18.5; }
    else {
      g.seatTop = FA.FLOOR - FA.CHAIR_H; g.Rl = Math.hypot(g.hh, g.th); g.dl = -Math.atan2(g.hh, g.th);
      g.Ay = g.seatTop - 7.5; g.rest = top - 17.5;
    }
    g.k1 = g.dt + g.dl;
    var d1 = Math.sqrt(sq(g.Rt) + sq(g.Rl) + 2 * g.Rt * g.Rl * Math.cos(g.k1)), S0y = top - 4.5 - g.ua, dy = g.Ay - S0y;
    var dx = Math.sqrt(Math.max(1, d1 * d1 - dy * dy));
    g.ex = FA.W / 2 - dx / 2 + (mode === 'bocni' ? 9 : -15);
    g.E = [g.ex, top - 4.5]; g.A = [g.ex + dx, g.Ay];
    /* sklon kloubového řetězce při t = 0: kyčle leží na podložce */
    var EA = Math.hypot(g.A[0] - g.E[0], g.A[1] - g.E[1]);
    var cmin = (sq(EA - g.ua + 0.3) - sq(g.Rt) - sq(g.Rl)) / (2 * g.Rt * g.Rl), kmin = -Math.acos(clamp(cmin, -1, 1)), i, k, hy, py = 0, pk = 0;
    g.k0 = kmin;
    for (i = 0; i <= 200; i++) {
      k = kmin * i / 200; hy = flPose(g, k).hcn[1];
      if (hy >= g.rest) { g.k0 = i ? lerp(pk, k, clamp((g.rest - py) / (hy - py), 0, 1)) : k; break; }
      py = hy; pk = k;
    }
    return g;
  }
  function flPose(g, kap) {
    var dSA = Math.sqrt(sq(g.Rt) + sq(g.Rl) + 2 * g.Rt * g.Rl * Math.cos(kap));
    var S = circInt2(g.E, g.ua, g.A, dSA, false), hcn = circInt2(S, g.Rt, g.A, g.Rl, kap < 0);
    return { S: S, hcn: hcn, wt: ang(S, hcn) + g.dt * R2D, wl: ang(hcn, g.A) - g.dl * R2D };
  }
  function vadd(p, v, k) { return [p[0] + v[0] * k, p[1] + v[1] * k]; }
  function toeFront(a) { return [a[0] + 3, a[1] + 2.5]; }
  /* horní paže s dlaní na boku / kyčli */
  function handOnHip(sR, sc, ut, wu, T, ua, fa) {
    var tgt = vadd(vadd(sc, ut, 0.72 * T), wu, 12), m = mid(sR, tgt);
    return ik(sR, tgt, ua, fa, vadd(m, wu, 60));
  }
  /* postava z řetězce: q = pose, lowAngle = směr spodní nohy (jen kopenhagen) */
  function flFigure(g, q, lowAngle, upShin) {
    var b = FA.BODY, ut = dirv(q.wt), wu = dirv(q.wt - 90), ul = dirv(q.wl), wl = dirv(q.wl - 90);
    var sc = vadd(q.S, wu, g.sh), sR = vadd(sc, wu, g.sh);
    var hipR = vadd(q.hcn, wl, g.hh), hipL = vadd(q.hcn, wl, -g.hh);
    var J = { shoulder: sc, hip: q.hcn, shoulderL: q.S, shoulderR: sR, hipL: hipL, hipR: hipR };
    J.head = vadd(sc, ut, -(b.neck + b.headR)); J.headRot = q.wt - 90;
    /* horní noha (R) rovně v ose těla */
    J.kneeR = vadd(hipR, ul, g.th);
    J.ankleR = upShin == null ? vadd(hipR, ul, g.L) : P(J.kneeR, upShin, g.shn); J.toeR = toeFront(J.ankleR);
    if (lowAngle == null) { J.kneeL = vadd(hipL, ul, g.th); J.ankleL = vadd(hipL, ul, g.L); }
    else { J.kneeL = P(hipL, lowAngle, g.th); J.ankleL = P(J.kneeL, lowAngle, g.shn); }
    J.toeL = toeFront(J.ankleL);
    /* spodní paže: stojí svisle na loketu, předloktí míří k divákovi (zkrácené) */
    J.elbowL = copy(g.E); J.wristL = [g.E[0] + 3.5, g.E[1] + 1];
    var ar = handOnHip(sR, sc, ut, wu, g.T, g.ua, g.fa);
    J.elbowR = ar.mid; J.wristR = ar.end;
    return J;
  }

  /* ---- boční plank ---- */
  function bocniSolve(t, time) {
    var g = flGeo('bocni'), kap = lerp(g.k0, g.k1, t) + t * (0.6 * D2R) * wave(time, 3.8);
    return flFigure(g, flPose(g, kap));
  }
  FA.register('bocni-plank', {
    title: 'Boční plank na předloktí', view: 'front', zoom: 1.4,
    tempo: { up: 2.2, hold: 5, down: 2.2, pause: 0.8 },
    phases: { up: 'Zvedni boky ⬆', hold: 'Drž, dýchej', down: 'Pomalu dolů ⬇', pause: 'Loket pod ramenem' },
    solve: bocniSolve,
    back: function (c) { var g = flGeo('bocni'); mat(c, g.ex - 62, g.A[0] + 34); },
    front: function () { },
    highlight: function (t) { return { core: 0.15 + 0.65 * t, abductors: 0.1 + 0.5 * t, shoulders: 0.1 + 0.3 * t, glutes: 0.1 + 0.3 * t }; }
  });

  /* ---- kodaňský plank ---- */
  function kopSolve(t, time) {
    var g = flGeo('kop'), kap = lerp(g.k0, g.k1, t) + t * (0.5 * D2R) * wave(time, 3.8);
    var q = flPose(g, kap);
    return flFigure(g, q, lerp(3, 10, t), 2.5);          // holeň horní nohy leží na sedáku, spodní noha visí pod ním
  }
  function frontChair(c, cx, part) {                      // židle zepředu (podélná osa těla je napříč sedákem)
    var C = FA.COL, wood = C.wood || '#a06a44', woodD = C.woodD || '#7a4d2e', woodL = C.woodL || '#c08a5f';
    var sy = FA.FLOOR - FA.CHAIR_H, hw = 22, FL = FA.FLOOR;
    if (part === 'back') {
      FA.gear.shadow(c, cx, FL + 0.5, hw + 12, 0.4, 3.5);
      c.fillStyle = woodD; c.fillRect(cx - hw + 2, sy - 46, 5, FL - sy + 46); c.fillRect(cx + hw - 7, sy - 46, 5, FL - sy + 46);      // zadní nohy + sloupky opěradla
      c.fillStyle = wood; c.fillRect(cx - hw + 2, sy - 46, 2 * hw - 4, 7); c.fillRect(cx - hw + 2, sy - 30, 2 * hw - 4, 5);
      c.fillStyle = woodL; c.fillRect(cx - hw + 3, sy - 45, 2 * hw - 6, 1.2);
      c.fillStyle = woodD; c.fillRect(cx - hw + 2, sy + 4, 2 * hw - 4, 4);
      c.fillStyle = woodD; c.fillRect(cx - hw - 2.2, sy + 0.8, 2 * hw + 4.4, 4.6);
      c.fillStyle = wood; c.fillRect(cx - hw - 2.2, sy, 2 * hw + 4.4, 3.4);                 // sedák
      c.fillStyle = woodL; c.fillRect(cx - hw + 1, sy + 0.4, 2 * hw - 2, 1);
    } else {
      c.fillStyle = woodD; c.fillRect(cx - hw + 0.5, sy + 4.6, 5.4, FL - sy - 4.6); c.fillRect(cx + hw - 5.9, sy + 4.6, 5.4, FL - sy - 4.6);   // přední nohy
      c.fillStyle = wood; c.fillRect(cx - hw + 0.5, sy + 4.6, 3.4, FL - sy - 4.6); c.fillRect(cx + hw - 5.9, sy + 4.6, 3.4, FL - sy - 4.6);
      c.fillStyle = woodD; c.fillRect(cx - hw + 5, sy + FA.CHAIR_H * 0.62, 2 * hw - 10, 2.6);
    }
  }
  FA.register('kopenhagen', {
    title: 'Kodaňský plank (koleno na židli)', view: 'front', zoom: 1.4,
    tempo: { up: 2.4, hold: 5, down: 2.4, pause: 1 },
    phases: { up: 'Zvedni boky ⬆', hold: 'Drž, dýchej', down: 'Pomalu dolů ⬇', pause: 'Předloktí pod ramenem' },
    solve: kopSolve,
    back: function (c) { var g = flGeo('kop'); mat(c, g.ex - 62, g.A[0] - 36); frontChair(c, g.A[0], 'back'); },
    front: function (c) { var g = flGeo('kop'); frontChair(c, g.A[0], 'front'); },
    highlight: function (t) { return { adductors: 0.15 + 0.8 * t, core: 0.2 + 0.5 * t, shoulders: 0.1 + 0.25 * t, abductors: 0.1 * t }; }
  });

  /* ---- unožování vleže na boku ---- */
  function legGeo() { return { sx: FA.W / 2 - 48, top: matTop(), zoom: 1.35 }; }
  function legSolve(t) {
    var b = FA.BODY, g = legGeo(), top = g.top, sh = b.shoulderHalf, hh = b.hipHalf, T = b.torso, wt = 5;
    var ut = dirv(wt), wu = dirv(wt - 90), SL = [g.sx, top - 5.8];
    var sc = vadd(SL, wu, sh), hcn = vadd(sc, ut, T), hipR = vadd(hcn, wu, hh), hipL = vadd(hcn, wu, -hh), sR = vadd(sc, wu, sh);
    var J = { shoulder: sc, hip: hcn, shoulderL: SL, shoulderR: sR, hipL: hipL, hipR: hipR };
    var Rh = b.neck + b.headR, hy = top - 21.5;
    J.head = [sc[0] - Math.sqrt(Math.max(1, Rh * Rh - sq(hy - sc[1]))), hy]; J.headRot = wt - 90;
    /* spodní paže leží natažená pod hlavou, horní ruka na boku */
    var el = [SL[0] - Math.sqrt(sq(b.upperArm) - 1), top - 4.8];
    J.elbowL = el; J.wristL = [el[0] - Math.sqrt(sq(b.forearm) - 1), top - 3.8];
    var ar = handOnHip(sR, sc, ut, wu, T, b.upperArm, b.forearm);
    J.elbowR = ar.mid; J.wristR = ar.end;
    /* spodní noha pokrčená (koleno míří k divákovi -> zkrácená), horní natažená a zvedá se do strany */
    J.kneeL = [hipL[0] + b.thigh * Math.cos(50 * D2R), top - 7.5];
    J.ankleL = [J.kneeL[0] + b.shin * Math.cos(40 * D2R), top - 6.6]; J.toeL = toeFront(J.ankleL);
    var du = wt - lerp(1, 42, t);
    J.kneeR = vadd(hipR, dirv(du), b.thigh); J.ankleR = vadd(J.kneeR, dirv(du), b.shin); J.toeR = toeFront(J.ankleR);
    return J;
  }
  FA.register('unozovani', {
    title: 'Unožování vleže na boku', view: 'front', zoom: 1.35,
    tempo: { up: 1.3, hold: 0.4, down: 1.5, pause: 0.4 },
    phases: { up: 'Zvedni nohu ⬆', hold: 'Špička dopředu', down: 'Pomalu dolů ⬇', pause: 'Boky nad sebou' },
    solve: legSolve,
    back: function (c) { var g = legGeo(); mat(c, g.sx - 92, g.sx + 178); },
    front: function () { },
    highlight: function (t) { return { abductors: 0.15 + 0.85 * t, glutes: 0.1 + 0.55 * t, core: 0.2 }; }
  });

  /* ===================================================================
     RUSKÁ ROTACE – sed, mírný záklon, ruce sepnuté před hrudníkem (čelní pohled)
     t = 0: rotace doleva, t = 1: rotace doprava; trup se otáčí kolem své osy (ramena se zužují a naklánějí)
     =================================================================== */
  function rusGeo() { return { cx: FA.W / 2, top: matTop(), zoom: 1.85 }; }
  function rusSolve(t) {
    var b = FA.BODY, g = rusGeo(), top = g.top, cx = g.cx;
    var psi = lerp(-52, 52, t) * D2R, beta = 28 * D2R, hh = b.hipHalf * 1.2;
    var hy = top - 12, hipC = [cx, hy], Lp = b.torso * Math.cos(beta), sc = [cx, hy - Lp], sh = b.shoulderHalf;
    var dxs = sh * Math.cos(psi), dys = sh * Math.sin(psi) * Math.sin(beta);
    var J = { shoulder: sc, hip: hipC, shoulderL: [sc[0] - dxs, sc[1] - dys], shoulderR: [sc[0] + dxs, sc[1] + dys], hipL: [cx - hh, hy], hipR: [cx + hh, hy] };
    J.head = [sc[0] + 4 * Math.sin(psi), sc[1] - (b.neck + b.headR) * Math.cos(beta * 0.8)]; J.headRot = psi * R2D * 0.1;
    /* nohy pokrčené, chodidla na podložce mírně od sebe */
    J.kneeL = [cx - 17, top - 40]; J.kneeR = [cx + 17, top - 40];
    J.ankleL = [cx - 28, top - 8]; J.ankleR = [cx + 28, top - 8];
    J.toeL = [cx - 30, top]; J.toeR = [cx + 30, top];
    /* ruce sepnuté před hrudníkem, otáčí se s trupem */
    var hand = [sc[0] + 27 * Math.sin(psi), sc[1] + 11 + 6 * sq(Math.sin(psi))];
    var hL = [hand[0] - 1.5, hand[1]], hR = [hand[0] + 1.5, hand[1]];
    var aL = ik(J.shoulderL, hL, b.upperArm, b.forearm, [J.shoulderL[0] - 30, J.shoulderL[1] + 25]);
    var aR = ik(J.shoulderR, hR, b.upperArm, b.forearm, [J.shoulderR[0] + 30, J.shoulderR[1] + 25]);
    J.elbowL = aL.mid; J.wristL = aL.end; J.elbowR = aR.mid; J.wristR = aR.end;
    return J;
  }
  FA.register('rus-twist', {
    title: 'Ruská rotace', view: 'front', zoom: 1.85,
    tempo: { up: 1.0, hold: 0.15, down: 1.0, pause: 0.15 },
    phases: { up: 'Rotuj doprava ➡', hold: 'Ruce k podložce', down: 'Rotuj doleva ⬅', pause: 'Rotuj doleva ⬅' },
    solve: rusSolve,
    back: function (c) { var g = rusGeo(); mat(c, g.cx - 76, g.cx + 76); },
    front: function () { },
    highlight: function (t) { var s = Math.abs(2 * t - 1); return { core: 0.45 + 0.45 * s, lats: 0.1 + 0.3 * s, quads: 0.1, shoulders: 0.1 }; }
  });
})();
