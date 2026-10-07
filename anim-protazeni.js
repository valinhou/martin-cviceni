/* =====================================================================
   anim-protazeni.js - rozcvicka a protazeni
   Klice: pochod-koleno, zakopavani, kmihy-vpred, kmihy-stranou, kyc-kruhy,
          devadesat, wgs, flexor, hamstring, figure4, motylek, zabka, kocka
   Zavisi na jadru anim-jadro.js (window.FitAnim). Delky koncetin z FitAnim.BODY,
   koncetiny pres FK / IK, opory se nesmyk (chodidla / dlane / kolena jsou pevne).
   ===================================================================== */
(function () {
  'use strict';

  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  var FA = root.FitAnim;
  if (!FA || typeof FA.register !== 'function') {
    if (typeof console !== 'undefined') console.warn('anim-protazeni.js: jadro FitAnim neni nacteno (anim-jadro.js musi byt drive).');
    return;
  }

  var PI = Math.PI, D2R = PI / 180, FLOOR = FA.FLOOR, W = FA.W, G = FA.gear, COL = FA.COL;
  var LAST = { time: 0 };                       // posledni cas z solve() - pro highlight (ten cas nedostava)

  /* ------------------------------ pomucky ------------------------------ */
  function bd() { return FA.BODY; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(p, q, t) { return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; }
  function sm(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }                  // smoothstep
  function P(b, a, l) { return FA.pt(b, a, l); }
  function dist(a, b) { return FA.dist(a, b); }
  function ang(a, b) { return FA.ang(a, b); }
  function d2(a, b) { var x = a[0] - b[0], y = a[1] - b[1]; return x * x + y * y; }
  function wrap180(a) { return ((a + 540) % 360) - 180; }
  function dirv(a) { return [Math.cos(a * D2R), Math.sin(a * D2R)]; }
  function flatA() { return Math.atan2(bd().ankleH, 20.5) / D2R; }                    // uhel kotnik->spicka u ploche nohy

  // 2-kloubove IK, strana kloubu se vybira podle napovedy (hint)
  function ik(base, target, l1, l2, hint) {
    var a = FA.ik2(base, target, l1, l2, 1), b = FA.ik2(base, target, l1, l2, -1);
    return d2(a.mid, hint) <= d2(b.mid, hint) ? a : b;
  }
  function legIK(hip, ank, hint) { var b = bd(); return ik(hip, ank, b.thigh, b.shin, hint); }
  function armIK(sh, wr, hint) { var b = bd(); return ik(sh, wr, b.upperArm, b.forearm, hint); }
  function straightLeg(hip, ank) { var b = bd(); return mix(hip, ank, b.thigh / (b.thigh + b.shin)); }

  // chodidlo: spicka lezi na povrchu sy (paty muze byt zvednuta); kotnik leva = f 1
  function toeSurf(A, sy) {
    var b = bd(), h = clamp(sy - A[1], 0, b.foot), dx = Math.sqrt(Math.max(0, b.foot * b.foot - h * h));
    return [A[0] + dx, A[1] + h];
  }
  function plantX(toeX, ankH) {                 // x kotniku, aby spicka stala na toeX pri vysce kotniku ankH nad povrchem
    var b = bd(), h = clamp(ankH, 0, b.foot); return toeX - Math.sqrt(Math.max(0, b.foot * b.foot - h * h));
  }
  function footFree(A, shinAng, extra) { return P(A, shinAng - 90 + flatA() + (extra || 0), bd().foot); }
  function footBlend(A, sy, shinAng, extra) {   // ploske na povrchu -> volne podle bercu
    var b = bd(), lift = (sy - b.ankleH) - A[1], w = clamp(lift / 5, 0, 1), T0 = toeSurf(A, sy);
    if (w <= 0) return T0;
    var a0 = ang(A, T0), a1 = shinAng - 90 + flatA() + (extra || 0);
    return P(A, a0 + wrap180(a1 - a0) * w, b.foot);
  }
  function legFK(hip, a1, flex) {
    var b = bd(), k = P(hip, a1, b.thigh), sa = a1 + flex;
    return { knee: k, ankle: P(k, sa, b.shin), sa: sa };
  }
  // nohu ve vzduchu (nikdy pod podlahu): FK, kotnik oriznut na vysku sy-ankleH-lift, koleno z IK
  function swingLeg(hip, a1, flex, sy, lift) {
    var b = bd(), f = legFK(hip, a1, flex), yMax = sy - b.ankleH - (lift || 0);
    var A = [f.ankle[0], Math.min(f.ankle[1], yMax)], r = legIK(hip, A, f.knee);
    return { knee: r.mid, ankle: r.end, sa: ang(r.mid, r.end) };
  }
  function armFK(S, ua, flex) {
    var b = bd(), e = P(S, ua, b.upperArm); return { elbow: e, wrist: P(e, ua - flex, b.forearm) };
  }
  function bump(p) {                            // 0..1..0 v prvni polovine cyklu, pak 0
    p = ((p % 1) + 1) % 1;
    return p < 0.5 ? Math.pow(Math.sin(2 * PI * p), 1.15) : 0;
  }
  function isFrz(info) { return !!(info && (info.phase === 'freeze' || info.phase === 'static')); }
  function clk(t, time, info, cycSec) {         // faze cyklu 0..1 (cas, nebo t pri zmrazeni)
    LAST.time = time || 0;
    if (isFrz(info)) return clamp(t, 0, 0.9999);
    return (((time || 0) / 1000 / cycSec) % 1 + 1) % 1;
  }
  function rr(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath(); c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function J2(o) {                              // dopln vzdalenejsi koncetiny z blizkych, pokud chybi
    if (!o.elbowF) { o.elbowF = o.elbowN; o.wristF = o.wristN; }
    if (!o.kneeF) { o.kneeF = o.kneeN; o.ankleF = o.ankleN; o.toeF = o.toeN; }
    return o;
  }

  /* ===================================================================
     STOJ: pochod s vysokym kolenem, zakopavani, kmihy (bocni pohled)
     =================================================================== */
  function standLegs(hipY, x0, hA, hB, o) {     // o: {heel, bias, swingFn(hip, h, bias) -> {knee,ankle,sa}, extra}
    var b = bd(), hip = [x0, hipY], res = {}, i, h, hO, bias, A, T, sw, r, sy = FLOOR, ankH, toeX;
    for (i = 0; i < 2; i++) {
      h = i ? hB : hA; hO = i ? hA : hB; bias = i ? 1.7 : 0;
      if (h > 0.0005) {
        sw = o.swingFn(hip, h, bias);
        T = footBlend(sw.ankle, sy, sw.sa, o.extra * h);
        res[i] = { knee: sw.knee, ankle: sw.ankle, toe: T };
      } else {
        ankH = b.ankleH + o.heel * hO;                    // pata zvednuta jen kdyz druha noha pracuje
        toeX = x0 + 20.5 + (i ? -3 : 0);
        A = [plantX(toeX, ankH), sy - ankH];
        r = legIK(hip, A, [A[0] + 60, (hip[1] + A[1]) / 2]);
        res[i] = { knee: r.mid, ankle: r.end, toe: toeSurf(r.end, sy) };
      }
    }
    return { hip: hip, N: res[0], F: res[1] };
  }

  function marchSolve(t, time, info) {
    var b = bd(), L = b.thigh + b.shin, p = clk(t, time, info, 1.2), x0 = W * 0.5 - 8;
    var hA = bump(p), hB = bump(p + 0.5), lift = Math.max(hA, hB);
    var hipY = FLOOR - b.ankleH - 0.972 * L - 2.2 * lift;
    var lg = standLegs(hipY, x0, hA, hB, {
      heel: 4.5, extra: 18,
      swingFn: function (hip, h, bias) { return swingLeg(hip, 90 - 84 * h + bias * (1 - h), 104 * Math.pow(h, 0.9), FLOOR, 0); }
    });
    var lean = 3, S = P(lg.hip, -90 + lean, b.torso), head = FA.headAt(S, -90 + lean * 0.5);
    var s = Math.sin(2 * PI * p), aN = armFK(S, 90 + 22 * s, 78), aF = armFK(S, 90 - 22 * s, 78);
    return {
      hip: lg.hip, shoulder: S, head: head,
      elbowN: aN.elbow, wristN: aN.wrist, kneeN: lg.N.knee, ankleN: lg.N.ankle, toeN: lg.N.toe,
      elbowF: aF.elbow, wristF: aF.wrist, kneeF: lg.F.knee, ankleF: lg.F.ankle, toeF: lg.F.toe
    };
  }
  FA.register('pochod-koleno', {
    title: 'Pochod / skipink s vysokým kolenem', view: 'side', facing: 1,
    tempo: { up: 0.6, hold: 0, down: 0.6, pause: 0 },
    phases: { up: 'Koleno nahoru ⬆', hold: '', down: 'Střídej nohu', pause: '' },
    solve: marchSolve,
    highlight: function (t, info) {
      var p = isFrz(info) ? t : ((LAST.time / 1200) % 1), a = bump(p), c = bump(p + 0.5);
      return { quads: clamp(0.3 + 0.5 * a + 0.2 * c, 0, 1), core: 0.3, glutes: 0.18 + 0.2 * c, calves: 0.12 };
    }
  });

  function kickSolve(t, time, info) {
    var b = bd(), L = b.thigh + b.shin, p = clk(t, time, info, 1.05), x0 = W * 0.5 - 12;
    var hA = bump(p), hB = bump(p + 0.5), lift = Math.max(hA, hB);
    var hipY = FLOOR - b.ankleH - 0.972 * L - 3.2 - 1.8 * lift;
    var lg = standLegs(hipY, x0, hA, hB, {
      heel: 3.5, extra: 8,
      swingFn: function (hip, h, bias) { return swingLeg(hip, 90 - 12 * h + bias * (1 - h), 150 * h, FLOOR, 3.5); }
    });
    var lean = 7, S = P(lg.hip, -90 + lean, b.torso), head = FA.headAt(S, -90 + lean * 0.4);
    var s = Math.sin(2 * PI * p), aN = armFK(S, 92 + 20 * s, 85), aF = armFK(S, 92 - 20 * s, 85);
    return {
      hip: lg.hip, shoulder: S, head: head,
      elbowN: aN.elbow, wristN: aN.wrist, kneeN: lg.N.knee, ankleN: lg.N.ankle, toeN: lg.N.toe,
      elbowF: aF.elbow, wristF: aF.wrist, kneeF: lg.F.knee, ankleF: lg.F.ankle, toeF: lg.F.toe
    };
  }
  FA.register('zakopavani', {
    title: 'Zakopávání na místě', view: 'side', facing: 1,
    tempo: { up: 0.52, hold: 0, down: 0.53, pause: 0 },
    phases: { up: 'Pata k hýždím ⬆', hold: '', down: 'Střídej nohu', pause: '' },
    solve: kickSolve,
    highlight: function (t, info) {
      var p = isFrz(info) ? t : ((LAST.time / 1050) % 1), a = bump(p), c = bump(p + 0.5);
      return { hamstrings: clamp(0.3 + 0.55 * a + 0.2 * c, 0, 1), calves: 0.2, glutes: 0.18 };
    }
  });

  /* ---- kmihy vpred-vzad (zboku, opora o operadlo zidle na vzdalenejsi strane) ---- */
  var KM_N = 8;                                 // pocet kmitu v jednom cyklu s narustajicim rozsahem
  function kmEnv(n) {                           // n 0..1 pres cely cyklus: rozsah naroste, chvili drzi, zklidni
    if (n < 0.6) return 0.55 + 0.45 * sm(n / 0.6);
    if (n < 0.84) return 1;
    return 1 - 0.45 * sm((n - 0.84) / 0.16);
  }
  function kmCycle(t, time, info, cycSec) {     // {p: faze kmitu, e: rozsah}
    LAST.time = time || 0;
    if (isFrz(info)) return { p: clamp(t, 0, 0.9999), e: 1 };
    var n = (((time || 0) / 1000 / cycSec) % KM_N + KM_N) % KM_N;
    return { p: n % 1, e: kmEnv(n / KM_N) };
  }
  function kmStatic() {
    var b = bd(), L = b.thigh + b.shin, hip = [W * 0.5 - 22, FLOOR - b.ankleH - 0.985 * L];
    var S = P(hip, -90 + 4, b.torso);
    return { hip: hip, S: S, hand: [S[0] + 18, S[1] + 0.9 * (b.upperArm + b.forearm) * 0.93] };
  }
  function kmVSolve(t, time, info) {
    var b = bd(), st = kmStatic(), cy = kmCycle(t, time, info, 1.7), hip = st.hip, S = st.S;
    var ct = -Math.cos(2 * PI * cy.p), th = 16 + 46 * cy.e * ct;          // vychylka z kolmice: + dopredu
    var fwd = clamp(th / 60, 0, 1), bwd = clamp(-th / 25, 0, 1);
    var fl = 3 + 15 * (0.5 - 0.5 * ct) + 8 * bwd;
    var sw = swingLeg(hip, 90 - th, fl, FLOOR, 0), T = footBlend(sw.ankle, FLOOR, sw.sa, 12 * bwd);
    var stA = [plantX(hip[0] + 20.5, b.ankleH), FLOOR - b.ankleH];
    var stK = legIK(hip, stA, [stA[0] + 50, (hip[1] + stA[1]) / 2]);
    var head = FA.headAt(S, -90 + 4 * 0.5);
    var arN = armFK(S, 94 - 8 * ct, 22);                                   // volna ruka, mirne proti kmitu
    var arF = armIK(S, st.hand, [(S[0] + st.hand[0]) / 2 - 18, (S[1] + st.hand[1]) / 2 + 6]);
    return {
      hip: hip, shoulder: S, head: head,
      elbowN: arN.elbow, wristN: arN.wrist, kneeN: sw.knee, ankleN: sw.ankle, toeN: T,
      elbowF: arF.mid, wristF: arF.end, kneeF: stK.mid, ankleF: stK.end, toeF: toeSurf(stK.end, FLOOR)
    };
  }
  function woodPoly(c, pts, base, dark) {
    c.fillStyle = dark; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath(); c.fill();
  }
  function chairSideBack(c, J) {                 // zidle za postavou (na vzdalenejsi strane): sedak z jadra + vyssi opěradlo, na ktere lezi ruka
    var Wh = J.wristF, topX = Wh[0], lean = -6, px = topX - lean, rail = Wh[1] + 3.6, sy = FLOOR - FA.CHAIR_H;
    G.chair(c, px + 31.4, -1, { back: false });  // opěradlo u postavy, sedak smeruje dopredu (doprava)
    woodPoly(c, [[px - 2.6, sy + 1], [px + 2.6, sy + 1], [topX + 2.4, rail + 3], [topX - 2.4, rail + 3]], COL.wood, COL.woodD);
    c.fillStyle = COL.wood; c.beginPath(); c.moveTo(px - 2.6, sy + 1); c.lineTo(px + 0.4, sy + 1); c.lineTo(topX + 0.2, rail + 3); c.lineTo(topX - 2.4, rail + 3); c.closePath(); c.fill();
    c.fillStyle = COL.woodD; rr(c, topX - 2.9, rail + 0.8, 5.8, 17, 2.5); c.fill();
    c.fillStyle = COL.wood; rr(c, topX - 2.9, rail, 5.8, 16.4, 2.5); c.fill();
    c.fillStyle = COL.woodL; c.fillRect(topX - 0.6, rail + 1, 1.1, 13);
  }
  FA.register('kmihy-vpred', {
    title: 'Kmihy nohou vpřed–vzad (opora o židli)', view: 'side', facing: 1,
    tempo: { up: 0.85, hold: 0, down: 0.85, pause: 0 },
    phases: { up: 'Švih vpřed', hold: '', down: 'Švih vzad', pause: '' },
    solve: kmVSolve, back: chairSideBack,
    highlight: function (t, info) {
      var p = isFrz(info) ? t : ((LAST.time / 1700) % 1), ct = -Math.cos(2 * PI * p);
      return { hamstrings: 0.2 + 0.4 * clamp(ct, 0, 1), quads: 0.2 + 0.4 * clamp(-ct, 0, 1), glutes: 0.2 + 0.3 * clamp(-ct, 0, 1), core: 0.15 };
    }
  });

  /* ===================================================================
     PREDNI POHLED NA STOJI: zidle zepredu, kmihy do stran, kruzeni kolenem
     =================================================================== */
  var FR_CX = W * 0.5;
  function frontStatic(shiftX) {
    var b = bd(), L = b.thigh + b.shin, hipC = [FR_CX + (shiftX || 0), FLOOR - b.ankleH - 0.985 * L];
    var lean = 0.89, scC = [hipC[0], hipC[1] - b.torso * lean];
    return { hipC: hipC, scC: scC, lean: lean };
  }
  var FR_CHAIR_TOP = 116;                        // horni hrana opěradla (zepredu), ruce na ni lehce polozene
  function chairFrontDraw(c) {                   // zidle zepredu - stoji pred postavou (kresli se po figure)
    var sy = FLOOR - FA.CHAIR_H, top = FR_CHAIR_TOP, cx = FR_CX, i, s, lx;
    G.shadow(c, cx, FLOOR + 0.5, 40, 0.45, 3.2);
    for (i = 0; i < 2; i++) {                    // zadni nohy / sloupky operadla (vzdalenejsi, tmavsi)
      s = i ? 1 : -1; lx = cx + s * 27;
      c.fillStyle = COL.woodD; c.fillRect(lx - 2.3, top + 4, 4.6, FLOOR - top - 4);
    }
    c.fillStyle = COL.woodD; c.fillRect(cx - 24, FLOOR - 30, 48, 2.6);                  // pricka mezi nohami
    for (i = 0; i < 2; i++) {                    // predni nohy
      s = i ? 1 : -1; lx = cx + s * 25;
      c.fillStyle = COL.woodD; c.fillRect(lx - 2.6, sy + 4, 5.2, FLOOR - sy - 4);
      c.fillStyle = COL.wood; c.fillRect(lx - 2.6 + (s < 0 ? 0 : 1.6), sy + 4, 3.6, FLOOR - sy - 4);
    }
    c.fillStyle = COL.woodD; rr(c, cx - 32, sy + 0.8, 64, 6, 2.5); c.fill();            // sedak
    c.fillStyle = COL.wood; rr(c, cx - 32, sy, 64, 5.4, 2.5); c.fill();
    c.fillStyle = COL.woodL; c.fillRect(cx - 29, sy + 0.7, 58, 1);
    c.fillStyle = COL.woodD; rr(c, cx - 31, top + 1, 62, 9.5, 3.4); c.fill();           // horni pricka
    c.fillStyle = COL.wood; rr(c, cx - 31, top, 62, 8.8, 3.4); c.fill();
    c.fillStyle = COL.woodL; c.fillRect(cx - 27, top + 0.8, 54, 1.2);
    c.fillStyle = COL.woodD; rr(c, cx - 28, top + 14, 56, 4.5, 2); c.fill();
    c.fillStyle = COL.wood; rr(c, cx - 28, top + 13.4, 56, 4, 2); c.fill();
  }
  function frontArmsOnChair(sL, sR) {
    var wy = FR_CHAIR_TOP - 3.5, wl = [FR_CX - 25, wy], wr = [FR_CX + 25, wy];
    var aL = armIK(sL, wl, [sL[0] - 16, (sL[1] + wl[1]) / 2 + 2]), aR = armIK(sR, wr, [sR[0] + 16, (sR[1] + wr[1]) / 2 + 2]);
    return { aL: aL, aR: aR };
  }
  function frontFigure(hipC, scC, sw, ankL, toeL, kneeL, ankR, toeR, kneeR, o) {
    var b = bd(), sL = [scC[0] - b.shoulderHalf, scC[1]], sR = [scC[0] + b.shoulderHalf, scC[1]];
    var arms = o.arms ? frontArmsOnChair(sL, sR) : null;
    var J = {
      shoulder: scC, hip: hipC, shoulderL: sL, shoulderR: sR, hipL: [hipC[0] - b.hipHalf, hipC[1]], hipR: [hipC[0] + b.hipHalf, hipC[1]],
      head: [scC[0] + (o.headDx || 0), scC[1] - (b.neck + b.headR)], headRot: o.headRot || 0,
      kneeL: kneeL, ankleL: ankL, toeL: toeL, kneeR: kneeR, ankleR: ankR, toeR: toeR
    };
    if (arms) { J.elbowL = arms.aL.mid; J.wristL = arms.aL.end; J.elbowR = arms.aR.mid; J.wristR = arms.aR.end; }
    return J;
  }

  /* ---- kmihy do stran: noha (R, vpravo v obraze) kmita pred telem ---- */
  function kmSSolve(t, time, info) {
    var b = bd(), cy = kmCycle(t, time, info, 1.7), L = b.thigh + b.shin;
    var st = frontStatic(0), hipC = st.hipC, e = cy.e;
    var ct = -Math.cos(2 * PI * cy.p);           // -1 pred telem, +1 ven
    var phi = (ct > 0) ? 4 + 36 * e * ct : 4 + 28 * e * ct;
    var hipR = [hipC[0] + b.hipHalf, hipC[1]], hipL = [hipC[0] - b.hipHalf, hipC[1]];
    var ankL = [hipL[0] - 1, FLOOR - b.ankleH];
    var kL = mix(hipL, ankL, b.thigh / (b.thigh + b.shin));
    var lenR = 0.985 * L, u = [Math.sin(phi * D2R), Math.cos(phi * D2R)];
    var ankR = [hipR[0] + u[0] * lenR, hipR[1] + u[1] * lenR], kR = [hipR[0] + u[0] * lenR * b.thigh / L, hipR[1] + u[1] * lenR * b.thigh / L];
    var toeR = [ankR[0] + 2, ankR[1] + b.ankleH];
    return frontFigure(hipC, st.scC, 0, ankL, [ankL[0] - 2, ankL[1] + b.ankleH], kL, ankR, toeR, kR, { arms: true });
  }
  FA.register('kmihy-stranou', {
    title: 'Kmihy nohou do stran (opora o židli)', view: 'front', facing: 1,
    tempo: { up: 0.85, hold: 0, down: 0.85, pause: 0 },
    phases: { up: 'Kmih ven', hold: '', down: 'Kmih před tělem', pause: '' },
    solve: kmSSolve, back: function (c) { chairFrontDraw(c); },
    highlight: function (t, info) {
      var p = isFrz(info) ? t : ((LAST.time / 1700) % 1), ct = -Math.cos(2 * PI * p);
      return { abductors: 0.25 + 0.5 * clamp(ct, 0, 1), adductors: 0.25 + 0.5 * clamp(-ct, 0, 1), glutes: 0.2, core: 0.12 };
    }
  });

  /* ---- otevirani brany: koleno nahoru -> do strany -> dolu (3D -> 2D) ---- */
  function kyKnee(hip, F, A, m) {                // smer stehna z flexe F a abdukce A (stupne), 3D -> 2D
    var b = bd(), f = F * D2R, a = A * D2R;
    var dx = Math.sin(a), dy = Math.cos(a) * Math.cos(f), dz = Math.cos(a) * Math.sin(f);
    var k = [hip[0] + b.thigh * m * dx, hip[1] + b.thigh * m * (dy + 0.26 * dz)];
    return { k: k, d: [dx, dy, dz] };
  }
  function kySolve(t, time, info) {
    var b = bd(), cyc = 2.8, u = clk(t, time, info, cyc), L = b.thigh + b.shin, m = 0.985, F, A, lift;
    if (u < 0.3) { F = 90 * sm(u / 0.3); A = 0; }
    else if (u < 0.6) { F = 90; A = 74 * sm((u - 0.3) / 0.3); }
    else if (u < 0.9) { var q = sm((u - 0.6) / 0.3); F = 90 * (1 - q); A = 74 * (1 - q); }
    else { F = 0; A = 0; }
    lift = F / 90;
    var st = frontStatic(-3.5 * lift), hipC = st.hipC;
    var hipL = [hipC[0] - b.hipHalf, hipC[1]], hipR = [hipC[0] + b.hipHalf, hipC[1]];
    var ankL = [FR_CX - 9, FLOOR - b.ankleH];
    var kL = straightLeg(hipL, ankL);
    var kn = kyKnee(hipR, F, A, m), d = kn.d, lam = A / 74;
    // holen: visi dolu, pri vnejsi rotaci se spicka stahuje ke stredu tela
    var sx = -0.55 * lam, sy3 = 1, sz = -0.25 * (F / 90) * (1 - lam);
    var sl = Math.hypot(sx, sy3, sz), s2 = [sx / sl, (sy3 + 0.26 * sz) / sl];
    var ankR = [kn.k[0] + b.shin * m * s2[0], kn.k[1] + b.shin * m * s2[1]];
    if (ankR[1] > FLOOR - b.ankleH) ankR[1] = FLOOR - b.ankleH;
    var toeR = [ankR[0] + 2, ankR[1] + b.ankleH], toeL = [ankL[0] - 2, ankL[1] + b.ankleH];
    var J = frontFigure(hipC, st.scC, 0, ankL, toeL, kL, ankR, toeR, kn.k, { arms: true, headRot: 0 });
    return J;
  }
  FA.register('kyc-kruhy', {
    title: 'Otevírání brány (kroužení kolenem)', view: 'front', facing: 1,
    tempo: { up: 0.84, hold: 0.84, down: 0.84, pause: 0.28 },
    phases: { up: 'Koleno nahoru', hold: 'Vytoč ho do strany', down: 'Dolů', pause: '' },
    solve: kySolve, back: function (c) { chairFrontDraw(c); },
    highlight: function (t, info) {
      var u = isFrz(info) ? t : ((LAST.time / 2800) % 1), a = u > 0.3 && u < 0.9 ? 1 : 0.45;
      return { abductors: 0.55 * a, glutes: 0.4 * a, quads: 0.3, adductors: 0.2, core: 0.15 };
    }
  });

  /* ===================================================================
     SED NA PODLOZCE - pohled zepredu (mirne shora): 90/90, motylek
     Podlahova rovina (x, z) -> obraz [cx + x, G0 - vyska + z * KZ]; z smerem ke kameře.
     =================================================================== */
  var KZ = 0.4, SG0 = 205;                       // sklon pohledu, obrazova y bodu (z = 0, vyska 0) na podlozce
  function pj(x, z, h) { return [FR_CX + x, SG0 - h + z * KZ]; }
  function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function v3add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function v3mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function v3len(a) { return Math.sqrt(v3dot(a, a)) || 1e-9; }
  function v3nrm(a) { return v3mul(a, 1 / v3len(a)); }
  function v3cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  // koleno [x,z,h] ze 3D IK: otaceni kolena kolem osy kycel->kotnik o uhel psi (0 = nahoru, + = do obrazu doprava)
  function knee3(H, A, psi, outwardRight) {
    var b = bd(), l1 = b.thigh, l2 = b.shin, d = v3sub(A, H), dl = clamp(v3len(d), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
    var u = v3nrm(d), a = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl), r = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    var C = v3add(H, v3mul(u, a)), up = [0, 0, 1], e1 = v3nrm(v3sub(up, v3mul(u, v3dot(up, u)))), e2 = v3nrm(v3cross(e1, u));
    if (e2[0] < 0) e2 = v3mul(e2, -1);
    return v3add(C, v3add(v3mul(e1, r * Math.cos(psi)), v3mul(e2, r * Math.sin(psi))));
  }
  function seatedFront(o) {                      // zaklad sedu: kyčle, trup se sklonem (lean > 0 = predklon, < 0 = zaklon)
    var b = bd(), hh = 12, lean = (o.lean || 0) * D2R, hc = pj(0, 0, hh);
    var sc = pj(0, b.torso * Math.sin(lean), hh + b.torso * Math.cos(lean));
    var sL = [sc[0] - b.shoulderHalf, sc[1]], sR = [sc[0] + b.shoulderHalf, sc[1]];
    return { b: b, hh: hh, hc: hc, sc: sc, sL: sL, sR: sR, hipL: pj(-b.hipHalf, 0, hh), hipR: pj(b.hipHalf, 0, hh) };
  }
  function matFront(c) {
    var yb = SG0 - 38 * KZ, yf = SG0 + 62 * KZ, x1 = FR_CX - 104, w = 208;
    G.shadow(c, FR_CX, yf + 4.6, 112, 0.4, 3.2);
    c.fillStyle = '#205c4a'; rr(c, x1, yf - 3, w, 7.4, 3.5); c.fill();                  // celo (tloustka)
    c.fillStyle = '#2d7a63'; rr(c, x1, yb, w, yf - yb, 7); c.fill();                    // horni plocha
    c.fillStyle = 'rgba(255,255,255,0.08)'; rr(c, x1 + 3, yb + 2, w - 6, 2, 1); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.16)'; c.fillRect(x1 + 6, yf - 1.8, w - 12, 1);
  }

  function d90Solve(t, time, info) {
    LAST.time = time || 0;
    var s = seatedFront({ lean: -9 }), b = s.b, lam = 2 * t - 1, psiMax = 86 * D2R, psi = lam * psiMax, i, K = {}, kp, A3, H3, an = {}, side;
    var xa = 40, za = 41;
    for (i = 0; i < 2; i++) {
      side = i ? 1 : -1;
      H3 = [side * b.hipHalf, 0, s.hh]; A3 = [side * xa, za, b.ankleH];
      var k3 = knee3(H3, A3, psi, true);
      K[i] = pj(k3[0], k3[1], k3[2]); an[i] = pj(A3[0], A3[1], A3[2]);
    }
    var toeL = [an[0][0] - 1.5, an[0][1] + 15], toeR = [an[1][0] + 1.5, an[1][1] + 15];
    // ruce za telem opreny o podlozku
    var wl = pj(-30, -36, 3.6), wr = pj(30, -36, 3.6);
    var aL = armIK(s.sL, wl, [s.sL[0] - 8, (s.sL[1] + wl[1]) / 2 + 3]), aR = armIK(s.sR, wr, [s.sR[0] + 8, (s.sR[1] + wr[1]) / 2 + 3]);
    var sh = s.sc.slice(); sh[0] += 2.2 * lam;
    var sL = [s.sL[0] + 2.2 * lam, s.sL[1]], sR = [s.sR[0] + 2.2 * lam, s.sR[1]];
    aL = armIK(sL, wl, [sL[0] - 8, (sL[1] + wl[1]) / 2 + 3]); aR = armIK(sR, wr, [sR[0] + 8, (sR[1] + wr[1]) / 2 + 3]);
    return {
      shoulder: sh, hip: s.hc, shoulderL: sL, shoulderR: sR, hipL: s.hipL, hipR: s.hipR,
      head: [sh[0] + 1.5 * lam, sh[1] - (b.neck + b.headR)], headRot: 3 * lam,
      kneeL: K[0], ankleL: an[0], toeL: toeL, kneeR: K[1], ankleR: an[1], toeR: toeR,
      elbowL: aL.mid, wristL: aL.end, elbowR: aR.mid, wristR: aR.end
    };
  }
  FA.register('devadesat', {
    title: '90/90 přetáčení kyčlí', view: 'front', facing: 1, zoom: 1.32,
    tempo: { up: 1.7, hold: 0.5, down: 1.7, pause: 0.5 },
    phases: { up: 'Kolena doprava', hold: 'Drž, záda rovně', down: 'Kolena doleva', pause: 'Drž, záda rovně' },
    solve: d90Solve, back: function (c) { matFront(c); },
    highlight: function (t) {
      var a = Math.abs(2 * t - 1);
      return { glutes: 0.3 + 0.4 * a, abductors: 0.25 + 0.35 * a, adductors: 0.2 + 0.25 * (1 - a), core: 0.15 };
    }
  });

  function butSolve(t, time, info) {
    LAST.time = time || 0;
    var br = Math.sin((time || 0) / 1000 * 1.65) * (t > 0.97 ? 1 : 0.3);
    var tt = clamp(t + 0.01 * br, 0, 1);
    var s0 = seatedFront({ lean: lerp(30, 40, tt) }), b = s0.b;
    var s = s0, zA = lerp(25, 33, tt), psi = lerp(58, 89, tt) * D2R, i, side, H3, A3, K = {}, an = {};
    for (i = 0; i < 2; i++) {
      side = i ? 1 : -1;
      H3 = [side * b.hipHalf, 0, s.hh]; A3 = [side * 3.6, zA, b.ankleH + 1];
      var k3 = knee3(H3, A3, side * psi, true);
      K[i] = pj(k3[0], k3[1], k3[2]); an[i] = pj(A3[0], A3[1], A3[2]);
    }
    var toeL = [an[0][0] + 1, an[0][1] + 14], toeR = [an[1][0] - 1, an[1][1] + 14];
    var wl = [an[0][0] - 4, an[0][1] - 4.5], wr = [an[1][0] + 4, an[1][1] - 4.5];
    var aL = armIK(s.sL, wl, [s.sL[0] - 16, (s.sL[1] + wl[1]) / 2]), aR = armIK(s.sR, wr, [s.sR[0] + 16, (s.sR[1] + wr[1]) / 2]);
    return {
      shoulder: s.sc, hip: s.hc, shoulderL: s.sL, shoulderR: s.sR, hipL: s.hipL, hipR: s.hipR,
      head: [s.sc[0], s.sc[1] - (b.neck + b.headR) * 0.97 + 1.5], headRot: 0,
      kneeL: K[0], ankleL: an[0], toeL: toeL, kneeR: K[1], ankleR: an[1], toeR: toeR,
      elbowL: aL.mid, wristL: aL.end, elbowR: aR.mid, wristR: aR.end
    };
  }
  FA.register('motylek', {
    title: 'Motýlek (protažení třísel)', view: 'front', facing: 1, zoom: 1.32,
    tempo: { up: 2.6, hold: 8, down: 2.2, pause: 1 },
    phases: { up: 'Kolena pomalu k zemi', hold: 'Drž a dýchej', down: 'Pomalu zpět', pause: '' },
    solve: butSolve, back: function (c) { matFront(c); },
    highlight: function (t) { return { adductors: clamp(0.3 + 0.6 * t, 0, 1), glutes: 0.1, core: 0.1 * t }; }
  });

  /* ===================================================================
     CVIKY NA PODLOZCE - bocni pohled (hlava vlevo u supinaci, vpravo u ctyrnozky)
     =================================================================== */
  var SY = FLOOR - 4.2;                          // povrch podlozky
  function matSide(x1, x2) { return function (c) { G.mat(c, x1, x2); }; }

  function supineBase(hipX, lift) {              // lezi na zadech, hlava vlevo; lift = zvednuti ramen (stupne)
    var b = bd(), hip = [hipX, SY - 12.5];
    var S = [hip[0] - b.torso * Math.cos((4.2 - lift) * D2R), hip[1] + b.torso * Math.sin((4.2 - lift) * D2R)];
    var hy = SY - 11.6 - lift * 0.55, hx = S[0] - Math.sqrt(Math.max(1, Math.pow(b.neck + b.headR, 2) - Math.pow(S[1] - hy, 2)));
    return { b: b, hip: hip, S: S, head: [hx, hy], headRot: -90 + lift * 0.8 };
  }

  /* ---- hamstring: noha nahoru, drzi za stehno ---- */
  function hamSolve(t, time, info) {
    LAST.time = time || 0;
    var b = bd(), hipX = W * 0.5 - 10, br = (isFrz(info) || t < 0.98) ? 0 : Math.sin((time || 0) / 1000 * 1.6);
    var up = sm(t / 0.72), deep = sm((t - 0.7) / 0.3), grab = sm((t - 0.38) / 0.36);
    var th = -(lerp(0, 108, up) + 9 * deep + 1.3 * br), lift = 9 * grab;
    var sb = supineBase(hipX, lift), hip = sb.hip, S = sb.S;
    var u = dirv(th), flex = 4 * sm(t / 0.5);
    var f = legFK(hip, th, flex), kn = f.knee, an = f.ankle;
    var T = footFree(an, f.sa, 4);
    var n2 = [-Math.sin(th * D2R), Math.cos(th * D2R)];                             // zadni strana stehna
    var hold = [hip[0] + u[0] * b.thigh * 0.56 + n2[0] * 7.5, hip[1] + u[1] * b.thigh * 0.56 + n2[1] * 7.5];
    var rest = [hip[0] - 3, SY - 5.2], hy = lerp(-14, 16, grab);
    var wr = mix(rest, hold, grab), wrF = [wr[0] + 1.4, wr[1] + 1.2];
    var aN = armIK(S, wr, [(S[0] + wr[0]) / 2 - 6, (S[1] + wr[1]) / 2 + hy]), aF = armIK(S, wrF, [(S[0] + wrF[0]) / 2 - 8, (S[1] + wrF[1]) / 2 + hy + 2]);
    var anF = [hip[0] + 0.995 * (b.thigh + b.shin), SY - 9], knF = straightLeg(hip, anF), TF = footFree(anF, 0, 0);
    return {
      hip: hip, shoulder: S, head: sb.head, headRot: sb.headRot,
      elbowN: aN.mid, wristN: aN.end, kneeN: kn, ankleN: an, toeN: T,
      elbowF: aF.mid, wristF: aF.end, kneeF: knF, ankleF: anF, toeF: TF
    };
  }
  FA.register('hamstring', {
    title: 'Protažení zadního stehna vleže', view: 'side', facing: 1, zoom: 1.28,
    tempo: { up: 3, hold: 8, down: 2.5, pause: 1 },
    phases: { up: 'Zvedni nataženou nohu', hold: 'Drž za stehno a dýchej', down: 'Pomalu zpět', pause: '' },
    solve: hamSolve, back: matSide(W * 0.5 - 118, W * 0.5 + 128),
    highlight: function (t) { return { hamstrings: clamp(0.15 + 0.7 * t, 0, 1), calves: 0.15 * t }; }
  });

  /* ---- figure4: ctyrka vleze ---- */
  function f4Solve(t, time, info) {
    LAST.time = time || 0;
    var b = bd(), hipX = W * 0.5 + 12, br = (isFrz(info) || t < 0.98) ? 0 : Math.sin((time || 0) / 1000 * 1.6);
    var sb = supineBase(hipX, 0), hip = sb.hip, S = sb.S;
    var cr = sm(t / 0.3), pull = sm((t - 0.28) / 0.72), grab = sm((t - 0.22) / 0.4);
    var th = -lerp(58, 130, pull) - 1.5 * br, sa = lerp(75, -24, pull);
    var kn = P(hip, th, b.thigh), an = P(kn, sa, b.shin);
    var T = footBlend(an, SY, sa, 6 * pull);
    var u = dirv(th), n1 = [Math.sin(th * D2R), -Math.cos(th * D2R)], n2 = [-n1[0], -n1[1]];
    // prekrizena noha (vzdalenejsi): clanek lezi na predni strane stehna spodni nohy
    var A0 = [hip[0] + 44, SY - 9], Pc = [hip[0] + u[0] * b.thigh * 0.82 + n1[0] * 9, hip[1] + u[1] * b.thigh * 0.82 + n1[1] * 9];
    var aF = mix(A0, Pc, cr), kf = lerp(1, 0.56, cr);
    // koleno prekrizene nohy: stehno zkracene perspektivou (koleno uhyba od divaka), smer plynule 57 -> 104 stupnu nahoru
    var kC = P(hip, -lerp(57, 104, cr), b.thigh * kf), rF = { mid: kC, end: aF };
    var saF = ang(kC, aF), TF = footBlend(aF, SY, saF, 4);
    var hold = [hip[0] + u[0] * b.thigh * 0.58 + n2[0] * 7.5, hip[1] + u[1] * b.thigh * 0.58 + n2[1] * 7.5];
    var rest = [hip[0] - 3, SY - 5.2], hy = lerp(-14, 18, grab);
    var wr = mix(rest, hold, grab), wrF = [wr[0] + 2, wr[1] - 1.5];
    var aN = armIK(S, wr, [(S[0] + wr[0]) / 2 - 4, (S[1] + wr[1]) / 2 + hy]), aFa = armIK(S, wrF, [(S[0] + wrF[0]) / 2 - 6, (S[1] + wrF[1]) / 2 + hy + 2]);
    return {                                                // blizsi noha = prekrizena (viditelna), vzdalenejsi = spodni, pritahovana
      hip: hip, shoulder: S, head: sb.head, headRot: sb.headRot,
      elbowN: aN.mid, wristN: aN.end, kneeN: rF.mid, ankleN: rF.end, toeN: TF,
      elbowF: aFa.mid, wristF: aFa.end, kneeF: kn, ankleF: an, toeF: T
    };
  }
  FA.register('figure4', {
    title: 'Protažení hýždí „čtyřka“ vleže', view: 'side', facing: 1, zoom: 1.4,
    tempo: { up: 3, hold: 8, down: 2.5, pause: 1 },
    phases: { up: 'Kotník přes koleno, přitáhni', hold: 'Drž a dýchej', down: 'Pomalu zpět', pause: '' },
    solve: f4Solve, back: matSide(W * 0.5 - 90, W * 0.5 + 100),
    highlight: function (t) { return { glutes: clamp(0.15 + 0.8 * t, 0, 1), abductors: 0.35 * t, hamstrings: 0.1 * t }; }
  });

  /* ---- flexor kycle v kleku ---- */
  function flexSolve(t, time, info) {
    LAST.time = time || 0;
    var b = bd(), Kx = W * 0.5 + 0, br = (isFrz(info) || t < 0.98) ? 0 : Math.sin((time || 0) / 1000 * 1.5);
    var d = 14 * t + 0.9 * br * (t > 0.98 ? 1 : 0), Xf = Kx + b.thigh - 1;
    var Kr = [Kx, SY - 7.2], hip = [Kr[0] + d, Kr[1] - Math.sqrt(Math.max(1, b.thigh * b.thigh - d * d))];
    // zadni noha: koleno na podlozce, holen podel podlozky, nárt dole
    var Ar = [Kx - Math.sqrt(b.shin * b.shin - 4.8 * 4.8), SY - 12], Tr = [Ar[0] - Math.sqrt(b.foot * b.foot - 100), SY - 2];
    var Af = [Xf, SY - b.ankleH], rf = legIK(hip, Af, [(hip[0] + Af[0]) / 2 + 24, (hip[1] + Af[1]) / 2 - 28]);
    var lean = -1.5 * t, S = P(hip, -90 + lean, b.torso), head = FA.headAt(S, -90 + lean * 0.5 + 2);
    var hipW = [hip[0] + 1.5, hip[1] - 8];                                          // ruce na bocich
    var aN = armIK(S, hipW, [S[0] - 24, S[1] + 18]), aF = armIK(S, [hipW[0] - 2, hipW[1] + 1], [S[0] - 26, S[1] + 20]);
    return {
      hip: hip, shoulder: S, head: head, headRot: 0,
      elbowN: aN.mid, wristN: aN.end, kneeN: Kr, ankleN: Ar, toeN: Tr,
      elbowF: aF.mid, wristF: aF.end, kneeF: rf.mid, ankleF: rf.end, toeF: toeSurf(rf.end, SY)
    };
  }
  FA.register('flexor', {
    title: 'Protažení flexoru kyčle v kleku', view: 'side', facing: 1, zoom: 1.4,
    tempo: { up: 2.5, hold: 8, down: 2, pause: 1 },
    phases: { up: 'Podsaď pánev, boky dopředu', hold: 'Drž a dýchej', down: 'Pomalu zpět', pause: '' },
    solve: flexSolve, back: matSide(W * 0.5 - 92, W * 0.5 + 92),
    highlight: function (t) { return { quads: clamp(0.15 + 0.75 * t, 0, 1), abductors: 0.15 * t, core: 0.12 }; }
  });

  /* ---- zabka: houpani bokem dozadu, na predlokti ---- */
  function frogSolve(t, time, info) {
    LAST.time = time || 0;
    var b = bd(), e = t, Kx = W * 0.5 - 26, xe = Kx - 24 + b.torso;
    var hipH = lerp(36, 24, e), hy = SY - hipH, ang0 = lerp(0, 11, e);
    var hip = [Kx - lerp(24, 36, e), hy];
    var S = [hip[0] + b.torso * Math.cos(ang0 * D2R), hip[1] - b.torso * Math.sin(ang0 * D2R)];
    var head = FA.headAt(S, -90 + 78 - 8 * e - 10), hRot = 22 - 8 * e;
    var wr = [xe + 24, SY - 3.8];
    var aN = armIK(S, wr, [S[0] - 4, S[1] + 40]), aF = armIK(S, [wr[0] - 3, wr[1]], [S[0] - 6, S[1] + 40]);
    var Kn = [Kx, SY - 7.4], An = [Kx - 20, SY - 11.5];
    var Tn = [An[0] - Math.sqrt(b.foot * b.foot - 91), SY - 2];
    var Kf = [Kx - 5, SY - 7.4], Af = [Kx - 26, SY - 11.5], Tf = [Af[0] - Math.sqrt(b.foot * b.foot - 91), SY - 2];
    return {
      hip: hip, shoulder: S, head: head, headRot: hRot,
      elbowN: aN.mid, wristN: aN.end, kneeN: Kn, ankleN: An, toeN: Tn,
      elbowF: aF.mid, wristF: aF.end, kneeF: Kf, ankleF: Af, toeF: Tf
    };
  }
  FA.register('zabka', {
    title: 'Žabka – houpání vzad', view: 'side', facing: 1, zoom: 1.55,
    tempo: { up: 1.5, hold: 0.4, down: 1.3, pause: 0.3 },
    phases: { up: 'Boky pomalu dozadu', hold: 'Drž', down: 'Zpět dopředu', pause: '' },
    solve: frogSolve, back: matSide(W * 0.5 - 100, W * 0.5 + 100),
    highlight: function (t) { return { adductors: clamp(0.25 + 0.65 * t, 0, 1), glutes: 0.18 * t, core: 0.1 }; }
  });

  /* ---- kocka: ctyrnozka, kulaty hřbet <-> prohnuti (t = 0 prohnuti, t = 1 kulaty) ---- */
  function catSolve(t, time, info) {
    LAST.time = time || 0;
    var b = bd(), c = t, Sx = W * 0.5 + 36;
    var wr = [Sx, SY - 3.8], armLen = 0.975 * (b.upperArm + b.forearm);
    var S = [Sx, wr[1] - armLen - 2 * c];
    var hipY = SY - 7.2 - b.thigh + 1.5 * c, hip = [S[0] - Math.sqrt(Math.max(100, b.torso * b.torso - Math.pow(S[1] - hipY, 2))), hipY];
    var ah = lerp(-26, 66, c), head = FA.headAt(S, ah), hRot = ah + 6;
    var Kn = [hip[0] - 1, SY - 7.2];
    var An = [Kn[0] - Math.sqrt(b.shin * b.shin - 4.8 * 4.8), SY - 12], Tn = [An[0] - Math.sqrt(b.foot * b.foot - 100), SY - 2];
    var Kf = [Kn[0] - 5, Kn[1]], Af = [An[0] - 5, An[1]], Tf = [Tn[0] - 5, Tn[1]];
    var aN = armIK(S, wr, [(S[0] + wr[0]) / 2 - 12, (S[1] + wr[1]) / 2]), aF = armIK(S, [wr[0] - 5, wr[1]], [S[0] - 14, (S[1] + wr[1]) / 2]);
    return {
      hip: hip, shoulder: S, head: head, headRot: hRot,
      elbowN: aN.mid, wristN: aN.end, kneeN: Kn, ankleN: An, toeN: Tn,
      elbowF: aF.mid, wristF: aF.end, kneeF: Kf, ankleF: Af, toeF: Tf
    };
  }
  function catFront(c, J, t) {                    // zakrivena paterni linka (koralky) + zaobleni / prohnuti zad
    var S = J.shoulder, H = J.hip, L = dist(S, H) || 1, ux = (H[0] - S[0]) / L, uy = (H[1] - S[1]) / L, nx = 0, ny = 1;
    var k = 2 * t - 1, i, N = 14, s, bulge, px, py, pts = [];
    nx = uy; ny = -ux; if (ny < 0) { nx = -nx; ny = -ny; }                  // nx,ny = k bricho (dolu)
    for (i = 0; i <= N; i++) {
      s = i / N; bulge = Math.sin(Math.PI * s) * (k > 0 ? 9 : 7.5) * k;     // k > 0 kulaty hrbet (nahoru = -n), k < 0 prohnuti
      px = S[0] + ux * s * L - nx * (bulge + 5.2) + nx * 0; py = S[1] + uy * s * L - ny * (bulge + 5.2);
      pts.push([px, py]);
    }
    c.save();
    if (k > 0.04) {                                // vyduti zad: vypln mezi puvodnim a zaoblenym obrysem
      var g = c.createLinearGradient(S[0], S[1], H[0], H[1]);
      g.addColorStop(0, COL.top); g.addColorStop(0.45, COL.top); g.addColorStop(0.58, COL.leg); g.addColorStop(1, COL.leg);
      c.fillStyle = g; c.beginPath();
      for (i = 0; i <= N; i++) { s = i / N; bulge = Math.sin(Math.PI * s) * 9 * k; var p0 = [S[0] + ux * s * L - nx * 9.6, S[1] + uy * s * L - ny * 9.6]; if (i) c.lineTo(p0[0], p0[1]); else c.moveTo(p0[0], p0[1]); }
      for (i = N; i >= 0; i--) { s = i / N; bulge = Math.sin(Math.PI * s) * 9 * k; c.lineTo(S[0] + ux * s * L - nx * (9.6 + bulge), S[1] + uy * s * L - ny * (9.6 + bulge)); }
      c.closePath(); c.fill();
    }
    if (k < -0.04) {                               // propad bricha dolu
      var g2 = c.createLinearGradient(S[0], S[1], H[0], H[1]);
      g2.addColorStop(0, COL.top); g2.addColorStop(0.45, COL.top); g2.addColorStop(0.58, COL.leg); g2.addColorStop(1, COL.leg);
      c.fillStyle = g2; c.beginPath();
      for (i = 0; i <= N; i++) { s = i / N; var q0 = [S[0] + ux * s * L + nx * 8.4, S[1] + uy * s * L + ny * 8.4]; if (i) c.lineTo(q0[0], q0[1]); else c.moveTo(q0[0], q0[1]); }
      for (i = N; i >= 0; i--) { s = i / N; bulge = Math.sin(Math.PI * s) * 7 * (-k); c.lineTo(S[0] + ux * s * L + nx * (8.4 + bulge), S[1] + uy * s * L + ny * (8.4 + bulge)); }
      c.closePath(); c.fill();
    }
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = 'rgba(233,224,255,0.35)'; c.lineWidth = 2.2; c.beginPath();
    for (i = 0; i < pts.length; i++) { if (i) c.lineTo(pts[i][0], pts[i][1]); else c.moveTo(pts[i][0], pts[i][1]); }
    c.stroke();
    for (i = 1; i < N; i++) {
      c.fillStyle = 'rgba(233,224,255,0.88)'; c.beginPath(); c.arc(pts[i][0], pts[i][1], 1.55, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
  FA.register('kocka', {
    title: 'Kočičí hřbet', view: 'side', facing: 1, zoom: 1.42,
    tempo: { up: 1.9, hold: 0.4, down: 1.9, pause: 0.4 },
    phases: { up: 'Výdech: kulatá záda', hold: 'Drž', down: 'Nádech: prohnutí', pause: 'Drž' },
    solve: catSolve, back: matSide(W * 0.5 - 100, W * 0.5 + 98), front: catFront,
    highlight: function (t) {
      return { back: clamp(0.15 + 0.7 * t, 0, 1), core: 0.15 + 0.55 * t, chest: 0.5 * (1 - t), shoulders: 0.12, glutes: 0.22 * (1 - t) };
    }
  });

  /* ===================================================================
     WGS: nejlepsi protazeni sveta (vypad, loket ke kotniku, rotace hrudniku)
     t 0 -> 0,45: loket dolu ke kotniku; 0,45 -> 1: rotace, paze nahoru jen do vertikaly
     =================================================================== */
  function wgsSolve(t, time, info) {
    LAST.time = time || 0;
    var b = bd(), L = b.thigh + b.shin, a = sm(t / 0.45), r = sm((t - 0.45) / 0.55), Xf = W * 0.5 + 62;
    var Af = [Xf, SY - b.ankleH];
    var hh = lerp(51, 45, a) - 1.5 * r, theta = lerp(13, -9, a) + 9 * r;            // vyska kycle, sklon trupu
    var Ar = [Xf - 144, SY - 19];
    var hip = [Ar[0] + Math.sqrt(Math.max(1, Math.pow(0.992 * L, 2) - Math.pow(Ar[1] - (SY - hh), 2))), SY - hh];
    var kr = straightLeg(hip, Ar), Tr = toeSurf(Ar, SY);
    var rf = legIK(hip, Af, [(hip[0] + Af[0]) / 2 + 24, (hip[1] + Af[1]) / 2 - 30]);
    var S = P(hip, -theta, b.torso), head = FA.headAt(S, lerp(-8, 6, a) - 36 * r), hRot = lerp(8, 12, a) - 48 * r;
    // opora: vzdalenejsi dlan na podlaze u predniho chodidla
    var wF = [Xf + 6, SY - 3.8], aF = armIK(S, wF, [(S[0] + wF[0]) / 2 - 14, (S[1] + wF[1]) / 2 - 6]);
    var elbow, wrist, ub = b.upperArm, fo = b.forearm;
    if (r <= 0.0005) {                                     // faze 1: dlan na zemi -> loket dolu, predlokti vpred
      var wN0 = [wF[0] - 3, wF[1]], W1 = [S[0] + fo, S[1] + ub], wr = mix(wN0, W1, a);
      var ar = armIK(S, wr, [S[0] - 10, S[1] + 22]);
      elbow = ar.mid; wrist = ar.end;
    } else {                                               // faze 2: rotace, paze nahoru max. do vertikaly
      var rho = PI * r, dx = 0.42 * Math.sin(rho), dy = Math.cos(rho), f = sm(clamp(r * 2.2, 0, 1));
      elbow = [S[0] + ub * dx, S[1] + ub * dy];
      wrist = [elbow[0] + lerp(fo, fo * dx, f), elbow[1] + lerp(0, fo * dy, f)];
    }
    return {
      hip: hip, shoulder: S, head: head, headRot: hRot,
      elbowN: elbow, wristN: wrist, kneeN: rf.mid, ankleN: rf.end, toeN: toeSurf(rf.end, SY),
      elbowF: aF.mid, wristF: aF.end, kneeF: kr, ankleF: Ar, toeF: Tr
    };
  }
  FA.register('wgs', {
    title: 'Nejlepší protažení světa (výpad s rotací)', view: 'side', facing: 1, zoom: 1.28,
    tempo: { up: 3.4, hold: 1.6, down: 2.4, pause: 0.6 },
    phases: { up: 'Loket ke kotníku, pak rotace', hold: 'Paže nahoru jen kam to jde', down: 'Zpět', pause: '' },
    solve: wgsSolve, back: matSide(W * 0.5 - 118, W * 0.5 + 118),
    highlight: function (t) {
      var r = sm((t - 0.45) / 0.55);
      return { quads: 0.3 + 0.2 * (1 - r), adductors: 0.4, glutes: 0.3, back: 0.15 + 0.5 * r, shoulders: 0.12 * r, core: 0.15 };
    }
  });
})();
