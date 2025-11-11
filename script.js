// Hamburger toggle (functional + accessible)
// - toggles .show on #main-nav
// - updates aria-expanded and aria-hidden
// - closes on Escape or outside click

const hamburger = document.getElementById('hamburger');
const nav = document.getElementById('main-nav');

if (hamburger && nav) {
  function openNav() {
    hamburger.classList.add('open');
    nav.classList.add('show');
    hamburger.setAttribute('aria-expanded','true');
    nav.setAttribute('aria-hidden','false');
    document.addEventListener('click', outsideClick);
    document.addEventListener('keydown', onKey);
  }
  function closeNav() {
    hamburger.classList.remove('open');
    nav.classList.remove('show');
    hamburger.setAttribute('aria-expanded','false');
    nav.setAttribute('aria-hidden','true');
    document.removeEventListener('click', outsideClick);
    document.removeEventListener('keydown', onKey);
  }
  function toggleNav(e){
    e.stopPropagation();
    const expanded = hamburger.getAttribute('aria-expanded') === 'true';
    if (expanded) closeNav(); else openNav();
  }
  function outsideClick(e){
    if (!nav.contains(e.target) && e.target !== hamburger) closeNav();
  }
  function onKey(e){
    if (e.key === 'Escape') closeNav();
  }
// Reveal two-column sections with IntersectionObserver (adds .in-view)
(function () {
  const nodes = document.querySelectorAll('.two-col');
  if (!nodes.length) return;

  // fallback: if IntersectionObserver not supported, reveal immediately
  if (!('IntersectionObserver' in window)) {
    nodes.forEach(n => n.classList.add('in-view'));
    return;
  }

  const obs = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target); // one-time reveal
      }
    });
  }, { root: null, rootMargin: '0px 0px -10% 0px', threshold: 0.12 });

  nodes.forEach(n => obs.observe(n));
})();


  hamburger.addEventListener('click', toggleNav);

  // ensure nav links close the menu when clicked (mobile)
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    // only close if nav is visible (mobile)
    if (nav.classList.contains('show')) closeNav();
  }));
}
