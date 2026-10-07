/* =====================================================================
   animace.js  -  FitAnim: sdilene animacni jadro pro cviky (Canvas 2D, bez knihoven)
   Jedna globalni promenna window.FitAnim. Stejna postava (kapsle s tapperem, tvarovany trup,
   kratke tmave vlasy, fotbalovy dres s kratkym rukavem, tmave kratasy, podkolenky, tenisky, mekke stiny,
   zarici svalovy highlight oranzovy #fb923c) pro vsechny cviky. Postava je MUZ (Martin), paleta zelena.

   Logicky prostor 400x250, podlaha y = FitAnim.FLOOR. Uhly ve stupnich: 0 = +x, 90 = +y (dolu).
   Body jsou pole [x,y]. Cvik se zapise pres FitAnim.register(key, def) - viz animace-hipthrust.js.
   ===================================================================== */
(function (G) {
'use strict';

var W = 400, H = 250, FLOOR = 232, PI = Math.PI, D2R = PI / 180, R2D = 180 / PI, U = 0.78;
var CHAIR_H = 52, STEP_H = 23;                       // sedak zidle ~45 cm, stupinek 20 cm (v logickych jednotkach)
/* delky segmentu v logickych jednotkach (dospely muz, stojici ~ 200 j.; 1 j. ~ 0,85 cm) */
var BODY = { torso: 58, neck: 12, headR: 10.5, upperArm: 31, forearm: 28, hand: 8, thigh: 52, shin: 50,
             foot: 22, ankleH: 8, shoulderHalf: 19, hipHalf: 7.5 };
/* torso = rameno->kycel; neck+headR = rameno->stred hlavy; forearm = loket->stisk (zapesti = stred pesti);
   foot = kotnik->spicka; ankleH = vyska kotniku nad podlahou; shoulderHalf/hipHalf = vychozi poloviny sirky (predni pohled) */
var FOOT_A = Math.atan2(BODY.ankleH, 20.5);          // uhel kotnik->spicka u ploche nohy (rad)

var COL = {
  text: '#eef6f3', muted: '#8fb0a6', line: '#28403a', card2: '#1c2a26', accent: '#34d399', accent2: '#10b981',
  glow: '#fb923c',
  floorLine: '#34524a',
  skin: '#e2ae8c', skinD: '#c28a6c', farSkin: '#b88268', farSkinD: '#9a6a55',
  leg: '#26343a', legD: '#18232a', farLeg: '#1c282e', farLegD: '#121b21',     // kratasy
  top: '#0f9f8c', topD: '#0b7a6c', band: '#5eead4', farTop: '#0c7f70', farTopD: '#096055',   // dres + lem
  sock: '#0c8a7a', sockD: '#096a5e', farSock: '#0a6f63', farSockD: '#08544b', sockBand: '#a7f3d0',
  shoe: '#eef3f1', shoeD: '#c3d0cb', farShoe: '#a9bab4', farShoeD: '#8a9c96', sole: '#10b981', soleD: '#0b8f63',
  hair: '#2b2421', hairD: '#1b1614',
  wood: '#a06a44', woodD: '#7a4d2e', woodL: '#c08a5f',
  pad: '#3a4a46', padD: '#28332f', padTop: '#55695f', frame: '#566661', frameD: '#3b4844',
  metal: '#9aa9a3', metalL: '#dbe7e2', rubber: '#101816'
};
var PAL_N = { skin: COL.skin, skinD: COL.skinD, leg: COL.leg, legD: COL.legD, shoe: COL.shoe, shoeD: COL.shoeD,
              top: COL.top, topD: COL.topD, sock: COL.sock, sockD: COL.sockD };
var PAL_F = { skin: COL.farSkin, skinD: COL.farSkinD, leg: COL.farLeg, legD: COL.farLegD, shoe: COL.farShoe, shoeD: COL.farShoeD,
              top: COL.farTop, topD: COL.farTopD, sock: COL.farSock, sockD: COL.farSockD };
var LX = 1.0, LY = -1.25;                              // posun svetla pro tvarove stinovani
/* polomery kapsli [u kloubu bliz trupu, vzdalenejsi konec] */
var RT = [11.4, 7.5], RS = [7.2, 4.5], RA = [5.7, 4.5], RF = [4.3, 3.4];

/* ============================== geometrie ============================== */
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a.length ? [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] : a + (b - a) * t; }  // cisla i body
function ease(p) { p = clamp(p, 0, 1); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
function pt(b, a, l) { a *= D2R; return [b[0] + Math.cos(a) * l, b[1] + Math.sin(a) * l]; }
function ang(a, b) { return Math.atan2(b[1] - a[1], b[0] - a[0]) * R2D; }
function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
function wrap180(a) { return ((a + 540) % 360) - 180; }

/* 2-kloubove IK. bend = +1 / -1 vybira stranu kloubu: stred lezi na (-uy,ux)*bend od primky base->target.
   Pro postavu s facing=1 a koncetinou smerujici dolu: koleno bend=-1 (dopredu), loket bend=+1 (dozadu).
   Nedosazitelny cil se orizne na dosah (end = skutecny konec), nikdy NaN. */
function ik2(P, T, l1, l2, bend) {
  var dx = T[0] - P[0], dy = T[1] - P[1], dl = Math.hypot(dx, dy);
  var ux = dl > 1e-9 ? dx / dl : 0, uy = dl > 1e-9 ? dy / dl : 1;
  var d = clamp(dl, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3), b = bend < 0 ? -1 : 1;
  var a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  return { mid: [P[0] + ux * a - uy * h * b, P[1] + uy * a + ux * h * b], end: [P[0] + ux * d, P[1] + uy * d] };
}
/* spicka chodidla lezici na podlaze (i se zvednutou patou): vzdalenost kotnik->spicka = BODY.foot */
function toeFloor(A, f) {
  var h = clamp(FLOOR - A[1], 0, BODY.foot), dx = Math.sqrt(Math.max(0, BODY.foot * BODY.foot - h * h));
  return [A[0] + (f < 0 ? -1 : 1) * dx, A[1] + h];
}
/* stred hlavy ve smeru angDeg od ramene */
function headAt(S, angDeg) { return pt(S, angDeg, BODY.neck + BODY.headR); }

/* ======================= kreslici pomucky (aktualni ctx = c) ======================= */
var c = null;
function cap(p0, p1, r0, r1, ox, oy) {               // zaoblena kapsle s ruznymi polomery (do cesty)
  ox = ox || 0; oy = oy || 0;
  var x0 = p0[0] + ox, y0 = p0[1] + oy, x1 = p1[0] + ox, y1 = p1[1] + oy;
  var dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1e-6, a = Math.atan2(dy, dx), k = Math.acos(clamp((r0 - r1) / d, -1, 1));
  c.moveTo(x0 + r0 * Math.cos(a + k), y0 + r0 * Math.sin(a + k));
  c.arc(x0, y0, r0, a + k, a - k + PI * 2);
  c.arc(x1, y1, r1, a - k, a + k);
  c.closePath();
}
function poly(pts, ox, oy) {
  ox = ox || 0; oy = oy || 0; c.moveTo(pts[0][0] + ox, pts[0][1] + oy);
  for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0] + ox, pts[i][1] + oy);
  c.closePath();
}
function orient(pts) {                               // jednotny smer (pro sjednoceni clipu)
  var s = 0, i, a, b;
  for (i = 0; i < pts.length; i++) { a = pts[i]; b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s < 0 ? pts.reverse() : pts;
}
function circ(x, y, r) { c.moveTo(x + r, y); c.arc(x, y, r, 0, PI * 2); }
function rr(x, y, w, h, r) {                         // zaoblany obdelnik
  r = Math.min(r, w / 2, h / 2);
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
/* tvarove stinovani: tmavy podklad + svetla vypln posunuta ke svetlu -> srpek stinu na odvracene strane.
   shapeFn(ox,oy) pridava tvar do cesty; parts = [{base, shade, fn?}] */
function shaded(shapeFn, parts) {
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    c.save();
    c.beginPath(); shapeFn(0, 0); c.clip();
    c.beginPath(); (p.fn || shapeFn)(0, 0); c.fillStyle = p.shade; c.fill();
    c.beginPath(); shapeFn(LX, LY); c.clip();
    c.beginPath(); (p.fn || shapeFn)(0, 0); c.fillStyle = p.base; c.fill();
    c.restore();
  }
}
function softEllipse(x, y, rx, ry, a) {              // mekky kontaktni stin
  if (!(a > 0.003)) return;
  c.save(); c.translate(x, y); c.scale(rx, ry);
  var g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, 'rgba(0,0,0,' + a + ')'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(-1, -1, 2, 2); c.restore();
}
function footShadow(A, T, a) {
  var h = FLOOR - Math.max(T[1], A[1] + 6);
  softEllipse((A[0] + T[0]) / 2, FLOOR + 0.5, 25, 3.4, a * clamp(1 - h / 45, 0, 1));
}

/* =========================== zvyrazneni svalu =========================== */
var AN = [], anN = 0;                                // kotvy zare (znovupouzivany pool)
var CS = { side: true, J: null, tp: null };          // stav aktualni postavy (pro clip siluety)
function A(x, y, rx, ry, rot, a, m) {                // m = maska: 1 trup, 2 blizke nohy, 4 vzdalenejsi noha, 8 blizke ruce, 16 vzdalenejsi ruka
  if (!(a > 0.02)) return;
  var o = AN[anN] || (AN[anN] = {});
  o.x = x; o.y = y; o.rx = rx; o.ry = ry; o.rot = rot; o.a = Math.min(1, a); o.m = m; anN++;
}
function seg(p, q, k, s, off, len, w, a, m) {        // elipsa podel useku p->q (k = pozice 0..1, s*off = posun do strany)
  var dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
  A(p[0] + dx * k + s[0] * off, p[1] + dy * k + s[1] * off, l * len, w, Math.atan2(dy, dx), a, m);
}
function bk(p, q, f) { var dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1; return [-f * dy / l, f * dx / l]; } // zadni normala useku
function sil(m) {                                    // pridani siluety do cesty (pro clip zare)
  var J = CS.J, i, s;
  if (m & 1) poly(CS.tp);
  if (CS.side) {
    if (m & 2) { cap(J.hip, J.kneeN, RT[0], RT[1]); cap(J.kneeN, J.ankleN, RS[0], RS[1]); }
    if (m & 4) { cap(J.hip, CS.kF, RT[0], RT[1]); cap(CS.kF, CS.aF, RS[0], RS[1]); }
    if (m & 8) { cap(J.shoulder, J.elbowN, RA[0], RA[1]); cap(J.elbowN, J.wristN, RF[0], RF[1]); }
    if (m & 16) { cap(J.shoulder, CS.eF, RA[0], RA[1]); cap(CS.eF, CS.wF, RF[0], RF[1]); }
  } else {
    for (i = 0; i < 2; i++) {
      s = i ? 'R' : 'L';
      if (m & 2) { cap(J['hip' + s], J['knee' + s], RT[0], RT[1]); cap(J['knee' + s], J['ankle' + s], RS[0], RS[1]); }
      if (m & 8) { cap(J['shoulder' + s], J['elbow' + s], RA[0], RA[1]); cap(J['elbow' + s], J['wrist' + s], RF[0], RF[1]); }
    }
  }
}
function armA(S, E, Wr, k, m, hl) {                  // biceps (strana ohybu) a triceps v bocnim pohledu
  var dx = E[0] - S[0], dy = E[1] - S[1], l = Math.hypot(dx, dy) || 1, px = -dy / l, py = dx / l;
  var bd = (Wr[0] - E[0]) * px + (Wr[1] - E[1]) * py, sg = Math.abs(bd) > 1.5 ? (bd > 0 ? 1 : -1) : (px * CS.nx + py * CS.ny >= 0 ? 1 : -1);
  var r = Math.atan2(dy, dx);
  A(S[0] + dx * 0.5 + px * sg * 3, S[1] + dy * 0.5 + py * sg * 3, l * 0.42, 4.6, r, (hl.biceps || 0) * k, m);
  A(S[0] + dx * 0.5 - px * sg * 3, S[1] + dy * 0.5 - py * sg * 3, l * 0.42, 4.2, r, (hl.triceps || 0) * k, m);
}
function anchorsSide(hl) {
  var J = CS.J, f = CS.f, S = J.shoulder, Hp = J.hip, kN = J.kneeN, aN = J.ankleN, kF = CS.kF, aF = CS.aF;
  var L = CS.L, u = [CS.ux, CS.uy], n = [CS.nx, CS.ny], ru = Math.atan2(u[1], u[0]);
  var tb = bk(Hp, kN, f), tbF = bk(Hp, kF, f), sb = bk(kN, aN, f), sbF = bk(kF, aF, f);
  var dl = dist(Hp, kN) || 1;
  A(Hp[0] - n[0] * 5 + (kN[0] - Hp[0]) / dl * 3, Hp[1] - n[1] * 5 + (kN[1] - Hp[1]) / dl * 3, 19, 19, 0, hl.glutes, 3);
  seg(Hp, kN, 0.5, tb, 5.5, 0.55, 6, hl.hamstrings, 2);    seg(Hp, kF, 0.5, tbF, 5.5, 0.55, 6, (hl.hamstrings || 0) * 0.5, 4);
  seg(Hp, kN, 0.5, tb, -5, 0.55, 7, hl.quads, 2);          seg(Hp, kF, 0.5, tbF, -5, 0.55, 7, (hl.quads || 0) * 0.5, 4);
  seg(kN, aN, 0.36, sb, 2.8, 0.32, 6.3, hl.calves, 2);     seg(kF, aF, 0.36, sbF, 2.8, 0.32, 6.3, (hl.calves || 0) * 0.5, 4);
  seg(Hp, kN, 0.55, tb, 0, 0.45, 4, (hl.adductors || 0) * 0.85, 2); seg(Hp, kF, 0.55, tbF, 0, 0.45, 4, (hl.adductors || 0) * 0.45, 4);
  seg(Hp, kN, 0.3, tb, -1, 0.28, 7, hl.abductors, 3);
  A(S[0] + u[0] * L * 0.17 + n[0] * 7, S[1] + u[1] * L * 0.17 + n[1] * 7, 10, 9, 0, hl.chest, 1);
  A(S[0] + u[0] * L * 0.28 - n[0] * 6, S[1] + u[1] * L * 0.28 - n[1] * 6, 9, 13, ru, hl.back, 1);
  A(S[0] + u[0] * L * 0.42 - n[0] * 4.5, S[1] + u[1] * L * 0.42 - n[1] * 4.5, 15, 6, ru, hl.lats, 9);
  A(S[0] + u[0] * 2, S[1] + u[1] * 2, 9, 9, 0, hl.shoulders, 9);
  A(S[0] + u[0] * L * 0.62 + n[0] * 5, S[1] + u[1] * L * 0.62 + n[1] * 5, 12, 6.5, ru, hl.core, 1);
  armA(S, J.elbowN, J.wristN, 1, 8, hl); armA(S, CS.eF, CS.wF, 0.5, 16, hl);
}
function anchorsFront(hl) {
  var J = CS.J, sc = CS.sc, ux = CS.ux, uy = CS.uy, L = CS.L, ru = Math.atan2(uy, ux), i, sg, s, Hh, K, Aa, S, E, lat;
  A(sc[0] + ux * L * 0.62, sc[1] + uy * L * 0.62, 12, 5.5, ru, hl.core, 1);
  for (i = 0; i < 2; i++) {
    sg = i ? 1 : -1; s = i ? 'R' : 'L'; lat = [uy * sg, -ux * sg];       // lat = smer ven od stredu
    Hh = J['hip' + s]; K = J['knee' + s]; Aa = J['ankle' + s]; S = J['shoulder' + s]; E = J['elbow' + s];
    A(Hh[0] + lat[0] * 6.5 + ux * 3, Hh[1] + lat[1] * 6.5 + uy * 3, 9.5, 9.5, 0, hl.glutes, 3);
    seg(Hh, K, 0.5, lat, 0, 0.55, 7.5, hl.quads, 2);
    seg(Hh, K, 0.5, lat, 5.5, 0.5, 4, (hl.hamstrings || 0) * 0.55, 2);
    seg(Hh, K, 0.52, lat, -5.5, 0.5, 3.8, hl.adductors, 2);
    seg(Hh, K, 0.4, lat, 6.5, 0.5, 4.2, hl.abductors, 3);
    seg(K, Aa, 0.36, lat, 2.8, 0.32, 5, hl.calves, 2);
    A(sc[0] + ux * L * 0.17 + lat[0] * 6.5, sc[1] + uy * L * 0.17 + lat[1] * 6.5, 8.5, 8, 0, hl.chest, 1);
    A(sc[0] + ux * L * 0.02 + lat[0] * 10, sc[1] + uy * L * 0.02 + lat[1] * 10, 8, 5, Math.atan2(lat[1], lat[0]), hl.back, 1);
    A(sc[0] + ux * L * 0.4 + lat[0] * 11.5, sc[1] + uy * L * 0.4 + lat[1] * 11.5, 14, 4.8, ru, hl.lats, 9);
    A(S[0], S[1], 8.5, 8.5, 0, hl.shoulders, 9);
    seg(S, E, 0.5, lat, 0, 0.42, 4.8, hl.biceps, 8);
    seg(S, E, 0.5, lat, 3.2, 0.42, 4, (hl.triceps || 0) * 0.7, 8);
  }
}
function glowPass(ctx) {                             // zare svalu: oranzova, clip na siluetu casti tela
  if (!anN) return;
  c = ctx; c.save();   // oranzova zare: bezne prekryti (screen by na zelenem dresu bledl do mint-bile)
  for (var i = 0; i < anN; i++) {
    var a = AN[i], g, k = a.a;
    c.save(); c.beginPath(); sil(a.m); c.clip();
    c.translate(a.x, a.y); c.rotate(a.rot); c.scale(a.rx, a.ry);
    g = c.createRadialGradient(0, 0, 0.04, 0, 0, 1);
    g.addColorStop(0, 'rgba(255,205,130,' + 0.92 * k + ')'); g.addColorStop(0.35, 'rgba(251,146,60,' + 0.8 * k + ')');
    g.addColorStop(0.7, 'rgba(249,115,22,' + 0.4 * k + ')'); g.addColorStop(1, 'rgba(234,88,12,0)');
    c.fillStyle = g; c.fillRect(-1, -1, 2, 2); c.restore();
  }
  c.restore();
}
function haloPass() {                                // mekka zare za telem u nejsilnejsiho svalu
  var best = -1, i, m = 0.02, a, r, g;
  for (i = 0; i < anN; i++) if (AN[i].a > m) { m = AN[i].a; best = i; }
  if (best < 0) return;
  a = AN[best]; r = Math.max(a.rx, a.ry) * 1.9 + 4;
  g = c.createRadialGradient(a.x, a.y, 3, a.x, a.y, r);
  g.addColorStop(0, 'rgba(251,146,60,' + 0.3 * a.a + ')'); g.addColorStop(1, 'rgba(251,146,60,0)');
  c.fillStyle = g; c.fillRect(a.x - r, a.y - r, r * 2, r * 2);
}

/* ============================== hlava a vlasy ============================== */
function headLocal(hc, f, rot) { c.save(); c.translate(hc[0], hc[1]); c.scale(f * U, U); c.rotate(rot); }
function drawHeadSide(hc, f, rot) {                  // profil (souradnice v jednotkach puvodniho dema), kratke vlasy
  headLocal(hc, f, rot);
  c.fillStyle = COL.hairD; c.beginPath(); c.ellipse(-2.4, -2.6, 11.9, 11.2, 0, 0, PI * 2); c.fill();   // lebka pod vlasy
  c.fillStyle = COL.hair; c.beginPath(); c.ellipse(-2, -3.2, 11.2, 10.4, 0, 0, PI * 2); c.fill();
  c.fillStyle = COL.skinD; c.beginPath(); c.ellipse(3.2, 1.6, 10.3, 11.4, 0, 0, PI * 2); rr(1.4, 4.2, 12.2, 8.6, 3.6); c.fill();
  c.fillStyle = COL.skin; c.beginPath(); c.ellipse(3.9, 0.9, 9.6, 10.7, 0, 0, PI * 2); rr(1.6, 3.4, 12, 8.6, 3.6); c.fill();   // celist + vyrazna brada
  c.fillStyle = COL.skin; c.strokeStyle = COL.skinD; c.lineWidth = 0.8;
  c.beginPath(); c.moveTo(12.2, -2.6); c.lineTo(17.2, 3.2); c.lineTo(12, 4.3); c.closePath(); c.fill(); c.stroke();   // vetsi nos
  c.fillStyle = COL.hair; c.beginPath(); c.ellipse(0.6, -7.0, 11.6, 6.4, -0.1, PI, PI * 2); c.fill();             // horni cast vlasu + linie cela
  c.beginPath(); c.moveTo(-9.2, -4.5); c.quadraticCurveTo(-11.6, 2, -8.2, 5.2); c.lineTo(-4.4, 4.6); c.lineTo(-4.6, -2); c.closePath(); c.fill();   // kratky vzadu / u ucha
  c.fillStyle = COL.skinD; c.beginPath(); c.ellipse(-0.8, 2.6, 2.3, 3.1, 0, 0, PI * 2); c.fill();
  c.fillStyle = COL.hair; c.beginPath(); c.moveTo(1.4, -5); c.lineTo(3.2, -5); c.lineTo(2.8, 1); c.lineTo(1.6, 1.6); c.closePath(); c.fill();   // licous
  c.globalAlpha = 0.11; c.fillStyle = COL.hairD; c.beginPath(); rr(3, 5.2, 10.4, 6.8, 3.4); c.fill(); c.globalAlpha = 1;               // stin strniste na brade
  c.fillStyle = '#1c2a26'; c.beginPath(); circ(8.2, -1.2, 1.25); c.fill();
  c.strokeStyle = COL.hairD; c.lineWidth = 1.5; c.lineCap = 'round';
  c.beginPath(); c.moveTo(5.4, -4.4); c.lineTo(10.4, -4.2); c.stroke();
  c.strokeStyle = '#a2594e'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(9.2, 7.4); c.lineTo(11.8, 7.2); c.stroke();
  c.restore();
}
function drawHeadFront(hc, rot) {                    // obliceje zepredu
  headLocal(hc, 1, rot);
  c.fillStyle = COL.hairD; c.beginPath(); c.ellipse(0, -3.2, 11.8, 11.4, 0, 0, PI * 2); c.fill();
  c.fillStyle = COL.skinD; c.beginPath(); c.ellipse(-10, 2.4, 2, 3, 0, 0, PI * 2); c.ellipse(10, 2.4, 2, 3, 0, 0, PI * 2); c.fill();
  c.fillStyle = COL.skinD; c.beginPath(); c.ellipse(0, 1.8, 10.2, 11.5, 0, 0, PI * 2); rr(-8.6, 4, 17.2, 9.4, 4); c.fill();
  c.fillStyle = COL.skin; c.beginPath(); c.ellipse(0, 1.1, 9.8, 10.9, 0, 0, PI * 2); rr(-8.4, 3.4, 16.8, 9.4, 4); c.fill();
  c.fillStyle = COL.hair; c.beginPath(); c.ellipse(0.4, -7.2, 11.4, 6.4, 0, PI, PI * 2); c.fill();
  c.beginPath(); c.moveTo(-10.4, -6); c.lineTo(-9.8, 1.4); c.lineTo(-8.2, 1.2); c.lineTo(-8, -4); c.closePath(); c.fill();   // licousy
  c.beginPath(); c.moveTo(10.4, -6); c.lineTo(9.8, 1.4); c.lineTo(8.2, 1.2); c.lineTo(8, -4); c.closePath(); c.fill();
  c.globalAlpha = 0.1; c.fillStyle = COL.hairD; c.beginPath(); rr(-8, 5.5, 16, 7.4, 3.5); c.fill(); c.globalAlpha = 1;
  c.fillStyle = '#1c2a26'; c.beginPath(); circ(-3.9, -0.4, 1.25); circ(3.9, -0.4, 1.25); c.fill();
  c.strokeStyle = COL.hairD; c.lineWidth = 1.5; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-6.6, -3.6); c.lineTo(-1.8, -3.9); c.moveTo(1.8, -3.9); c.lineTo(6.6, -3.6); c.stroke();
  c.strokeStyle = COL.skinD; c.lineWidth = 0.9; c.beginPath(); c.moveTo(0.4, 0.2); c.quadraticCurveTo(1.8, 3.8, -0.4, 4.2); c.stroke();
  c.strokeStyle = '#a2594e'; c.beginPath(); c.moveTo(-2.8, 7.4); c.quadraticCurveTo(0, 8.2, 2.8, 7.4); c.stroke();
  c.restore();
}

