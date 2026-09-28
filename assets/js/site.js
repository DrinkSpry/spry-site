(function () {
  var C = window.SPRY_CONFIG || {};
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FLAVORS = {
    mango: { name: 'Mango Passionfruit', text: 'The crowd-pleaser. Tropical and bright, with a tart edge.' },
    blood: { name: 'Blood Orange', text: 'The sophisticated one. A bitter edge and a dry finish.' },
    yuzu:  { name: 'Yuzu Lime', text: 'The cleanest sip. Citrus first, and a clean finish.' },
    berry: { name: 'Mixed Berry', text: 'Dark fruit, more tart than sweet.' }
  };
  var current = 'mango';

  // ---------- 3D can ----------
  var canvas = document.getElementById('can');
  var canApi = null;
  function webglOK() {
    try { var c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
  }
  function mountCan() {
    if (!canvas || !window.SpryCan || !webglOK()) { document.documentElement.classList.add('no-webgl'); return; }
    try {
      canApi = window.SpryCan.mount(canvas, {
        textures: { mango: '/assets/can/label-mango.webp', blood: '/assets/can/label-blood.webp', yuzu: '/assets/can/label-yuzu.webp', berry: '/assets/can/label-berry.webp' },
        initial: current,
        scrollEl: document.getElementById('hero'),
        startAngle: -0.35,
        idle: 0.1,
        scrollTurns: 1.1
      });
    } catch (e) { document.documentElement.classList.add('no-webgl'); }
  }
  if (document.readyState === 'complete') mountCan(); else window.addEventListener('load', mountCan);

  // ---------- flavor switching ----------
  function setFlavor(k, opts) {
    if (!FLAVORS[k]) return;
    current = k;
    document.documentElement.setAttribute('data-flavor', k);
    document.querySelectorAll('.pill').forEach(function (p) { p.setAttribute('aria-pressed', p.dataset.flavor === k ? 'true' : 'false'); });
    document.querySelectorAll('.stage img').forEach(function (im) { im.classList.toggle('on', im.dataset.flavor === k); });
    var nameEl = document.getElementById('flavorName'), textEl = document.getElementById('flavorText');
    if (nameEl) { nameEl.textContent = FLAVORS[k].name; textEl.textContent = FLAVORS[k].text; }
    var side = document.getElementById('sideCan'); if (side) side.src = '/assets/can/can-' + k + '-side.webp';
    var fb = document.getElementById('canFallback'); if (fb) fb.src = '/assets/can/can-' + k + '-hero.webp';
    if (canApi) canApi.setFlavor(k);
    if (!(opts && opts.keepRadio)) {
      var r = document.querySelector('input[name=flav][value="' + k + '"]'); if (r) r.checked = true;
    }
  }
  document.querySelectorAll('.pill').forEach(function (p) { p.addEventListener('click', function () { setFlavor(p.dataset.flavor); }); });
  document.querySelectorAll('input[name=flav]').forEach(function (r) {
    r.addEventListener('change', function () { if (FLAVORS[r.value]) setFlavor(r.value, { keepRadio: true }); });
  });

  // ---------- reserve ----------
  var pack = '6';
  var packBtns = document.querySelectorAll('.pack');
  packBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      packBtns.forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
      b.setAttribute('aria-pressed', 'true');
      pack = b.dataset.pack;
      document.getElementById('btnPack').textContent = pack + '-pack';
      document.getElementById('btnPrice').textContent = b.dataset.price;
      var s = document.querySelector('.sticky-cta strong'); if (s) s.textContent = pack + '-pack, ' + b.dataset.price;
    });
  });
  var reserveBtn = document.getElementById('reserveBtn'), panelMsg = document.getElementById('panelMsg');
  if (reserveBtn) reserveBtn.addEventListener('click', function () {
    var flav = (document.querySelector('input[name=flav]:checked') || {}).value;
    var id = ((C.variants || {})[pack] || {})[flav];
    if (!id) {
      panelMsg.textContent = 'Checkout for this flavor opens with the site launch. Pick another flavor, or the mixed pack, for now.';
      panelMsg.style.display = 'block'; return;
    }
    panelMsg.style.display = 'none';
    reserveBtn.disabled = true; reserveBtn.textContent = 'Opening checkout';
    window.location.href = C.shop + '/cart/' + id + ':1';
    setTimeout(function () { reserveBtn.disabled = false; reserveBtn.innerHTML = 'Reserve my <span id="btnPack">' + pack + '-pack</span> · <span id="btnPrice">' + document.querySelector('.pack[aria-pressed="true"]').dataset.price + '</span>'; }, 4000);
  });

  // ---------- science figures ----------
  if (C.showFigures) document.documentElement.classList.add('show-figures');
  if (C.trialsUrl) {
    var tl = document.getElementById('trialLink');
    if (tl) { tl.href = C.trialsUrl; tl.target = '_blank'; tl.rel = 'noopener'; document.documentElement.classList.add('show-trials'); }
  }

  // ---------- founder list (Loops) ----------
  var form = document.getElementById('founderForm'), msg = document.getElementById('formMsg'), sbtn = document.getElementById('submitBtn');
  if (form) form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = form.email.value.trim();
    if (!email || email.indexOf('@') < 1) { msg.textContent = 'Enter a valid email address.'; msg.style.display = 'block'; return; }
    sbtn.disabled = true; sbtn.textContent = 'Joining';
    fetch('https://app.loops.so/api/newsletter-form/' + C.loopsFormId, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=' + encodeURIComponent(email) + '&userGroup=Founder%20List'
    }).then(function (res) {
      if (!res.ok) throw new Error('bad');
      form.querySelector('input').style.display = 'none'; sbtn.style.display = 'none';
      msg.textContent = 'You are on the list. We will be in touch before December.'; msg.style.display = 'block';
    }).catch(function () {
      sbtn.disabled = false; sbtn.textContent = 'Join';
      msg.textContent = 'That did not go through. Try again, or email alejandro@drinkspry.com.'; msg.style.display = 'block';
    });
  });

  // ---------- mobile menu ----------
  var menuBtn = document.getElementById('menuBtn'), menu = document.getElementById('mobileMenu');
  if (menuBtn) {
    menuBtn.addEventListener('click', function () { var open = menu.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); });
    menu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { menu.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); }); });
  }

  // ---------- reveals ----------
  var reveals = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !reduce) {
    var ro = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); ro.unobserve(e.target); } }); }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    reveals.forEach(function (el) { ro.observe(el); });
  } else { reveals.forEach(function (el) { el.classList.add('in'); }); }

  // ---------- sticky mobile CTA ----------
  var sticky = document.getElementById('stickyCta'), hero = document.getElementById('hero'), reserve = document.getElementById('reserve');
  if (sticky && hero && reserve && 'IntersectionObserver' in window) {
    var heroVisible = true, reserveVisible = false;
    function upd() { var on = !heroVisible && !reserveVisible; sticky.classList.toggle('on', on); sticky.setAttribute('aria-hidden', on ? 'false' : 'true'); }
    new IntersectionObserver(function (es) { heroVisible = es[0].isIntersecting; upd(); }, { threshold: 0.15 }).observe(hero);
    new IntersectionObserver(function (es) { reserveVisible = es[0].isIntersecting; upd(); }, { threshold: 0.05 }).observe(reserve);
  }

  // ---------- pour loop, loaded only when near ----------
  var pv = document.getElementById('pourVideo');
  if (pv && C.pourVideo && !reduce && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (es, o) {
      if (es[0].isIntersecting) { pv.src = C.pourVideo; pv.play().catch(function () {}); o.disconnect(); }
    }, { rootMargin: '200px' }).observe(pv);
  } else if (pv) { pv.removeAttribute('src'); }
})();
