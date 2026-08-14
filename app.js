/* ══════════════════════════════════════════════════════════════════════
   Oktatótermek — Sürgősségi Orvostani Klinika
   Terembeosztás + oktatási eszközök nyilvántartása. Supabase (terem séma).
   ══════════════════════════════════════════════════════════════════════ */
'use strict';

const VERZIO = 'v1.2';
const VERZIONAPLO = [
  ['v1.2', '2026. augusztus 14.', [
    'Teljes tevékenységnapló: egy helyen látszik, ki mit vett fel, módosított vagy törölt (foglalás, eszköz, terem), szűrőkkel és kereséssel.',
    'Új Kapcsolat lap: kihez lehet fordulni, és hogyan jelezhető hiba.',
    'Ez a verziónapló a Súgó alján.',
  ]],
  ['v1.1', '2026. augusztus 14.', [
    'A foglalási űrlap már mentés előtt kiírja, melyik terem szabad és melyik foglalt.',
    'Gyors időpontgombok, „most” jelző vonal a naptárban, keresés a foglalások között.',
    'Ismétlődő foglalásnál összegzés a felvett és a kimaradt alkalmakról.',
    'Eszköz adatlap: minden adat szerkeszthető, „nem használt” állapot törlés helyett, előzmény.',
    'Telefonon kártyás eszközlista, nagyobb beviteli mezők.',
    'Elfelejtett jelszó: a levélben lévő linkről új jelszó adható meg.',
  ]],
  ['v1.0', '2026. augusztus 14.', [
    'Első változat: heti, napi és lista nézet, foglalás ütközésvédelemmel, ismétlődés,',
    'naptárfájl (.ics), nyomtatható heti beosztás, 159 leltári eszköz nyilvántartása.',
  ]],
];
const CFG = {
  url: 'https://kcjiydathdqrpiofokoi.supabase.co',
  kulcs: 'sb_publishable_-SvSiiRu6PAhm9on3JQRpQ_f-f84ZY-',
};
const ALAP_KEZD = 7 * 60;    // a rács alapból 07:00-kor kezd
const ALAP_VEG = 21 * 60;    // és 21:00-kor ér véget — de a foglalásokhoz igazodik
const ORA_PX = 46;           // egy óra magassága a rácsban
const TETLEN_MS = 3 * 60 * 60 * 1000;   // 3 óra tétlenség után kilép (közös gépek miatt)

const sb = window.supabase.createClient(CFG.url, CFG.kulcs, {
  db: { schema: 'terem' },
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sokterem-auth' },
});

/* ──────────────────────────────────────────────────────── állapot */
const A = {
  user: null, profil: null,
  termek: [], foglalasok: [], eszkozok: [], profilok: [],
  lap: 'naptar',
  nezet: (window.innerWidth < 820 ? 'lista' : 'het'),
  nap: kezdoNap(new Date()),          // a megjelenített hét/nap kezdete
  rejtettTermek: new Set(),
  kereso: '',
  eszkSzuro: { szo: '', kat: new Set(['oktatasi', 'it']), room: '', allapot: '', inaktiv: false },
  naploSzuro: { tipus: '', ki: '', szo: '' },
  utolsoTevekenyseg: Date.now(),
  utolsoFrissites: null,
  frissitesHiba: false,
  betoltJel: 0,                       // a naptár-léptetés versenyhelyzete ellen
  belepesFut: false,
  visszaallitas: false,               // jelszó-visszaállító linkről jött
  racsGorgetes: null,
  racsElsoRajz: true,
  rajzJel: 0,
  sajatFoglalasok: null,
};

const TIPUSOK = {
  oktatas:    { nev: 'Oktatás',      szin: '#232f61' },
  vizsga:     { nev: 'Vizsga',       szin: '#b3172c' },
  szimulacio: { nev: 'Szimuláció',   szin: '#008c49' },
  megbeszeles:{ nev: 'Megbeszélés',  szin: '#3d4584' },
  egyeb:      { nev: 'Egyéb',        szin: '#5c6478' },
};
const ALLAPOTOK = {
  ismeretlen:    { nev: 'nincs adat',     jelzo: 'jelzo-szurke' },
  mukodik:       { nev: 'működik',        jelzo: 'jelzo-zold' },
  javitasra_var: { nev: 'javításra vár',  jelzo: 'jelzo-sarga' },
  javitas_alatt: { nev: 'javítás alatt',  jelzo: 'jelzo-sarga' },
  kolcsonben:    { nev: 'kölcsönben',     jelzo: 'jelzo-kek' },
  selejt:        { nev: 'selejt',         jelzo: 'jelzo-piros' },
};
const KATEGORIAK = { oktatasi: 'Oktatási eszköz', it: 'IT / technika', butor: 'Bútor', egyeb: 'Egyéb' };
const SZEREPEK = { admin: 'rendszergazda', titkarsag: 'titkárság', oktato: 'oktató' };
const SZINEK = [
  ['#232f61', 'Semmelweis kék'], ['#008bd2', 'azúrkék'], ['#008c49', 'zöld'],
  ['#3d4584', 'alnyomat-kék'], ['#b3a16e', 'sötét arany'], ['#b3172c', 'piros'],
];

/* ══════════════════════════════════════════════════ segédek ══ */
const $ = (s, gyoker = document) => gyoker.querySelector(s);
const $$ = (s, gyoker = document) => Array.from(gyoker.querySelectorAll(s));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/* csak valódi hatjegyű hexet engedünk stílusba (CSS-befecskendezés ellen) */
function szinBiztos(sz) { return /^#[0-9a-f]{6}$/i.test(String(sz || '')) ? sz : '#232f61'; }
/* olvasható szövegszín a háttérhez (WCAG-hoz igazodó egyszerű fényesség-számítás) */
function szovegSzin(hatter) {
  const h = szinBiztos(hatter).slice(1);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  // 0,21 körül fordul át, hogy melyik ad nagyobb kontrasztot (WCAG szerint számolva)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.21 ? '#1d2233' : '#ffffff';
}
/* ékezetre és kis/nagybetűre érzéketlen keresés */
function normal(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/* N\u00e9vegyeztet\u00e9s emberekhez: a \u201eDr.\u201d el\u0151tag, a sorrend \u00e9s az extra keresztnevek
   ne akad\u00e1lyozz\u00e1k, hogy valaki megtal\u00e1lja a neki foglalt oktat\u00e1st. */
function nevKulcs(nev) {
  return normal(nev)
    .replace(/\b(dr|prof|med|habil|phd|univ)\.?\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter(x => x.length > 1).sort();
}
function ugyanazAzEmber(a, b) {
  const x = nevKulcs(a), y = nevKulcs(b);
  if (!x.length || !y.length) return false;
  const kisebb = x.length <= y.length ? x : y;
  const nagyobb = x.length <= y.length ? y : x;
  const egyezo = kisebb.filter(t => nagyobb.includes(t));
  return egyezo.length === kisebb.length && egyezo.length >= Math.min(2, kisebb.length);
}

function kezelo() { return !!A.profil && ['admin', 'titkarsag'].includes(A.profil.szerep); }
function admin() { return !!A.profil && A.profil.szerep === 'admin'; }

/* magyarázó kérdőjel: koppintásra és fókuszra is megjelenik */
function sugoJel(szoveg) {
  return `<button type="button" class="sugo-jel" data-sugo="${esc(szoveg)}"
    aria-label="Magyarázat: ${esc(szoveg)}">?</button>`;
}
document.addEventListener('click', e => {
  const jel = e.target.closest('.sugo-jel');
  document.querySelectorAll('.sugo-buborek').forEach(b => b.remove());
  if (!jel) return;
  e.preventDefault();
  e.stopPropagation();
  const b = document.createElement('div');
  b.className = 'sugo-buborek';
  b.textContent = jel.dataset.sugo;
  document.body.appendChild(b);
  const r = jel.getBoundingClientRect();
  const ablak = window.innerWidth || document.documentElement.clientWidth || 320;
  const szel = Math.max(180, Math.min(260, ablak - 24));
  b.style.width = szel + 'px';
  b.style.left = Math.max(12, Math.min(ablak - szel - 12, r.left - szel / 2 + r.width / 2)) + 'px';
  const alattaHely = (window.innerHeight || document.documentElement.clientHeight || 600) - r.bottom;
  if (alattaHely > b.offsetHeight + 16) b.style.top = (r.bottom + window.scrollY + 6) + 'px';
  else b.style.top = (r.top + window.scrollY - b.offsetHeight - 6) + 'px';
});

function pirit(szoveg, fajta = '') {
  const p = $('#pirit');
  p.textContent = szoveg;
  p.className = 'pirit ' + fajta;
  p.setAttribute('aria-live', fajta === 'hiba' ? 'assertive' : 'polite');
  p.hidden = false;
  clearTimeout(pirit._t);
  pirit._t = setTimeout(() => { p.hidden = true; }, fajta === 'hiba' ? 8000 : 3200);
}

/* dátum-segédek — mind helyi idő szerint */
const NAPNEVEK = ['hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap'];
const NAPROVID = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];
const HONAPOK = ['január', 'február', 'március', 'április', 'május', 'június',
  'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
const HONAP_ROVID = ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.',
  'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'];

function kezdoNap(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function hetKezdet(d) {
  const x = kezdoNap(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));   // hétfő = a hét első napja
  return x;
}
function napPlusz(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hm(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function napCimke(d) { return `${d.getFullYear()}. ${HONAPOK[d.getMonth()]} ${d.getDate()}. (${NAPNEVEK[(d.getDay() + 6) % 7]})`; }
function rovidNap(d) { return `${HONAP_ROVID[d.getMonth()]} ${d.getDate()}.`; }
function percbe(d) { return d.getHours() * 60 + d.getMinutes(); }
function maE(d) { return ymd(d) === ymd(new Date()); }
function idoSzoveg(kezd, veg) { return `${hm(kezd)}–${hm(veg)}`; }
function napOra(perc) { return `${String(Math.floor(perc / 60)).padStart(2, '0')}:${String(perc % 60).padStart(2, '0')}`; }

/* magyar munkaszüneti napok (mozgó ünnepek Meeus/Jones/Butcher szerint) */
function husvet(ev) {
  const a = ev % 19, b = Math.floor(ev / 100), c = ev % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const ho = Math.floor((h + l - 7 * m + 114) / 31), nap = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ev, ho - 1, nap);
}
const unnepGyorsito = {};
function unnepek(ev) {
  if (unnepGyorsito[ev]) return unnepGyorsito[ev];
  const h = husvet(ev), t = {};
  const tesz = (d, nev) => { t[ymd(d)] = nev; };
  tesz(new Date(ev, 0, 1), 'Újév');
  tesz(new Date(ev, 2, 15), 'Nemzeti ünnep');
  tesz(napPlusz(h, -2), 'Nagypéntek');
  tesz(h, 'Húsvét');
  tesz(napPlusz(h, 1), 'Húsvéthétfő');
  tesz(new Date(ev, 4, 1), 'Munka ünnepe');
  tesz(napPlusz(h, 49), 'Pünkösd');
  tesz(napPlusz(h, 50), 'Pünkösdhétfő');
  tesz(new Date(ev, 7, 20), 'Szent István');
  tesz(new Date(ev, 9, 23), 'Nemzeti ünnep');
  tesz(new Date(ev, 10, 1), 'Mindenszentek');
  tesz(new Date(ev, 11, 25), 'Karácsony');
  tesz(new Date(ev, 11, 26), 'Karácsony másnapja');
  unnepGyorsito[ev] = t;
  return t;
}
function unnepNev(d) { return unnepek(d.getFullYear())[ymd(d)] || null; }

/* ══════════════════════════════════════════════════ modális ══ */
/* Verem: a megerősítő ablak a hívó űrlap FÖLÉ nyílik, és bezárásakor
   az eredeti űrlap a beírt adatokkal együtt visszatér. */
const modalisVerem = [];
let modalisAllapot = null;

function modalis({ cim, torzs, lab, szeles, zarKerdes, verem }) {
  const honnan = document.activeElement;
  if (verem && modalisAllapot) {
    modalisAllapot.elem.classList.add('hatra');      // az alatta lévő réteg elrejtve, de megmarad
    modalisVerem.push(modalisAllapot);
  } else {
    modalisVerem.length = 0;
    $('#modalis-tarto').innerHTML = '';
  }
  const h = document.createElement('div');
  h.className = 'modalis-hatter';
  h.innerHTML = `<div class="modalis" role="dialog" aria-modal="true" aria-label="${esc(cim)}"
      ${szeles ? 'style="max-width:860px"' : ''}>
    <div class="modalis-fej"><h2>${esc(cim)}</h2>
      <button class="zar-gomb" aria-label="Bezárás">×</button></div>
    <div class="modalis-torzs">${torzs}</div>
    ${lab ? `<div class="modalis-lab">${lab}</div>` : ''}
  </div>`;
  $('#modalis-tarto').appendChild(h);
  modalisAllapot = { elem: h, honnan, zarKerdes: !!zarKerdes, ment: false };

  h.addEventListener('mousedown', e => { if (e.target === h) zarKerdessel(); });
  $('.zar-gomb', h).addEventListener('click', zarKerdessel);

  // a Tab ne szökjön ki a párbeszédpanelből
  h.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const elemek = $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])', h)
      .filter(x => x.offsetParent !== null);
    if (!elemek.length) return;
    const elso = elemek[0], utolso = elemek[elemek.length - 1];
    if (e.shiftKey && document.activeElement === elso) { e.preventDefault(); utolso.focus(); }
    else if (!e.shiftKey && document.activeElement === utolso) { e.preventDefault(); elso.focus(); }
  });

  const elso = h.querySelector('input,select,textarea,button:not(.zar-gomb)');
  if (elso) setTimeout(() => elso.focus(), 30);
  return h;
}

function modalisNyitva() { return !!$('.modalis-hatter'); }

/* A legfelső réteg bezárása. Ha van alatta réteg (megerősítő ablakból való
   visszalépés), az visszatér a beírt adatokkal együtt. */
function zarModalis(csendben) {
  const allapot = modalisAllapot;
  if (allapot && allapot.elem && allapot.elem.parentNode) allapot.elem.remove();
  const alatta = modalisVerem.pop();
  modalisAllapot = alatta || null;
  if (alatta) {
    alatta.elem.classList.remove('hatra');
    const cel = alatta.elem.querySelector('input,select,textarea,button:not(.zar-gomb)');
    if (cel && !csendben) setTimeout(() => { try { cel.focus(); } catch (e) {} }, 20);
    return;
  }
  $('#modalis-tarto').innerHTML = '';
  if (!csendben && allapot && allapot.honnan && document.body.contains(allapot.honnan)) {
    try { allapot.honnan.focus(); } catch (e) { /* ha eltűnt, nem gond */ }
  }
}

/* minden réteg bezárása (pl. sikeres mentés után) */
function zarMindenModalist() {
  modalisVerem.length = 0;
  modalisAllapot = null;
  $('#modalis-tarto').innerHTML = '';
}

/* bezárás félig kitöltött űrlapnál rákérdez */
function zarKerdessel() {
  const allapot = modalisAllapot;
  if (!allapot) return;
  if (allapot.ment) return;                      // mentés közben nem zárunk
  if (allapot.zarKerdes && urlapErintve(allapot.elem)) {
    if (!confirm('Eldobod a megkezdett űrlapot? A beírt adatok nem mentődnek.')) return;
  }
  zarModalis();
}

function urlapErintve(h) {
  const mezok = $$('input,textarea', h).some(x => {
    if (x.type === 'hidden' || x.disabled) return false;
    return x.value !== x.defaultValue;
  });
  if (mezok) return true;
  return $$('select', h).some(x => Array.from(x.options).some(o => o.selected !== o.defaultSelected));
}

document.addEventListener('keydown', e => {
  A.utolsoTevekenyseg = Date.now();
  if (e.key === 'Escape' && modalisNyitva()) zarKerdessel();
});
document.addEventListener('click', () => { A.utolsoTevekenyseg = Date.now(); });

function megerosit(cim, szovegHtml, gombSzoveg, fn, veszes = true) {
  const h = modalis({
    cim,
    torzs: `<p>${szovegHtml}</p>`,
    lab: `<button class="btn" data-megse>Mégse</button>
          <button class="btn ${veszes ? 'btn-veszes' : 'btn-fo'}" data-ok>${esc(gombSzoveg)}</button>`,
    verem: true,
  });
  $('[data-megse]', h).onclick = () => zarModalis();
  $('[data-ok]', h).onclick = async () => {
    const gomb = $('[data-ok]', h);
    gomb.disabled = true;
    if (modalisAllapot) modalisAllapot.ment = true;
    try {
      await fn();
      zarMindenModalist();          // a művelet lefutott: a hívó űrlapra sem kell visszalépni
    } catch (e) {
      if (modalisAllapot) modalisAllapot.ment = false;
      gomb.disabled = false;
      hibaKi(e);
    }
  };
}

function hibaSzoveg(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e || '');
  if (/23P01|exclusion|overlap|bookings_nincs_utkozes/i.test(m))
    return 'Ebben a teremben a választott időben már van foglalás. Válassz másik időt vagy termet.';
  if (/Invalid login credentials/i.test(m)) return 'Hibás e-mail-cím vagy jelszó.';
  if (/Email not confirmed/i.test(m))
    return 'Ez a fiók még nincs aktiválva; kérj segítséget a titkárságtól.';
  if (/violates row-level security|permission denied/i.test(m))
    return 'Ehhez a művelethez nincs jogosultságod. Ha szükséged van rá, kérd a titkárságtól.';
  if (/csak a rendszergazda módosíthatja/i.test(m))
    return 'Ezt az adatot csak a rendszergazda módosíthatja.';
  if (/bookings_ido/i.test(m)) return 'A befejezés későbbi legyen, mint a kezdés.';
  if (/bookings_letszam/i.test(m)) return 'A létszám 0 és 500 között lehet.';
  if (/bookings_cim_hossz/i.test(m)) return 'A megnevezés legfeljebb 200 karakter lehet.';
  if (/bookings_hossz/i.test(m)) return 'Egy foglalás legfeljebb 14 napos lehet.';
  if (/foreign key|23503/i.test(m))
    return 'Erre a teremre van foglalás, ezért nem törölhető. Állítsd inkább „nem foglalható”-ra.';
  if (/rooms_kod_key/i.test(m)) return 'Ez a teremkód már szerepel a listában.';
  if (/duplicate key|23505/i.test(m)) return 'Ez az érték már szerepel a rendszerben, adj meg mást.';
  if (/Password should be at least|password.*(short|length)/i.test(m))
    return 'Legalább 8 karakter, benne kisbetű, nagybetű és szám.';
  if (/(pwned|leaked|compromis)/i.test(m))
    return 'Ez a jelszó szerepel nyilvános adatszivárgásokban, ezért nem használható. Válassz másikat.';
  if (/New password should be different/i.test(m))
    return 'Az új jelszó nem lehet ugyanaz, mint a mostani.';
  if (/rate limit|too many requests|429|email rate/i.test(m))
    return 'Túl sok jelszó-levél ment ki rövid időn belül (óránként kettőt engedélyez a rendszer). ' +
           'Várj egy órát, vagy kérd a titkárságtól, hogy állítsanak be neked jelszót.';
  if (/Failed to fetch|NetworkError|network/i.test(m))
    return 'Nincs kapcsolat a szerverrel. Ellenőrizd a hálózatot, és próbáld újra.';
  if (/JWT|token|session/i.test(m))
    return 'A belépés lejárt. Lépj be újra.';
  console.error('Lefordítatlan hiba:', m);
  return 'Váratlan hiba történt, a művelet nem sikerült. Próbáld újra; ha marad, jelezd a titkárságnak.';
}
function hibaKi(e) { console.error(e); pirit(hibaSzoveg(e), 'hiba'); }

/* mentés-ellenőrzés: a PostgREST 0 érintett sornál sem ad hibát,
   ezért minden írásnál visszakérjük az érintett sorokat */
function ellenoriz({ data, error }, uresSzoveg) {
  if (error) throw error;
  if (!data || !data.length) throw new Error(uresSzoveg || 'A tétel közben megváltozott, vagy nincs rá jogosultságod.');
  return data;
}

