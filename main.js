/* PineGate Pre‑launch JS */
// year
document.getElementById('year').textContent = new Date().getFullYear();

// navbar background on scroll
const topNav = document.getElementById('topNav');
const heroEl = document.querySelector('.hero');
if (topNav && heroEl){
  const navObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) topNav.classList.add('scrolled');
      else topNav.classList.remove('scrolled');
    });
  }, {threshold: 0.1});
  navObs.observe(heroEl);
}

// simple parallax on hero image (desktop only)
const hero = document.querySelector('.hero');
const img = document.querySelector('.hero-bg img');
function move(e){
  const rect = hero.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width - 0.5;
  const y = (e.clientY - rect.top) / rect.height - 0.5;
  const max = 10; // px
  img.style.transform = `translate3d(${x*max}px, ${y*max}px, 0) scale(1.05)`;
}
if (hero && img){
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouch){
    hero.addEventListener('mousemove', move);
    hero.addEventListener('mouseleave', ()=> img.style.transform = 'translate3d(0,0,0) scale(1.05)');
  }
}

// reveal on scroll
const revealEls = document.querySelectorAll('section, .feature-card, .carousel');
revealEls.forEach(el => el.classList.add('reveal'));
const io = new IntersectionObserver((entries, obs)=>{
  entries.forEach(ent => { if(ent.isIntersecting){ ent.target.classList.add('visible'); obs.unobserve(ent.target); } });
}, { threshold: 0.12 });
revealEls.forEach(el => io.observe(el));