/* ============================ bocni pohled ============================ */
var TCH = [[0, 9.5], [0.1, 12.6], [0.26, 13.6], [0.45, 11.6], [0.7, 11.2], [0.9, 11.4], [1.02, 11]];   // profil hrudi: siroky hrudnik, rovne bricho (v jednotkach dema)
var TBK = [[0, 9.5], [0.2, 10.4], [0.5, 8.8], [0.75, 10.6], [0.93, 13], [1.02, 12.6]];                  // profil zad / hyzdi (uzsi hyzde)
function prof(tbl, s) {
  if (s <= tbl[0][0]) return tbl[0][1];
  for (var i = 1; i < tbl.length; i++) if (s <= tbl[i][0]) {
    var a = tbl[i - 1], b = tbl[i], p = (s - a[0]) / (b[0] - a[0]);
    return a[1] + (b[1] - a[1]) * (0.5 * p + 0.5 * (1 - Math.cos(p * PI)) / 2);
  }
  return tbl[tbl.length - 1][1];
}
function torsoSide(breath, pulse) {
  var pts = [], N = 22, i, s, off, f, S = CS.J.shoulder, ux = CS.ux, uy = CS.uy, nx = CS.nx, ny = CS.ny, L = CS.L;
  for (i = 0; i <= N; i++) { s = i / N * 1.02; off = (prof(TCH, s) + (s < 0.42 ? breath : 0)) * U;
    pts.push([S[0] + ux * s * L + nx * off, S[1] + uy * s * L + ny * off]); }
  for (i = N; i >= 0; i--) { s = i / N * 1.02; off = prof(TBK, s) * U * (1 + (s > 0.7 ? pulse * 0.07 : 0));
    pts.push([S[0] + ux * s * L - nx * off, S[1] + uy * s * L - ny * off]); }
  for (i = 1; i < 8; i++) { f = i / 8 * PI;
    pts.push([S[0] - nx * 9.5 * U * Math.cos(f) - ux * 9.5 * U * Math.sin(f), S[1] - ny * 9.5 * U * Math.cos(f) - uy * 9.5 * U * Math.sin(f)]); }
  return orient(pts);
}
function band(S, ux, uy, nx, ny, L, s0, s1) {        // pas pres trup mezi s0..s1 osy rameno->kycel
  var a = s0 * L, b = s1 * L, e = 31;
  return [[S[0] + ux * a + nx * e, S[1] + uy * a + ny * e], [S[0] + ux * b + nx * e, S[1] + uy * b + ny * e],
          [S[0] + ux * b - nx * e, S[1] + uy * b - ny * e], [S[0] + ux * a - nx * e, S[1] + uy * a - ny * e]];
}
function drawTorsoParts(shapeFn, S, ux, uy, nx, ny, L, extra, collar) {
  var reg = function (s0, s1) { return function () { poly(band(S, ux, uy, nx, ny, L, s0, s1)); }; };
  var parts = [{ base: COL.skin, shade: COL.skinD }, { fn: reg(0.5, 1.5), base: COL.leg, shade: COL.legD },
               { fn: reg(-0.3, 0.7), base: COL.top, shade: COL.topD }, { fn: reg(0.655, 0.7), base: COL.band, shade: COL.topD }];   // kratasy, dres, lem dresu
  if (extra) parts.push(extra);
  shaded(shapeFn, parts);
  if (collar) collar();
}
function shoeShape(ox, oy) {                         // tenisky v lokalnim systemu: kotnik = [0,0], podesev y = +ankleH, spicka vpravo
  var fl = BODY.ankleH + oy, x = ox;
  c.moveTo(x - 8.5, fl); c.lineTo(x + 17.2, fl); c.quadraticCurveTo(x + 21.8, fl, x + 21, fl - 3.9);
  c.quadraticCurveTo(x + 19.5, fl - 7, x + 11.7, fl - 8.2); c.quadraticCurveTo(x + 7, fl - 8.6, x + 3.9, fl - 13);
  c.lineTo(x - 4.7, fl - 11.8); c.quadraticCurveTo(x - 8.6, fl - 7.8, x - 8.6, fl - 3.1); c.closePath();
}
function soleShape() { c.rect(-12, BODY.ankleH - 3.2, 40, 6); }
function drawShoe(A, T, f, pal) {
  c.save(); c.translate(A[0], A[1]);
  c.rotate(Math.atan2(T[1] - A[1], T[0] - A[0]) - (f > 0 ? FOOT_A : PI - FOOT_A)); c.scale(f, 1);
  shaded(shoeShape, [{ base: pal.shoe, shade: pal.shoeD }, { fn: soleShape, base: COL.sole, shade: COL.soleD }]);
  c.strokeStyle = pal.shoeD; c.lineWidth = 0.8;
  for (var i = 0; i < 3; i++) { c.beginPath(); c.moveTo(4 + i * 3.6, -3.2 + i * 1.4); c.lineTo(6.4 + i * 3.6, -0.8 + i * 1.2); c.stroke(); }
  c.restore();
}
/* kalhotovy / rukavovy kuzel: kruh u kloubu Pa (polomer ra) + licha od Pa k Pb (polomery ra -> rb), rovny lem v Pb */
function flare(Pa, Pb, ra, rb, ox, oy, noCircle) {
  var dx = Pb[0] - Pa[0], dy = Pb[1] - Pa[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
  if (!noCircle) circ(Pa[0] + ox, Pa[1] + oy, ra);
  poly(orient([[Pa[0] + nx * ra, Pa[1] + ny * ra], [Pb[0] + nx * rb, Pb[1] + ny * rb], [Pb[0] - nx * rb, Pb[1] - ny * rb], [Pa[0] - nx * ra, Pa[1] - ny * ra]]), ox, oy);
}
function lerpR(r, t) { return r[0] + (r[1] - r[0]) * t; }
var SH = 0.78, SLV = 0.48, SOCK = 0.6;                // kratasy konci v 80 % stehna, rukav v 48 % paze, podkolenka od 60 % holene
function sockPoly(K, Aa, b, t0, t1) {                // pas podkolenky mezi t0..t1 delky holene (b = normala)
  var dx = Aa[0] - K[0], dy = Aa[1] - K[1], p0 = [K[0] + dx * t0, K[1] + dy * t0], p1 = [K[0] + dx * t1, K[1] + dy * t1];
  var r0 = lerpR(RS, t0) + 1.2, r1 = lerpR(RS, t1) + 1.2;
  return orient([[p0[0] + b[0] * r0, p0[1] + b[1] * r0], [p1[0] + b[0] * r1, p1[1] + b[1] * r1],
                 [p1[0] - b[0] * r1, p1[1] - b[1] * r1], [p0[0] - b[0] * r0, p0[1] - b[1] * r0]]);
}
function shin(K, Aa, pal, calfFn, b) {               // holen: kuze + podkolenka, volitelne lytko
  shaded(function (ox, oy) { cap(K, Aa, RS[0], RS[1], ox, oy); if (calfFn) calfFn(ox, oy); },
    [{ base: pal.skin, shade: pal.skinD },
     { fn: function () { poly(sockPoly(K, Aa, b, SOCK, 1.1)); }, base: pal.sock, shade: pal.sockD },
     { fn: function () { poly(sockPoly(K, Aa, b, SOCK, SOCK + 0.075)); }, base: pal === PAL_N ? COL.sockBand : pal.sockD, shade: pal.sockD }]);
}
function thigh(Hp, K, pal) {                         // stehno: kapsle (kuze) + kratasy po 80 % delky
  var P = lerp(Hp, K, SH), r0 = RT[0] + 0.5, r1 = lerpR(RT, SH) + 1.3;
  shaded(function (ox, oy) { cap(Hp, K, RT[0], RT[1], ox, oy); flare(Hp, P, r0, r1, ox, oy); },
    [{ base: pal.skin, shade: pal.skinD }, { fn: function () { flare(Hp, P, r0, r1, 0, 0); }, base: pal.leg, shade: pal.legD }]);
  var dx = K[0] - Hp[0], dy = K[1] - Hp[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
  c.strokeStyle = pal.legD; c.lineWidth = 1.1; c.beginPath();
  c.moveTo(P[0] + nx * (r1 - 0.4), P[1] + ny * (r1 - 0.4)); c.lineTo(P[0] - nx * (r1 - 0.4), P[1] - ny * (r1 - 0.4)); c.stroke();
}
function legSide(Hp, K, Aa, T, pal, calf, f) {
  drawShoe(Aa, T, f, pal);
  var dx = Aa[0] - K[0], dy = Aa[1] - K[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, b = [-f * uy, f * ux];
  var cx = K[0] + dx * 0.32 + b[0] * 2.6, cy = K[1] + dy * 0.32 + b[1] * 2.6, rot = Math.atan2(dy, dx);
  shin(K, Aa, pal, calf ? function (ox, oy) { c.moveTo(cx + ox + 9.4, cy + oy); c.ellipse(cx + ox, cy + oy, 9.4, 6.4, rot, 0, PI * 2); } : null, b);
  thigh(Hp, K, pal);
}
function armSide(S, E, Wr, pal) {
  var P = lerp(S, E, SLV), r0 = RA[0] + 1.0, r1 = lerpR(RA, SLV) + 1.3, S2 = lerp(S, E, 0.09);   // rameno zacina kousek pod kloubem (bez kulate hlavy nad ramenem)
  shaded(function (ox, oy) { cap(S2, E, RA[0], RA[1], ox, oy); flare(S2, P, r0, r1, ox, oy); },
    [{ base: pal.skin, shade: pal.skinD }, { fn: function () { flare(S2, P, r0, r1, 0, 0); }, base: pal.top, shade: pal.topD }]);
  var dx = E[0] - S[0], dy = E[1] - S[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;   // lem rukavu
  c.strokeStyle = pal === PAL_N ? COL.band : pal.topD; c.lineWidth = 1.5; c.beginPath();
  c.moveTo(P[0] + nx * (r1 - 0.5), P[1] + ny * (r1 - 0.5)); c.lineTo(P[0] - nx * (r1 - 0.5), P[1] - ny * (r1 - 0.5)); c.stroke();
  shaded(function (ox, oy) { cap(E, Wr, RF[0], RF[1], ox, oy); }, [{ base: pal.skin, shade: pal.skinD }]);
  c.fillStyle = pal.skin; c.beginPath(); circ(Wr[0], Wr[1], 4); c.fill();
}

function drawSide(J, o) {
  var f = o.facing < 0 ? -1 : 1, ts = o.time / 1000, S = J.shoulder, Hp = J.hip, hc = J.head, hl = o.highlight || {};
  var tN = J.toeN || toeFloor(J.ankleN, f), kF = J.kneeF || J.kneeN, aF = J.ankleF || J.ankleN, tF = J.toeF || (J.ankleF ? toeFloor(aF, f) : tN);
  var L = dist(S, Hp) || 1, ux = (Hp[0] - S[0]) / L, uy = (Hp[1] - S[1]) / L;
  CS.side = true; CS.J = J; CS.f = f; CS.L = L; CS.ux = ux; CS.uy = uy; CS.nx = f * uy; CS.ny = -f * ux;
  CS.kF = kF; CS.aF = aF; CS.eF = J.elbowF || J.elbowN; CS.wF = J.wristF || J.wristN;
  var breath = o.breath === false ? 0 : Math.sin(ts * PI * 2 / 3.8) * 0.9, pulse = (o.pulse || 0) * clamp(hl.glutes || 0, 0, 1);
  CS.tp = torsoSide(breath, pulse);
  anN = 0; anchorsSide(hl);
  if (!o.noShadow) {
    footShadow(J.ankleN, tN, 0.55); footShadow(aF, tF, 0.3);
    var hb = FLOOR - Math.max(Hp[1], S[1]);
    softEllipse((S[0] + Hp[0]) / 2, FLOOR + 0.5, 40, 4.5, clamp(0.4 * (1 - hb / 110), 0, 0.4));
  }
  haloPass();
  var al = Math.atan2(hc[1] - S[1], (hc[0] - S[0]) * f) * R2D;       // smer krku v zrcadlenem prostoru
  var rot = (J.headRot != null ? J.headRot : 0.45 * wrap180(al + 90)) * D2R;
  armSide(S, CS.eF, CS.wF, PAL_F);
  legSide(Hp, kF, aF, tF, PAL_F, false, f);
  if (o.mid) o.mid(c, J, o.t, o.time, o.info);
  var hx = hc[0] - S[0], hy = hc[1] - S[1], hl2 = Math.hypot(hx, hy) || 1;
  shaded(function (ox, oy) { cap([S[0] - ux * 4, S[1] - uy * 4], [hc[0] - hx / hl2 * 2, hc[1] - hy / hl2 * 2], 7.0, 6.4, ox, oy); }, [{ base: COL.skin, shade: COL.skinD }]);
  drawTorsoParts(function (ox, oy) { poly(CS.tp, ox, oy); }, S, ux, uy, CS.nx, CS.ny, L);
  legSide(Hp, J.kneeN, J.ankleN, tN, PAL_N, true, f);
  drawHeadSide(hc, f, rot);
  armSide(S, J.elbowN, J.wristN, PAL_N);
  if (!o.glowLater) glowPass(c);
}

/* ============================ predni pohled ============================ */
var TF = [[0, 16], [0.07, 18], [0.2, 16.4], [0.45, 12.6], [0.62, 12.4], [0.85, 13.2], [1, 13.8], [1.05, 13.4]];   // pul-sirka trupu zepredu (V-tvar: siroka ramena, uzke boky)
function torsoFront(sc, ux, uy, L, sk, hk, breath) {
  var lx = uy, ly = -ux, N = 14, i, s, w, cx, cy, left = [], right = [], pts, k;
  for (i = 0; i <= N; i++) {
    s = i / N * 1.04; k = sk + (hk - sk) * clamp(s, 0, 1);
    w = prof(TF, s) * k + (s < 0.35 ? breath * 0.6 : 0); cx = sc[0] + ux * s * L; cy = sc[1] + uy * s * L;
    left.push([cx - lx * w, cy - ly * w]); right.push([cx + lx * w, cy + ly * w]);
  }
  pts = left; for (i = N; i >= 0; i--) pts.push(right[i]);
  w = TF[0][1] * sk;
  for (i = 1; i < 9; i++) { k = i / 9 * PI; pts.push([sc[0] + lx * w * Math.cos(k) - ux * 6.4 * Math.pow(Math.sin(k), 0.85), sc[1] + ly * w * Math.cos(k) - uy * 6.4 * Math.pow(Math.sin(k), 0.85)]); }   // kopule: sikmina trapezu
  return orient(pts);
}
function legFront(Hh, K, Aa, T) {
  var A2 = [Aa[0], Aa[1] + 1], T2 = [T[0], T[1] - 4.4];                 // spicka T lezi na podlaze
  shaded(function (ox, oy) { cap(A2, T2, 5.6, 5, ox, oy); },
    [{ base: COL.shoe, shade: COL.shoeD }, { fn: function () { c.ellipse(T[0], T[1] - 1.6, 5.4, 2.6, 0, 0, PI * 2); }, base: COL.sole, shade: COL.soleD }]);
  var dx = Aa[0] - K[0], dy = Aa[1] - K[1], len = Math.hypot(dx, dy) || 1;
  shin(K, Aa, PAL_N, null, [-dy / len, dx / len]);
  thigh(Hh, K, PAL_N);
}
function vNeck(sc, ux, uy) {                         // vystrih dresu zepredu (V)
  var lx = uy, ly = -ux;
  return [[sc[0] - ux * 2 - lx * 6.2, sc[1] - uy * 2 - ly * 6.2], [sc[0] - ux * 2 + lx * 6.2, sc[1] - uy * 2 + ly * 6.2], [sc[0] + ux * 8.5, sc[1] + uy * 8.5]];
}
function drawFront(J, o) {
  var ts = o.time / 1000, hl = o.highlight || {}, sL = J.shoulderL, sR = J.shoulderR, hL = J.hipL, hR = J.hipR, hd = J.head;
  var sc = J.shoulder || lerp(sL, sR, 0.5), hcn = J.hip || lerp(hL, hR, 0.5), L = dist(sc, hcn) || 1;
  var ux = (hcn[0] - sc[0]) / L, uy = (hcn[1] - sc[1]) / L;
  var sk = dist(sL, sR) / (2 * BODY.shoulderHalf) || 1, hk = dist(hL, hR) / (2 * BODY.hipHalf) || 1;
  var breath = o.breath === false ? 0 : Math.sin(ts * PI * 2 / 3.8) * 0.9, i, s, T = [];
  for (i = 0; i < 2; i++) { s = i ? 'R' : 'L'; T[i] = J['toe' + s] || [J['ankle' + s][0] + (i ? 2 : -2), J['ankle' + s][1] + BODY.ankleH]; }
  CS.side = false; CS.J = J; CS.sc = sc; CS.ux = ux; CS.uy = uy; CS.L = L; CS.tp = torsoFront(sc, ux, uy, L, sk, hk, breath);
  anN = 0; anchorsFront(hl);
  if (!o.noShadow) {
    footShadow(J.ankleL, T[0], 0.5); footShadow(J.ankleR, T[1], 0.5);
    softEllipse(hcn[0], FLOOR + 0.5, 34, 4, clamp(0.3 * (1 - (FLOOR - hcn[1]) / 110), 0, 0.3));
  }
  haloPass();
  if (o.mid) o.mid(c, J, o.t, o.time, o.info);
  var rot = (J.headRot || 0) * D2R;
  drawTorsoParts(function (ox, oy) { poly(CS.tp, ox, oy); }, sc, ux, uy, uy, -ux, L,
    { fn: function () { poly(vNeck(sc, ux, uy)); }, base: COL.skin, shade: COL.skinD },
    function () { var v = vNeck(sc, ux, uy); c.strokeStyle = COL.band; c.lineWidth = 1.6; c.beginPath(); c.moveTo(v[0][0], v[0][1]); c.lineTo(v[2][0], v[2][1]); c.lineTo(v[1][0], v[1][1]); c.stroke(); });
  shaded(function (ox, oy) { cap([sc[0] - ux * 3, sc[1] - uy * 3], hd, 7.0, 6.4, ox, oy); }, [{ base: COL.skin, shade: COL.skinD }]);
  drawHeadFront(hd, rot);
  legFront(hL, J.kneeL, J.ankleL, T[0]); legFront(hR, J.kneeR, J.ankleR, T[1]);
  armSide(sL, J.elbowL, J.wristL, PAL_N); armSide(sR, J.elbowR, J.wristR, PAL_N);
  if (!o.glowLater) glowPass(c);
}

/* drawFigure(ctx, J, opts) - viz hlavicka souboru / dokumentace v zadani */
function drawFigure(ctx, J, opts) {
  c = ctx; var o = opts || {};
  if (o.time == null) o.time = 0;
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  if (o.view === 'front') drawFront(J, o); else drawSide(J, o);
  c.restore();
}

/* ============================== vybaveni (gear) ============================== */
function shadowAt(x, X, Y, rx, a, ry) { c = x; softEllipse(X, Y, rx, ry || Math.max(2.5, rx * 0.14), a == null ? 0.4 : a); }
function tube(x, pts, w, col, colD, colL) {          // trubka (rám / tyc) s hlubkou a odleskem
  c = x; x.lineCap = 'round'; x.lineJoin = 'round';
  var i, p, k = [[w + 1.6, colD, 0.8], [w, col, 0], [Math.max(0.8, w * 0.25), colL, -w * 0.22]];
  for (var j = 0; j < 3; j++) {
    if (!k[j][1]) continue; x.strokeStyle = k[j][1]; x.lineWidth = k[j][0]; x.beginPath();
    for (i = 0; i < pts.length; i++) { p = pts[i]; if (i) x.lineTo(p[0], p[1] + k[j][2]); else x.moveTo(p[0], p[1] + k[j][2]); }
    x.stroke();
  }
}
var gear = {
  floor: function (x) {                              // podlaha: jemne ztmaveni + cara (render ji vola sam)
    x.fillStyle = 'rgba(5,14,11,0.30)'; x.fillRect(-W, FLOOR, W * 3, H * 2);
    x.fillStyle = COL.floorLine; x.fillRect(-W, FLOOR, W * 3, 1.2);
  },
  shadow: shadowAt,                                  // shadow(ctx, x, y, rx, alpha=.4, ry)
  mat: function (x, x1, x2) {
    c = x; var y = FLOOR - 4.2; shadowAt(x, (x1 + x2) / 2, FLOOR + 0.5, (x2 - x1) / 2 + 4, 0.35, 3);
    shaded(function (ox, oy) { rr(x1 + ox, y + oy, x2 - x1, 4.2, 2); }, [{ base: '#2d7a63', shade: '#205c4a' }]);
    x.fillStyle = 'rgba(255,255,255,0.16)'; x.fillRect(x1 + 3, y + 0.7, x2 - x1 - 6, 1);
  },
  bench: function (x, X, Y, w, h, o) {
    c = x; var i, lx;
    if (!o || o.legs !== false) {
      for (i = 0; i < 2; i++) { lx = i ? X + w - 13 : X + 7; softEllipse(lx + 3, FLOOR + 0.5, 12, 2.8, 0.5);
        x.fillStyle = COL.frameD; x.fillRect(lx, Y + h - 1, 5.5, FLOOR - Y - h + 1); x.fillStyle = COL.frame; x.fillRect(lx, Y + h - 1, 3.6, FLOOR - Y - h + 1); }
      x.fillStyle = COL.frameD; x.fillRect(X + 12, Y + (FLOOR - Y) * 0.62, w - 28, 3);
    }
    shaded(function (ox, oy) { rr(X + ox, Y + oy, w, h, 3.5); }, [{ base: COL.pad, shade: COL.padD }]);
    x.fillStyle = COL.padTop; x.fillRect(X + 4, Y + 0.7, w - 8, 1.3);
  },
  seat: function (x, X, Y, w, o) {                   // sedak (X,Y = levy horni roh) + volitelna opěrka {x1,y1,x2,y2}
    c = x; var bx = X + w * 0.3;
    softEllipse(bx + 3, FLOOR + 0.5, 22, 3, 0.45);
    x.fillStyle = COL.frameD; x.fillRect(bx, Y + 8, 7, FLOOR - Y - 8); x.fillRect(bx - 10, FLOOR - 4, 27, 4);
    x.fillStyle = COL.frame; x.fillRect(bx, Y + 8, 4.6, FLOOR - Y - 8);
    if (o && o.back) shaded(function (ox, oy) { cap([o.back.x1, o.back.y1], [o.back.x2, o.back.y2], 5.5, 5.5, ox, oy); }, [{ base: COL.pad, shade: COL.padD }]);
    shaded(function (ox, oy) { rr(X + ox, Y + oy, w, 9, 4); }, [{ base: COL.pad, shade: COL.padD }]);
    x.fillStyle = COL.padTop; x.fillRect(X + 4, Y + 0.7, w - 8, 1.2);
  },
  plateEnd: function (x, X, Y, r) {                  // kotouc zboku (jako v demu)
    c = x; var k = r / 27;
    x.fillStyle = 'rgba(0,0,0,0.20)'; x.beginPath(); circ(X + 3.5 * k, Y + 4.5 * k, r + k); x.fill();
    x.fillStyle = 'rgba(0,0,0,0.14)'; x.beginPath(); circ(X + 2 * k, Y + 2.5 * k, r + 2.5 * k); x.fill();
    x.globalAlpha = 0.94; x.fillStyle = COL.rubber; x.beginPath(); circ(X, Y, r); x.fill(); x.globalAlpha = 1;
    x.strokeStyle = COL.accent2; x.lineWidth = 2.6 * k; x.beginPath(); circ(X, Y, r - 1.3 * k); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.10)'; x.lineWidth = 1.2 * k; x.beginPath(); circ(X, Y, r * 0.74); x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.045)'; x.beginPath(); circ(X, Y, r * 0.56); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.22)'; x.lineWidth = 2 * k; x.beginPath(); x.arc(X, Y, r - 5 * k, PI * 1.08, PI * 1.45); x.stroke();
    var g = x.createRadialGradient(X - 2 * k, Y - 2 * k, 0.5, X, Y, 7 * k);
    g.addColorStop(0, '#f1f8f5'); g.addColorStop(1, COL.metal);
    x.fillStyle = g; x.beginPath(); circ(X, Y, 6.4 * k); x.fill();
    x.fillStyle = COL.rubber; x.beginPath(); circ(X, Y, 2.3 * k); x.fill();
  },
  barbellFront: function (x, x1, y, x2, o) {         // osa zepredu; kotouce jsou v x1 a x2, tyc presahuje o 12
    c = x; var r = (o && o.r) || 22, i, px;
    shadowAt(x, (x1 + x2) / 2, FLOOR + 0.5, (x2 - x1) / 2 + r, clamp(0.4 * (1 - (FLOOR - y - r) / 90), 0, 0.4), 3);
    tube(x, [[x1 - 12, y], [x2 + 12, y]], 3, COL.metal, '#6b7a75', COL.metalL);
    for (i = 0; i < 2; i++) {
      px = i ? x2 : x1;
      shaded(function (ox, oy) { rr(px - 3.5 + ox, y - r + oy, 7, r * 2, 2.5); }, [{ base: '#222e2b', shade: COL.rubber }]);
      x.fillStyle = COL.accent2; x.fillRect(px - 3.5, y - r + 3, 7, 1.6); x.fillRect(px - 3.5, y + r - 4.6, 7, 1.6);
    }
  },
  dumbbell: function (x, X, Y, a, o) {               // {end:true} = pohled na konec (kruh), jinak zboku; a = natoceni (stupne)
    c = x;
    if (o && o.end) { gear.plateEnd(x, X, Y, 8.5); return; }
    x.save(); x.translate(X, Y); x.rotate(a * D2R);
    tube(x, [[-11, 0], [11, 0]], 2.6, COL.metal, '#6b7a75', COL.metalL);
    for (var i = -1; i <= 1; i += 2) {
      shaded(function (ox, oy) { rr(i * 13 - 4 + ox, -8 + oy, 8, 16, 2.5); }, [{ base: '#222e2b', shade: COL.rubber }]);
      x.fillStyle = COL.accent2; x.fillRect(i * 13 - 4, -8, 8, 1.5);
    }
    x.restore();
  },
  cable: function (x, p, q) {
    x.lineCap = 'round'; x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 2.4; x.beginPath(); x.moveTo(p[0] + 0.6, p[1] + 0.8); x.lineTo(q[0] + 0.6, q[1] + 0.8); x.stroke();
    x.strokeStyle = '#b6c7c1'; x.lineWidth = 1.3; x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.stroke();
  },
  band: function (x, p, q) {                         // odporova guma (tlustsi akcentova linka)
    x.lineCap = 'round'; x.strokeStyle = COL.accent; x.lineWidth = 3.6; x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.25)'; x.lineWidth = 1; x.beginPath(); x.moveTo(p[0], p[1] - 0.8); x.lineTo(q[0], q[1] - 0.8); x.stroke();
  },
  pulley: function (x, X, Y) {
    c = x; tube(x, [[X, Y - 14], [X, Y - 3]], 2.2, COL.frame, COL.frameD, COL.padTop);
    x.fillStyle = COL.frameD; x.fillRect(X - 6, Y - 16, 12, 3);
    x.fillStyle = COL.rubber; x.beginPath(); circ(X, Y, 6.8); x.fill();
    x.strokeStyle = COL.accent2; x.lineWidth = 1.8; x.beginPath(); circ(X, Y, 5.4); x.stroke();
    x.fillStyle = COL.metal; x.beginPath(); circ(X, Y, 2); x.fill();
  },
  handle: function (x, X, Y, a) {                    // drzadlo kabelu / D-madlo, a = natoceni
    c = x; x.save(); x.translate(X, Y); x.rotate(a * D2R);
    tube(x, [[-7, 0], [7, 0]], 3.4, COL.metal, '#6b7a75', COL.metalL);
    tube(x, [[-4, 0], [4, 0]], 3.8, COL.rubber, COL.rubber, null);
    x.strokeStyle = COL.metal; x.lineWidth = 1.2; x.beginPath(); x.arc(-8, -2.5, 2.6, 0, PI * 2); x.stroke();
    x.restore();
  },
  bar: function (x, x1, y1, x2, y2) { tube(x, [[x1, y1], [x2, y2]], 3.4, COL.metal, '#6b7a75', COL.metalL); },
  stack: function (x, X, Y, lift) {                  // zavazi: X = stred, Y = horni hrana v klidu; horni 4 desky se zvedaji o lift (px nahoru)
    c = x; var i, py;
    tube(x, [[X - 11, Y - 12], [X - 11, Y + 64]], 1.6, COL.frame, COL.frameD, null); tube(x, [[X + 11, Y - 12], [X + 11, Y + 64]], 1.6, COL.frame, COL.frameD, null);
    softEllipse(X, FLOOR + 0.5, 20, 3, 0.45);
    for (i = 0; i < 8; i++) {
      py = Y + i * 7.5 - (i < 4 ? lift : 0);
      shaded(function (ox, oy) { rr(X - 13 + ox, py + oy, 26, 6.4, 1.6); }, [{ base: '#34443f', shade: COL.rubber }]);
      x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(X - 11, py + 0.7, 22, 1);
    }
    x.fillStyle = COL.accent; x.beginPath(); circ(X + 8, Y + 3.5 * 7.5 + 3 - lift, 1.6); x.fill();
  },
  pad: function (x, X, Y, r) {
    c = x; shaded(function (ox, oy) { circ(X + ox, Y + oy, r); }, [{ base: COL.pad, shade: COL.padD }]);
    x.strokeStyle = COL.padTop; x.lineWidth = 1.2; x.beginPath(); x.arc(X, Y, r - 2, PI * 1.15, PI * 1.55); x.stroke();
  },
  frame: function (x, pts) { tube(x, pts, 5, COL.frame, COL.frameD, COL.padTop); },
  step: function (x, X, Y, w, h) {                   // bedna / step: levy horni roh X,Y; h vynechane = az k podlaze
    c = x; h = h || FLOOR - Y; shadowAt(x, X + w / 2, FLOOR + 0.5, w / 2 + 6, 0.4, 3);
    shaded(function (ox, oy) { rr(X + ox, Y + oy, w, h, 3); }, [{ base: COL.pad, shade: COL.padD }]);
    x.fillStyle = COL.padTop; x.fillRect(X + 3, Y + 0.8, w - 6, 1.6);
  },
  rail: function (x, x1, y1, x2, y2) {
    tube(x, [[x1, y1], [x2, y2]], 2.4, COL.frame, COL.frameD, COL.padTop);
    x.fillStyle = COL.frameD; x.beginPath(); circ(x1, y1, 2.8); circ(x2, y2, 2.8); x.fill();
  },
  sled: function (x, X, Y, a) {                      // platforma legpressu / sanek (stred X,Y, natoceni a)
    c = x; x.save(); x.translate(X, Y); x.rotate(a * D2R);
    shaded(function (ox, oy) { rr(-24 + ox, -4.5 + oy, 48, 9, 3); }, [{ base: COL.pad, shade: COL.padD }]);
    x.fillStyle = COL.padTop; x.fillRect(-20, -3.7, 40, 1.3);
    x.fillStyle = COL.frameD; x.fillRect(-14, 4.5, 6, 6); x.fillRect(8, 4.5, 6, 6);
    x.restore();
  },
  ball: function (x, X, Y, r) {                      // gymball
    c = x; shadowAt(x, X, FLOOR + 0.5, r * 0.8, 0.4, 3);
    var g = x.createRadialGradient(X - r * 0.35, Y - r * 0.4, r * 0.1, X, Y, r);
    g.addColorStop(0, '#6ee7b7'); g.addColorStop(0.55, '#10b981'); g.addColorStop(1, '#047857'); x.fillStyle = g; x.beginPath(); circ(X, Y, r); x.fill();
  },
  /* zidle zboku (drevena kuchynska): X = predni hrana sedaku, dir = +1 sedak (a operadlo) smeruje doprava od X, -1 doleva.
     Horni plocha sedaku presne ve vysce CHAIR_H nad podlahou (~45 cm), hloubka sedaku 36 j., zadni nohy pokracuji
     nahoru jako opery operadla (mirne nakloneneho dozadu), pod sedakem zarg + pricka mezi nohami. o.back === false = bez operadla. */
  chair: function (x, X, dir, o) {
    c = x; dir = dir < 0 ? -1 : 1; var sy = FLOOR - CHAIR_H, d = 36, xb = X + dir * d, x0 = Math.min(X, xb), i, lx, top = sy - 46, lean = dir * 6;
    var wood = function (ox, oy, fn) { shaded(function (a, b) { fn(a + ox, b + oy); }, [{ base: COL.wood, shade: COL.woodD }]); };
    softEllipse(X + dir * d / 2, FLOOR + 0.5, d / 2 + 9, 3, 0.45);
    // vzdalenejsi (tmavsi) nohy, mirne posunute
    x.fillStyle = COL.woodD;
    x.fillRect(X + dir * 5 - 2 + dir * 1.6, sy + 4, 4, CHAIR_H - 4);
    x.beginPath(); poly([[xb - dir * 4 - 2 + dir * 1.6, sy], [xb - dir * 4 + 2 + dir * 1.6, sy], [xb - dir * 2 + 2 + dir * 1.6, FLOOR], [xb - dir * 2 - 2 + dir * 1.6, FLOOR]]); x.fill();
    // blizke nohy: predni (mirne zuzena dolu) a zadni
    x.beginPath(); poly([[X + dir * 3 - 2.6, sy + 3], [X + dir * 3 + 2.6, sy + 3], [X + dir * 3 + 1.8, FLOOR], [X + dir * 3 - 1.8, FLOOR]]);
    x.fillStyle = COL.woodD; x.fill(); x.beginPath(); poly([[X + dir * 3 - 2.6, sy + 3], [X + dir * 3 + 0.4, sy + 3], [X + dir * 3 + 0.1, FLOOR], [X + dir * 3 - 1.8, FLOOR]]);
    x.fillStyle = COL.wood; x.fill();
    // zadni noha + sloupek operadla (jeden dilec, vzadu skloneny)
    var rb = function (ox, oy) {
      poly(orient([[xb - dir * 4.6 - 2.6 + ox, FLOOR + oy], [xb - dir * 4.6 + 2.6 + ox, FLOOR + oy], [xb - dir * 4.6 + 2.6 + ox, sy + oy], [xb - dir * 4.6 + lean + 2.4 + ox, top + oy],
        [xb - dir * 4.6 + lean - 2.4 + ox, top + oy], [xb - dir * 4.6 - 2.6 + ox, sy + oy]]));
    };
    if (!o || o.back !== false) wood(0, 0, rb);
    else { x.fillStyle = COL.woodD; x.fillRect(xb - dir * 4.6 - 2.6, sy + 3, 5.2, CHAIR_H - 3); }
    // podsedakovy ram a pricka mezi nohami
    x.fillStyle = COL.woodD; x.fillRect(x0 + 3, sy + 4, d - 6, 4);
    x.fillStyle = COL.wood; x.fillRect(x0 + 3, sy + 4, d - 6, 2.4);
    x.fillStyle = COL.woodD; x.fillRect(x0 + 4, sy + CHAIR_H * 0.62, d - 8, 2.4);
    if (!o || o.back !== false) {                    // vyplne operadla: horni listy (videt zboku jako tence desky)
      var bx = xb - dir * 4.6 + lean, k = 0.5;
      wood(0, 0, function (ox, oy) { rr(bx - 2.9 + ox, top - 2 + oy, 5.8, 17, 2.5); });
      wood(0, 0, function (ox, oy) { var t = sy - 20 - 0; rr(xb - dir * 4.6 + lean * 0.34 - 2.5 + ox, t + oy, 5, 7, 2); });
      x.fillStyle = COL.woodL; x.fillRect(bx - 0.6, top - 1, 1.1, 14);
    }
    // sedak: horni plocha presne v sy, tloustka 4.5
    shaded(function (ox, oy) { rr(x0 - 2.2 + ox, sy + oy, d + 4.4, 4.6, 2); }, [{ base: COL.wood, shade: COL.woodD }]);
    x.fillStyle = COL.woodL; x.fillRect(x0 + 1, sy + 0.4, d - 2, 1);
  },
  /* stupinek 20 cm (STEP_H j.): X = leva hrana, w = sirka (vychozi 46); plastova plosina s protiskluzovym vrchem a dvema podstavci */
  step20: function (x, X, w) {
    c = x; w = w || 46; var Y = FLOOR - STEP_H, lw = 8.5, i, lx;
    shadowAt(x, X + w / 2, FLOOR + 0.5, w / 2 + 6, 0.4, 3);
    x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(X + lw, Y + 6, w - 2 * lw, STEP_H - 6);                  // dutina mezi podstavci
    for (i = 0; i < 2; i++) {
      lx = i ? X + w - lw - 1.5 : X + 1.5;
      shaded(function (ox, oy) { rr(lx + ox, Y + 4 + oy, lw, STEP_H - 4, 1.5); }, [{ base: '#52665e', shade: '#33423d' }]);
      x.fillStyle = COL.rubber; x.fillRect(lx, FLOOR - 2.4, lw, 2.4);
    }
    shaded(function (ox, oy) { rr(X + ox, Y + oy, w, 7, 2.6); }, [{ base: '#6b857b', shade: '#42554e' }]);   // deska
    x.fillStyle = COL.padTop; x.fillRect(X + 3, Y + 0.8, w - 6, 1.2);
    x.fillStyle = 'rgba(0,0,0,0.30)';                                                                        // protiskluzove zebra
    for (i = 6; i < w - 5; i += 5) x.fillRect(X + i, Y + 3.2, 2.4, 1.1);
  }
};

/* ======================== registr, tempo, vykreslovani ======================== */
var REG = {}, KEYS = [];
function register(key, def) {
  def.tempo = Object.assign({ up: 0.9, hold: 0.4, down: 1.5, pause: 0.5 }, def.tempo);
  def.phases = Object.assign({ up: 'Nahoru ⬆', hold: 'Drž', down: 'Pomalu zpět ⬇', pause: '' }, def.phases);
  def.view = def.view === 'front' ? 'front' : 'side';
  def._o = { view: def.view, facing: def.facing < 0 ? -1 : 1, breath: def.breath !== false, glowLater: !!def.glowTop, mid: def.mid || null };
  def.key = key; if (!REG[key]) KEYS.push(key); REG[key] = def; return def;
}
function phaseAt(def, ms) {                          // casova osa jednoho opakovani (ease in-out)
  var T = def.tempo, up = T.up * 1000, ho = T.hold * 1000, dn = T.down * 1000, pa = T.pause * 1000, cyc = Math.max(1, up + ho + dn + pa);
  var m = ms % cyc, t, ph, sq = 0;
  if (m < up) { t = ease(m / up); ph = 'up'; }
  else if (m < up + ho) { t = 1; ph = 'hold'; sq = Math.sin(PI * (m - up) / ho); }
  else if (m < up + ho + dn) { t = 1 - ease((m - up - ho) / dn); ph = 'down'; }
  else { t = 0; ph = 'pause'; }
  return { t: t, phase: ph, rep: Math.floor(ms / cyc) + (m >= up ? 1 : 0), squeeze: sq, label: def.phases[ph] || (ph === 'pause' ? def.phases.up : '') };
}
function getDef(key) { return REG[key] || REG.generic || REG.hipthrust || null; }
/* render(ctx, key, t, time_ms, info?) - kresli do logickeho prostoru 400x250 (caller nastavi transform) */
function render(ctx, key, t, time, info) {
  var def = getDef(key); if (!def) return;
  t = clamp(+t || 0, 0, 1); time = time || 0;
  ctx.clearRect(-4, -4, W + 8, H + 8);
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  var g = ctx.createRadialGradient(200, 150, 10, 200, 150, 190);
  g.addColorStop(0, 'rgba(16,185,129,0.12)'); g.addColorStop(1, 'rgba(16,185,129,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (def.zoom && def.zoom !== 1) { ctx.translate(W / 2, FLOOR); ctx.scale(def.zoom, def.zoom); ctx.translate(-W / 2, -FLOOR); }
  gear.floor(ctx);
  var J = def.solve(t, time, info), o = def._o;
  if (def.back) def.back(ctx, J, t, time, info);
  o.time = time; o.t = t; o.info = info; o.pulse = (info && info.squeeze) || 0;
  o.highlight = def.highlight ? def.highlight(t, info) : null;
  drawFigure(ctx, J, o);
  if (def.front) def.front(ctx, J, t, time, info);
  if (o.glowLater) glowPass(ctx);
  ctx.restore();
}

/* ============================ canvas + smycka ============================ */
var IO = null, running = false, raf = 0, last = 0, lastScan = 0, list = [], reduceMQ = null;
function sizeIt(st) {
  var cv = st.cv, r = cv.getBoundingClientRect(), dpr = Math.min(G.devicePixelRatio || 1, 2.5), w = Math.round(r.width * dpr);
  if (w < 2) { st.cw = -1; return false; }
  st.cw = cv.clientWidth;
  var h = Math.round(w * H / W);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  st.k = w / W; st.dirty = true; return true;
}
function mount(cv) {
  if (cv._fa) return cv._fa;
  var st = { cv: cv, ctx: cv.getContext('2d'), k: 1, ms: 0, vis: true, phase: '', rep: -1, dirty: true, cw: -1, frozen: null, key: null };
  cv._fa = st; cv.classList.add('fitanim');
  try { if (G.getComputedStyle(cv).aspectRatio === 'auto') cv.style.aspectRatio = W + ' / ' + H; } catch (e) {}
  if (G.IntersectionObserver) {
    if (!IO) IO = new G.IntersectionObserver(function (es) { for (var i = 0; i < es.length; i++) if (es[i].target._fa) es[i].target._fa.vis = es[i].isIntersecting; }, { rootMargin: '60px' });
    IO.observe(cv);
  }
  var d0 = sizeIt(st) && getDef(cv.getAttribute('data-anim'));   // hned prvni snimek, at neni canvas prazdny
  if (d0) { st.ctx.setTransform(st.k, 0, 0, st.k, 0, 0); render(st.ctx, d0.key, 0.6, 0); }
  return st;
}
function tick(ts) {
  raf = G.requestAnimationFrame(tick);
  if (ts - last < 28) return;
  var dt = Math.min(100, ts - last), i, st, def, info, key, fz = FitAnim.freeze, still = reduceMQ && reduceMQ.matches;
  last = ts;
  if (ts - lastScan > 600 || !list.length) {
    lastScan = ts; list = Array.prototype.slice.call(G.document.querySelectorAll('canvas.fitanim'));
    for (i = 0; i < list.length; i++) mount(list[i]);
  }
  for (i = 0; i < list.length; i++) {
    st = list[i]._fa;
    if (!st || !st.vis) continue;
    if (st.cv.clientWidth !== st.cw && !sizeIt(st)) continue;
    key = st.cv.getAttribute('data-anim'); def = getDef(key); if (!def) continue;
    if (key !== st.key) { st.key = key; st.ms = 0; st.dirty = true; }
    if (fz != null) { if (!st.dirty && st.frozen === fz) continue; info = { t: fz, phase: 'freeze', rep: 0, squeeze: 0, label: '' }; }
    else if (still) { if (!st.dirty && st.frozen === 'still') continue; info = { t: 0.6, phase: 'static', rep: 0, squeeze: 0, label: '' }; }
    else { st.ms += dt; info = phaseAt(def, st.ms); }
    st.frozen = fz != null ? fz : (still ? 'still' : null); st.dirty = false;
    st.ctx.setTransform(st.k, 0, 0, st.k, 0, 0);
    render(st.ctx, def.key, info.t, st.ms, info);
    if ((info.phase !== st.phase || info.rep !== st.rep) && FitAnim.onPhase) FitAnim.onPhase(st.cv, info);
    st.phase = info.phase; st.rep = info.rep;
  }
}
function start() {
  if (running || !G.requestAnimationFrame) return; running = true;
  reduceMQ = G.matchMedia ? G.matchMedia('(prefers-reduced-motion: reduce)') : null;
  last = 0; raf = G.requestAnimationFrame(tick);
}
function stop() { running = false; if (G.cancelAnimationFrame) G.cancelAnimationFrame(raf); }

var FitAnim = {
  W: W, H: H, FLOOR: FLOOR, CHAIR_H: CHAIR_H, STEP_H: STEP_H, BODY: BODY, COL: COL, U: U, gear: gear,
  pt: pt, ang: ang, dist: dist, ik2: ik2, lerp: lerp, ease: ease, clamp: clamp, toeFloor: toeFloor, headAt: headAt,
  drawFigure: drawFigure, register: register, phaseAt: phaseAt, render: render, mount: mount, start: start, stop: stop,
  keys: function () { return KEYS.slice(); }, get: function (k) { return REG[k] || null; },
  freeze: null,        // cislo 0..1 => vsechny viditelne canvasy se vykresli ve fixni poloze t (galerie / ladeni)
  onPhase: null        // function (canvas, info) pri zmene faze / opakovani; info = {t, phase, rep, label}
};
G.FitAnim = FitAnim;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