/* ══════════════════════════════════════════════════ belépés ══ */
async function belepesInditas() {
  // lejárt vagy hibás jelszó-visszaállító link: a Supabase a hash-ben küld hibát
  const hash = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  if (hash.get('error') || hash.get('error_description')) {
    const leiras = hash.get('error_description') || '';
    history.replaceState(null, '', location.pathname);
    belepesLap(/expired|invalid/i.test(leiras + hash.get('error'))
      ? 'A jelszó-visszaállító link lejárt vagy már felhasználták (egy óráig érvényes). Kérj újat az „Elfelejtett jelszó” gombbal.'
      : 'A link nem működött. Kérj újat az „Elfelejtett jelszó” gombbal.');
    return;
  }
  const { data } = await sb.auth.getSession();
  sb.auth.onAuthStateChange((esemeny, session) => {
    if (esemeny === 'SIGNED_OUT') { location.reload(); return; }
    if (esemeny === 'PASSWORD_RECOVERY') {
      A.visszaallitas = true;
      if (session) appIndit(session.user).catch(e => belepesLap(hibaSzoveg(e)));
    }
  });
  if (data.session) await appIndit(data.session.user);
  else belepesLap();
}

function lapokElrejt() {
  $('#indulo-allapot').hidden = true;
  $('#belepes').hidden = true;
  $('#jelszocsere-lap').hidden = true;
  $('#app').hidden = true;
}

function belepesLap(hiba) {
  lapokElrejt();
  $('#belepes').hidden = false;
  const uzenet = hiba || sessionStorage.getItem('sokterem-uzenet');
  sessionStorage.removeItem('sokterem-uzenet');
  if (uzenet) { $('#be-hiba').textContent = uzenet; $('#be-hiba').hidden = false; }
  else { $('#be-hiba').hidden = true; }
}

$('#belepes-form').addEventListener('submit', async e => {
  e.preventDefault();
  const gomb = $('#be-gomb');
  gomb.disabled = true; gomb.textContent = 'Belépés…';
  $('#be-hiba').hidden = true;
  A.belepesFut = true;
  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email: $('#be-email').value.trim(), password: $('#be-jelszo').value });
    if (error) throw error;
    await appIndit(data.user);
  } catch (err) {
    belepesLap(hibaSzoveg(err));
  } finally {
    A.belepesFut = false;
    gomb.disabled = false; gomb.textContent = 'Belépés';
  }
});

$('#be-elfelejtett').addEventListener('click', async () => {
  const email = $('#be-email').value.trim();
  if (!email) { $('#be-email').focus(); pirit('Írd be az e-mail-címedet, oda küldjük a linket.', 'hiba'); return; }
  const gomb = $('#be-elfelejtett');
  gomb.disabled = true;
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) throw error;
    pirit('Elküldtük a levelet a ' + email + ' címre. Nyisd meg benne a linket, és ott adhatsz meg új jelszót.', 'siker');
  } catch (e) { hibaKi(e); } finally { gomb.disabled = false; }
});

$$('.jelszo-mutat').forEach(b => b.addEventListener('click', () => {
  const m = $('#' + b.dataset.cel);
  const latszik = m.type === 'password';
  m.type = latszik ? 'text' : 'password';
  b.setAttribute('aria-pressed', String(latszik));
  b.setAttribute('aria-label', latszik ? 'Jelszó elrejtése' : 'Jelszó megjelenítése');
}));

/* jelszócsere: első belépés, rendszergazdai kérés vagy visszaállító link */
function jelszocsereLap() {
  lapokElrejt();
  $('#jc-alcim').textContent = A.visszaallitas
    ? 'A levélben kapott linkről jöttél: itt adhatsz meg új jelszót.'
    : 'Biztonsági okból új jelszót kell megadnod: a közös kezdő jelszó nem használható tovább.';
  $('#jelszocsere-lap').hidden = false;
}

const JELSZO_SZABALY = /^(?=.*[a-záéíóöőúüű])(?=.*[A-ZÁÉÍÓÖŐÚÜŰ])(?=.*\d).{8,}$/;
const JELSZO_SZOVEG = 'Legalább 8 karakter, benne kisbetű, nagybetű és szám.';

$('#jc-kilep').addEventListener('click', () => sb.auth.signOut());
$('#jelszocsere-form').addEventListener('submit', async e => {
  e.preventDefault();
  const a = $('#jc-1').value, b = $('#jc-2').value;
  const hiba = $('#jc-hiba');
  hiba.hidden = true;
  if (a !== b) { hiba.textContent = 'A két jelszó nem egyezik.'; hiba.hidden = false; return; }
  if (!JELSZO_SZABALY.test(a)) { hiba.textContent = JELSZO_SZOVEG; hiba.hidden = false; return; }
  const gomb = $('#jelszocsere-form button[type=submit]');
  gomb.disabled = true;
  try {
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) throw error;
    ellenoriz(await sb.from('profiles').update({ jelszo_csere: false })
      .eq('id', A.user.id).select('id'));
    A.profil.jelszo_csere = false;
    A.visszaallitas = false;
    pirit('Az új jelszó elmentve.', 'siker');
    await appMegjelenit();
  } catch (err) { hiba.textContent = hibaSzoveg(err); hiba.hidden = false; }
  finally { gomb.disabled = false; }
});

/* ══════════════════════════════════════════════════ indulás ══ */
async function appIndit(user) {
  A.user = user;
  let profil;
  try {
    const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    profil = data;
  } catch (e) { belepesLap(hibaSzoveg(e)); return; }

  if (!profil) {
    sessionStorage.setItem('sokterem-uzenet',
      'Ehhez az e-mail-címhez még nincs terem-nyilvántartási jogosultság. Kérd a titkárságtól.');
    await sb.auth.signOut();
    return;
  }
  if (!profil.aktiv) {
    sessionStorage.setItem('sokterem-uzenet',
      'Ez a fiók jelenleg le van tiltva. Ha tévedésnek gondolod, keresd a titkárságot.');
    await sb.auth.signOut();
    return;
  }
  A.profil = profil;
  sb.from('profiles').update({ utolso_belepes: new Date().toISOString() }).eq('id', user.id)
    .then(() => {}, () => {});
  sb.rpc('belepes_naploz').then(() => {}, () => {});   // belépés a naplóba
  if (profil.jelszo_csere || A.visszaallitas) { jelszocsereLap(); return; }
  await appMegjelenit();
}

async function appMegjelenit() {
  $('#indulo-szoveg').textContent = 'Adatok betöltése…';
  $('#indulo-allapot').hidden = false;
  $('#belepes').hidden = true;
  $('#jelszocsere-lap').hidden = true;
  try {
    await adatokBetolt();
  } catch (e) {
    belepesLap(hibaSzoveg(e));
    return;
  }
  lapokElrejt();
  $('#app').hidden = false;
  $('#lablec-verzio').textContent = VERZIO;
  $('#felh-nev').textContent = A.profil.nev;
  menuEpit();
  lapNyit(location.hash.replace('#', '') || 'naptar');

  if (!appMegjelenit._idozitok) {
    appMegjelenit._idozitok = true;
    setInterval(hatterFrissites, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) hatterFrissites(); });
    setInterval(() => {
      if (Date.now() - A.utolsoTevekenyseg > TETLEN_MS) {
        sessionStorage.setItem('sokterem-tetlen', '1');
        sb.auth.signOut();
      }
    }, 60000);
  }
  if (sessionStorage.getItem('sokterem-tetlen')) {
    sessionStorage.removeItem('sokterem-tetlen');
    pirit('Tétlenség miatt korábban kiléptettünk, ezért kellett újra belépni.', '');
  }
}

const LAPOK = [
  ['naptar', 'Naptár', () => true],
  ['foglalasaim', 'Foglalásaim', () => true],
  ['eszkozok', 'Eszközök', () => true],
  ['termek', 'Termek', () => true],
  ['naplo', 'Napló', () => true],
  ['fiokok', 'Fiókok', admin],
];
const MENU_NELKULI_LAPOK = ['fiokom', 'javaslat', 'kapcsolat', 'sugo'];

function menuEpit() {
  $('#menu').innerHTML = LAPOK.filter(([, , joge]) => joge())
    .map(([k, n]) => `<button data-lap="${k}">${esc(n)}</button>`).join('');
  $$('#menu button').forEach(b => b.onclick = () => lapNyit(b.dataset.lap));
}

$('#felh-gomb').addEventListener('click', e => {
  e.stopPropagation();
  const m = $('#felh-menu');
  m.hidden = !m.hidden;
  $('#felh-gomb').setAttribute('aria-expanded', String(!m.hidden));
});
document.addEventListener('click', e => {
  const m = $('#felh-menu');
  if (m && !m.hidden && !e.target.closest('.fejlec-jobb')) m.hidden = true;
});
$$('#felh-menu button[data-lap]').forEach(b => b.onclick = () => {
  $('#felh-menu').hidden = true; lapNyit(b.dataset.lap);
});
$('#kilepes-gomb').addEventListener('click', () => sb.auth.signOut());

/* ══════════════════════════════════════════════════ adatok ══ */
async function adatokBetolt() {
  const kerdesek = [sb.from('rooms').select('*').order('sorrend').order('kod')];
  kerdesek.push(kezelo()
    ? sb.from('profiles').select('id,nev,beosztas,email,szerep,aktiv,jelszo_csere,utolso_belepes').order('nev')
    : Promise.resolve({ data: [], error: null }));
  const [termek, profilok] = await Promise.all(kerdesek);
  if (termek.error) throw termek.error;
  A.termek = termek.data || [];
  if (profilok.error) console.error('Profilok betöltése:', profilok.error);
  A.profilok = profilok.data || [];
  await Promise.all([foglalasokBetolt(), eszkozokBetolt()]);
  A.utolsoFrissites = new Date();
}

/* A betöltött időszak a MAI naphoz ÉS a megjelenített héthez is igazodik,
   hogy a Foglalásaim és a Termek lap se mutasson hamis nullát. */
function latoszog() {
  const ma = hetKezdet(new Date());
  // a megjelenített időszak (hónap nézetnél az egész hónap) mindig legyen betöltve
  let elso = hetKezdet(A.nap), utolso = napPlusz(hetKezdet(A.nap), 6);
  if (A.nezet === 'honap') {
    elso = honapRacsKezdet(A.nap);
    utolso = napPlusz(elso, 41);
  }
  const kezd = napPlusz(new Date(Math.min(ma, elso)), -14);
  const veg = napPlusz(new Date(Math.max(napPlusz(ma, 42), utolso)), 7);
  return [kezd, veg];
}

/* a hónap rácsának első napja: a hónap 1-jét tartalmazó hét hétfője */
function honapRacsKezdet(d) {
  return hetKezdet(new Date(d.getFullYear(), d.getMonth(), 1));
}

async function foglalasokBetolt(jel) {
  const [k, v] = latoszog();
  const { data, error } = await sb.from('bookings').select('*')
    .lt('kezdet', v.toISOString()).gt('veg', k.toISOString())
    .order('kezdet');
  if (error) throw error;
  // ha közben továbbléptek a naptárban, ez a válasz elavult: ne írjuk be
  if (jel !== undefined && jel !== A.betoltJel) return;
  A.foglalasok = (data || []).map(f => ({ ...f, _k: new Date(f.kezdet), _v: new Date(f.veg) }));
}

async function eszkozokBetolt() {
  const { data, error } = await sb.from('equipment').select('*').order('nev').order('leltarszam');
  if (error) throw error;
  A.eszkozok = data || [];
}

function foglalasLenyomat() {
  return A.foglalasok.map(f => `${f.id}:${f.modositva || f.letrehozva}:${f.allapot}`).join('|');
}
function eszkozLenyomat() {
  return A.eszkozok.map(e => `${e.id}:${e.modositva || e.letrehozva}`).join('|');
}

async function hatterFrissites() {
  if (modalisNyitva()) return;
  const fokusz = document.activeElement;
  const gepel = fokusz && fokusz.closest && fokusz.closest('#tartalom') &&
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(fokusz.tagName);
  try {
    const elotteF = foglalasLenyomat();
    let elotteE = null;
    await foglalasokBetolt();
    if (A.lap === 'eszkozok' && !gepel) { elotteE = eszkozLenyomat(); await eszkozokBetolt(); }
    A.utolsoFrissites = new Date();
    if (A.frissitesHiba) { A.frissitesHiba = false; }
    if (gepel) return;                                   // gépelés közben nem rajzolunk újra
    if (['naptar', 'foglalasaim', 'termek'].includes(A.lap)) {
      if (elotteF !== foglalasLenyomat()) lapKirajzol();
    } else if (A.lap === 'eszkozok' && elotteE !== null && elotteE !== eszkozLenyomat()) {
      // csak tényleges változásnál rajzolunk újra, hogy ne ugorjon el a görgetés
      const gorgetes = $('.tabla-tarto') ? $('.tabla-tarto').scrollTop : 0;
      lapKirajzol();
      const t = $('.tabla-tarto');
      if (t) t.scrollTop = gorgetes;
      pirit('Valaki módosított egy eszközadatot, frissítettem a listát.', '');
    }
  } catch (e) {
    if (!A.frissitesHiba) {
      A.frissitesHiba = true;
      pirit('Nem sikerült frissíteni az adatokat. Amit látsz, lehet, hogy nem a legfrissebb.', 'hiba');
    }
  }
}

