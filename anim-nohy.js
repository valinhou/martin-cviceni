/* =====================================================================
   anim-nohy.js – cviky na nohy (vlastní váha + židle + stupínek 20 cm)
   Klíče: drep-zidle, drep, drep-pauza, vypad-vzad, bulhar, vystup, vystup-koleno,
          lytka, lytka-1noha, rdl-1noha, kozacky, vyskok-drep, bruslar
   Závisí na jádru anim-jadro.js (window.FitAnim). Žádné moduly, jen FitAnim.register().
   Boční pohled: kolena/lokty se řeší 2-kloubovým IK (pevné délky segmentů), stojící chodidla se
   nesmýkají. Čelní pohledy (kozácký dřep, bruslař) se počítají v malém 3D (x do strany, výška, z k divákovi)
   a promítají ortogonálně – segmenty tak mají stále pevnou délku a ve zkrácení vypadají přirozeně.
   ===================================================================== */
(function () {
  'use strict';

  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  var FA = root.FitAnim;
  if (!FA || typeof FA.register !== 'function') {
    if (typeof console !== 'undefined') console.warn('anim-nohy.js: jádro FitAnim není načteno (anim-jadro.js musí být před tímto souborem).');
    return;
  }

  var B = FA.BODY, FL = FA.FLOOR, D2R = Math.PI / 180, PI = Math.PI;
  var STEP_H = FA.STEP_H || 23, CHAIR_H = FA.CHAIR_H || 52;
  var SEAT_TOP = FL - CHAIR_H - 2;                         // horní plocha polštáře židle (gear.chair)
  var gear = FA.gear;

  /* ------------------------------ pomocné funkce ------------------------------ */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sm(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function mix(p, q, t) { return [lerp(p[0], q[0], t), lerp(p[1], q[1], t)]; }
  function sin(d) { return Math.sin(d * D2R); }
  function cos(d) { return Math.cos(d * D2R); }
  function easeInv(t) {                                    // inverze FA.ease (kubický in-out) -> lineární čas
    t = clamp(t, 0, 1);
    return t < 0.5 ? Math.pow(t / 4, 1 / 3) : 1 - Math.pow(2 * (1 - t), 1 / 3) / 2;
  }
  function kf(tbl, x) {                                    // klíčové body [[x,y],...], kosinová interpolace
    if (x <= tbl[0][0]) return tbl[0][1];
    for (var i = 1; i < tbl.length; i++) if (x <= tbl[i][0]) {
      var a = tbl[i - 1], b = tbl[i], p = (x - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * (1 - Math.cos(p * PI)) / 2;
    }
    return tbl[tbl.length - 1][1];
  }
  function bump(x, c, w) { var d = (x - c) / w; return Math.exp(-d * d); }
  function rrect(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath(); c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  /* ----------------------------- chodidlo / noha ----------------------------- */
  function rho0() { return Math.asin(clamp(B.ankleH / B.foot, 0, 1)); }       // úhel kotník->špička u ploché nohy (rad)
  function toeOf(a, rho) { return [a[0] + B.foot * Math.cos(rho), a[1] + B.foot * Math.sin(rho)]; }
  function ankleOf(toe, rho) { return [toe[0] - B.foot * Math.cos(rho), toe[1] - B.foot * Math.sin(rho)]; }
  function knee2(h, a) { return FA.ik2(h, a, B.thigh, B.shin, -1).mid; }       // koleno dopředu (facing = 1)
  function legTo(h, a, t) { return { k: knee2(h, a), a: a, t: t || FA.toeFloor(a, 1) }; }
  function legFlat(h, ax) { var a = [ax, FL - B.ankleH]; return legTo(h, a, FA.toeFloor(a, 1)); }
  function legLen() { return B.thigh + B.shin; }

  /* stojná noha: kotník a, bérec se předklání o phi (°), stehno svírá psi (°) se svislicí -> kyčel */
  function standHip(a, psi, phi) {
    var kn = [a[0] + B.shin * sin(phi), a[1] - B.shin * cos(phi)];
    return { knee: kn, hip: [kn[0] - B.thigh * sin(psi), kn[1] - B.thigh * cos(psi)] };
  }
  function shoulderOf(hip, lam) { return [hip[0] + B.torso * sin(lam), hip[1] - B.torso * cos(lam)]; }

  /* ruce (boční pohled) */
  function arms(S, wN, wF) {
    var a = FA.ik2(S, wN, B.upperArm, B.forearm, 1), b = FA.ik2(S, wF || [wN[0] - 1.5, wN[1] + 0.8], B.upperArm, B.forearm, 1);
    return { eN: a.mid, wN: a.end, eF: b.mid, wF: b.end };
  }
  function trunkFrame(lam) { return { u: [sin(lam), -cos(lam)], f: [cos(lam), sin(lam)] }; }
  function handsChest(S, lam, k) {                         // sepjaté před hrudníkem (k = 0..1 jemně vpřed)
    var T = trunkFrame(lam), fw = 24 + 9 * k, dn = 12 - 5 * k;
    return arms(S, [S[0] + T.f[0] * fw - T.u[0] * dn, S[1] + T.f[1] * fw - T.u[1] * dn]);
  }
  function handsHips(S, lam) {                             // ruce v bok
    var T = trunkFrame(lam);
    return arms(S, [S[0] - T.u[0] * 45 + T.f[0] * 13, S[1] - T.u[1] * 45 + T.f[1] * 13]);
  }
  function handsSwing(S, alpha, k) {                       // paže (téměř natažené) mávají ve svislé rovině, alpha = 0 dolů, 90 vpřed
    var l = (B.upperArm + B.forearm) * (k || 0.96);
    return arms(S, [S[0] + l * sin(alpha), S[1] + l * cos(alpha)], [S[0] + l * sin(alpha) - 2, S[1] + l * cos(alpha) + 1]);
  }

  function sideJ(hip, lam, hk, N, F, A) {
    var S = shoulderOf(hip, lam), ar = (typeof A === 'function') ? A(S, lam) : A;
    return {
      hip: hip, shoulder: S, head: FA.headAt(S, -90 + lam * hk),
      elbowN: ar.eN, wristN: ar.wN, elbowF: ar.eF, wristF: ar.wF,
      kneeN: N.k, ankleN: N.a, toeN: N.t, kneeF: F.k, ankleF: F.a, toeF: F.t,
      cN: !!N.c, cF: !!F.c
    };
  }

  function phaseOf(info, t) { return (info && info.phase) || 'free'; }
  function shadowFloor(c, x, w, a) { gear.shadow(c, x, FL + 0.5, w, a == null ? 0.3 : a); }

  /* ===================================================================
     1) DŘEP (volný), 2) DŘEP S VÝDRŽÍ – boční pohled, t = 0 stoj, t = 1 dole
     =================================================================== */
  function squatJ(t, o) {
    var psi = lerp(4, o.psi, t), phi = lerp(4, o.phi, Math.pow(t, 0.85)), lam = lerp(3, o.lam, Math.pow(t, 0.85));
    var a = [o.ax, FL - B.ankleH], st = standHip(a, psi, phi), hip = st.hip;
    var N = { k: st.knee, a: a, t: FA.toeFloor(a, 1), c: true };
    var aF = [o.ax - 6, a[1]], F = legTo(hip, aF, FA.toeFloor(aF, 1)); F.c = true;
    return sideJ(hip, lam, 0.4, N, F, function (S, l) { return handsChest(S, l, t); });
  }
  function squatHl(t, info, deep) {
    var sq = (info && info.squeeze) || 0;
    return { quads: 0.12 + 0.78 * t, glutes: 0.08 + 0.82 * Math.pow(t, 1.4), hamstrings: 0.08 + 0.12 * t,
             core: 0.18 + 0.2 * t + (deep ? 0.35 * sq : 0), back: 0.12 + 0.2 * t, adductors: 0.2 * t, calves: 0.08 };
  }
  var SQ_FREE = { ax: 196, psi: 102, phi: 34, lam: 40 };
  var SQ_HOLD = { ax: 196, psi: 100, phi: 34, lam: 41 };

  FA.register('drep', {
    title: 'Dřep', view: 'side', facing: 1, zoom: 1.06,
    tempo: { up: 1.5, hold: 0.2, down: 1.0, pause: 0.3 },
    phases: { up: 'Dolů ⬇', hold: 'Dole', down: 'Nahoru ⬆', pause: '' },
    solve: function (t) { return squatJ(t, SQ_FREE); },
    highlight: function (t, info) { return squatHl(t, info, false); }
  });
  FA.register('drep-pauza', {
    title: 'Dřep s výdrží dole (3 s)', view: 'side', facing: 1, zoom: 1.06,
    tempo: { up: 1.5, hold: 3.0, down: 0.7, pause: 0.3 },
    phases: { up: 'Dolů ⬇', hold: 'Drž 3 s, napni břicho', down: 'Nahoru dynamicky ⬆', pause: '' },
    solve: function (t) { return squatJ(t, SQ_HOLD); },
    highlight: function (t, info) { return squatHl(t, info, true); }
  });

  /* ===================================================================
     3) DŘEP NA ŽIDLI – zadek dozadu, dotek sedáku a hned zpět
     =================================================================== */
  var CH = { ax: 221 };
  CH.X = CH.ax - 30;                                       // přední hrana sedáku, sedák směřuje doleva
  function chairSquatJ(t) {
    var a = [CH.ax, FL - B.ankleH], h0 = standHip(a, 4, 4).hip;
    var h1 = [CH.X - 16, SEAT_TOP - 12.5];
    var hip = [lerp(h0[0], h1[0], Math.pow(t, 0.7)), lerp(h0[1], h1[1], t)];
    var lam = lerp(3, 40, Math.pow(t, 0.85));
    var N = legTo(hip, a, FA.toeFloor(a, 1)); N.c = true;
    var aF = [CH.ax - 6, a[1]], F = legTo(hip, aF, FA.toeFloor(aF, 1)); F.c = true;
    return sideJ(hip, lam, 0.4, N, F, function (S, l) { return handsChest(S, l, t); });
  }
  FA.register('drep-zidle', {
    title: 'Dřep na židli', view: 'side', facing: 1, zoom: 1.06,
    tempo: { up: 1.4, hold: 0.2, down: 1.0, pause: 0.4 },
    phases: { up: 'Dolů ⬇ zadek dozadu', hold: 'Dotkni se sedáku', down: 'Hned nahoru ⬆', pause: '' },
    solve: function (t) { return chairSquatJ(t); },
    back: function (c, J, t) { gear.chair(c, CH.X, -1); },
    highlight: function (t) {
      return { quads: 0.12 + 0.7 * t, glutes: 0.08 + 0.78 * Math.pow(t, 1.4), hamstrings: 0.1 + 0.1 * t, core: 0.2, back: 0.15, adductors: 0.15 * t };
    }
  });

  /* ===================================================================
     4) VÝPAD VZAD – blízká noha stojí vpředu, vzdálenější krok dozadu
     =================================================================== */
  var LG = { ax: 239, tc: 0.58, toeE: -84, rhoE: 54 };
  function lungeJ(t) {
    var psi = lerp(4, 84, t), phi = lerp(4, 14, Math.pow(t, 0.85)), lam = lerp(3, 10, t);
    var a = [LG.ax, FL - B.ankleH], st = standHip(a, psi, phi), hip = st.hip;
    var N = { k: st.knee, a: a, t: FA.toeFloor(a, 1), c: true };
    var r0 = rho0(), aS = [LG.ax - 7, FL - B.ankleH], toeS = FA.toeFloor(aS, 1), toeE = [LG.ax + LG.toeE, FL];
    var u = sm(t / LG.tc), toe, rho, air = t < LG.tc;
    if (air) {
      toe = mix(toeS, toeE, u); toe[1] -= 17 * Math.sin(PI * u);
      rho = lerp(r0, LG.rhoE * D2R, u) + 22 * D2R * Math.sin(PI * u);
    } else { toe = toeE; rho = LG.rhoE * D2R; }
    var aF = ankleOf(toe, rho), F = { k: knee2(hip, aF), a: aF, t: toe, c: !air || t < 0.002 };
    return sideJ(hip, lam, 0.35, N, F, handsHips);
  }
  FA.register('vypad-vzad', {
    title: 'Výpad vzad', view: 'side', facing: 1, zoom: 1.08,
    tempo: { up: 1.7, hold: 0.4, down: 1.1, pause: 0.5 },
    phases: { up: 'Krok vzad a dolů ⬇', hold: 'Dole', down: 'Odraz přední patou ⬆', pause: '' },
    solve: lungeJ,
    highlight: function (t) {
      return { quads: 0.12 + 0.78 * t, glutes: 0.1 + 0.8 * Math.pow(t, 1.3), hamstrings: 0.1 + 0.12 * t, adductors: 0.15 * t, core: 0.18, calves: 0.1 };
    }
  });

  /* ===================================================================
     5) BULHARSKÝ DŘEP – nárt zadní nohy na sedáku židle
     =================================================================== */
  var BG = { ax: 244 };
  BG.X = BG.ax - 72;                                       // přední hrana sedáku (sedák doleva), opěradlo vzadu
  function bulgJ(t) {
    var psi = lerp(4, 88, t), phi = lerp(4, 22, Math.pow(t, 0.85)), lam = lerp(5, 19, t);
    var a = [BG.ax, FL - B.ankleH], st = standHip(a, psi, phi), hip = st.hip;
    var N = { k: st.knee, a: a, t: FA.toeFloor(a, 1), c: true };
    var aF = [BG.X - 11, SEAT_TOP - 7], rhoF = 168 * D2R, F = { k: knee2(hip, aF), a: aF, t: toeOf(aF, rhoF), c: true };
    return sideJ(hip, lam, 0.4, N, F, handsHips);
  }
  FA.register('bulhar', {
    title: 'Bulharský dřep (zadní noha na židli)', view: 'side', facing: 1,
    tempo: { up: 1.8, hold: 0.3, down: 1.2, pause: 0.3 },
    phases: { up: 'Rovně dolů ⬇', hold: 'Dole', down: 'Nahoru ⬆', pause: '' },
    solve: bulgJ,
    back: function (c, J, t) { gear.chair(c, BG.X, -1); },
    highlight: function (t) {
      return { quads: 0.12 + 0.8 * t, glutes: 0.1 + 0.8 * Math.pow(t, 1.3), hamstrings: 0.1 + 0.1 * t, adductors: 0.2 * t, core: 0.2, abductors: 0.2 + 0.2 * t };
    }
  });

  /* ===================================================================
     6) VÝSTUP NA STUPÍNEK  (+ 7) s vytažením kolene)
     =================================================================== */
  var SP = { w: 46 };
  function stepJ(t, knee) {
    var X0 = knee ? 178 : 188, aN = [X0 + 18, FL - STEP_H - B.ankleH];
    var psi = lerp(60, 4, t), phi = lerp(28, 4, t), lam = lerp(17, 3, t);
    var st = standHip(aN, psi, phi), hip = st.hip, r0 = rho0();
    var N = { k: st.knee, a: aN, t: FA.toeFloor(aN, 1), c: true };
    var aS = [X0 - 27, FL - B.ankleH], toeS = FA.toeFloor(aS, 1);   // zadní noha stojí na zemi před stupínkem
    var tl = 0.30, aF, toeF, rho, grounded = t < tl;
    if (grounded) {                                        // zadní noha: pata se zvedá, špička zůstává na zemi
      rho = lerp(r0, 70 * D2R, sm(t / tl)); toeF = toeS; aF = ankleOf(toeF, rho);
    } else {
      var aTo = ankleOf(toeS, 70 * D2R), u = (t - tl) / (1 - tl), su = sm(u);
      var hover = [hip[0] + 8, hip[1] + 84];
      var tgt = hover;
      if (knee) { var kl = sm((t - 0.5) / 0.5), kUp = [hip[0] + 48, hip[1] + 50]; tgt = mix(hover, kUp, kl); }
      aF = mix(aTo, tgt, su); aF[1] -= 20 * Math.sin(PI * Math.pow(su, 0.8)) * (1 - su * 0.0);
      rho = lerp(70, knee ? 80 : 74, su) * D2R; toeF = toeOf(aF, rho);
    }
    var F = { k: knee2(hip, aF), a: aF, t: toeF, c: grounded && t < 0.002 };
    return sideJ(hip, lam, 0.35, N, F, handsHips);
  }
  function stepBack(knee) { return function (c) { gear.step20(c, knee ? 178 : 188, SP.w); }; }
  FA.register('vystup', {
    title: 'Výstup na stupínek', view: 'side', facing: 1, zoom: 0.92,
    tempo: { up: 1.1, hold: 0.3, down: 1.4, pause: 0.5 },
    phases: { up: 'Vytlač se nahoru ⬆', hold: 'Nahoře', down: 'Pomalu dolů ⬇', pause: '' },
    solve: function (t) { return stepJ(t, false); }, back: stepBack(false),
    highlight: function (t) {
      var w = Math.sin(PI * Math.min(1, t * 1.1));            // největší práce uprostřed výstupu
      return { quads: 0.12 + 0.8 * w, glutes: 0.12 + 0.7 * w, hamstrings: 0.1, calves: 0.12, abductors: 0.15 + 0.15 * t, core: 0.15 };
    }
  });
  FA.register('vystup-koleno', {
    title: 'Výstup na stupínek s vytažením kolene', view: 'side', facing: 1, zoom: 0.92,
    tempo: { up: 1.3, hold: 0.8, down: 1.3, pause: 0.4 },
    phases: { up: 'Nahoru a koleno vzhůru ⬆', hold: 'Drž rovnováhu', down: 'Pomalu dolů ⬇', pause: '' },
    solve: function (t) { return stepJ(t, true); }, back: stepBack(true),
    highlight: function (t) {
      var w = Math.sin(PI * Math.min(1, t * 1.1));
      return { quads: 0.12 + 0.7 * w, glutes: 0.15 + 0.6 * w, hamstrings: 0.1, calves: 0.12, abductors: 0.2 + 0.4 * t, core: 0.2 + 0.4 * t };
    }
  });

  /* ===================================================================
     8) VÝPONY NA STUPÍNKU  (+ 9) na jedné noze) – ruce na opěradle židle
     =================================================================== */
  var CR = { w: 34, rLow: 10, rHigh: 62, lean: 15 };
  function crGeom(one) {
    var X0 = one ? 176 : 162, g = { X0: X0 };
    g.toe = [X0 + 20, FL - STEP_H];                        // špička na stupínku, pata přes hranu
    g.X = X0 + 79;                                         // přední hrana sedáku židle, opěradlo na její levé straně
    g.rail = [g.X - 33, FL - 153];                         // madlo (vyšší opěradlo – aby ho ruka dosáhla)
    return g;
  }
  function calfJ(t, one) {
    var G = crGeom(one), rho = lerp(CR.rLow, CR.rHigh, t) * D2R, a = ankleOf(G.toe, rho), dL = 0.988 * legLen();
    var hx = G.toe[0] - 12, dx = hx - a[0], hip = [hx, a[1] - Math.sqrt(dL * dL - dx * dx)];
    var N = { k: knee2(hip, a), a: a, t: G.toe, c: true }, F;
    if (one) {                                             // druhá noha pokrčená za tělem
      var aF = [hip[0] - 42, hip[1] + 46], rF = 100 * D2R;
      F = { k: knee2(hip, aF), a: aF, t: toeOf(aF, rF) };
    } else {
      var toeF = [G.toe[0] - 5, G.toe[1]], aF2 = ankleOf(toeF, rho);
      F = { k: knee2(hip, aF2), a: aF2, t: toeF, c: true };
    }
    return sideJ(hip, CR.lean, 0.5, N, F, function (S) { return arms(S, [G.rail[0], G.rail[1] + 4], [G.rail[0] - 1.5, G.rail[1] + 5]); });
  }
  function calfBack(one) { return function (c) {
    var G = crGeom(one);
    shadowFloor(c, G.X0 + 18, 30, 0.2);
    gear.chair(c, G.X, -1, { back: false });               // sedák + nohy; vlastní vysoké opěradlo
    var px = G.X - 33, C = FA.COL, top = G.rail[1] - 9, bot = SEAT_TOP + 4;     // vysoké opěradlo (deska)
    c.fillStyle = C.frameD; rrect(c, px - 4.6, top, 9.6, bot - top, 3.6); c.fill();
    c.fillStyle = C.frame; rrect(c, px - 4.6, top, 8, bot - top, 3.4); c.fill();
    c.fillStyle = C.padD; rrect(c, px - 6.2, top, 12.4, 38, 5); c.fill();             // horní polštář / madlo
    c.fillStyle = C.pad; rrect(c, px - 6.2, top - 0.8, 10.8, 37, 5); c.fill();
    c.fillStyle = C.padTop; c.fillRect(px - 4, top + 4, 1.4, 26);
  }; }
  function calfFront(one) { return function (c) { gear.step20(c, crGeom(one).X0, CR.w); }; }   // stupínek přes špičku a podešev
  FA.register('lytka', {
    title: 'Výpony na stupínku', view: 'side', facing: 1, zoom: 0.9,
    tempo: { up: 0.8, hold: 0.4, down: 1.0, pause: 0.2 },
    phases: { up: 'Nahoru na špičky ⬆', hold: 'Nahoře stiskni', down: 'Pomalu dolů ⬇', pause: '' },
    solve: function (t) { return calfJ(t, false); }, back: calfBack(false), front: calfFront(false),
    highlight: function (t) { return { calves: 0.2 + 0.8 * Math.pow(t, 0.8), hamstrings: 0.08, quads: 0.1, core: 0.1 }; }
  });
  FA.register('lytka-1noha', {
    title: 'Výpony na jedné noze na stupínku', view: 'side', facing: 1, zoom: 0.9,
    tempo: { up: 0.9, hold: 0.3, down: 2.0, pause: 0.3 },
    phases: { up: 'Nahoru na špičku ⬆', hold: 'Nahoře stiskni', down: 'Pomalu dolů 2 s ⬇', pause: '' },
    solve: function (t) { return calfJ(t, true); }, back: calfBack(true), front: calfFront(true),
    highlight: function (t) { return { calves: 0.28 + 0.72 * Math.pow(t, 0.8), glutes: 0.12, abductors: 0.18, core: 0.15, quads: 0.1 }; }
  });

  /* ===================================================================
     10) JEDNONOHÝ MRTVÝ TAH – předklon, zadní noha v jedné linii s trupem
     =================================================================== */
  var RD = { ax: 217 };
  function rdlJ(t) {
    var psi = lerp(4, 22, t), phi = lerp(4, 14, t), lam = lerp(3, 86, sm(t * 1.0));
    var a = [RD.ax, FL - B.ankleH], st = standHip(a, psi, phi), hip = st.hip;
    var N = { k: st.knee, a: a, t: FA.toeFloor(a, 1), c: true };
    var phr = 90 + 0.97 * lam, R = 0.986 * legLen();
    var aF = [hip[0] + R * cos(phr), hip[1] + R * sin(phr)];
    var rho = lerp(rho0(), 90 * D2R, sm(t * 1.6));
    if (aF[1] + B.foot * Math.sin(rho) > FL) rho = Math.asin(clamp((FL - aF[1]) / B.foot, -1, 1));   // špička nesmí pod podlahu
    var F = { k: knee2(hip, aF), a: aF, t: toeOf(aF, rho), c: t < 0.002 };
    return sideJ(hip, lam, 0.9, N, F, function (S, l) {
      var ar = FA.ik2(S, [S[0] + 2, S[1] + 0.95 * (B.upperArm + B.forearm)], B.upperArm, B.forearm, 1);
      return { eN: ar.mid, wN: ar.end, eF: ar.mid, wF: ar.end };
    });
  }
  FA.register('rdl-1noha', {
    title: 'Jednonohý mrtvý tah (vlastní váha)', view: 'side', facing: 1, zoom: 1.1,
    tempo: { up: 1.6, hold: 0.3, down: 1.4, pause: 0.3 },
    phases: { up: 'Předklon, noha vzad ⬇', hold: 'Rovná linie', down: 'Zpět do stoje ⬆', pause: '' },
    solve: rdlJ,
    highlight: function (t) {
      return { hamstrings: 0.15 + 0.85 * t, glutes: 0.15 + 0.75 * t, back: 0.1 + 0.5 * t, core: 0.2 + 0.3 * t, calves: 0.12, abductors: 0.15 + 0.25 * t };
    }
  });

  /* ===================================================================
     11) KOZÁCKÝ DŘEP – čelní pohled, 3D -> ortogonální průmět
     =================================================================== */
  function ik3(h, a, l1, l2, pole) {
    var dx = a[0] - h[0], dy = a[1] - h[1], dz = a[2] - h[2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    var dc = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3), ux = dx / d, uy = dy / d, uz = dz / d;
    var A = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc), H = Math.sqrt(Math.max(0, l1 * l1 - A * A));
    var pu = pole[0] * ux + pole[1] * uy + pole[2] * uz, px = pole[0] - ux * pu, py = pole[1] - uy * pu, pz = pole[2] - uz * pu;
    var pl = Math.sqrt(px * px + py * py + pz * pz);
    if (pl < 1e-6) { px = -uy; py = ux; pz = 0; pl = Math.sqrt(px * px + py * py) || 1; if (!(pl > 1e-6)) { px = 1; py = 0; pl = 1; } }
    px /= pl; py /= pl; pz /= pl;
    return [h[0] + ux * A + px * H, h[1] + uy * A + py * H, h[2] + uz * A + pz * H];
  }
  function P2(p) { return [p[0], FL - p[1]]; }             // [x, výška, z] -> obrazovka
  function mir(p, cx) { return [2 * cx - p[0], p[1], p[2]]; }
  function frontArms(sc3, zsh, hsh, out) {
    // sc3 = střed ramen [x, výška, z]; ruce sepnuté před hrudníkem (zápěstí u středu hrudi, vpřed)
    var sh = B.shoulderHalf || 17, res = {}, i, sg, S3, W3, E3, s;
    for (i = 0; i < 2; i++) {
      sg = i ? 1 : -1; s = i ? 'R' : 'L';
      S3 = [sc3[0] + sg * sh, sc3[1], sc3[2]];
      W3 = [sc3[0] + sg * 2.5 + out.dx, sc3[1] - 15, sc3[2] + 24];
      E3 = ik3(S3, W3, B.upperArm, B.forearm, [sg * 0.9, -1, 0.1]);
      res['shoulder' + s] = P2(S3); res['elbow' + s] = P2(E3); res['wrist' + s] = P2(W3);
    }
    return res;
  }
  var KZ = { cx: 200 };
  function kozackyJ(t) {
    var cx = KZ.cx, AH = B.ankleH, aL = [cx - 60, AH, 0], aR = [cx + 64, AH, 0];
    var yc = lerp(92, 48, t), xc = lerp(cx + 1, cx - 36, t), hw = B.hipHalf || 8;
    var hL = [xc - hw, yc, 0], hR = [xc + hw, yc, 0];
    var kL = ik3(hL, aL, B.thigh, B.shin, [-0.75, 0, 1]), kR = ik3(hR, aR, B.thigh, B.shin, [0.3, 0, 1]);
    var lf = lerp(2, 30, Math.pow(t, 0.9)), hs = yc + B.torso * cos(lf), zs = B.torso * sin(lf), sx = xc - 7 * t;
    var sc3 = [sx, hs, zs], J = frontArms(sc3, zs, hs, { dx: 0 });
    var toeUp = 6 * sm(t * 1.4);
    J.hip = P2([xc, yc, 0]); J.shoulder = P2(sc3);
    J.hipL = P2(hL); J.hipR = P2(hR); J.kneeL = P2(kL); J.kneeR = P2(kR);
    J.ankleL = P2(aL); J.ankleR = P2(aR);
    J.toeL = [aL[0] - 3, FL]; J.toeR = [aR[0] + 3, FL - toeUp];
    J.head = [sx, FL - hs - (B.neck + B.headR) * cos(lf * 0.5)];
    J.headRot = 0;
    return J;
  }
  FA.register('kozacky', {
    title: 'Kozácký dřep', view: 'front', facing: 1, zoom: 1.2,
    tempo: { up: 1.8, hold: 0.6, down: 1.2, pause: 0.5 },
    phases: { up: 'Přenes váhu a dolů ⬇', hold: 'Dole', down: 'Zpět do středu ⬆', pause: '' },
    solve: kozackyJ,
    highlight: function (t) {
      return { quads: 0.1 + 0.75 * t, glutes: 0.1 + 0.75 * Math.pow(t, 1.2), adductors: 0.12 + 0.88 * t, hamstrings: 0.1 * t, core: 0.2, calves: 0.1 };
    }
  });

  /* ===================================================================
     12) DŘEP S VÝSKOKEM – boční pohled; čas: dolů (up) / odraz-let-doskok (down)
     =================================================================== */
  var JP = { ax: 180, H: 20 };
  function jumpTime(t, info) {
    var ph = phaseOf(info, t);
    if (ph === 'up') return { m: 'dip', x: t };
    if (ph === 'hold') return { m: 'dip', x: 1 };
    if (ph === 'down') return { m: 'go', x: easeInv(1 - t) };
    if (ph === 'pause') return { m: 'dip', x: 0 };
    return t < 0.3 ? { m: 'dip', x: t / 0.3 } : { m: 'go', x: (t - 0.3) / 0.7 };
  }
  function jumpState(jt) {
    var r0 = rho0() / D2R, x = jt.x, s, f;
    if (jt.m === 'dip') {
      return { psi: lerp(4, 62, x), phi: lerp(4, 26, Math.pow(x, 0.85)), lam: lerp(3, 32, Math.pow(x, 0.85)), rho: r0, fl: 0, al: -40 * x, ph: 'dip' };
    }
    x = clamp(x, 0, 1);
    if (x < 0.24) {
      s = x / 0.24; var e = Math.pow(s, 1.3);
      return { psi: lerp(62, 4, e), phi: lerp(26, 6, e), lam: lerp(32, 3, s), rho: lerp(r0, 70, Math.pow(s, 2.2)), fl: 0, al: lerp(-40, 75, Math.pow(s, 0.8)), ph: 'push' };
    }
    if (x < 0.52) {
      f = (x - 0.24) / 0.28;
      return { psi: lerp(4, 22, Math.pow(f, 1.4)), phi: lerp(6, 12, f), lam: lerp(3, 12, f), rho: lerp(70, 56, f), fl: 4 * JP.H * f * (1 - f), al: lerp(75, 45, f), ph: 'air' };
    }
    if (x < 0.72) {
      s = sm((x - 0.52) / 0.2);
      return { psi: lerp(22, 58, s), phi: lerp(12, 24, s), lam: lerp(12, 28, s), rho: lerp(56, r0, s), fl: 0, al: lerp(45, -10, s), ph: 'land' };
    }
    s = sm((x - 0.72) / 0.28);
    return { psi: lerp(58, 4, s), phi: lerp(24, 4, s), lam: lerp(28, 3, s), rho: r0, fl: 0, al: lerp(-10, 0, s), ph: 'rise' };
  }
  function jumpJ(t, time, info) {
    var q = jumpState(jumpTime(t, info)), toe = [JP.ax + Math.sqrt(Math.max(0, B.foot * B.foot - B.ankleH * B.ankleH)), FL - q.fl];
    var a = ankleOf(toe, q.rho * D2R), st = standHip(a, q.psi, q.phi), hip = st.hip;
    var N = { k: st.knee, a: a, t: toe, c: q.fl === 0 };
    var toeF = [toe[0] - 6, toe[1]], aF = ankleOf(toeF, q.rho * D2R);
    var F = { k: knee2(hip, aF), a: aF, t: toeF, c: q.fl === 0 };
    var J = sideJ(hip, q.lam, 0.4, N, F, function (S) { return handsSwing(S, q.al, 0.96); });
    J._q = q; return J;
  }
  FA.register('vyskok-drep', {
    title: 'Dřep s výskokem', view: 'side', facing: 1, zoom: 0.88,
    tempo: { up: 0.6, hold: 0.1, down: 1.5, pause: 0.6 },
    phases: { up: 'Rychle dolů ⬇', hold: 'Napni se', down: 'Výbušně nahoru, měkký doskok ⬆', pause: '' },
    solve: jumpJ,
    highlight: function (t, info) {
      var q = jumpState(jumpTime(t, info)), k = 0;
      if (q.ph === 'dip') k = 0.25 + 0.4 * t;
      else if (q.ph === 'push') k = 1;
      else if (q.ph === 'land') k = 0.85;
      else if (q.ph === 'rise') k = 0.3;
      return { quads: k, glutes: k * 0.95, calves: q.ph === 'push' ? 1 : (q.ph === 'air' ? 0.6 : 0.2), hamstrings: 0.2 * k, core: 0.3, adductors: 0.15 * k };
    }
  });

  /* ===================================================================
     13) BRUSLAŘSKÉ SKOKY – čelní pohled, 3D; s = 0 (stoj na levé) ... 1 (stoj na pravé)
         pohyb je časově symetrický (zrcadlo kolem středu), takže „skok doprava" i „skok zpět" vypadají přirozeně
     =================================================================== */
  var SK = { cx: 200, dx: 70, tTo: 0.38, tTd: 0.62, HJ: 13 };
  var SK_D = [[0, 94], [0.10, 94], [0.24, 64], [0.31, 76], [0.38, 99.5]];     // vzdálenost kyčel–kotník stojné nohy
  var SK_A = [[0, 6], [0.10, 6], [0.24, 12], [0.31, 24], [0.38, 44]];         // boční odchylka kyčle od kotníku
  var SK_HR = [[0, 0], [0.28, 0], [0.38, 14]];                                // zvednutá pata
  var SK_LAM = [[0, 18], [0.24, 32], [0.38, 14]];                             // předklon trupu
  function skHalfY(s) {                                    // výška kyčle pro s <= tTo
    var d = kf(SK_D, s), a = kf(SK_A, s);
    return B.ankleH + kf(SK_HR, s) + Math.sqrt(Math.max(0, d * d - a * a));
  }
  function skHip(s) {                                      // střed kyčlí [x, výška]
    var xA = SK.cx - SK.dx, f;
    if (s <= SK.tTo) return [xA + kf(SK_A, s), skHalfY(s)];
    if (s >= SK.tTd) { var p = skHip(1 - s); return [2 * SK.cx - p[0], p[1]]; }
    f = (s - SK.tTo) / (SK.tTd - SK.tTo);
    var h0 = skHip(SK.tTo), h1 = skHip(SK.tTd);
    return [lerp(h0[0], h1[0], f), h0[1] + SK.HJ * 4 * f * (1 - f)];
  }
  function skLam(s) { return kf(SK_LAM, Math.min(s, 1 - s, SK.tTo)); }
  function skOx(s) {                                       // boční náklon ramen (kladný = ve směru skoku z levé)
    if (s <= SK.tTo) return 0.5 * kf(SK_A, s);
    if (s >= SK.tTd) return -skOx(1 - s);
    var f = (s - SK.tTo) / (SK.tTd - SK.tTo);
    return lerp(skOx(SK.tTo), -skOx(SK.tTo), f);
  }
  function skLeftLeg(s) {                                  // levá noha (tělesně): stojná v A, po odrazu volná za tělem
    var xA = SK.cx - SK.dx, hip = skHip(s), hw = B.hipHalf || 8;
    var hL = [hip[0] - hw, hip[1], 0], aTo = [xA, B.ankleH + kf(SK_HR, SK.tTo), 0], a, planted = s <= SK.tTo, e = 0, hr;
    if (planted) { hr = kf(SK_HR, s); a = [xA, B.ankleH + hr, 0]; }
    else {
      var f = clamp((s - SK.tTo) / (SK.tTd - SK.tTo), 0, 1); e = sm(f); hr = 14;
      var free = [hL[0] - 20, Math.max(hL[1] - 62, 27), -45];
      a = [lerp(aTo[0], free[0], e), lerp(aTo[1], free[1], e), lerp(aTo[2], free[2], e)];
    }
    var pole = [lerp(-0.30, 0, e), 0, 1];
    return { h: hL, a: a, k: ik3(hL, a, B.thigh, B.shin, pole), hr: hr, c: planted };
  }
  function skLegOut(g, flip, cx) {                         // 3D -> obrazovka (flip = zrcadlení kolem cx)
    var h = flip ? mir(g.h, cx) : g.h, a = flip ? mir(g.a, cx) : g.a, k = flip ? mir(g.k, cx) : g.k;
    var ah = P2(a), out = flip ? 1 : -1;
    return { h: P2(h), k: P2(k), a: ah, t: [ah[0] + out * 2.5, ah[1] + B.ankleH + g.hr], c: g.c };
  }
  function bruslarJ(t, time, info) {
    var ph = phaseOf(info, t), s;
    if (ph === 'up' || ph === 'down') s = easeInv(t); else if (ph === 'hold') s = 1; else if (ph === 'pause') s = 0; else s = t;
    var cx = SK.cx, hip = skHip(s), hw = B.hipHalf || 8;
    var Lg = skLegOut(skLeftLeg(s), false, cx), Rg = skLegOut(skLeftLeg(1 - s), true, cx);
    var lf = skLam(s), hs = hip[1] + B.torso * cos(lf), zs = B.torso * sin(lf), sx = hip[0] + skOx(s);
    var sc3 = [sx, hs, zs], sway = -14 * Math.cos(PI * s);
    var J = frontArms(sc3, zs, hs, { dx: sway });
    var A = (s < 0.5) ? { L: Rg, R: Lg } : { L: Lg, R: Rg };           // vzdálenější (volná) noha se kreslí první
    J.hipL = A.L.h; J.kneeL = A.L.k; J.ankleL = A.L.a; J.toeL = A.L.t;
    J.hipR = A.R.h; J.kneeR = A.R.k; J.ankleR = A.R.a; J.toeR = A.R.t;
    J.hip = P2([hip[0], hip[1], 0]); J.shoulder = P2(sc3);
    J.head = [sx + skOx(s) * 0.15, FL - hs - (B.neck + B.headR) * cos(lf * 0.45)];
    J.headRot = 0; J._s = s;
    return J;
  }
  FA.register('bruslar', {
    title: 'Bruslařské skoky', view: 'front', facing: 1,
    tempo: { up: 1.2, hold: 0.6, down: 1.2, pause: 0.6 },
    phases: { up: 'Skok do strany ➡', hold: 'Stabilizuj', down: 'Skok zpět ⬅', pause: 'Stabilizuj' },
    solve: bruslarJ,
    highlight: function (t, info) {
      var ph = phaseOf(info, t), s = (ph === 'up' || ph === 'down') ? easeInv(t) : (ph === 'hold' ? 1 : (ph === 'pause' ? 0 : t));
      var k = Math.max(bump(s, 0.30, 0.09), bump(s, 0.70, 0.09), 0.35 * (s < 0.1 || s > 0.9 ? 1 : 0.3));
      return { quads: 0.15 + 0.7 * k, glutes: 0.15 + 0.6 * k, abductors: 0.3 + 0.5 * k, adductors: 0.2 + 0.3 * k, calves: 0.15 + 0.4 * k, core: 0.25 };
    }
  });

  /* testovací háček (jen pro ladění v Node) */
  FA._nohy = { jumpState: jumpState, jumpTime: jumpTime, skHip: skHip, easeInv: easeInv };
})();