// PineGate Service Area — MapLibre + MapTiler Hybrid
(() => {
  const MT_KEY = 'C5ywh4oPLuXDcoy2Ayqg';        // rotate if you change keys
  const RADIUS_MI = 150;
  const center = { lat: 41.2565, lng: -95.9345 }; // Omaha

  const mapEl = document.getElementById('omahaMap');
  if (!mapEl || !window.maplibregl) return;

  // Build map
  const map = new maplibregl.Map({
    container: 'omahaMap',
    style: `https://api.maptiler.com/maps/hybrid/style.json?key=${MT_KEY}`,
    center: [center.lng, center.lat],
    zoom: 6.6,
    cooperativeGestures: true
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-left');

  // Helpers
  const milesToMeters = m => m * 1609.344;
  function circlePolygon(c, radiusMeters, steps = 128) {
    const coords = [];
    const d = radiusMeters / 6378137; // Earth radius (m)
    const lat1 = c.lat * Math.PI/180, lon1 = c.lng * Math.PI/180;
    for (let i = 0; i <= steps; i++) {
      const brng = 2 * Math.PI * (i / steps);
      const lat2 = Math.asin(Math.sin(lat1)*Math.cos(d) + Math.cos(lat1)*Math.sin(d)*Math.cos(brng));
      const lon2 = lon1 + Math.atan2(Math.sin(brng)*Math.sin(d)*Math.cos(lat1), Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
      coords.push([lon2*180/Math.PI, lat2*180/Math.PI]);
    }
    return { type:'Feature', geometry:{ type:'Polygon', coordinates:[coords] } };
  }
  function milesBetween(a, b){
    const R = 3958.761, toRad = d => d*Math.PI/180;
    const dLat = toRad(b.lat-a.lat), dLng = toRad(b.lng-a.lng);
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const x = Math.sin(dLat/2)**2 + Math.sin(dLng/2)**2 * Math.cos(lat1)*Math.cos(lat2);
    return 2*R*Math.asin(Math.sqrt(x));
  }
  function setStatus(text, cls){
    const box = document.getElementById('locStatus');
    if (!box) return;
    if (!text) { box.classList.add('d-none'); box.textContent=''; box.classList.remove('inside','outside'); return; }
    box.textContent = text;
    box.classList.remove('d-none','inside','outside');
    if (cls) box.classList.add(cls);
  }

  // Overlays
  let overviewBounds = null;
  let userMarker = null;

  map.on('load', () => {
    // Omaha marker
    new maplibregl.Marker().setLngLat([center.lng, center.lat]).addTo(map);

    // 150-mile circle (with halo so it shows on imagery)
    const ring = circlePolygon(center, milesToMeters(RADIUS_MI));
    map.addSource('radius', { type:'geojson', data: ring });
    map.addLayer({ id:'radius-fill', type:'fill', source:'radius',
      paint:{ 'fill-color':'#2e5536', 'fill-opacity':0.18 } });
    map.addLayer({ id:'radius-halo', type:'line', source:'radius',
      paint:{ 'line-color':'#ffffff', 'line-opacity':0.55, 'line-width':6 } });
    map.addLayer({ id:'radius-line', type:'line', source:'radius',
      paint:{ 'line-color':'#2e5536', 'line-width':3 } });

    // Subtle state borders on satellite
    map.addSource('us-states', {
      type:'geojson',
      data:'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json'
    });
    map.addLayer({
      id:'us-state-borders',
      type:'line',
      source:'us-states',
      paint:{
        'line-color':'#ffffff',
        'line-opacity':0.6,
        'line-width':['interpolate', ['linear'], ['zoom'], 3,0.5, 6,1.2, 8,2.0]
      }
    }, 'radius-line');

    // Compute + store overview bounds for Reset
    overviewBounds = new maplibregl.LngLatBounds();
    ring.geometry.coordinates[0].forEach(pt => overviewBounds.extend(pt));
    map.fitBounds(overviewBounds, { padding: 20, duration: 0 });
  });

  // --- Interactions ---
  const btn = document.getElementById('checkLocationBtn');
  const resetBtn = document.getElementById('resetViewBtn');

  // NO geolocation on load — only on click
  btn?.addEventListener('click', () => {
    if (!navigator.geolocation){
      setStatus('Location not available on this device.', 'outside'); 
      return;
    }
    const original = btn.textContent; btn.disabled = true; btn.textContent = 'Checking…';

    navigator.geolocation.getCurrentPosition(pos => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const dist = milesBetween(here, center).toFixed(1);
      const inside = Number(dist) <= RADIUS_MI;

      setStatus(
        inside ? `You're ~${dist} miles from Omaha — inside our planned area.` :
                 `You're ~${dist} miles away — outside our ${RADIUS_MI}-mile area.`,
        inside ? 'inside' : 'outside'
      );

      if (userMarker) userMarker.remove();
      userMarker = new maplibregl.Marker({ color: inside ? '#1a7f37' : '#b23a2b' })
        .setLngLat([here.lng, here.lat]).addTo(map);

      // Smoothly zoom to the user
      map.flyTo({ center:[here.lng, here.lat], zoom: inside ? 10 : 8.5, speed: 0.9, curve: 1.4, essential: true });

      btn.disabled = false; btn.textContent = original;
    }, () => {
      setStatus('Could not get your location. Please allow permission.', 'outside');
      btn.disabled = false; btn.textContent = original;
    }, { enableHighAccuracy:true, timeout:8000 });
  });

  // Reset to overview (fits the 150-mile circle)
  resetBtn?.addEventListener('click', () => {
    if (!overviewBounds) return;
    setStatus('', null); // hide status pill
    map.fitBounds(overviewBounds, { padding: 20, duration: 600 });
  });
})();



// Mobile: close navbar after clicking a link
const nav = document.getElementById('nav');
if (nav){
  nav.querySelectorAll('a.nav-link').forEach(a=>{
    a.addEventListener('click', ()=>{
      if (window.getComputedStyle(document.querySelector('.navbar-toggler')).display !== 'none'){
        const bsCollapse = bootstrap.Collapse.getOrCreateInstance(nav);
        bsCollapse.hide();
      }
    });
  });
}

// ---- Signup form (AJAX to Formspree) ----
(function(){
  const form = document.getElementById('signupForm');
  if(!form) return;
  const alertBox = document.getElementById('signupAlert');
  const btn = form.querySelector('button[type="submit"]');
  const emailInput = form.querySelector('input[type="email"]');
  // capture UTM params
  const utmField = document.getElementById('utmField');
  if (utmField){
    const params = new URLSearchParams(window.location.search);
    const utm = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']
      .map(k => params.get(k) ? `${k}=${params.get(k)}` : null)
      .filter(Boolean).join('&');
    utmField.value = utm;
  }
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if (!emailInput.value || !emailInput.checkValidity()){
      emailInput.focus();
      emailInput.reportValidity?.();
      return;
    }
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Sending…';
    try{
      const data = new FormData(form);
      const res = await fetch(form.action, { method:'POST', body:data, headers:{'Accept':'application/json'} });
      if (res.ok){
        form.reset();
        btn.textContent = 'Got it!';
        setTimeout(()=>{ btn.textContent = orig; btn.disabled=false; }, 1800);
        // Success message inline
        if (alertBox){
          alertBox.classList.remove('visually-hidden');
          alertBox.classList.add('alert','alert-success','mt-2');
          alertBox.textContent = 'Thanks! You’re on the early-bird list for updates.';
        }
      } else {
        throw new Error('Network error');
      }
    }catch(err){
      if (alertBox){
        alertBox.classList.remove('visually-hidden');
        alertBox.classList.add('alert','alert-danger','mt-2');
        alertBox.textContent = 'Sorry, something went wrong. Please try again or email hello@pinegatestorage.com.';
      }
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
})();


  (function(){
    const q = (s) => document.querySelector(s);
    const qa = (s) => Array.from(document.querySelectorAll(s));

    // Search filter
    const input = q('#faqSearch');
    const items = qa('#faqAccordion .accordion-item');
    input?.addEventListener('input', () => {
      const term = input.value.toLowerCase().trim();
      items.forEach(item => {
        const text = item.innerText.toLowerCase();
        item.style.display = term && !text.includes(term) ? 'none' : '';
      });
    });

    // Expand/Collapse all
    function setAll(open){
      items.forEach(item => {
        const btn = item.querySelector('.accordion-button');
        const collapse = item.querySelector('.accordion-collapse');
        const bsCollapse = bootstrap.Collapse.getOrCreateInstance(collapse, { toggle:false });
        open ? bsCollapse.show() : bsCollapse.hide();
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
    q('#expandAllFaq')?.addEventListener('click', ()=> setAll(true));
    q('#collapseAllFaq')?.addEventListener('click', ()=> setAll(false));

    // Open via hash (e.g., /#q-pricing)
    if (location.hash){
      const h = location.hash.replace('#','');
      const head = document.getElementById(h);
      const col = head?.nextElementSibling;
      if (col && col.classList.contains('accordion-collapse')) {
        bootstrap.Collapse.getOrCreateInstance(col, { toggle:true });
        head.scrollIntoView({ behavior:'smooth', block:'start' });
      }
    }

    // Last updated (today)
    const ts = new Date();
    const nice = ts.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
    const updated = document.getElementById('faqUpdated'); if (updated) updated.textContent = nice;
  })();




/* =========================
   Roadbar logic (safe + scoped)
   ========================= */
// --- Roadbar (desktop) + Timeline (mobile)
(() => {
  // Desktop horizontal
  const rb = document.querySelector('.roadbar');
  if (rb) {
    const order   = ['Land Search','Permitting','Construction','Launch'];
    const current = rb.getAttribute('data-current') || order[0];
    const steps   = Array.from(rb.querySelectorAll('.step'));
    const fill    = rb.querySelector('.roadbar-fill');
    const track   = rb.querySelector('.roadbar-track').getBoundingClientRect();

    const idx = Math.max(0, order.indexOf(current));
    const pct = Math.round((idx / (order.length - 1)) * 100);

    // Mark states
    steps.forEach((s,i) => {
      if (i < idx)  s.classList.add('completed');
      if (i === idx) s.classList.add('active');
    });

    // Fill from first dot center to current dot center
    const firstCenter = steps[0].querySelector('.dot').getBoundingClientRect().left;
    const curCenter   = steps[idx].querySelector('.dot').getBoundingClientRect().left;
    fill.style.left   = `${firstCenter - track.left}px`;
    fill.style.width  = `${Math.max(0, curCenter - firstCenter)}px`;

    const status = document.getElementById('road-status');
    const percent= document.getElementById('road-percent');
    if (status)  status.textContent  = `Current: ${current}`;
    if (percent) percent.textContent = `${pct}% complete`;
  }

  // Mobile vertical
  const tl = document.querySelector('.timeline');
  if (tl) {
    const order   = ['Land Search','Permitting','Construction','Launch'];
    const current = tl.getAttribute('data-current') || order[0];
    const idx     = Math.max(0, order.indexOf(current));
    tl.querySelectorAll('li').forEach((li,i) => {
      li.classList.toggle('is-current',   i === idx);
      li.classList.toggle('is-completed', i <  idx);
    });
  }
})();

/* ======================================
   Partner form (AJAX + validation + redirect)
   ====================================== */
(() => {
  const form = document.getElementById('partnerForm');
  if (!form) return;              // don't affect other forms (like #signupForm)

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Validate required fields
    let ok = true;
    form.querySelectorAll('input[required], textarea[required]').forEach(el => {
      if (!el.checkValidity()) { el.classList.add('is-invalid'); ok = false; }
      else el.classList.remove('is-invalid');
    });
    if (!ok) return;

    // UI feedback
    const btn = form.querySelector('button[type="submit"]');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: new FormData(form)
      });

      if (res.ok) {
        // Redirect to your branded thank-you page (free Formspree workaround)
        window.location.href = 'thanks.html';
      } else {
        btn.disabled = false;
        btn.textContent = original;
        alert('Oops — something went wrong. Please try again.');
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = original;
      alert('Network error. Please try again.');
    }
  });

  // Clear error state on input
  form.addEventListener('input', e => e.target.classList.remove('is-invalid'));
})();

// --- Mobile navbar: collapse after clicking a link
(() => {
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.querySelectorAll('.nav-link, .btn').forEach(a => {
    a.addEventListener('click', () => {
      const bsCollapse = bootstrap.Collapse.getInstance(nav);
      if (bsCollapse) bsCollapse.hide();
    });
  });
})();