/* ══════════════════════════════════════════════════ router ══ */
function lapNyit(lap) {
  const bejegyzes = LAPOK.find(([k]) => k === lap);
  if (bejegyzes && !bejegyzes[2]()) lap = 'naptar';       // jogosultság a címsorból se legyen megkerülhető
  if (!bejegyzes && !MENU_NELKULI_LAPOK.includes(lap)) lap = 'naptar';
  A.lap = lap;
  history.replaceState(null, '', '#' + lap);
  $$('#menu button').forEach(b => {
    const aktiv = b.dataset.lap === lap;
    b.classList.toggle('aktiv', aktiv);
    if (aktiv) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  lapKirajzol();
}

async function lapKirajzol() {
  const c = $('#tartalom');
  const jel = ++A.rajzJel;
  const idejemult = () => jel !== A.rajzJel;
  const gorgetes = $('.racs-tarto') ? $('.racs-tarto').scrollTop : null;
  if (gorgetes !== null) A.racsGorgetes = gorgetes;
  try {
    switch (A.lap) {
      case 'naptar':      c.innerHTML = naptarHtml(); naptarKotes(); break;
      case 'foglalasaim':
        if (!A.sajatFoglalasok) {
          c.innerHTML = '<div class="betolt"><span class="porgo"></span> Foglalásaim betöltése…</div>';
        }
        await sajatFoglalasokBetolt();
        if (idejemult()) return;
        c.innerHTML = foglalasaimHtml(); foglalasaimKotes(); break;
      case 'eszkozok':    c.innerHTML = eszkozokHtml(); eszkozokKotes(); break;
      case 'termek':      c.innerHTML = termekHtml(); termekKotes(); break;
      case 'fiokok':      c.innerHTML = fiokokHtml(); fiokokKotes(); break;
      case 'naplo': {
        c.innerHTML = '<div class="betolt"><span class="porgo"></span> Napló betöltése…</div>';
        const html = await naploHtml();
        if (idejemult()) return;
        c.innerHTML = html; naploKotes(); break;
      }
      case 'kapcsolat':   c.innerHTML = kapcsolatHtml(); break;
      case 'fiokom':      c.innerHTML = fiokomHtml(); fiokomKotes(); break;
      case 'javaslat': {
        c.innerHTML = '<div class="betolt"><span class="porgo"></span> Betöltés…</div>';
        const html = await javaslatHtml();
        if (idejemult()) return;
        c.innerHTML = html; javaslatKotes(); break;
      }
      case 'sugo':        c.innerHTML = sugoHtml(); break;
      default:            c.innerHTML = naptarHtml(); naptarKotes();
    }
  } catch (e) { hibaKi(e); }
}

/* ══════════════════════════════════════════════════ naptár ══ */
function lathatoTermek() { return A.termek.filter(t => t.aktiv && !A.rejtettTermek.has(t.id)); }
function teremSzin(id) { const t = A.termek.find(x => x.id === id); return szinBiztos(t && t.szin); }
function teremKod(id) { const t = A.termek.find(x => x.id === id); return t ? t.kod : '?'; }
function teremNev(id) { const t = A.termek.find(x => x.id === id); return t ? `${t.kod} · ${t.nev}` : 'törölt terem'; }

/* a megjelenített napok, nézet szerint */
function napokAMostaniNezetben() {
  if (A.nezet === 'nap') return [kezdoNap(A.nap)];
  if (A.nezet === 'honap') {
    const k = honapRacsKezdet(A.nap);
    return Array.from({ length: 42 }, (_, i) => napPlusz(k, i));
  }
  const k = hetKezdet(A.nap);
  return Array.from({ length: 7 }, (_, i) => napPlusz(k, i));
}

/* A rács idősávja a megjelenített foglalásokhoz igazodik, hogy egy kora reggeli
   vagy késő esti foglalás se csúszhasson ki a nézetből. */
function racsSav(napok) {
  let kezd = ALAP_KEZD, veg = ALAP_VEG;
  napok.forEach(d => {
    napiSzeletek(d).forEach(sz => {
      kezd = Math.min(kezd, Math.floor(sz.kezdPerc / 60) * 60);
      veg = Math.max(veg, Math.ceil(sz.vegPerc / 60) * 60);
    });
  });
  return { kezd: Math.max(0, kezd), veg: Math.min(24 * 60, Math.max(veg, kezd + 120)) };
}

/* egy napra eső szeletek: az éjfélen átnyúló foglalás minden érintett napon megjelenik */
function napiSzeletek(nap, teremId) {
  const napKezd = kezdoNap(nap), napVeg = napPlusz(napKezd, 1);
  const lathato = lathatoTermek();
  return A.foglalasok
    .filter(f => (teremId ? f.room_id === teremId : lathato.some(t => t.id === f.room_id)))
    .filter(f => f._k < napVeg && f._v > napKezd)
    .map(f => ({
      f,
      kezdPerc: f._k <= napKezd ? 0 : percbe(f._k),
      vegPerc: f._v >= napVeg ? 24 * 60 : percbe(f._v),
      folytatas: f._k < napKezd,
      folytatodik: f._v > napVeg,
    }))
    .sort((a, b) => a.kezdPerc - b.kezdPerc || a.vegPerc - b.vegPerc);
}

function naptarHtml() {
  const idoszak = A.nezet === 'nap'
    ? napCimke(A.nap)
    : A.nezet === 'honap'
    ? `${A.nap.getFullYear()}. ${HONAPOK[A.nap.getMonth()]}`
    : (() => {
        const k = hetKezdet(A.nap), v = napPlusz(k, 6);
        const azonosHo = k.getMonth() === v.getMonth();
        return `${k.getFullYear()}. ${HONAPOK[k.getMonth()]} ${k.getDate()}.` +
               ` – ${azonosHo ? '' : HONAPOK[v.getMonth()] + ' '}${v.getDate()}.`;
      })();
  const lepesNev = { nap: 'nap', honap: 'hónap' }[A.nezet] || 'hét';

  const csipek = A.termek.filter(t => t.aktiv).map(t => {
    const rejtett = A.rejtettTermek.has(t.id);
    return `<button class="csip ${rejtett ? 'halk' : 'aktiv'}" data-terem="${t.id}"
      style="color:${szinBiztos(t.szin)}" aria-pressed="${!rejtett}"
      title="${esc(t.nev)} — ${rejtett ? 'bekapcsolás' : 'kikapcsolás'} a nézetben">
      <span class="pont"></span>${esc(t.kod)}</button>`;
  }).join('');

  const rejtettDb = A.termek.filter(t => t.aktiv && A.rejtettTermek.has(t.id)).length;
  const szuroSav = rejtettDb ? `<div class="szuro-sav">
      Csak ${lathatoTermek().map(t => esc(t.kod)).join(', ') || '— egy terem sem —'} látszik.
      <button class="btn btn-kis" data-mindet>Mutasd mind</button></div>` : '';

  return `
  <div class="eszkoztar">
    <div class="lepteto">
      <button data-lep="-1" aria-label="Előző ${lepesNev}">◀</button>
      <span class="idoszak">${esc(idoszak)}</span>
      <button data-lep="1" aria-label="Következő ${lepesNev}">▶</button>
    </div>
    <button class="btn" data-ma>Ma</button>
    <input type="date" id="datum-valaszto" value="${ymd(A.nap)}"
      aria-label="Ugrás dátumra" style="width:auto">
    <div class="valto" role="group" aria-label="Nézet">
      ${['honap', 'het', 'nap', 'lista'].map(n => `<button data-nezet="${n}" class="${A.nezet === n ? 'aktiv' : ''}"
        aria-pressed="${A.nezet === n}">${{ honap: 'Hónap', het: 'Hét', nap: 'Nap', lista: 'Lista' }[n]}</button>`).join('')}
    </div>
    ${sugoJel('Hónap: az egész hónap egy lapon, napi felsorolással — ehhez jó, ha valaki hetekre előre tervez. Hét: a napok oszlopokban, a termek színnel jelölve. Nap: egy nap, a termek külön oszlopban. Lista: felsorolás keresővel, telefonon ez a legkényelmesebb.')}
    <div class="csipek" role="group" aria-label="Termek szűrése">${csipek}</div>
    ${sugoJel('A színes gombokkal ki- és bekapcsolhatod, melyik terem látszik a naptárban. Ez csak a megjelenítést szűri, foglalást nem töröl.')}
    ${A.nezet === 'lista' ? `<input type="search" id="fogl-kereso" placeholder="Keresés a foglalásokban…"
      aria-label="Keresés a foglalásokban" value="${esc(A.kereso)}"
      style="width:auto; flex:1 1 180px; max-width:260px">` : ''}
    <span class="tolto"></span>
    <button class="btn" data-ics
      title="A megjelenített időszak letöltése naptárfájlként">Naptárfájl (.ics)</button>
    <button class="btn csak-nagy" data-nyomtat>Nyomtatás</button>
    <button class="btn btn-fo" data-uj>+ Új foglalás</button>
  </div>
  ${szuroSav}
  <div class="nyomtatas-fej"><strong>Oktatótermek — ${esc(idoszak)}</strong>
    <span>${lathatoTermek().map(t => `${esc(t.kod)} (${esc(t.nev)})`).join(' · ')}
      · Sürgősségi Orvostani Klinika · nyomtatva: ${new Date().toLocaleString('hu-HU')}</span></div>
  ${A.nezet === 'het' ? hetiRacsHtml() : A.nezet === 'nap' ? napiRacsHtml()
    : A.nezet === 'honap' ? honapRacsHtml() : listaHtml()}
  <p class="sugoszoveg">${A.nezet === 'lista' || A.nezet === 'honap'
    ? 'Egy foglalásra koppintva látod a részleteket, egy napra koppintva a napi beosztást. A sajátjaidat a „Foglalásaim” lapon együtt találod.'
    : 'Kattints egy szabad sávra új foglaláshoz, vagy egy meglévő foglalásra a részletekhez. A saját foglalásaidat arany bal szegély jelöli.'}
    ${A.utolsoFrissites ? ` Utolsó frissítés: ${hm(A.utolsoFrissites)}.` : ''}</p>`;
}

/* ─── heti rács: oszlop = nap, benne a termek színes blokkjai */
function hetiRacsHtml() {
  const napok = napokAMostaniNezetben();
  const sav = racsSav(napok);
  const magas = (sav.veg - sav.kezd) / 60 * ORA_PX;

  let fej = `<div class="ido-sav sarok"></div>`;
  napok.forEach(d => {
    const u = unnepNev(d), hetvege = d.getDay() === 0 || d.getDay() === 6;
    fej += `<div class="racs-fej ${maE(d) ? 'ma' : ''} ${u ? 'unnep' : hetvege ? 'hetvege' : ''}">
      ${NAPROVID[(d.getDay() + 6) % 7]}<span class="nap-szam">${d.getDate()}</span>
      ${u ? `<span class="unnep-nev" title="${esc(u)}">${esc(u)}</span>` : ''}</div>`;
  });

  const oszlopok = napok.map(d => {
    const hetvege = d.getDay() === 0 || d.getDay() === 6;
    return `<div class="nap-oszlop kattinthato ${hetvege ? 'hetvege' : ''} ${maE(d) ? 'ma' : ''}"
      data-nap="${ymd(d)}" style="height:${magas}px">${mostVonal(d, sav)}${
      esemenyekHtml(napiSzeletek(d), d, sav, true)}</div>`;
  }).join('');

  return `<div class="racs-tarto"><div class="racs"
      style="--ora:${ORA_PX}px; grid-template-columns:52px repeat(7,minmax(88px,1fr));
             grid-template-rows:auto ${magas}px">
    ${fej}
    <div class="ido-tengely" style="grid-row:2">${idoTengely(sav)}</div>
    ${oszlopok}
  </div></div>`;
}

/* ─── napi rács: oszlop = terem */
function napiRacsHtml() {
  const termek = lathatoTermek();
  if (!termek.length) {
    return `<div class="kartya ures">Egy terem sincs bekapcsolva a nézetben.
      Kapcsolj be legalább egyet a fenti szűrőgombokkal.</div>`;
  }
  const nap = kezdoNap(A.nap);
  const sav = racsSav([nap]);
  const magas = (sav.veg - sav.kezd) / 60 * ORA_PX;

  let fej = `<div class="ido-sav sarok"></div>`;
  termek.forEach(t => {
    fej += `<div class="terem-fej" style="border-bottom:3px solid ${szinBiztos(t.szin)}">
      <span class="kod">${esc(t.kod)}</span>
      <span class="hely">${esc(t.nev)}${t.ferohely ? ` · ${t.ferohely} fő` : ''}</span></div>`;
  });

  const oszlopok = termek.map(t => `<div class="nap-oszlop kattinthato"
      data-nap="${ymd(nap)}" data-terem="${t.id}" style="height:${magas}px">${
      mostVonal(nap, sav)}${esemenyekHtml(napiSzeletek(nap, t.id), nap, sav, false)}</div>`).join('');

  return `<div class="racs-tarto"><div class="racs"
      style="--ora:${ORA_PX}px; grid-template-columns:52px repeat(${termek.length},minmax(120px,1fr));
             grid-template-rows:auto ${magas}px">
    ${fej}
    <div class="ido-tengely" style="grid-row:2">${idoTengely(sav)}</div>
    ${oszlopok}
  </div></div>`;
}

function idoTengely(sav) {
  let ki = '';
  for (let p = sav.kezd; p < sav.veg; p += 60) {
    ki += `<div class="ido-sav" style="height:${ORA_PX}px">${napOra(p)}</div>`;
  }
  return ki;
}

/* piros vonal a mostani időnél (csak a mai napon, a rács idősávján belül) */
function mostVonal(d, sav) {
  if (!maE(d)) return '';
  const most = new Date();
  const p = percbe(most);
  if (p < sav.kezd || p > sav.veg) return '';
  return `<div class="most-vonal" style="top:${(p - sav.kezd) / 60 * ORA_PX}px"><span>${hm(most)}</span></div>`;
}

/* Átfedési fürtök: a szélességet csak az egymást tényleg átfedő foglalások
   száma szabja meg, nem az egész nap legzsúfoltabb pillanata. */
function savokba(szeletek) {
  let furt = [], furtVeg = -1;
  const eredmeny = [];
  const furtZar = () => {
    const db = Math.max(1, Math.max(...furt.map(x => x.sav + 1)));
    furt.forEach(x => { x.savDb = db; eredmeny.push(x); });
    furt = []; furtVeg = -1;
  };
  szeletek.forEach(sz => {
    if (furt.length && sz.kezdPerc >= furtVeg) furtZar();
    const hasznalt = new Set(furt.filter(x => x.vegPerc > sz.kezdPerc).map(x => x.sav));
    let s = 0; while (hasznalt.has(s)) s++;
    sz.sav = s;
    furt.push(sz);
    furtVeg = Math.max(furtVeg, sz.vegPerc);
  });
  if (furt.length) furtZar();
  return eredmeny;
}

function esemenyekHtml(szeletek, nap, sav, teremJeloles) {
  return savokba(szeletek).map(sz => {
    const f = sz.f;
    const kp = Math.max(sav.kezd, sz.kezdPerc);
    const vp = Math.min(sav.veg, sz.vegPerc);
    const top = (kp - sav.kezd) / 60 * ORA_PX;
    const mag = Math.max(16, (vp - kp) / 60 * ORA_PX - 2);
    const szel = 100 / sz.savDb;
    const hatter = teremJeloles ? teremSzin(f.room_id) : (TIPUSOK[f.tipus] || TIPUSOK.egyeb).szin;
    const enyem = f.szerzo_id === A.user.id;
    const cimke = `${napCimke(nap)} ${idoSzoveg(f._k, f._v)}, ${f.cim}, ${teremNev(f.room_id)}` +
      (f.oktato ? `, tartja: ${f.oktato}` : '') + (enyem ? ', a saját foglalásod' : '') +
      (f.allapot === 'lemondva' ? ', lemondva' : '');
    return `<button class="esemeny ${f.allapot === 'lemondva' ? 'lemondva' : ''} ${enyem ? 'enyem' : ''}
      ${sz.savDb >= 3 ? 'szuk' : ''} ${mag < 36 ? 'alacsony' : ''}"
      data-foglalas="${f.id}" aria-label="${esc(cimke)}"
      style="top:${top}px; height:${mag}px; left:calc(${sz.sav * szel}% + 2px);
             width:calc(${szel}% - 4px); background:${hatter}; color:${szovegSzin(hatter)}">
      <span class="e-ido">${sz.folytatas ? '↳ ' : ''}${idoSzoveg(f._k, f._v)}${sz.folytatodik ? ' →' : ''}</span>
      <span class="e-cim">${esc(f.cim)}</span>
      <span class="e-alsor">${teremJeloles ? esc(teremKod(f.room_id)) : esc((TIPUSOK[f.tipus] || {}).nev || '')}${
        f.oktato ? ' · ' + esc(f.oktato) : ''}</span>
    </button>`;
  }).join('');
}

/* ─── hónap nézet: az egész hónap egy lapon, napi felsorolással */
function honapRacsHtml() {
  if (!lathatoTermek().length) {
    return `<div class="kartya ures">Egy terem sincs bekapcsolva a nézetben.
      Kapcsolj be legalább egyet a fenti szűrőgombokkal.</div>`;
  }
  const napok = napokAMostaniNezetben();
  const honap = A.nap.getMonth();
  const fej = NAPROVID.map(n => `<div class="honap-fej">${n}</div>`).join('');

  const cellak = napok.map(d => {
    const napKezd = kezdoNap(d), napVeg = napPlusz(napKezd, 1);
    const lista = A.foglalasok
      .filter(f => lathatoTermek().some(t => t.id === f.room_id))
      .filter(f => f._k < napVeg && f._v > napKezd)
      .sort((a, b) => a._k - b._k);
    const u = unnepNev(d);
    const masHonap = d.getMonth() !== honap;
    const hetvege = d.getDay() === 0 || d.getDay() === 6;
    const mutat = lista.slice(0, 3);
    return `<div class="honap-cella ${masHonap ? 'mas-honap' : ''} ${hetvege ? 'hetvege' : ''}
        ${maE(d) ? 'ma' : ''}" data-honap-nap="${ymd(d)}">
      <div class="honap-nap-fej">
        <span class="honap-nap-szam ${u ? 'unnep' : ''}">${d.getDate()}</span>
        ${u ? `<span class="honap-unnep" title="${esc(u)}">${esc(u)}</span>` : ''}
        ${lista.length ? `<span class="honap-db">${lista.length}</span>` : ''}
      </div>
      ${mutat.map(f => {
        const szin = teremSzin(f.room_id);
        const enyem = f.szerzo_id === A.user.id;
        return `<button class="honap-esemeny ${f.allapot === 'lemondva' ? 'lemondva' : ''}"
          data-foglalas="${f.id}" style="border-left-color:${enyem ? 'var(--arany-sotet)' : szin}"
          aria-label="${esc(`${napCimke(d)} ${idoSzoveg(f._k, f._v)}, ${f.cim}, ${teremNev(f.room_id)}`)}">
          <span class="honap-ido">${hm(f._k)}</span>
          <span class="honap-cim">${esc(f.cim)}</span>
          <span class="honap-terem" style="color:${szin}">${esc(teremKod(f.room_id))}</span>
        </button>`;
      }).join('')}
      ${lista.length > 3 ? `<button class="honap-tovabb" data-honap-nap-nyit="${ymd(d)}">
        + még ${lista.length - 3}</button>` : ''}
    </div>`;
  }).join('');

  return `<div class="honap-racs">${fej}${cellak}</div>`;
}

/* ─── lista / agenda nézet */
function listaHtml() {
  const napok = A.nezet === 'nap' ? [kezdoNap(A.nap)] : napokAMostaniNezetben();
  const k = napok[0], v = napPlusz(napok[napok.length - 1], 1);
  const keres = normal(A.kereso.trim());

  if (!lathatoTermek().length) {
    return `<div class="kartya ures">Egy terem sincs bekapcsolva a nézetben.
      Kapcsolj be legalább egyet a fenti szűrőgombokkal.</div>`;
  }
  if (keres) {
    const talalat = A.foglalasok
      .filter(f => lathatoTermek().some(t => t.id === f.room_id))
      .filter(f => normal([f.cim, f.oktato, f.szerzo_nev, f.leiras, f.eszkozigeny,
        teremNev(f.room_id), (TIPUSOK[f.tipus] || {}).nev].filter(Boolean).join(' ')).includes(keres))
      .sort((a, b) => a._k - b._k);
    if (!talalat.length) {
      return `<div class="kartya ures">Nincs találat a betöltött időszakban
        (kb. két hét visszamenőleg és hat hét előre).</div>`;
    }
    return `<p class="sugoszoveg">${talalat.length} találat a betöltött időszakban.</p>
      <div class="agenda">${talalat.map(f =>
        `<div class="agenda-nap"><div class="agenda-nap-fej">${esc(napCimke(f._k))}</div>${agendaSor(f)}</div>`
      ).join('')}</div>`;
  }

  const lista = A.foglalasok.filter(f => f._v > k && f._k < v &&
    lathatoTermek().some(t => t.id === f.room_id));
  if (!lista.length) {
    return `<div class="kartya ures">Ebben az időszakban nincs foglalás.
      A „+ Új foglalás” gombbal tudsz felvenni egyet.</div>`;
  }
  const csoport = {};
  napok.forEach(d => { csoport[ymd(d)] = []; });
  lista.forEach(f => {
    napok.forEach(d => {
      const napKezd = kezdoNap(d), napVeg = napPlusz(napKezd, 1);
      if (f._k < napVeg && f._v > napKezd) csoport[ymd(d)].push(f);
    });
  });
  return `<div class="agenda">` + napok.map(d => {
    const sorok = csoport[ymd(d)];
    if (!sorok.length) return '';
    const u = unnepNev(d);
    return `<div class="agenda-nap">
      <div class="agenda-nap-fej">${esc(napCimke(d))}${u ? ` · <span class="unnep-cimke">${esc(u)}</span>` : ''}</div>
      ${sorok.sort((a, b) => a._k - b._k).map(f => agendaSor(f)).join('')}
    </div>`;
  }).join('') + `</div>`;
}

function agendaSor(f) {
  const enyem = f.szerzo_id === A.user.id;
  return `<button class="agenda-sor ${f.allapot === 'lemondva' ? 'lemondva' : ''} ${enyem ? 'enyem' : ''}"
    data-foglalas="${f.id}" style="border-left-color:${enyem ? 'var(--arany-sotet)' : teremSzin(f.room_id)}">
    <span class="agenda-ido">${idoSzoveg(f._k, f._v)}</span>
    <span class="agenda-fo">
      <span class="agenda-cim">${esc(f.cim)}</span>
      <span class="agenda-meta">${esc(teremNev(f.room_id))} · ${esc((TIPUSOK[f.tipus] || {}).nev || '')}${
        f.oktato ? ' · tartja: ' + esc(f.oktato) : ''}${f.letszam != null ? ' · ' + f.letszam + ' fő' : ''}</span>
    </span>
    <span class="agenda-jel">
      ${f.allapot === 'lemondva' ? '<span class="jelzo jelzo-piros">lemondva</span>' : ''}
      ${enyem ? '<span class="jelzo jelzo-arany">saját</span>'
              : `<span class="jelzo jelzo-szurke">foglalta: ${esc(f.szerzo_nev)}</span>`}
    </span>
  </button>`;
}

/* a naptár léptetése: versenyhelyzet-mentes, azonnal rajzol a meglévő adatból */
async function napraLep(ujNap) {
  const jel = ++A.betoltJel;
  A.nap = ujNap;
  lapKirajzol();                                   // azonnali visszajelzés a már betöltött adatból
  try {
    await foglalasokBetolt(jel);
    if (jel !== A.betoltJel) return;               // közben továbbléptek, ez a válasz elavult
    A.utolsoFrissites = new Date();
    lapKirajzol();
  } catch (e) { hibaKi(e); }
}

function naptarKotes() {
  const tart = $('#tartalom');
  $$('[data-lep]', tart).forEach(b => b.onclick = () => {
    const irany = Number(b.dataset.lep);
    if (A.nezet === 'honap') {
      const d = new Date(A.nap.getFullYear(), A.nap.getMonth() + irany, 1);
      napraLep(kezdoNap(d));
    } else {
      napraLep(napPlusz(A.nap, irany * (A.nezet === 'nap' ? 1 : 7)));
    }
  });
  $('[data-ma]', tart).onclick = () => napraLep(kezdoNap(new Date()));
  $('#datum-valaszto', tart).onchange = e => {
    if (!e.target.value) return;
    const d = new Date(e.target.value + 'T00:00:00');
    if (!isNaN(d)) napraLep(kezdoNap(d));
  };
  $$('[data-nezet]', tart).forEach(b => b.onclick = () => {
    A.nezet = b.dataset.nezet; A.racsElsoRajz = true; lapKirajzol();
  });
  $$('.csip[data-terem]', tart).forEach(b => b.onclick = () => {
    const id = Number(b.dataset.terem);
    if (A.rejtettTermek.has(id)) A.rejtettTermek.delete(id); else A.rejtettTermek.add(id);
    lapKirajzol();
  });
  const mindet = $('[data-mindet]', tart);
  if (mindet) mindet.onclick = () => { A.rejtettTermek.clear(); lapKirajzol(); };
  $('[data-uj]', tart).onclick = () => foglalasModalis(null, {});
  $('[data-ics]', tart).onclick = () => icsLetolt();
  $('[data-nyomtat]', tart).onclick = () => window.print();

  const kereso = $('#fogl-kereso', tart);
  if (kereso) {
    let ido;
    kereso.oninput = e => {
      clearTimeout(ido);
      const ertek = e.target.value, poz = e.target.selectionStart;
      ido = setTimeout(() => {
        A.kereso = ertek;
        lapKirajzol();
        const uj = $('#fogl-kereso');
        if (uj) { uj.focus(); uj.setSelectionRange(poz, poz); }
      }, 350);
    };
  }
  esemenyKotes();

  // görgetés: első rajzoláskor a mostani időre, később ahol a felhasználó volt
  const racs = $('.racs-tarto', tart);
  if (racs) {
    if (A.racsElsoRajz) {
      A.racsElsoRajz = false;
      const sav = racsSav(napokAMostaniNezetben());
      const p = percbe(new Date());
      if (p > sav.kezd + 60) racs.scrollTop = (p - sav.kezd - 60) / 60 * ORA_PX;
    } else if (A.racsGorgetes) {
      racs.scrollTop = A.racsGorgetes;
    }
  }

  // hónap nézet: napra kattintva a napi beosztás nyílik meg
  $$('[data-honap-nap-nyit]', tart).forEach(b => b.onclick = e => {
    e.stopPropagation();
    A.nap = new Date(b.dataset.honapNapNyit + 'T00:00:00');
    A.nezet = 'nap'; A.racsElsoRajz = true;
    lapKirajzol();
  });
  $$('[data-honap-nap]', tart).forEach(c => c.addEventListener('click', e => {
    if (e.target.closest('.honap-esemeny') || e.target.closest('.honap-tovabb')) return;
    A.nap = new Date(c.dataset.honapNap + 'T00:00:00');
    A.nezet = 'nap'; A.racsElsoRajz = true;
    lapKirajzol();
  }));

  if (A.nezet === 'honap') return;

  // kattintás szabad sávra → új foglalás azzal az idővel
  const sav = racsSav(napokAMostaniNezetben());
  $$('.nap-oszlop.kattinthato', tart).forEach(o => o.addEventListener('click', e => {
    if (e.target.closest('.esemeny')) return;
    const r = o.getBoundingClientRect();
    const perc = Math.max(0, Math.min(23 * 60 + 30,
      sav.kezd + Math.floor((e.clientY - r.top) / ORA_PX * 2) * 30));
    const d = new Date(o.dataset.nap + 'T00:00:00');
    foglalasModalis(null, {
      datum: ymd(d),
      kezdet: napOra(perc),
      room_id: o.dataset.terem ? Number(o.dataset.terem) : undefined,
    });
  }));
}

function esemenyKotes() {
  $$('[data-foglalas]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const id = Number(b.dataset.foglalas);
    const f = A.foglalasok.find(x => x.id === id) ||
      (A.sajatFoglalasok || []).find(x => x.id === id);
    if (f) foglalasAdatlap(f);
    else pirit('Ez a foglalás közben megszűnt.', 'hiba');
  });
}

/* ─── Foglalásaim lap (a saját foglalásokat a teljes időszakra betöltjük) */
async function sajatFoglalasokBetolt() {
  const [enyem, nekem] = await Promise.all([
    sb.from('bookings').select('*').eq('szerzo_id', A.user.id)
      .order('kezdet', { ascending: false }).limit(400),
    sb.from('bookings').select('*').not('oktato', 'is', null)
      .gte('veg', new Date().toISOString()).order('kezdet').limit(400),
  ]);
  if (enyem.error) throw enyem.error;
  if (nekem.error) throw nekem.error;
  const alak = f => ({ ...f, _k: new Date(f.kezdet), _v: new Date(f.veg) });
  const lista = (enyem.data || []).map(alak);
  const megvan = new Set(lista.map(f => f.id));
  (nekem.data || []).forEach(f => {
    if (!megvan.has(f.id) && f.oktato && ugyanazAzEmber(f.oktato, A.profil.nev)) lista.push(alak(f));
  });
  A.sajatFoglalasok = lista;
}

function foglalasaimHtml() {
  const most = new Date();
  const forras = A.sajatFoglalasok || A.foglalasok;
  const sajat = forras.filter(f => f.szerzo_id === A.user.id);
  const nekem = forras.filter(f => f.szerzo_id !== A.user.id && f.oktato &&
    ugyanazAzEmber(f.oktato, A.profil.nev));
  const jovo = sajat.filter(f => f._v >= most).sort((a, b) => a._k - b._k);
  const regi = sajat.filter(f => f._v < most).sort((a, b) => b._k - a._k).slice(0, 30);
  const nekemJovo = nekem.filter(f => f._v >= most).sort((a, b) => a._k - b._k);

  const blokk = (lista, cim, uresSzoveg) => `
    <div class="kartya"><div class="kartya-fej"><h2>${cim}</h2></div>
      ${lista.length ? `<div class="agenda">${lista.map(agendaSor).join('')}</div>`
                     : `<p class="halk">${uresSzoveg}</p>`}</div>`;

  return `
    <div class="eszkoztar">
      <span class="tolto"></span>
      <button class="btn btn-fo" data-uj>+ Új foglalás</button>
    </div>
    ${blokk(jovo, 'Közelgő foglalásaim',
      'Most nincs közelgő foglalásod. A „+ Új foglalás” gombbal tudsz felvenni egyet.')}
    ${nekemJovo.length ? blokk(nekemJovo, 'Amit nekem foglaltak', '') : ''}
    ${blokk(regi, 'Korábbi foglalásaim', 'Még nincs korábbi foglalásod.')}
    <p class="sugoszoveg">Itt <strong>minden</strong> foglalásod látszik, nem csak a naptárban éppen
      megjelenített időszak — a korábbiak közül a legutóbbi harminc. Az „Amit nekem foglaltak” rész
      azokat mutatja, ahol a „Ki tartja” mezőben a te neved szerepel (a „Dr.” előtag és a névsorrend
      nem számít).</p>`;
}

function foglalasaimKotes() {
  $('[data-uj]').onclick = () => foglalasModalis(null, {});
  esemenyKotes();
}

/* ══════════════════════════════════════════ foglalás modális ══ */
function foglalasModalis(f, elo) {
  const uj = !f;
  const termek = A.termek.filter(t => t.aktiv || (f && f.room_id === t.id));
  if (!termek.length) { pirit('Nincs felvett terem. A Termek lapon lehet hozzáadni.', 'hiba'); return; }
  const d = f ? f._k : (elo.datum ? new Date(elo.datum + 'T00:00:00') : kezdoNap(A.nap));
  const kezdIdo = f ? hm(f._k) : (elo.kezdet || '08:00');
  const vegIdo = f ? hm(f._v) : idoPlusz(elo.kezdet || '08:00', 90);
  const roomId = f ? f.room_id : (elo.room_id || (lathatoTermek()[0] || termek[0]).id);

  const torzs = `
    ${uj ? `<div class="gyors-sor">
      <span class="gyors-cimke">Gyors időpont:</span>
      <button type="button" class="btn btn-kis" data-gyors="ma">ma</button>
      <button type="button" class="btn btn-kis" data-gyors="holnap8">holnap 8:00</button>
      <button type="button" class="btn btn-kis" data-gyors="holnap13">holnap 13:00</button>
    </div>` : ''}
    <label for="fm-cim">Mi lesz a teremben? <abbr title="kötelező" class="kell">*</abbr></label>
    <input id="fm-cim" maxlength="200" required value="${esc(f ? f.cim : '')}"
      placeholder="pl. Sürgősségi ellátás gyakorlat — IV. évf.">
    <div class="mezo-sor">
      <div><label for="fm-terem">Terem <abbr title="kötelező" class="kell">*</abbr></label>
        <select id="fm-terem">${termek.map(t =>
          `<option value="${t.id}" ${t.id === roomId ? 'selected' : ''}>${esc(t.kod)} · ${esc(t.nev)}${
            t.ferohely ? ` (${t.ferohely} fő)` : ''}</option>`).join('')}</select></div>
      <div><label for="fm-tipus">Típus ${sugoJel('Csak jelölés, hogy egy pillantással látszódjon, mi történik a teremben. A napi nézetben a blokk színe ezt követi.')}</label>
        <select id="fm-tipus">${Object.entries(TIPUSOK).map(([k, v]) =>
          `<option value="${k}" ${f && f.tipus === k ? 'selected' : ''}>${esc(v.nev)}</option>`).join('')}</select></div>
    </div>
    <p class="terem-allapot" id="fm-szabadsag"></p>
    <p class="sugoszoveg" style="margin-top:.2rem">A jelzés a beírt dátumra és időre vonatkozik, és
      minden változtatásnál frissül. ${sugoJel('A „foglalt” azt jelenti, hogy abban a teremben abban az idősávban már van élő foglalás. Ilyenkor a mentés nem megy át — válassz másik termet vagy időt.')}</p>
    <div class="mezo-sor">
      <div><label for="fm-datum">Dátum <abbr title="kötelező" class="kell">*</abbr></label>
        <input type="date" id="fm-datum" value="${ymd(d)}"></div>
      <div><label for="fm-kezd">Kezdés <abbr title="kötelező" class="kell">*</abbr></label>
        <input type="time" id="fm-kezd" step="900" value="${kezdIdo}"></div>
      <div><label for="fm-veg">Befejezés <abbr title="kötelező" class="kell">*</abbr></label>
        <input type="time" id="fm-veg" step="900" value="${vegIdo}"></div>
    </div>
    <div class="mezo-sor">
      <div><label for="fm-oktato">Ki tartja ${sugoJel('Az oktató neve — lehet más is, mint aki foglal. Ha valaki más nevét írod be, annál a kollégánál megjelenik a Foglalásaim lapon, az „Amit nekem foglaltak” részben.')}</label>
        <input id="fm-oktato" maxlength="120" list="fm-oktato-lista"
          value="${esc(f ? (f.oktato || '') : (kezelo() ? '' : A.profil.nev))}"
          placeholder="${kezelo() ? 'kinek foglalod' : ''}">
        <datalist id="fm-oktato-lista">${
          (A.profilok.length ? A.profilok : [A.profil]).filter(p => p.aktiv !== false)
            .map(p => `<option value="${esc(p.nev)}"></option>`).join('')}</datalist></div>
      <div><label for="fm-letszam">Létszám</label>
        <input type="number" id="fm-letszam" min="0" max="500" value="${f && f.letszam != null ? f.letszam : ''}"></div>
    </div>
    <label for="fm-leiras">Megjegyzés</label>
    <textarea id="fm-leiras" maxlength="2000" placeholder="Amit a titkárságnak vagy a kollégáknak tudni érdemes.">${esc(f ? (f.leiras || '') : '')}</textarea>
    <label for="fm-eszkoz">Eszközigény ${sugoJel('Szabad szöveg annak, aki előkészíti a termet: mit kell odakészíteni. Az Eszközök lap nyilvántartásából nem foglal le semmit.')}</label>
    <input id="fm-eszkoz" maxlength="500" value="${esc(f ? (f.eszkozigeny || '') : '')}"
      placeholder="pl. 2 db Little Anne, projektor, videolaringoszkóp">
    ${uj ? `
      <div class="mezo-sor">
        <div><label for="fm-ismet">Ismétlés ${sugoJel('Minden alkalom önálló foglalás lesz, tehát egyet-egyet külön is módosíthatsz vagy törölhetsz. A már foglalt időket kihagyja, és a végén felsorolja, mi maradt ki. Az ünnepnapokat nem hagyja ki.')}</label><select id="fm-ismet">
          <option value="0">nem ismétlődik</option>
          <option value="1">minden héten</option>
          <option value="2">kéthetente</option>
          <option value="7">munkanapokon (hétfő–péntek)</option>
        </select></div>
        <div><label for="fm-alkalom">Alkalmak száma</label>
          <input type="number" id="fm-alkalom" min="1" max="40" value="1"></div>
      </div>
      <p class="sugoszoveg">Ismétlődő foglalásnál minden alkalom külön foglalás lesz, tehát egyet-egyet
        külön is módosíthatsz vagy törölhetsz. A már foglalt időket kihagyja és felsorolja.
        A munkaszüneti napokat nem hagyja ki — azokat utólag töröld.</p>` : ''}
    ${f ? `<p class="sugoszoveg">Foglalta: ${esc(f.szerzo_nev)} · ${new Date(f.letrehozva).toLocaleString('hu-HU')}${
      f.modositva ? ` · módosította: ${esc(f.modositotta || '')} ${new Date(f.modositva).toLocaleString('hu-HU')}` : ''}</p>` : ''}
    <p class="modalis-figyelmeztet" id="fm-figyelmeztet" hidden></p>
    <p class="modalis-hiba" id="fm-utkozes" hidden></p>
    <p class="modalis-hiba" id="fm-hiba" hidden></p>`;

  const lab = `
    ${uj ? `<span class="balra halk apro">Foglalja: ${esc(A.profil.nev)}</span>` : ''}
    ${f ? `<button class="btn btn-veszes balra" data-torol>Foglalás törlése</button>` : ''}
    ${f && f.allapot === 'elfogadva' ? `<button class="btn" data-lemond>Lemondás</button>` : ''}
    ${f && f.allapot === 'lemondva' ? `<button class="btn" data-visszaall>Visszaállítás</button>` : ''}
    <button class="btn" data-megse>Mégse</button>
    <button class="btn btn-fo" data-ment>${uj ? 'Foglalás mentése' : 'Módosítás mentése'}</button>`;

  const h = modalis({ cim: uj ? 'Új foglalás' : 'Foglalás módosítása', torzs, lab, zarKerdes: true });
  const hiba = m => {
    if (!document.body.contains(h)) { pirit(m, 'hiba'); return; }
    const e = $('#fm-hiba', h);
    e.textContent = m; e.hidden = false;
    e.scrollIntoView({ block: 'nearest' });
  };

  /* ── szabad/foglalt visszajelzés élőben, mentés előtt */
  function allapotNez() {
    const datum = $('#fm-datum', h).value, kezd = $('#fm-kezd', h).value, veg = $('#fm-veg', h).value;
    const jelzo = $('#fm-utkozes', h), fig = $('#fm-figyelmeztet', h), szab = $('#fm-szabadsag', h);
    jelzo.hidden = true; fig.hidden = true; szab.innerHTML = '';
    if (!datum || !kezd || !veg || percKulonbseg(kezd, veg) <= 0) return;
    const k = idopont(datum, kezd), v = idopont(datum, veg);

    // óraátállítás: a beírt idő nem is létezik azon a napon
    if (hm(k) !== kezd || hm(v) !== veg) {
      fig.textContent = 'Ezen a napon ez az időpont az óraátállítás miatt nem létezik. Válassz másik időt.';
      fig.hidden = false;
    } else if (v < new Date()) {
      fig.textContent = 'Ez az időpont már elmúlt. Felvehető (utólagos rögzítéshez), csak szólok.';
      fig.hidden = false;
    }

    const utkozik = t => A.foglalasok.filter(x => x.room_id === t.id && x.allapot === 'elfogadva' &&
      (!f || x.id !== f.id) && x._k < v && x._v > k);
    szab.innerHTML = termek.map(t => {
      const u = utkozik(t);
      return `<span class="terem-jel ${u.length ? 'foglalt' : 'szabad'}"
        title="${u.length ? esc(u.map(x => `${idoSzoveg(x._k, x._v)} ${x.cim}`).join(', ')) : 'szabad ebben az idősávban'}">
        ${esc(t.kod)}: ${u.length ? 'foglalt' : 'szabad'}</span>`;
    }).join('');

    const sajatTerem = termek.find(t => t.id === Number($('#fm-terem', h).value));
    const u = sajatTerem ? utkozik(sajatTerem) : [];
    if (u.length) {
      jelzo.innerHTML = 'Ütközés: ebben a teremben már van foglalás ekkor — ' +
        u.slice(0, 3).map(x => `<strong>${idoSzoveg(x._k, x._v)} ${esc(x.cim)}</strong> (${esc(x.szerzo_nev)})`).join(', ') +
        '. Így nem lehet elmenteni.';
      jelzo.hidden = false;
    }
  }

  let elozoKezd = $('#fm-kezd', h).value;
  $('#fm-kezd', h).onchange = () => {
    const hossz = percKulonbseg(elozoKezd, $('#fm-veg', h).value);
    if (hossz > 0) $('#fm-veg', h).value = idoPlusz($('#fm-kezd', h).value, hossz);
    elozoKezd = $('#fm-kezd', h).value;
    allapotNez();
  };
  ['#fm-terem', '#fm-datum', '#fm-veg'].forEach(s => { $(s, h).onchange = allapotNez; });
  allapotNez();

  if (uj) {
    $$('[data-gyors]', h).forEach(b => b.onclick = () => {
      const most = new Date();
      if (b.dataset.gyors === 'ma') {
        const p = Math.min(22 * 60, Math.ceil((percbe(most) + 5) / 15) * 15);
        $('#fm-datum', h).value = ymd(most);
        $('#fm-kezd', h).value = napOra(p);
        $('#fm-veg', h).value = idoPlusz(napOra(p), 90);
      } else {
        const holnap = napPlusz(most, 1);
        const kezd = b.dataset.gyors === 'holnap8' ? '08:00' : '13:00';
        $('#fm-datum', h).value = ymd(holnap);
        $('#fm-kezd', h).value = kezd;
        $('#fm-veg', h).value = idoPlusz(kezd, 90);
      }
      elozoKezd = $('#fm-kezd', h).value;
      allapotNez();
    });
    $('#fm-ismet', h).onchange = e => {
      const alkalom = $('#fm-alkalom', h);
      if (e.target.value !== '0' && Number(alkalom.value) <= 1) {
        alkalom.value = e.target.value === '7' ? 5 : 10;
        alkalom.focus();
        alkalom.select();
      }
      if (e.target.value === '0') alkalom.value = 1;
    };
  }

  $('[data-megse]', h).onclick = () => zarKerdessel();

  if (f) {
    $('[data-torol]', h).onclick = () => megerosit(
      'Foglalás törlése',
      `Biztosan törlöd? <strong>${esc(f.cim)}</strong><br>${esc(teremNev(f.room_id))} · ${
        esc(napCimke(f._k))} ${idoSzoveg(f._k, f._v)}` +
      (f.sorozat_id ? '<br><span class="halk">Ez egy ismétlődő sorozat egy alkalma; csak ez az alkalom törlődik.</span>' : ''),
      'Törlés', async () => {
        ellenoriz(await sb.from('bookings').delete().eq('id', f.id).select('id'),
          'Ezt a foglalást közben már törölték.');
        await foglalasokBetolt(); lapKirajzol(); pirit('Foglalás törölve.', 'siker');
      });
    const allapotValt = async (allapot, szoveg) => {
      try {
        ellenoriz(await sb.from('bookings').update({ allapot }).eq('id', f.id).select('id'));
        zarModalis();
        await foglalasokBetolt(); lapKirajzol(); pirit(szoveg, 'siker');
      } catch (e) { hiba(hibaSzoveg(e)); }
    };
    const lemond = $('[data-lemond]', h);
    if (lemond) lemond.onclick = () => megerosit('Foglalás lemondása',
      `Lemondod ezt a foglalást? A naptárban áthúzva látszik tovább, és a terem felszabadul.<br>
       <strong>${esc(f.cim)}</strong> · ${esc(napCimke(f._k))} ${idoSzoveg(f._k, f._v)}`,
      'Lemondás', () => allapotValt('lemondva', 'A foglalás lemondva.'), false);
    const vissza = $('[data-visszaall]', h);
    if (vissza) vissza.onclick = () => allapotValt('elfogadva', 'A foglalás újra érvényes.');
  }

  $('[data-ment]', h).onclick = async () => {
    const gomb = $('[data-ment]', h);
    $('#fm-hiba', h).hidden = true;
    const cim = $('#fm-cim', h).value.trim();
    const datum = $('#fm-datum', h).value;
    const kezd = $('#fm-kezd', h).value;
    const veg = $('#fm-veg', h).value;
    if (!cim) return hiba('Írd be, mi lesz a teremben.');
    if (!datum || !kezd || !veg) return hiba('A dátum, a kezdés és a befejezés kötelező.');
    if (percKulonbseg(kezd, veg) <= 0) return hiba('A befejezés későbbi legyen, mint a kezdés.');
    const letszamSzoveg = $('#fm-letszam', h).value;
    if (letszamSzoveg !== '') {
      const n = Number(letszamSzoveg);
      if (!Number.isFinite(n) || n < 0 || n > 500) return hiba('A létszám 0 és 500 között lehet.');
    }
    if (hm(idopont(datum, kezd)) !== kezd) {
      return hiba('Ezen a napon ez az időpont az óraátállítás miatt nem létezik. Válassz másik időt.');
    }

    const alap = {
      room_id: Number($('#fm-terem', h).value),
      cim,
      tipus: $('#fm-tipus', h).value,
      oktato: $('#fm-oktato', h).value.trim() || null,
      letszam: letszamSzoveg === '' ? null : Number(letszamSzoveg),
      leiras: $('#fm-leiras', h).value.trim() || null,
      eszkozigeny: $('#fm-eszkoz', h).value.trim() || null,
    };
    gomb.disabled = true; gomb.textContent = 'Mentés…';
    if (modalisAllapot) modalisAllapot.ment = true;
    let sikeres = false;
    try {
      if (f) {
        ellenoriz(await sb.from('bookings').update({
          ...alap,
          kezdet: idopont(datum, kezd).toISOString(),
          veg: idopont(datum, veg).toISOString(),
        }).eq('id', f.id).select('id'), 'Ezt a foglalást közben törölték vagy átírták.');
        pirit('Foglalás módosítva.', 'siker');
        sikeres = true;
      } else {
        const ismet = Number($('#fm-ismet', h).value);
        const alkalom = Math.max(1, Math.min(40, Number($('#fm-alkalom', h).value) || 1));
        const sorozatId = (ismet && alkalom > 1) ? kriptoId() : null;
        const napok = [];
        let d0 = new Date(datum + 'T00:00:00');
        let db = 0, lepes = 0;
        while (db < (ismet ? alkalom : 1) && lepes < 400) {
          lepes++;
          if (ismet === 7) {
            if (d0.getDay() !== 0 && d0.getDay() !== 6) { napok.push(new Date(d0)); db++; }
            d0 = napPlusz(d0, 1);
          } else {
            napok.push(new Date(d0)); db++;
            d0 = napPlusz(d0, ismet === 2 ? 14 : 7);
          }
        }
        const sorok = napok.map(n => ({
          ...alap, sorozat_id: sorozatId, szerzo_id: A.user.id, szerzo_nev: A.profil.nev,
          kezdet: idopont(ymd(n), kezd).toISOString(),
          veg: idopont(ymd(n), veg).toISOString(),
        }));
        const kesz = [], utkozott = [];
        let egyebHiba = null;
        for (let i = 0; i < sorok.length; i++) {
          if (sorok.length > 1) gomb.textContent = `Mentés… (${i + 1}/${sorok.length})`;
          const { error } = await sb.from('bookings').insert(sorok[i]);
          if (error) {
            if (/23P01|exclusion|bookings_nincs_utkozes/i.test(error.message || '')) {
              utkozott.push(new Date(sorok[i].kezdet));
            } else { egyebHiba = error; break; }
          } else kesz.push(new Date(sorok[i].kezdet));
        }
        if (egyebHiba && !kesz.length) throw egyebHiba;
        if (!kesz.length) {
          gomb.disabled = false; gomb.textContent = 'Foglalás mentése';
          if (modalisAllapot) modalisAllapot.ment = false;
          return hiba('Ebben a teremben a választott időben már van foglalás. Válassz másik időt vagy termet.');
        }
        sikeres = true;
        if (utkozott.length || egyebHiba) {
          zarModalis();
          await foglalasokBetolt();
          lapKirajzol();
          sorozatOsszegzo(kesz, utkozott, egyebHiba);
          return;
        }
        pirit(kesz.length === 1 ? 'Foglalás mentve.' : `${kesz.length} alkalom mentve.`, 'siker');
      }
      zarMindenModalist();
      A.sajatFoglalasok = null;
      await foglalasokBetolt();
      lapKirajzol();
    } catch (err) {
      if (modalisAllapot) modalisAllapot.ment = false;
      gomb.disabled = false; gomb.textContent = f ? 'Módosítás mentése' : 'Foglalás mentése';
      hiba(hibaSzoveg(err));
      if (sikeres) { try { await foglalasokBetolt(); lapKirajzol(); } catch (e) { /* nem baj */ } }
    }
  };
}

/* ismétlődő mentés összegzése — hogy ne toastban kelljen elolvasni */
function sorozatOsszegzo(kesz, utkozott, egyebHiba) {
  const unnepre = kesz.filter(d => unnepNev(d));
  const h = modalis({
    cim: 'Ismétlődő foglalás eredménye',
    torzs: `
      <p><strong>${kesz.length} alkalom felvéve:</strong><br>
        <span class="halk">${kesz.map(rovidNap).join(', ')}</span></p>
      ${unnepre.length ? `<p class="modalis-figyelmeztet" style="margin-top:.6rem">
        ${unnepre.length} alkalom munkaszüneti napra esik
        (${unnepre.map(d => `${rovidNap(d)} — ${esc(unnepNev(d))}`).join(', ')}).
        Ha ezek nem lesznek megtartva, töröld őket egyenként a naptárban.</p>` : ''}
      ${utkozott.length ? `<p><strong>${utkozott.length} alkalom kimaradt</strong>, mert a terem
        akkor már foglalt volt:<br><span class="halk">${utkozott.map(rovidNap).join(', ')}</span></p>
        <p class="sugoszoveg">Ezeket másik teremben vagy másik időben tudod felvenni.</p>` : ''}
      ${egyebHiba ? `<p class="modalis-hiba">A sorozat felvétele megszakadt: ${
        esc(hibaSzoveg(egyebHiba))} A már felvett alkalmak megmaradtak.</p>` : ''}`,
    lab: `<button class="btn btn-fo" data-ok>Rendben</button>`,
  });
  $('[data-ok]', h).onclick = () => zarModalis();
}

function foglalasAdatlap(f) {
  const enyem = f.szerzo_id === A.user.id;
  const szerkeszthet = enyem || kezelo();
  const t = A.termek.find(x => x.id === f.room_id);
  const torzs = `
    <dl>
      <div class="adatsor"><dt>Terem</dt><dd><strong>${esc(teremNev(f.room_id))}</strong>${
        t ? `<br><span class="halk">${esc([t.epulet, t.emelet].filter(Boolean).join(', '))}${
          t.ferohely ? ` · ${t.ferohely} fő` : ''}</span>` : ''}</dd></div>
      <div class="adatsor"><dt>Mikor</dt><dd>${esc(napCimke(f._k))}<br><strong>${idoSzoveg(f._k, f._v)}</strong></dd></div>
      <div class="adatsor"><dt>Típus</dt><dd>${esc((TIPUSOK[f.tipus] || {}).nev || f.tipus)}</dd></div>
      ${f.oktato ? `<div class="adatsor"><dt>Ki tartja</dt><dd>${esc(f.oktato)}</dd></div>` : ''}
      ${f.letszam != null ? `<div class="adatsor"><dt>Létszám</dt><dd>${f.letszam} fő</dd></div>` : ''}
      ${f.eszkozigeny ? `<div class="adatsor"><dt>Eszközigény</dt><dd>${esc(f.eszkozigeny)}</dd></div>` : ''}
      ${f.leiras ? `<div class="adatsor"><dt>Megjegyzés</dt><dd>${esc(f.leiras)}</dd></div>` : ''}
      <div class="adatsor"><dt>Foglalta</dt><dd>${esc(f.szerzo_nev)}${enyem ? ' (te)' : ''}<br>
        <span class="halk">${new Date(f.letrehozva).toLocaleString('hu-HU')}</span></dd></div>
      ${f.modositva ? `<div class="adatsor"><dt>Módosítva</dt><dd>${esc(f.modositotta || '')}<br>
        <span class="halk">${new Date(f.modositva).toLocaleString('hu-HU')}</span></dd></div>` : ''}
      ${f.allapot === 'lemondva' ? `<div class="adatsor"><dt>Állapot</dt>
        <dd><span class="jelzo jelzo-piros">lemondva</span></dd></div>` : ''}
      ${f.sorozat_id ? `<div class="adatsor"><dt>Sorozat</dt><dd class="halk">ismétlődő foglalás egy alkalma${
        sorozatTovabbi(f).length ? ` · még ${sorozatTovabbi(f).length} későbbi alkalom` : ''}</dd></div>` : ''}
    </dl>
    ${szerkeszthet ? '' : `<p class="modalis-info">Ezt a foglalást ${esc(f.szerzo_nev)} vette fel,
      ezért te nem tudod módosítani. Kérd tőle vagy a titkárságtól (sbo@semmelweis.hu).</p>`}`;
  const lab = `
    <button class="btn balra" data-ics1>Naptárfájl (.ics)</button>
    ${szerkeszthet && f.sorozat_id && sorozatTovabbi(f).length
      ? '<button class="btn btn-veszes" data-sorozat>Sorozat többi alkalma…</button>' : ''}
    <button class="btn" data-megse>Bezárás</button>
    ${szerkeszthet ? `<button class="btn btn-fo" data-mod>Módosítás</button>` : ''}`;
  const h = modalis({ cim: f.cim, torzs, lab });
  $('[data-megse]', h).onclick = () => zarModalis();
  $('[data-ics1]', h).onclick = () => icsLetolt([f]);
  if (szerkeszthet) $('[data-mod]', h).onclick = () => foglalasModalis(f, {});
  const sorozatGomb = $('[data-sorozat]', h);
  if (sorozatGomb) sorozatGomb.onclick = () => sorozatKezelo(f);
}

/* ugyanabból a sorozatból a mostani alkalommal együtt következő alkalmak */
function sorozatTovabbi(f) {
  if (!f.sorozat_id) return [];
  const forras = A.foglalasok.concat(A.sajatFoglalasok || []);
  const megvan = new Set();
  return forras.filter(x => {
    if (x.sorozat_id !== f.sorozat_id || x.id === f.id || x._k < f._k) return false;
    if (megvan.has(x.id)) return false;
    megvan.add(x.id);
    return true;
  }).sort((a, b) => a._k - b._k);
}

function sorozatKezelo(f) {
  const tovabbi = sorozatTovabbi(f);
  const h = modalis({
    cim: 'Ismétlődő sorozat',
    torzs: `<p>Ez az alkalom (${esc(napCimke(f._k))}) után még
      <strong>${tovabbi.length} alkalom</strong> van ugyanebből a sorozatból:</p>
      <p class="halk">${tovabbi.map(x => rovidNap(x._k)).join(', ')}</p>
      <p class="sugoszoveg">A törlés csak a fenti későbbi alkalmakra vonatkozik, ez a mostani
        megmarad. A már megtartott alkalmakat nem bántja.</p>`,
    lab: `<button class="btn" data-megse>Mégse</button>
          <button class="btn btn-veszes" data-mind>Későbbi alkalmak törlése</button>`,
  });
  $('[data-megse]', h).onclick = () => zarModalis();
  $('[data-mind]', h).onclick = async () => {
    const gomb = $('[data-mind]', h);
    gomb.disabled = true; gomb.textContent = 'Törlés…';
    if (modalisAllapot) modalisAllapot.ment = true;
    try {
      const { data, error } = await sb.from('bookings').delete()
        .eq('sorozat_id', f.sorozat_id).gt('kezdet', f.kezdet).select('id');
      if (error) throw error;
      zarModalis();
      A.sajatFoglalasok = null;
      await foglalasokBetolt();
      lapKirajzol();
      pirit(`${(data || []).length} későbbi alkalom törölve.`, 'siker');
    } catch (e) {
      if (modalisAllapot) modalisAllapot.ment = false;
      gomb.disabled = false; gomb.textContent = 'Későbbi alkalmak törlése';
      hibaKi(e);
    }
  };
}

function idopont(datum, ido) {
  const [y, m, d] = datum.split('-').map(Number);
  const [h, p] = ido.split(':').map(Number);
  return new Date(y, m - 1, d, h, p, 0, 0);
}
function percKulonbseg(a, b) {
  const p = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  return p(b) - p(a);
}
function idoPlusz(ido, perc) {
  const [h, m] = ido.split(':').map(Number);
  const t = Math.max(0, Math.min(23 * 60 + 45, h * 60 + m + perc));
  return napOra(t);
}
function kriptoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/* ─── naptárfájl (Outlook, Google, Apple) */
function icsLetolt(lista) {
  const napok = napokAMostaniNezetben();
  const k = napok[0], v = napPlusz(napok[napok.length - 1], 1);
  const mit = (lista || A.foglalasok.filter(f => f._v > k && f._k < v &&
    lathatoTermek().some(t => t.id === f.room_id))).filter(f => f.allapot !== 'lemondva');
  if (!mit.length) { pirit('Ebben az időszakban nincs letölthető foglalás.', 'hiba'); return; }

  const u = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const sor = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
  // az iCalendar szabvány 75 oktettes sorokat kér: a hosszút tördeljük
  const tord = s => {
    const bajt = new TextEncoder().encode(s);
    if (bajt.length <= 74) return s;
    const ki = [];
    let jel = '', hossz = 0;
    for (const kar of s) {
      const kb = new TextEncoder().encode(kar).length;
      if (hossz + kb > (ki.length ? 73 : 74)) { ki.push(jel); jel = ''; hossz = 0; }
      jel += kar; hossz += kb;
    }
    if (jel) ki.push(jel);
    return ki.join('\r\n ');
  };
  const sorok = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SOK//Oktatotermek//HU', 'CALSCALE:GREGORIAN'];
  mit.forEach(f => {
    const valtozat = f.modositva ? Math.floor(new Date(f.modositva).getTime() / 1000) % 100000 : 0;
    [
      'BEGIN:VEVENT',
      `UID:sokterem-${f.id}@semmelweis.hu`,
      `DTSTAMP:${u(new Date())}`,
      `DTSTART:${u(f._k)}`,
      `DTEND:${u(f._v)}`,
      `SEQUENCE:${valtozat}`,
      `LAST-MODIFIED:${u(new Date(f.modositva || f.letrehozva))}`,
      `SUMMARY:${sor(f.cim)}`,
      `LOCATION:${sor(teremNev(f.room_id))}`,
      `DESCRIPTION:${sor([(TIPUSOK[f.tipus] || {}).nev, f.oktato && 'Tartja: ' + f.oktato,
        f.letszam != null && f.letszam + ' fő', f.eszkozigeny && 'Eszköz: ' + f.eszkozigeny,
        f.leiras, 'Foglalta: ' + f.szerzo_nev].filter(Boolean).join('\n'))}`,
      'END:VEVENT',
    ].forEach(s => sorok.push(tord(s)));
  });
  sorok.push('END:VCALENDAR');

  const nev = lista && lista.length === 1
    ? `foglalas_${ymd(lista[0]._k)}.ics`
    : `oktatotermek_${ymd(k)}.ics`;
  fajlLetolt(sorok.join('\r\n'), nev, 'text/calendar;charset=utf-8');
  pirit('Naptárfájl letöltve. Nyisd meg, és bekerül a naptáradba (telefonon a letöltések közül).', 'siker');
}

function fajlLetolt(tartalom, nev, tipus) {
  const blob = new Blob([tartalom], { type: tipus });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nev;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ══════════════════════════════════════════════════ eszközök ══ */
function eszkozSzurt() {
  const sz = A.eszkSzuro;
  const keres = normal(sz.szo.trim());
  return A.eszkozok.filter(e => {
    if (!sz.inaktiv && e.aktiv === false) return false;
    // keresésnél a kategória-szűrő ne rejtse el a találatot
    if (!keres && !sz.kat.has(e.kategoria)) return false;
    if (sz.room === 'nincs' && e.room_id) return false;
    if (sz.room && sz.room !== 'nincs' && e.room_id !== Number(sz.room)) return false;
    if (sz.allapot && e.allapot !== sz.allapot) return false;
    if (keres) {
      const hol = normal([e.nev, e.nev2, e.leltarszam, e.gyari_sz, e.eszkoz_sz, e.kinel,
        e.hely_szoveg, e.megjegyzes, KATEGORIAK[e.kategoria]].filter(Boolean).join(' '));
      if (!hol.includes(keres)) return false;
    }
    return true;
  });
}

function eszkozokHtml() {
  const sz = A.eszkSzuro;
  const szurt = eszkozSzurt();
  const hasznalt = A.eszkozok.filter(e => e.aktiv !== false);

  const kpi = A.termek.filter(t => t.aktiv).map(t => {
    const db = hasznalt.filter(e => e.room_id === t.id).length;
    const okt = hasznalt.filter(e => e.room_id === t.id && e.kategoria === 'oktatasi').length;
    return `<button class="kpi kpi-gomb" data-kpi-szuro="terem:${t.id}"
      title="Csak a ${esc(t.kod)} eszközei">
      <span class="kpi-cimke">${esc(t.kod)}</span>
      <span class="kpi-ertek" data-kpi="terem-${t.id}">${db}</span>
      <span class="kpi-alsor">eszköz, ebből ${okt} oktatási</span></button>`;
  }).join('');
  const nincsHely = hasznalt.filter(e => !e.room_id).length;
  const gond = hasznalt.filter(e => ['javitasra_var', 'javitas_alatt'].includes(e.allapot)).length;
  const inaktivDb = A.eszkozok.filter(e => e.aktiv === false).length;

  return `
  <div class="kpi-sor">
    ${kpi}
    <button class="kpi kpi-gomb" data-kpi-szuro="nincs" title="Csak amiknél nincs terem megadva">
      <span class="kpi-cimke">Terem nélkül</span>
      <span class="kpi-ertek" data-kpi="nincshely">${nincsHely}</span>
      <span class="kpi-alsor">nincs teremhez sorolva</span></button>
    <button class="kpi kpi-gomb" data-kpi-szuro="javitas" title="Csak a javításra várók">
      <span class="kpi-cimke">Javítás</span>
      <span class="kpi-ertek" data-kpi="javitas">${gond}</span>
      <span class="kpi-alsor">javításra vár vagy javítás alatt</span></button>
    <button class="kpi kpi-gomb" data-kpi-szuro="inaktiv" title="A nem használt tételek">
      <span class="kpi-cimke">Nem használt</span>
      <span class="kpi-ertek" data-kpi="inaktiv">${inaktivDb}</span>
      <span class="kpi-alsor">kivéve a listából</span></button>
  </div>

  <div class="eszkoztar">
    <input type="search" id="esz-kereso" aria-label="Keresés az eszközök között"
      placeholder="Keresés: név, leltárszám, gyári szám, kinél…"
      value="${esc(sz.szo)}" style="flex:1 1 240px; max-width:380px">
    <div class="csipek" role="group" aria-label="Kategóriák">
      ${Object.entries(KATEGORIAK).map(([k, n]) =>
        `<button class="csip ${sz.kat.has(k) ? 'aktiv' : 'halk'}" data-kat="${k}"
          aria-pressed="${sz.kat.has(k)}">${esc(n)}</button>`).join('')}
      <button class="csip ${sz.inaktiv ? 'aktiv' : 'halk'}" data-inaktiv
        aria-pressed="${sz.inaktiv}" title="A nem használt tételek megjelenítése">nem használtak</button>
      ${sugoJel('A kategóriákkal szűkíted a listát (a bútor alapból nincs benne). A „nem használtak” gomb előhozza azt is, amit valaki kivett a listából. Kereséskor minden kategóriában keresünk.')}
    </div>
    <select id="esz-terem" aria-label="Szűrés helyre" style="width:auto">
      <option value="">minden hely</option>
      <option value="nincs" ${sz.room === 'nincs' ? 'selected' : ''}>nincs megadva</option>
      ${A.termek.map(t => `<option value="${t.id}" ${String(t.id) === sz.room ? 'selected' : ''}>${esc(t.kod)}</option>`).join('')}
    </select>
    <select id="esz-allapot" aria-label="Szűrés állapotra" style="width:auto">
      <option value="">minden állapot</option>
      ${Object.entries(ALLAPOTOK).map(([k, v]) =>
        `<option value="${k}" ${sz.allapot === k ? 'selected' : ''}>${esc(v.nev)}</option>`).join('')}
    </select>
    <span class="tolto"></span>
    <button class="btn" data-csv>Teljes lista letöltése (CSV)</button>
    <button class="btn btn-fo" data-uj-eszkoz>+ Új eszköz</button>
  </div>

  <p class="sugoszoveg">${A.eszkozok.length} tételből ${szurt.length} felel meg a szűrésnek.${
    sz.szo.trim() ? ' Keresésnél minden kategóriában keresünk.' : ''}
    A sorban gyorsan átírható a hely, a felelős és az állapot; az <strong>Adatlap</strong> gombbal minden
    adat szerkeszthető, és ott lehet a tételt „nem használt”-ra állítani.</p>

  <div class="tabla-tarto"><table>
    <thead><tr>
      <th>Eszköz</th><th>Leltárszám</th>
      <th>Terem ${sugoJel('Melyik oktatóteremben van. Ha nincs teremben (pl. raktárban vagy kölcsönben), hagyd „nincs”-en, és írd a Pontos hely mezőbe.')}</th>
      <th>Pontos hely ${sugoJel('Ahol tényleg megtalálható: pl. „szekrény 2, alsó polc”, „bal oldali kocsi”.')}</th>
      <th>Kinél van ${sugoJel('Ha valaki elvitte vagy nála áll, ide írjuk a nevét — így nem kell körbetelefonálni.')}</th>
      <th>Állapot</th><th>Megjegyzés</th><th><span class="rejtett-szoveg">Műveletek</span></th>
    </tr></thead>
    <tbody>
      ${szurt.length ? szurt.map(e => `
      <tr data-esz="${e.id}" class="${e.aktiv === false ? 'nem-hasznalt' : ''}">
        <td data-cimke="Eszköz"><strong>${esc(e.nev)}</strong>
          ${e.aktiv === false ? ' <span class="jelzo jelzo-szurke">nem használt</span>' : ''}
          ${e.nev2 ? `<br><span class="halk">${esc(e.nev2)}</span>` : ''}
          ${e.gyari_sz ? `<br><span class="halk apro">gy.sz.: ${esc(e.gyari_sz)}</span>` : ''}</td>
        <td data-cimke="Leltárszám" class="halk">${esc(e.leltarszam || '—')}</td>
        <td data-cimke="Terem"><select data-mezo="room_id" aria-label="Terem"style="min-width:110px">
            <option value="">— nincs —</option>
            ${A.termek.map(t => `<option value="${t.id}" ${e.room_id === t.id ? 'selected' : ''}>${esc(t.kod)}</option>`).join('')}
          </select></td>
        <td data-cimke="Pontos hely"><input data-mezo="hely_szoveg" aria-label="Pontos hely"
            value="${esc(e.hely_szoveg || '')}" placeholder="pl. szekrény 2" style="min-width:110px"></td>
        <td data-cimke="Kinél van"><input data-mezo="kinel" aria-label="Kinél van"
            value="${esc(e.kinel || '')}" placeholder="név" style="min-width:100px"></td>
        <td data-cimke="Állapot"><select data-mezo="allapot" aria-label="Állapot">${
            Object.entries(ALLAPOTOK).map(([k, v]) =>
            `<option value="${k}" ${e.allapot === k ? 'selected' : ''}>${esc(v.nev)}</option>`).join('')}</select></td>
        <td data-cimke="Megjegyzés"><input data-mezo="megjegyzes" aria-label="Megjegyzés"
            value="${esc(e.megjegyzes || '')}" style="min-width:130px"></td>
        <td><button class="btn btn-kis" data-adatlap="${e.id}">Adatlap</button></td>
      </tr>`).join('') : `<tr><td colspan="8" class="ures">${
        sz.kat.size === 0 && !sz.szo.trim()
          ? 'Egy kategória sincs bekapcsolva. Kapcsolj be legalább egyet a szűrőgombokkal.'
          : 'Nincs a szűrésnek megfelelő eszköz.'}</td></tr>`}
    </tbody>
  </table></div>
  <p class="sugoszoveg">Az induló állomány a 152-es leltárkörzet 3-as alleltárának SAP-kivonata.
    A leltári számok maradjanak összhangban a gazdasági rendszerrel.</p>`;
}

/* az eszközök feletti számok frissítése újrarajzolás nélkül */
function eszkozKpiFrissit() {
  const h = A.eszkozok.filter(e => e.aktiv !== false);
  A.termek.filter(t => t.aktiv).forEach(t => {
    const c = $(`[data-kpi="terem-${t.id}"]`);
    if (c) c.textContent = h.filter(e => e.room_id === t.id).length;
  });
  const be = (kulcs, ertek) => { const c = $(`[data-kpi="${kulcs}"]`); if (c) c.textContent = ertek; };
  be('nincshely', h.filter(e => !e.room_id).length);
  be('javitas', h.filter(e => ['javitasra_var', 'javitas_alatt'].includes(e.allapot)).length);
  be('inaktiv', A.eszkozok.filter(e => e.aktiv === false).length);
}

function eszkozokKotes() {
  const tart = $('#tartalom');
  let idozit;
  $('#esz-kereso', tart).oninput = e => {
    clearTimeout(idozit);
    const ertek = e.target.value, poz = e.target.selectionStart;
    idozit = setTimeout(() => {
      A.eszkSzuro.szo = ertek;
      const gorgetes = $('.tabla-tarto') ? $('.tabla-tarto').scrollTop : 0;
      lapKirajzol();
      const uj = $('#esz-kereso');
      if (uj) { uj.focus(); uj.setSelectionRange(poz, poz); }
      const t = $('.tabla-tarto');
      if (t) t.scrollTop = gorgetes;
    }, 350);
  };
  $$('[data-kat]', tart).forEach(b => b.onclick = () => {
    const k = b.dataset.kat;
    if (A.eszkSzuro.kat.has(k)) A.eszkSzuro.kat.delete(k); else A.eszkSzuro.kat.add(k);
    lapKirajzol();
  });
  $('[data-inaktiv]', tart).onclick = () => { A.eszkSzuro.inaktiv = !A.eszkSzuro.inaktiv; lapKirajzol(); };
  $('#esz-terem', tart).onchange = e => { A.eszkSzuro.room = e.target.value; lapKirajzol(); };
  $('#esz-allapot', tart).onchange = e => { A.eszkSzuro.allapot = e.target.value; lapKirajzol(); };
  $('[data-csv]', tart).onclick = eszkozCsv;
  $('[data-uj-eszkoz]', tart).onclick = () => eszkozAdatlap(null);

  $$('[data-kpi-szuro]', tart).forEach(b => b.onclick = () => {
    const ertek = b.dataset.kpiSzuro;
    const sz = A.eszkSzuro;
    sz.szo = ''; sz.room = ''; sz.allapot = ''; sz.inaktiv = false;
    sz.kat = new Set(Object.keys(KATEGORIAK));
    if (ertek.startsWith('terem:')) sz.room = ertek.split(':')[1];
    else if (ertek === 'nincs') sz.room = 'nincs';
    else if (ertek === 'javitas') sz.allapot = 'javitasra_var';
    else if (ertek === 'inaktiv') sz.inaktiv = true;
    lapKirajzol();
  });

  $$('tr[data-esz]', tart).forEach(tr => {
    const id = Number(tr.dataset.esz);
    $$('[data-mezo]', tr).forEach(m => m.addEventListener('change', () => eszkozMentes(id, m)));
  });
  $$('[data-adatlap]', tart).forEach(b => b.onclick = () => eszkozAdatlap(Number(b.dataset.adatlap)));
}

async function eszkozMentes(id, elem) {
  const mezo = elem.dataset.mezo;
  const e = A.eszkozok.find(x => x.id === id);
  const regi = e ? e[mezo] : null;
  let ertek = elem.value;
  if (mezo === 'room_id') ertek = ertek === '' ? null : Number(ertek);
  else if (mezo !== 'allapot') ertek = ertek.trim() === '' ? null : ertek.trim();
  elem.disabled = true;
  try {
    const sorok = ellenoriz(
      await sb.from('equipment').update({ [mezo]: ertek }).eq('id', id).select('id,modositva,modositotta'),
      'Ez a tétel közben megszűnt vagy nincs rá jogosultságod.');
    if (e) {
      e[mezo] = ertek;
      // a friss időbélyeg nélkül az adatlap optimista zárja hamis ütközést jelezne
      e.modositva = sorok[0].modositva;
      e.modositotta = sorok[0].modositotta;
    }
    eszkozKpiFrissit();
    elem.classList.add('mentve');
    setTimeout(() => elem.classList.remove('mentve'), 1200);
    const nev = e ? e.nev : 'eszköz';
    pirit(mezo === 'room_id'
      ? `${nev} → ${ertek ? teremKod(ertek) : 'nincs terem'}`
      : `${nev}: mentve`, 'siker');
  } catch (err) {
    hibaKi(err);
    // csak ezt a cellát állítjuk vissza, a többi félig beírt érték megmarad
    if (elem.tagName === 'SELECT') elem.value = regi == null ? '' : String(regi);
    else elem.value = regi == null ? '' : String(regi);
  } finally { elem.disabled = false; }
}

const ESZK_MEZONEV = {
  nev: 'megnevezés', nev2: 'megnevezés 2', leltarszam: 'leltárszám', eszkoz_sz: 'eszközszám',
  alsz: 'alszám', gyari_sz: 'gyári szám', eszkozosztaly: 'eszközosztály', ktghely: 'költséghely',
  regi_azonosito: 'régi azonosító', aktivalas: 'aktiválás', beszerzesi_ertek: 'beszerzési érték',
  konyv_ertek: 'könyv szerinti érték', kategoria: 'kategória', room_id: 'terem',
  hely_szoveg: 'pontos hely', kinel: 'kinél van', allapot: 'állapot', megjegyzes: 'megjegyzés',
  ellenorizve: 'ellenőrizve', aktiv: 'használatban',
};

/* eszköz adatlapja: minden mező szerkeszthető + előzmény + „nem használt” */
async function eszkozAdatlap(id) {
  const uj = !id;
  const e = uj ? {} : A.eszkozok.find(x => x.id === id);
  if (!uj && !e) { pirit('Ez a tétel már nincs a listában.', 'hiba'); return; }
  const v = k => (e[k] === null || e[k] === undefined ? '' : e[k]);

  const torzs = `
    <div class="mezo-sor">
      <div style="flex:2 1 240px"><label for="ea-nev">Megnevezés <abbr title="kötelező" class="kell">*</abbr></label>
        <input id="ea-nev" maxlength="200" value="${esc(v('nev'))}" placeholder="pl. Little Anne QCPR"></div>
      <div><label for="ea-kat">Kategória</label>
        <select id="ea-kat">${Object.entries(KATEGORIAK).map(([k, n]) =>
          `<option value="${k}" ${(v('kategoria') || 'oktatasi') === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    </div>
    <label for="ea-nev2">Megnevezés 2 (típus, kiegészítés)</label>
    <input id="ea-nev2" maxlength="200" value="${esc(v('nev2'))}">

    <h3 class="szakasz">Hol van, kinél, milyen állapotban</h3>
    <div class="mezo-sor">
      <div><label for="ea-terem">Terem</label>
        <select id="ea-terem"><option value="">— nincs megadva —</option>
          ${A.termek.map(t => `<option value="${t.id}" ${e.room_id === t.id ? 'selected' : ''}>${
            esc(t.kod)} · ${esc(t.nev)}</option>`).join('')}</select></div>
      <div><label for="ea-hely">Pontos hely</label>
        <input id="ea-hely" maxlength="200" value="${esc(v('hely_szoveg'))}" placeholder="pl. szekrény 2, alsó polc"></div>
    </div>
    <div class="mezo-sor">
      <div><label for="ea-kinel">Kinél van</label>
        <input id="ea-kinel" maxlength="120" value="${esc(v('kinel'))}" placeholder="név, ha valakinél van"></div>
      <div><label for="ea-allapot">Állapot</label>
        <select id="ea-allapot">${Object.entries(ALLAPOTOK).map(([k, a]) =>
          `<option value="${k}" ${(v('allapot') || 'ismeretlen') === k ? 'selected' : ''}>${esc(a.nev)}</option>`).join('')}</select></div>
      <div><label for="ea-ell">Utoljára ellenőrizve</label>
        <input type="date" id="ea-ell" value="${esc(v('ellenorizve'))}"></div>
    </div>
    <label for="ea-megj">Megjegyzés</label>
    <textarea id="ea-megj" maxlength="2000">${esc(v('megjegyzes'))}</textarea>

    <h3 class="szakasz">Leltári adatok</h3>
    <p class="sugoszoveg felso">Ezek a gazdasági rendszerből (SAP) származnak. Csak akkor írd át,
      ha biztosan tudod, hogy ott is így van — a változás naplózódik.</p>
    <div class="mezo-sor">
      <div><label for="ea-leltar">Leltárszám</label>
        <input id="ea-leltar" maxlength="40" value="${esc(v('leltarszam'))}"></div>
      <div><label for="ea-eszkoz">Eszközszám</label>
        <input id="ea-eszkoz" maxlength="40" value="${esc(v('eszkoz_sz'))}"></div>
      <div><label for="ea-gyari">Gyári szám</label>
        <input id="ea-gyari" maxlength="80" value="${esc(v('gyari_sz'))}"></div>
    </div>
    <div class="mezo-sor">
      <div><label for="ea-ktg">Költséghely</label>
        <input id="ea-ktg" maxlength="40" value="${esc(v('ktghely'))}"></div>
      <div><label for="ea-akt">Aktiválás dátuma</label>
        <input type="date" id="ea-akt" value="${esc(v('aktivalas'))}"></div>
      <div><label for="ea-ertek">Beszerzési érték (Ft)</label>
        <input type="number" id="ea-ertek" min="0" step="1" value="${esc(v('beszerzesi_ertek'))}"></div>
    </div>

    <h3 class="szakasz">Használat</h3>
    <label for="ea-aktiv">Használatban van? ${sugoJel('A „nem használt” tétel nem törlődik, csak kikerül a listából — a leltárban és az előzményben megmarad. Bármikor visszaállítható.')}</label>
    <select id="ea-aktiv">
      <option value="1" ${uj || e.aktiv !== false ? 'selected' : ''}>igen — látszik a listában</option>
      <option value="0" ${!uj && e.aktiv === false ? 'selected' : ''}>nem használt — kikerül a listából</option>
    </select>
    <p class="sugoszoveg">A „nem használt” tétel nem törlődik, csak elrejtjük: a szűrősávban a
      „nem használtak” gombbal bármikor előhozható és visszaállítható.</p>

    ${!uj ? `<div id="ea-elozmeny"><h3 class="szakasz">Előzmény</h3>
      <div class="betolt"><span class="porgo"></span> betöltés…</div></div>` : ''}
    <p class="modalis-hiba" id="ea-hiba" hidden></p>`;

  const lab = `
    ${!uj && admin() ? '<button class="btn btn-veszes balra" data-torol>Eszköz törlése</button>' : ''}
    <button class="btn" data-megse>Mégse</button>
    <button class="btn btn-fo" data-ment>Mentés</button>`;

  const h = modalis({ cim: uj ? 'Új eszköz felvétele' : (e.nev || 'Adatlap'), torzs, lab,
    szeles: true, zarKerdes: true });
  const hiba = m => {
    if (!document.body.contains(h)) { pirit(m, 'hiba'); return; }
    const x = $('#ea-hiba', h);
    x.textContent = m; x.hidden = false; x.scrollIntoView({ block: 'nearest' });
  };
  $('[data-megse]', h).onclick = () => zarKerdessel();

  if (!uj && admin()) $('[data-torol]', h).onclick = () => megerosit('Eszköz törlése',
    `Véglegesen törlöd: <strong>${esc(e.nev)}</strong>? Az előzménye is elveszik.<br>
     Ha csak nem használják, inkább állítsd „nem használt”-ra.`, 'Végleges törlés', async () => {
      ellenoriz(await sb.from('equipment').delete().eq('id', id).select('id'),
        'Ezt a tételt közben már törölték.');
      await eszkozokBetolt(); lapKirajzol(); pirit('Eszköz törölve.', 'siker');
    });

  $('[data-ment]', h).onclick = async () => {
    const nev = $('#ea-nev', h).value.trim();
    if (!nev) return hiba('A megnevezés kötelező.');
    const szam = s => (s === '' ? null : Number(s));
    const ertek = szam($('#ea-ertek', h).value);
    if (ertek !== null && (!Number.isFinite(ertek) || ertek < 0)) {
      return hiba('A beszerzési érték csak nem negatív szám lehet.');
    }
    const sor = {
      nev,
      nev2: $('#ea-nev2', h).value.trim() || null,
      kategoria: $('#ea-kat', h).value,
      room_id: $('#ea-terem', h).value === '' ? null : Number($('#ea-terem', h).value),
      hely_szoveg: $('#ea-hely', h).value.trim() || null,
      kinel: $('#ea-kinel', h).value.trim() || null,
      allapot: $('#ea-allapot', h).value,
      ellenorizve: $('#ea-ell', h).value || null,
      megjegyzes: $('#ea-megj', h).value.trim() || null,
      leltarszam: $('#ea-leltar', h).value.trim() || null,
      eszkoz_sz: $('#ea-eszkoz', h).value.trim() || null,
      gyari_sz: $('#ea-gyari', h).value.trim() || null,
      ktghely: $('#ea-ktg', h).value.trim() || null,
      aktivalas: $('#ea-akt', h).value || null,
      beszerzesi_ertek: ertek,
      aktiv: $('#ea-aktiv', h).value === '1',
    };
    const gomb = $('[data-ment]', h);
    gomb.disabled = true; gomb.textContent = 'Mentés…';
    if (modalisAllapot) modalisAllapot.ment = true;
    try {
      if (uj) {
        ellenoriz(await sb.from('equipment').insert(sor).select('id'));
      } else {
        // csak a tényleg megváltozott mezőket küldjük, és csak akkor,
        // ha közben más nem írta át a tételt
        const valtozott = {};
        Object.keys(sor).forEach(k => {
          const regi = e[k] === undefined ? null : e[k];
          if (String(regi ?? '') !== String(sor[k] ?? '')) valtozott[k] = sor[k];
        });
        if (!Object.keys(valtozott).length) {
          zarModalis();
          pirit('Nem változott semmi.', '');
          return;
        }
        let kerdes = sb.from('equipment').update(valtozott).eq('id', id);
        kerdes = e.modositva ? kerdes.eq('modositva', e.modositva) : kerdes.is('modositva', null);
        const { data, error } = await kerdes.select('id');
        if (error) throw error;
        if (!data || !data.length) {
          await eszkozokBetolt();
          throw new Error('Ezt a tételt közben más átírta. Betöltöttem a friss adatot, nézd meg újra.');
        }
      }
      zarModalis();
      await eszkozokBetolt();
      lapKirajzol();
      pirit(uj ? 'Új eszköz felvéve.' : 'Adatlap mentve.', 'siker');
    } catch (err) {
      if (modalisAllapot) modalisAllapot.ment = false;
      gomb.disabled = false; gomb.textContent = 'Mentés';
      hiba(hibaSzoveg(err) === 'Váratlan hiba történt, a művelet nem sikerült. Próbáld újra; ha marad, jelezd a titkárságnak.'
        && err && err.message && /közben más átírta/.test(err.message) ? err.message : hibaSzoveg(err));
      if (err && err.message && /közben más átírta/.test(err.message)) lapKirajzol();
    }
  };

  if (uj) return;
  const { data, error } = await sb.from('equipment_log').select('*')
    .eq('equipment_id', id).order('mikor', { ascending: false }).limit(100);
  const tarto = $('#ea-elozmeny', h);
  if (!tarto) return;
  const megjelenit = (mezo, x) => {
    if (x === null || x === '' || x === undefined) return '<span class="halk">—</span>';
    if (mezo === 'room_id') return esc(teremKod(Number(x)));
    if (mezo === 'allapot') return esc((ALLAPOTOK[x] || {}).nev || x);
    if (mezo === 'kategoria') return esc(KATEGORIAK[x] || x);
    if (mezo === 'aktiv') return x === 'true' ? 'használatban' : 'nem használt';
    return esc(x);
  };
  tarto.innerHTML = `<h3 class="szakasz">Előzmény</h3>` + (error
    ? `<p class="modalis-hiba">${esc(hibaSzoveg(error))}</p>`
    : ((data || []).length ? `<div class="tabla-tarto"><table><thead><tr>
        <th>Mikor</th><th>Ki</th><th>Mit</th><th>Miről</th><th>Mire</th></tr></thead><tbody>
      ${data.map(r => `<tr><td class="halk">${new Date(r.mikor).toLocaleString('hu-HU')}</td>
        <td>${esc(r.ki || '')}</td><td>${esc(ESZK_MEZONEV[r.mezo] || r.mezo)}</td>
        <td>${megjelenit(r.mezo, r.regi)}</td><td>${megjelenit(r.mezo, r.uj)}</td></tr>`).join('')}
      </tbody></table></div>`
      : '<p class="halk">Még nincs rögzített változás ezen az eszközön.</p>')) +
    `<p class="sugoszoveg">Felvéve: ${e.letrehozva ? new Date(e.letrehozva).toLocaleString('hu-HU') : '—'}${
      e.modositva ? ` · utolsó módosítás: ${esc(e.modositotta || '')} ${new Date(e.modositva).toLocaleString('hu-HU')}` : ''}</p>`;
}

function eszkozCsv() {
  const fejek = ['Eszköz', 'Megnevezés 2', 'Leltárszám', 'Eszközszám', 'Gyári szám', 'Kategória',
    'Terem', 'Pontos hely', 'Kinél van', 'Állapot', 'Használatban', 'Ellenőrizve', 'Megjegyzés',
    'Utolsó módosítás', 'Módosította'];
  const biztos = v => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const sorok = [fejek.map(biztos).join(';')];
  A.eszkozok.forEach(e => sorok.push([
    e.nev, e.nev2, e.leltarszam, e.eszkoz_sz, e.gyari_sz, KATEGORIAK[e.kategoria] || e.kategoria,
    e.room_id ? teremKod(e.room_id) : '', e.hely_szoveg, e.kinel,
    (ALLAPOTOK[e.allapot] || {}).nev || e.allapot,
    e.aktiv === false ? 'nem' : 'igen', e.ellenorizve || '', e.megjegyzes,
    e.modositva ? new Date(e.modositva).toLocaleString('hu-HU') : '', e.modositotta,
  ].map(biztos).join(';')));
  fajlLetolt('\uFEFF' + sorok.join('\r\n'), `oktatasi_eszkozok_${ymd(new Date())}.csv`,
    'text/csv;charset=utf-8');
  pirit('A teljes eszközlista letöltve (Excelben megnyitható).', 'siker');
}

/* ══════════════════════════════════════════════════ termek ══ */
function termekHtml() {
  // a kihasználtság a naptárban megjelenített hétre vonatkozik, nem fixen a maira
  const k = hetKezdet(A.nap), v = napPlusz(k, 7);
  const maiHet = ymd(k) === ymd(hetKezdet(new Date()));
  const heti = t => {
    const lista = A.foglalasok.filter(f => f.room_id === t.id && f._k >= k && f._k < v && f.allapot !== 'lemondva');
    const perc = lista.reduce((s, f) => s + (f._v - f._k) / 60000, 0);
    const ora = perc / 60;
    return { db: lista.length, ora: Math.round(ora * 10) / 10,
      szazalek: Math.round(ora / (5 * 10) * 100) };   // hétköznap 8–18 = heti 50 óra
  };
  return `
  <div class="eszkoztar">
    <span class="halk">${maiHet ? 'Ez a hét' : `A megjelenített hét: ${ymd(k)} – ${ymd(napPlusz(k, 6))}`}
      ${sugoJel('A kihasználtság a Naptár lapon éppen megjelenített héten alapul: ha ott előre vagy hátra lapozol, itt is az a hét látszik. A százalék a hétköznapi 8–18 közötti 50 órához mért arány.')}</span>
    <span class="tolto"></span>
    <button class="btn" data-foglalas-csv>Foglalások letöltése (CSV)</button>
    ${kezelo() ? '<button class="btn btn-fo" data-uj-terem>+ Új terem</button>' : ''}
  </div>
  ${A.termek.map(t => {
    const h = heti(t);
    const eszk = A.eszkozok.filter(e => e.room_id === t.id && e.aktiv !== false);
    return `<div class="kartya" style="border-left:5px solid ${szinBiztos(t.szin)}">
      <div class="kartya-fej">
        <h2>${esc(t.kod)} · ${esc(t.nev)} ${t.aktiv ? '' : '<span class="jelzo jelzo-szurke">nem foglalható</span>'}</h2>
        <div class="gomb-sor">
          <button class="btn btn-kis" data-terem-naptar="${t.id}">Naptár</button>
          ${kezelo() ? `<button class="btn btn-kis" data-terem-mod="${t.id}">Szerkesztés</button>` : ''}
        </div>
      </div>
      <dl>
        <div class="adatsor"><dt>Hely</dt><dd>${esc([t.epulet, t.emelet].filter(Boolean).join(', ') || '—')}</dd></div>
        <div class="adatsor"><dt>Férőhely</dt><dd>${t.ferohely ? t.ferohely + ' fő' : '<span class="halk">nincs megadva</span>'}</dd></div>
        <div class="adatsor"><dt>Felszerelés</dt><dd>${esc(t.felszereles || '') || '<span class="halk">nincs megadva</span>'}</dd></div>
        ${t.megjegyzes ? `<div class="adatsor"><dt>Megjegyzés</dt><dd>${esc(t.megjegyzes)}</dd></div>` : ''}
        <div class="adatsor"><dt>${maiHet ? 'Ezen a héten' : 'A megjelenített héten'}</dt>
          <dd>${h.db} foglalás · ${h.ora} óra${h.db ? ` · kb. ${h.szazalek}% kihasználtság` : ''}</dd></div>
        <div class="adatsor"><dt>Itt nyilvántartott eszköz</dt>
          <dd>${eszk.length ? `${eszk.length} db${
            eszk.filter(e => e.kategoria === 'oktatasi').length
              ? ` (ebből ${eszk.filter(e => e.kategoria === 'oktatasi').length} oktatási)` : ''}`
            : '<span class="halk">még egy sincs ide sorolva</span>'}</dd></div>
      </dl>
    </div>`;
  }).join('')}
  ${A.termek.length ? '' : '<div class="kartya ures">Még nincs felvett terem.</div>'}`;
}

/* foglalások kimutatása Excelbe (kihasználtsághoz, beszámolóhoz) */
async function foglalasCsv() {
  const { data, error } = await sb.from('bookings').select('*')
    .order('kezdet', { ascending: false }).limit(3000);
  if (error) { hibaKi(error); return; }
  const biztos = v => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const fejek = ['Dátum', 'Kezdés', 'Befejezés', 'Óra', 'Terem kód', 'Terem neve', 'Megnevezés',
    'Típus', 'Ki tartja', 'Létszám', 'Eszközigény', 'Állapot', 'Foglalta', 'Felvéve'];
  const sorok = [fejek.map(biztos).join(';')];
  (data || []).forEach(f => {
    const k = new Date(f.kezdet), v = new Date(f.veg);
    sorok.push([ymd(k), hm(k), hm(v), Math.round((v - k) / 36000) / 100,
      teremKod(f.room_id), (A.termek.find(t => t.id === f.room_id) || {}).nev || '',
      f.cim, (TIPUSOK[f.tipus] || {}).nev || f.tipus, f.oktato || '',
      f.letszam == null ? '' : f.letszam, f.eszkozigeny || '',
      f.allapot === 'lemondva' ? 'lemondva' : 'érvényes',
      f.szerzo_nev, new Date(f.letrehozva).toLocaleString('hu-HU'),
    ].map(biztos).join(';'));
  });
  fajlLetolt('﻿' + sorok.join('\r\n'), `foglalasok_${ymd(new Date())}.csv`, 'text/csv;charset=utf-8');
  pirit(`${(data || []).length} foglalás letöltve (Excelben megnyitható).`, 'siker');
}

function termekKotes() {
  const tart = $('#tartalom');
  const csv = $('[data-foglalas-csv]', tart);
  if (csv) csv.onclick = foglalasCsv;
  $$('[data-terem-naptar]', tart).forEach(b => b.onclick = () => {
    const id = Number(b.dataset.teremNaptar);
    A.rejtettTermek = new Set(A.termek.filter(t => t.id !== id).map(t => t.id));
    if (window.innerWidth >= 820) A.nezet = 'het';
    A.racsElsoRajz = true;
    lapNyit('naptar');
  });
  if (!kezelo()) return;
  const ujGomb = $('[data-uj-terem]', tart);
  if (ujGomb) ujGomb.onclick = () => teremModalis(null);
  $$('[data-terem-mod]', tart).forEach(b => b.onclick = () =>
    teremModalis(A.termek.find(t => t.id === Number(b.dataset.teremMod))));
}

function teremModalis(t) {
  const torzs = `
    <div class="mezo-sor">
      <div><label for="tm-kod">Teremkód <abbr title="kötelező" class="kell">*</abbr></label>
        <input id="tm-kod" maxlength="30" value="${esc(t ? t.kod : '')}" placeholder="pl. K03.65"></div>
      <div><label for="tm-nev">Név <abbr title="kötelező" class="kell">*</abbr></label>
        <input id="tm-nev" maxlength="80" value="${esc(t ? t.nev : '')}" placeholder="pl. 2. emeleti oktatóterem"></div>
    </div>
    <div class="mezo-sor">
      <div><label for="tm-epulet">Épület</label><input id="tm-epulet" maxlength="40" value="${esc(t ? (t.epulet || '') : '')}"></div>
      <div><label for="tm-emelet">Emelet</label><input id="tm-emelet" maxlength="40" value="${esc(t ? (t.emelet || '') : '')}"></div>
      <div><label for="tm-fero">Férőhely</label>
        <input type="number" id="tm-fero" min="0" max="500" value="${t && t.ferohely != null ? t.ferohely : ''}"></div>
    </div>
    <label for="tm-felsz">Felszerelés</label>
    <input id="tm-felsz" maxlength="300" value="${esc(t ? (t.felszereles || '') : '')}"
      placeholder="pl. projektor, vetítővászon, 2 db oktatóbaba">
    <label for="tm-megj">Megjegyzés</label>
    <textarea id="tm-megj" maxlength="1000">${esc(t ? (t.megjegyzes || '') : '')}</textarea>
    <label id="tm-szin-cimke">Szín a naptárban</label>
    <div class="csipek" role="group" aria-labelledby="tm-szin-cimke">${SZINEK.map(([sz, nev]) =>
      `<button type="button" class="csip ${(t ? szinBiztos(t.szin) : '#232f61') === sz ? 'aktiv' : ''}"
        data-szin="${sz}" style="color:${sz}" aria-pressed="${(t ? szinBiztos(t.szin) : '#232f61') === sz}">
        <span class="pont"></span>${esc(nev)}</button>`).join('')}</div>
    <div class="mezo-sor" style="margin-top:.8rem">
      <div><label for="tm-sorrend">Sorrend a listákban</label>
        <input type="number" id="tm-sorrend" value="${t ? t.sorrend : 100}"></div>
      <div><label for="tm-aktiv">Foglalható</label>
        <select id="tm-aktiv"><option value="1" ${!t || t.aktiv ? 'selected' : ''}>igen</option>
        <option value="0" ${t && !t.aktiv ? 'selected' : ''}>nem</option></select></div>
    </div>
    <p class="modalis-hiba" id="tm-hiba" hidden></p>`;
  const lab = `
    ${t && admin() ? '<button class="btn btn-veszes balra" data-torol>Terem törlése</button>' : ''}
    <button class="btn" data-megse>Mégse</button>
    <button class="btn btn-fo" data-ment>Mentés</button>`;
  const h = modalis({ cim: t ? 'Terem szerkesztése' : 'Új terem', torzs, lab, zarKerdes: true });
  let szin = t ? szinBiztos(t.szin) : '#232f61';
  $$('[data-szin]', h).forEach(b => b.onclick = () => {
    szin = b.dataset.szin;
    $$('[data-szin]', h).forEach(x => {
      x.classList.toggle('aktiv', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
  });
  $('[data-megse]', h).onclick = () => zarKerdessel();
  if (t && admin()) $('[data-torol]', h).onclick = () => megerosit('Terem törlése',
    `Törlöd a <strong>${esc(t.kod)}</strong> termet? Ha van rá foglalás, a törlés nem lehetséges —
     olyankor inkább állítsd „nem foglalható”-ra. A törléssel az ide sorolt eszközöknél a hely
     üresen marad.`, 'Törlés', async () => {
      ellenoriz(await sb.from('rooms').delete().eq('id', t.id).select('id'),
        'Ezt a termet közben már törölték.');
      await adatokBetolt(); lapKirajzol(); pirit('Terem törölve.', 'siker');
    });
  $('[data-ment]', h).onclick = async () => {
    const hiba = m => { const e = $('#tm-hiba', h); e.textContent = m; e.hidden = false; };
    const kod = $('#tm-kod', h).value.trim(), nev = $('#tm-nev', h).value.trim();
    if (!kod || !nev) return hiba('A teremkód és a név kötelező.');
    const sor = {
      kod, nev, szin,
      epulet: $('#tm-epulet', h).value.trim() || null,
      emelet: $('#tm-emelet', h).value.trim() || null,
      ferohely: $('#tm-fero', h).value === '' ? null : Number($('#tm-fero', h).value),
      felszereles: $('#tm-felsz', h).value.trim() || null,
      megjegyzes: $('#tm-megj', h).value.trim() || null,
      sorrend: Number($('#tm-sorrend', h).value) || 100,
      aktiv: $('#tm-aktiv', h).value === '1',
    };
    const gomb = $('[data-ment]', h); gomb.disabled = true;
    if (modalisAllapot) modalisAllapot.ment = true;
    try {
      ellenoriz(t
        ? await sb.from('rooms').update(sor).eq('id', t.id).select('id')
        : await sb.from('rooms').insert(sor).select('id'));
      zarModalis(); await adatokBetolt(); lapKirajzol(); pirit('Mentve.', 'siker');
    } catch (err) {
      if (modalisAllapot) modalisAllapot.ment = false;
      gomb.disabled = false; hiba(hibaSzoveg(err));
    }
  };
}

/* ══════════════════════════════════════════════════ fiókok ══ */
function fiokokHtml() {
  return `
  <div class="kartya">
    <div class="kartya-fej"><h2>Fiókok</h2>
      <span class="halk">${A.profilok.length} fiók</span></div>
    <div class="tabla-tarto"><table>
      <thead><tr><th>Név</th><th>E-mail-cím</th><th>Beosztás</th>
        <th>Szerep ${sugoJel('oktató: foglal, a sajátját módosítja, eszközadatot ír. titkárság: bárki foglalását módosíthatja, termet szerkeszt. rendszergazda: ezen felül fiókokat kezel, és véglegesen törölhet.')}</th>
        <th>Beléphet ${sugoJel('A „nem” azonnal kizárja az illetőt, de a foglalásai és a naplóbejegyzései megmaradnak.')}</th>
        <th>Jelszócsere kérve ${sugoJel('Ha „igen”, a következő belépésnél a rendszer új jelszót kér tőle. Első belépéskor ez automatikusan bekapcsol.')}</th>
        <th>Utolsó belépés</th>
        <th><span class="rejtett-szoveg">Műveletek</span></th></tr></thead>
      <tbody>${A.profilok.map(p => `
        <tr data-profil="${p.id}">
          <td data-cimke="Név"><strong>${esc(p.nev)}</strong>${p.id === A.user.id ? ' (te)' : ''}</td>
          <td data-cimke="E-mail-cím" class="halk">${esc(p.email || '')}</td>
          <td data-cimke="Beosztás" class="halk">${esc(p.beosztas || '')}</td>
          <td data-cimke="Szerep"><select data-pmezo="szerep" aria-label="Szerep">${
            Object.entries(SZEREPEK).map(([k, n]) =>
            `<option value="${k}" ${p.szerep === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></td>
          <td data-cimke="Beléphet"><select data-pmezo="aktiv" aria-label="Beléphet">
            <option value="1" ${p.aktiv ? 'selected' : ''}>igen</option>
            <option value="0" ${!p.aktiv ? 'selected' : ''}>nem</option></select></td>
          <td data-cimke="Jelszócsere kérve"><select data-pmezo="jelszo_csere" aria-label="Jelszócsere kérve">
            <option value="1" ${p.jelszo_csere ? 'selected' : ''}>igen</option>
            <option value="0" ${!p.jelszo_csere ? 'selected' : ''}>nem</option></select></td>
          <td data-cimke="Utolsó belépés" class="halk">${p.utolso_belepes
            ? new Date(p.utolso_belepes).toLocaleString('hu-HU') : 'még nem lépett be'}</td>
          <td><button class="btn btn-kis" data-jelszo-mail="${esc(p.email || '')}"
            data-nev="${esc(p.nev)}">Jelszó-visszaállító levél</button></td>
        </tr>`).join('')}</tbody>
    </table></div>
    <p class="sugoszoveg">A <strong>titkárság</strong> szerep bárki foglalását módosíthatja és termet
      szerkeszthet; a <strong>rendszergazda</strong> ezen felül fiókokat kezel, termet és eszközt
      véglegesen törölhet. Új kolléga felvételét a rendszergazda tudja elvégezni.</p>
  </div>`;
}

function fiokokKotes() {
  $$('tr[data-profil]').forEach(tr => {
    const id = tr.dataset.profil;
    const p = A.profilok.find(x => x.id === id) || {};
    $$('[data-pmezo]', tr).forEach(m => {
      const eredeti = m.value;
      m.onchange = async () => {
        const mezo = m.dataset.pmezo;
        const ertek = mezo === 'szerep' ? m.value : m.value === '1';
        const ment = async () => {
          m.disabled = true;
          try {
            ellenoriz(await sb.from('profiles').update({ [mezo]: ertek }).eq('id', id).select('id'));
            const cel = A.profilok.find(x => x.id === id);
            if (cel) cel[mezo] = ertek;
            if (id === A.user.id && mezo === 'szerep') {
              pirit('A saját szerepedet módosítottad, újratöltöm a felületet.', 'siker');
              setTimeout(() => location.reload(), 900);
              return;
            }
            m.value = mezo === 'szerep' ? ertek : (ertek ? '1' : '0');
            pirit('Mentve.', 'siker');
          } catch (e) { m.value = eredeti; hibaKi(e); } finally { m.disabled = false; }
        };
        if (mezo === 'aktiv' && ertek === false) {
          megerosit('Belépés letiltása',
            `Letiltod <strong>${esc(p.nev)}</strong> belépését? Utána nem tud belépni,
             de a foglalásai megmaradnak.`, 'Letiltás', ment);
          m.value = eredeti;
          return;
        }
        await ment();
      };
    });
  });
  $$('[data-jelszo-mail]').forEach(b => b.onclick = () => {
    const email = b.dataset.jelszoMail;
    if (!email) { pirit('Ehhez a fiókhoz nincs e-mail-cím.', 'hiba'); return; }
    megerosit('Jelszó-visszaállító levél',
      `Elküldjük <strong>${esc(b.dataset.nev)}</strong> részére a jelszó-visszaállító levelet a
       ${esc(email)} címre. A levélben lévő linkkel tud új jelszót megadni.`, 'Elküldés', async () => {
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + location.pathname });
        if (error) throw error;
        pirit('Levél elküldve: ' + email, 'siker');
      }, false);
  });
}

/* ══════════════════════════════════════════════════ napló ══ */
const NAPLO_TIPUS = {
  foglalas: 'Foglalások', eszkoz: 'Eszközök', terem: 'Termek',
  fiok: 'Fiókok', belepes: 'Belépések',
};

async function naploHtml() {
  const sz = A.naploSzuro;
  let kerdes = sb.from('naplo').select('*').order('mikor', { ascending: false }).limit(400);
  if (sz.tipus) kerdes = kerdes.eq('tipus', sz.tipus);
  const { data, error } = await kerdes;
  if (error) return `<div class="kartya"><p class="modalis-hiba">${esc(hibaSzoveg(error))}</p></div>`;

  const keres = normal(sz.szo.trim());
  let sorok = data || [];
  if (sz.ki) sorok = sorok.filter(r => r.ki === sz.ki);
  if (keres) sorok = sorok.filter(r => normal([r.mit, r.ki, JSON.stringify(r.reszlet || '')].join(' ')).includes(keres));
  const emberek = [...new Set((data || []).map(r => r.ki).filter(Boolean)
    .concat(sz.ki ? [sz.ki] : []))].sort();
  const tipusok = kezelo() ? Object.entries(NAPLO_TIPUS)
    : Object.entries(NAPLO_TIPUS).filter(([k]) => ['foglalas', 'eszkoz', 'terem'].includes(k));

  return `<div class="kartya">
    <div class="kartya-fej">
      <h2>Napló ${sugoJel('Itt látszik, ki mit vett fel, módosított vagy törölt. A foglalások, az eszközök és a termek változásait mindenki látja; a fiók- és belépési sorokat csak a titkárság és a rendszergazda.')}</h2>
      <span class="halk">${sorok.length} esemény${sorok.length >= 400 ? ' (a legutóbbiak)' : ''}</span>
    </div>
    <div class="eszkoztar">
      <div class="csipek" role="group" aria-label="Napló szűrése">
        <button class="csip ${sz.tipus === '' ? 'aktiv' : 'halk'}" data-naplo-tipus="">minden</button>
        ${tipusok.map(([k, n]) => `<button class="csip ${sz.tipus === k ? 'aktiv' : 'halk'}"
          data-naplo-tipus="${k}" aria-pressed="${sz.tipus === k}">${esc(n)}</button>`).join('')}
      </div>
      <select id="naplo-ki" aria-label="Szűrés személyre" style="width:auto">
        <option value="">mindenki</option>
        ${emberek.map(e => `<option value="${esc(e)}" ${sz.ki === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}
      </select>
      <input type="search" id="naplo-kereso" aria-label="Keresés a naplóban"
        placeholder="Keresés a naplóban…" value="${esc(sz.szo)}" style="width:auto; flex:1 1 180px; max-width:260px">
      <span class="tolto"></span>
      <button class="btn" data-naplo-csv>Teljes napló letöltése (CSV)</button>
    </div>
    <div class="tabla-tarto"><table>
      <thead><tr><th>Mikor</th><th>Ki</th><th>Mit</th><th>Mi történt</th><th>Részlet</th></tr></thead>
      <tbody>${sorok.map(r => `<tr>
        <td data-cimke="Mikor" class="halk">${new Date(r.mikor).toLocaleString('hu-HU')}</td>
        <td data-cimke="Ki">${esc(r.ki || '—')}</td>
        <td data-cimke="Mit"><span class="jelzo ${naploJelzo(r.tipus)}">${
          esc(NAPLO_TIPUS[r.tipus] || r.tipus || '')}</span></td>
        <td data-cimke="Mi történt">${esc(r.mit || '')}</td>
        <td data-cimke="Részlet" class="halk apro">${esc(naploReszlet(r))}</td>
      </tr>`).join('') || `<tr><td colspan="5" class="ures">${
        sz.tipus || sz.ki || keres ? 'Nincs a szűrésnek megfelelő naplóbejegyzés.'
          : 'Még nincs naplóbejegyzés — az első foglalás után itt fog megjelenni.'}</td></tr>`}</tbody>
    </table></div>
    <p class="sugoszoveg">A napló nem szerkeszthető és nem törölhető a felületről, ezért utólag is
      megmondható, ki mit írt át. Egy-egy eszköz mezőnkénti előzménye az eszköz adatlapján van.</p>
  </div>`;
}

function naploJelzo(tipus) {
  return { foglalas: 'jelzo-kek', eszkoz: 'jelzo-zold', terem: 'jelzo-arany',
    fiok: 'jelzo-piros', belepes: 'jelzo-szurke' }[tipus] || 'jelzo-szurke';
}

function naploReszlet(sor) {
  const r = sor.reszlet;
  if (!r) return '—';
  const d = v => (v ? new Date(v).toLocaleString('hu-HU') : '');
  try {
    if (sor.tipus === 'foglalas') {
      const rovid = o => `${teremKod(o.room_id)} · ${d(o.kezdet)} – ${d(o.veg)}`;
      if (r.kezdet) return rovid(r);
      if (r.uj && r.regi) {
        return `${rovid(r.regi)} → ${rovid(r.uj)}${
          r.uj.allapot !== r.regi.allapot ? ` (${r.regi.allapot} → ${r.uj.allapot})` : ''}`;
      }
      if (r.uj) return rovid(r.uj);
    }
    if (r.mezok && r.regi && r.uj) {
      return r.mezok.map(m => {
        const nev = (sor.tipus === 'terem' ? TEREM_MEZONEV[m] : ESZK_MEZONEV[m]) || m;
        return `${nev}: ${naploErtek(m, r.regi[m])} → ${naploErtek(m, r.uj[m])}`;
      }).join('; ');
    }
    if (r.leltarszam) return 'leltárszám: ' + r.leltarszam;
  } catch (e) { /* ismeretlen szerkezet */ }
  return '—';
}
const TEREM_MEZONEV = { kod: 'kód', nev: 'név', epulet: 'épület', emelet: 'emelet',
  ferohely: 'férőhely', felszereles: 'felszerelés', szin: 'szín', megjegyzes: 'megjegyzés',
  aktiv: 'foglalható', sorrend: 'sorrend' };
function naploErtek(mezo, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (mezo === 'room_id') return teremKod(Number(v));
  if (mezo === 'allapot') return (ALLAPOTOK[v] || {}).nev || v;
  if (mezo === 'kategoria') return KATEGORIAK[v] || v;
  if (mezo === 'aktiv') return v === true || v === 'true' ? 'igen' : 'nem';
  return String(v);
}

function naploKotes() {
  const tart = $('#tartalom');
  $$('[data-naplo-tipus]', tart).forEach(b => b.onclick = () => {
    A.naploSzuro.tipus = b.dataset.naploTipus; lapKirajzol();
  });
  const ki = $('#naplo-ki', tart);
  if (ki) ki.onchange = e => { A.naploSzuro.ki = e.target.value; lapKirajzol(); };
  const kereso = $('#naplo-kereso', tart);
  if (kereso) {
    let ido;
    kereso.oninput = e => {
      clearTimeout(ido);
      const ertek = e.target.value, poz = e.target.selectionStart;
      ido = setTimeout(async () => {
        A.naploSzuro.szo = ertek;
        await lapKirajzol();
        const uj = $('#naplo-kereso');
        if (uj) { uj.focus(); uj.setSelectionRange(poz, poz); }
      }, 350);
    };
  }
  const csv = $('[data-naplo-csv]', tart);
  if (csv) csv.onclick = () => naploCsv();
}

async function naploCsv() {
  const { data, error } = await sb.from('naplo').select('*').order('mikor', { ascending: false }).limit(2000);
  if (error) { hibaKi(error); return; }
  const biztos = v => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const sorok = [['Mikor', 'Ki', 'Mit', 'Mi történt', 'Részlet'].map(biztos).join(';')];
  (data || []).forEach(r => sorok.push([
    new Date(r.mikor).toLocaleString('hu-HU'), r.ki || '',
    NAPLO_TIPUS[r.tipus] || r.tipus || '', r.mit || '', naploReszlet(r),
  ].map(biztos).join(';')));
  fajlLetolt('﻿' + sorok.join('\r\n'), `naplo_${ymd(new Date())}.csv`, 'text/csv;charset=utf-8');
  pirit('A napló letöltve (Excelben megnyitható).', 'siker');
}

/* ══════════════════════════════════════════════════ kapcsolat ══ */
function kapcsolatHtml() {
  const kezelok = A.profilok.filter(p => p.aktiv && ['admin', 'titkarsag'].includes(p.szerep));
  // oktatóként a profillista szándékosan nem érhető el, ilyenkor a fenti két cím a támpont
  return `
  <div class="kartya keskeny">
    <div class="kartya-fej"><h2>Kapcsolat</h2></div>
    <p>Ez a felület a Sürgősségi Orvostani Klinika belső eszköze: a klinikai oktatótermek
      beosztása és az oktatási eszközök nyilvántartása.</p>
    <dl>
      <div class="adatsor"><dt>Terembeosztás, foglalás</dt>
        <dd>Sürgősségi Orvostani Klinika — Titkárság<br>
          <a href="mailto:sbo@semmelweis.hu">sbo@semmelweis.hu</a></dd></div>
      <div class="adatsor"><dt>A felület, fiókok, hibák</dt>
        <dd>Ádám Kornél, operatív igazgatóhelyettes<br>
          <a href="mailto:adam.kornel@semmelweis.hu">adam.kornel@semmelweis.hu</a></dd></div>
      <div class="adatsor"><dt>Hibabejelentés a felületen</dt>
        <dd>A nevedre kattintva, jobb felül: <strong>Visszajelzés</strong> — ez a leggyorsabb,
          mert rögtön a megfelelő helyre kerül.</dd></div>
      <div class="adatsor"><dt>Elfelejtett jelszó</dt>
        <dd>A belépőképernyőn az „Elfelejtett jelszó” gombbal e-mailben kapsz linket.
          Ha az nem jön meg, keresd a titkárságot.</dd></div>
    </dl>
    ${kezelok.length ? `<h3 class="szakasz">Akik kezelik a rendszert</h3>
      <ul class="sugo-lista">${kezelok.map(p =>
        `<li>${esc(p.nev)}${p.beosztas ? ` — ${esc(p.beosztas)}` : ''}
          (${esc(SZEREPEK[p.szerep])})</li>`).join('')}</ul>` : ''}
    <p class="sugoszoveg">A rendszer minden foglalást és eszközmozgatást név szerint tart nyilván,
      és a Napló lapon visszakereshető. Az adatok az egyetem Supabase-adatbázisában vannak,
      belépés nélkül semmi nem érhető el.</p>
  </div>`;
}

/* ══════════════════════════════════════════════════ fiókom ══ */
function fiokomHtml() {
  const p = A.profil;
  return `
  <div class="kartya keskeny">
    <div class="kartya-fej"><h2>Fiókom</h2></div>
    <label for="fi-nev">Név</label>
    <input id="fi-nev" maxlength="80" value="${esc(p.nev)}">
    <label for="fi-beosztas">Beosztás</label>
    <input id="fi-beosztas" maxlength="80" value="${esc(p.beosztas || '')}">
    <dl style="margin-top:1rem">
      <div class="adatsor"><dt>E-mail-cím</dt><dd>${esc(p.email || A.user.email)}</dd></div>
      <div class="adatsor"><dt>Szerep</dt><dd>${esc(SZEREPEK[p.szerep] || p.szerep)}</dd></div>
    </dl>
    <button class="btn btn-fo" data-profil-ment>Mentés</button>
    <p class="sugoszoveg">A név a foglalásaidnál és a naplóban jelenik meg. A szerepet és az
      e-mail-címet a rendszergazda állítja.</p>
  </div>

  <div class="kartya keskeny">
    <div class="kartya-fej"><h2>Jelszó módosítása</h2></div>
    <label for="fi-regi">Mostani jelszó</label>
    <input type="password" id="fi-regi" autocomplete="current-password">
    <label for="fi-uj1">Új jelszó</label>
    <input type="password" id="fi-uj1" autocomplete="new-password">
    <label for="fi-uj2">Új jelszó még egyszer</label>
    <input type="password" id="fi-uj2" autocomplete="new-password">
    <p class="jelszo-szabaly">${JELSZO_SZOVEG}</p>
    <button class="btn btn-fo" data-jelszo-ment>Jelszó mentése</button>
    <p class="modalis-hiba" id="fi-hiba" hidden></p>
  </div>`;
}

function fiokomKotes() {
  $('[data-profil-ment]').onclick = async () => {
    const nev = $('#fi-nev').value.trim();
    if (!nev) { pirit('A név nem lehet üres.', 'hiba'); return; }
    const gomb = $('[data-profil-ment]');
    gomb.disabled = true;
    try {
      ellenoriz(await sb.from('profiles')
        .update({ nev, beosztas: $('#fi-beosztas').value.trim() || null })
        .eq('id', A.user.id).select('id'));
      A.profil.nev = nev;
      $('#felh-nev').textContent = nev;
      pirit('Mentve.', 'siker');
    } catch (e) { hibaKi(e); } finally { gomb.disabled = false; }
  };
  $('[data-jelszo-ment]').onclick = async () => {
    const hiba = m => { const e = $('#fi-hiba'); e.textContent = m; e.hidden = false; };
    $('#fi-hiba').hidden = true;
    const regi = $('#fi-regi').value, u1 = $('#fi-uj1').value, u2 = $('#fi-uj2').value;
    if (!regi) return hiba('Add meg a mostani jelszavadat.');
    if (u1 !== u2) return hiba('A két új jelszó nem egyezik.');
    if (!JELSZO_SZABALY.test(u1)) return hiba(JELSZO_SZOVEG);
    const gomb = $('[data-jelszo-ment]'); gomb.disabled = true;
    try {
      // a régi jelszót eldobható kliensen ellenőrizzük, hogy az élő munkamenet
      // ne szakadjon meg hibás próbálkozáskor
      const ideiglenes = window.supabase.createClient(CFG.url, CFG.kulcs, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: 'sokterem-ell' },
      });
      const { error: e1 } = await ideiglenes.auth.signInWithPassword({
        email: A.profil.email || A.user.email, password: regi });
      if (e1) throw new Error('A megadott mostani jelszó nem helyes.');
      await ideiglenes.auth.signOut();
      const { error } = await sb.auth.updateUser({ password: u1 });
      if (error) throw error;
      await sb.from('profiles').update({ jelszo_csere: false }).eq('id', A.user.id);
      $('#fi-regi').value = $('#fi-uj1').value = $('#fi-uj2').value = '';
      pirit('Az új jelszó elmentve.', 'siker');
    } catch (e) {
      hiba(e && /nem helyes/.test(e.message || '') ? e.message : hibaSzoveg(e));
    } finally { gomb.disabled = false; }
  };
}

/* ══════════════════════════════════════════════════ javaslat ══ */
async function javaslatHtml() {
  const { data, error } = await sb.from('uzenet').select('*').order('mikor', { ascending: false }).limit(100);
  const lista = data || [];
  return `
  <div class="kartya keskeny">
    <div class="kartya-fej"><h2>Visszajelzés, hibabejelentés</h2></div>
    <p class="halk">Ha valami nem világos, hiányzik vagy hibás, írd meg — a titkárság és a
      rendszergazda látja.</p>
    <label for="jv-szoveg" class="rejtett-szoveg">Visszajelzés szövege</label>
    <textarea id="jv-szoveg" maxlength="4000" placeholder="Írd ide…"></textarea>
    <button class="btn btn-fo" data-jv-kuld style="margin-top:.6rem">Elküldés</button>
    ${error ? `<p class="modalis-hiba">${esc(hibaSzoveg(error))}</p>` : ''}
  </div>
  ${lista.length ? `<div class="kartya keskeny">
    <div class="kartya-fej"><h2>Eddigi visszajelzések</h2></div>
    ${lista.map(u => `<div class="uzenet-sor">
      <div class="halk apro">${esc(u.szerzo_nev || '')} ·
        ${new Date(u.mikor).toLocaleString('hu-HU')}${u.lezarva ? ' · <span class="jelzo jelzo-zold">lezárva</span>' : ''}</div>
      <div>${esc(u.szoveg)}</div>
      ${u.valasz ? `<div class="uzenet-valasz">
        <span class="halk apro">válasz:</span> ${esc(u.valasz)}</div>` : ''}
      ${kezelo() ? `<button class="btn btn-kis" data-jv-valasz="${u.id}" style="margin-top:.4rem">Válasz, lezárás</button>` : ''}
    </div>`).join('')}
  </div>` : ''}`;
}

function javaslatKotes() {
  $('[data-jv-kuld]').onclick = async () => {
    const szoveg = $('#jv-szoveg').value.trim();
    if (!szoveg) { pirit('Írd le, mit tapasztaltál.', 'hiba'); return; }
    const gomb = $('[data-jv-kuld]'); gomb.disabled = true;
    try {
      ellenoriz(await sb.from('uzenet').insert({
        szoveg, szerzo_id: A.user.id, szerzo_nev: A.profil.nev }).select('id'));
      pirit('Köszönjük, megkaptuk.', 'siker');
      lapKirajzol();
    } catch (e) { hibaKi(e); } finally { gomb.disabled = false; }
  };
  $$('[data-jv-valasz]').forEach(b => b.onclick = () => {
    const id = Number(b.dataset.jvValasz);
    const h = modalis({ cim: 'Válasz a visszajelzésre',
      torzs: `<label for="jv-v">Válasz</label><textarea id="jv-v"></textarea>
        <label for="jv-l">Lezárva</label>
        <select id="jv-l"><option value="1">igen</option><option value="0" selected>nem</option></select>`,
      lab: `<button class="btn" data-megse>Mégse</button><button class="btn btn-fo" data-ok>Mentés</button>`,
      zarKerdes: true });
    $('[data-megse]', h).onclick = () => zarKerdessel();
    $('[data-ok]', h).onclick = async () => {
      const gomb = $('[data-ok]', h); gomb.disabled = true;
      if (modalisAllapot) modalisAllapot.ment = true;
      try {
        ellenoriz(await sb.from('uzenet').update({
          valasz: $('#jv-v', h).value.trim() || null,
          lezarva: $('#jv-l', h).value === '1' }).eq('id', id).select('id'));
        zarModalis(); lapKirajzol(); pirit('Mentve.', 'siker');
      } catch (e) {
        if (modalisAllapot) modalisAllapot.ment = false;
        gomb.disabled = false; hibaKi(e);
      }
    };
  });
}

/* ══════════════════════════════════════════════════ súgó ══ */
function sugoHtml() {
  return `
  <div class="kartya sugo">
    <div class="kartya-fej"><h2>Súgó</h2></div>

    <h3>Foglalás</h3>
    <ul class="sugo-lista">
      <li>A <strong>Naptár</strong> lapon kattints egy szabad sávra: a foglalási űrlap már a kiválasztott
        napra és időre nyílik. A „+ Új foglalás” gombbal is indíthatod, ott gyors időpontgombok is vannak.</li>
      <li>Az űrlapon a terem választása alatt rögtön látszik, melyik terem <strong>szabad</strong> és
        melyik <strong>foglalt</strong> a beírt idősávban — tehát nem mentés után derül ki.</li>
      <li>Egy teremben nem lehet két átfedő foglalás: a rendszer nem engedi, így nem tud véletlenül két
        csoport ugyanoda kerülni.</li>
      <li>Az <strong>ismétlés</strong> (heti, kétheti, munkanapokon) minden alkalmat külön foglalásként
        vesz fel, így egyet-egyet külön is módosíthatsz vagy törölhetsz. A már foglalt időket kihagyja,
        és a végén felsorolja, mi maradt ki. A munkaszüneti napokat nem hagyja ki.</li>
      <li>A saját foglalásaidat arany bal szegély jelöli a rácsban, a listában „saját” címke.
        A sajátodat te módosíthatod; bárki foglalását a titkárság és a rendszergazda.</li>
      <li><strong>Lemondás</strong>: a foglalás áthúzva látszik tovább (tehát nyoma marad), de a terem
        felszabadul. Ha véglegesen nem kell, a törlés is elérhető.</li>
      <li><strong>Naptárfájl (.ics)</strong>: a megjelenített időszakot vagy egy foglalást letöltöd, és
        megnyitva bekerül az Outlook-naptáradba. Ez egyszeri másolat, nem élő összekötés — a későbbi
        módosítás nem követi.</li>
    </ul>

    <h3>Nézetek</h3>
    <ul class="sugo-lista">
      <li><strong>Hét</strong>: egy hét, a napok oszlopokban, a termek színnel jelölve — így egy
        pillantással látszik a teljes heti kép. A piros vonal a mostani időt mutatja.</li>
      <li><strong>Nap</strong>: egy nap, a termek külön oszlopban, óra szerinti beosztással.</li>
      <li><strong>Lista</strong>: egyszerű felsorolás keresővel, telefonon ez a legkényelmesebb.</li>
      <li>A színes szűrőgombokkal egy-egy termet be- és kikapcsolhatod a nézetben; ilyenkor egy csík
        jelzi, hogy szűrve látod a naptárat.</li>
      <li>A <strong>Foglalásaim</strong> lapon a saját foglalásaid vannak együtt, és külön az is,
        amit más foglalt neked (ha a „Ki tartja” mezőbe a te neved írták).</li>
    </ul>

    <h3>Eszközök</h3>
    <ul class="sugo-lista">
      <li>Az induló állomány a 152-es leltárkörzet 3-as alleltárának SAP-kivonata. Alapból az oktatási
        és IT eszközök látszanak; a bútor és az egyéb tételek a szűrőgombokkal hozhatók elő.
        Kereséskor minden kategóriában keresünk.</li>
      <li>Bárki átírhatja, hogy egy eszköz <strong>melyik teremben</strong>, hol pontosan, kinél van, és
        milyen állapotban — a táblázatban egy mozdulattal, részletesen pedig az <strong>Adatlap</strong>
        gombbal. Minden mező változása naplózódik: ki, mikor, miről mire (Adatlap → Előzmény).</li>
      <li>Amit már nem használnak, azt az adatlapon <strong>„nem használt”</strong>-ra lehet állítani:
        nem törlődik, csak kikerül a listából, és a „nem használtak” gombbal bármikor előhozható.
        Véglegesen csak a rendszergazda töröl.</li>
      <li><strong>+ Új eszköz</strong>: felvehető olyan tétel is, ami nincs a SAP-kivonatban.</li>
      <li>A felső számok (K03.65, Terem nélkül, Javítás, Nem használt) kattinthatók: rögtön arra szűrnek.</li>
      <li><strong>Teljes lista letöltése (CSV)</strong>: az egész állomány, Excelben megnyitható.</li>
    </ul>

    <h3>Termek, napló, fiókok</h3>
    <ul class="sugo-lista">
      <li><strong>Termek</strong>: a termek adatai, a naptárban megjelenített hét kihasználtsága
        (foglalás, óra, kb. százalék) és az oda sorolt eszközök száma. Innen tölthető le a
        foglalások kimutatása Excelbe. A titkárság és a rendszergazda szerkesztheti a termeket
        (férőhely, felszerelés, naptárszín, foglalható-e).</li>
      <li><strong>Napló</strong>: itt látszik, ki mit vett fel, módosított vagy törölt. A foglalások,
        az eszközök és a termek változásait mindenki látja (ez szándékos: így nem kell nyomozni,
        hová került egy eszköz); a fiók- és belépési sorokat csak a titkárság és a rendszergazda.
        Szűrhető típusra, személyre, és Excelbe letölthető.</li>
      <li><strong>Fiókok</strong> (rendszergazda): szerep, belépés engedélyezése, jelszó-visszaállító levél.</li>
      <li><strong>Visszajelzés</strong> (a nevedre kattintva a jobb felső menüben): ide írhatod, ha valami
        hibás vagy hiányzik.</li>
    </ul>

    <h3>Jelszó, fiók</h3>
    <ul class="sugo-lista">
      <li>Első belépéskor a közös kezdő jelszót le kell cserélni. A jelszó legalább 8 karakter,
        benne kisbetű, nagybetű és szám.</li>
      <li>Ha elfelejtetted: a belépőképernyőn az „Elfelejtett jelszó” gombbal levelet kapsz, és a
        benne lévő linkről tudsz új jelszót megadni.</li>
      <li>A nevet és a beosztást a <strong>Fiókom</strong> lapon te módosíthatod.</li>
      <li>Ha három órán át nem használod, a rendszer kiléptet — ez azért kell, mert közös gépeken is
        használjuk. Ha valaki más gépén foglalsz, a végén lépj ki (jobb felül a nevedre kattintva),
        különben a következő foglalás a te nevedre kerül.</li>
      <li>Az „Elfelejtett jelszó” levelet a rendszer óránként legfeljebb kétszer tudja kiküldeni
        (ezt a levelezőnk korlátozza). Ha nem jön meg, keresd a titkárságot.</li>
    </ul>

    <h3>Nyomtatás</h3>
    <p>A <strong>Nyomtatás</strong> gomb a megjelenített hét vagy nap beosztását nyomtatható formában
      adja (fekete-fehér, keretes blokkokkal, fekvő lapra) — kitehető a terem ajtajára.</p>

    <h3>Magyarázó kérdőjelek</h3>
    <p>A felületen több helyen látsz egy kis <strong>?</strong> jelet. Kattints vagy koppints rá,
      és megjelenik, mire jó az a mező vagy gomb. Máshova kattintva eltűnik.</p>

    <h3>Mi változott</h3>
    ${VERZIONAPLO.map(([v, datum, pontok]) => `<div class="verzio-blokk">
      <div class="verzio-fej"><strong>${esc(v)}</strong> <span class="halk">${esc(datum)}</span></div>
      <ul class="sugo-lista">${pontok.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
    </div>`).join('')}
  </div>`;
}

/* ══════════════════════════════════════════════════ indulás ══ */
belepesInditas().catch(e => { console.error(e); belepesLap(hibaSzoveg(e)); });
