// Decide before the game measures its canvas; desktop can still be selected explicitly.
window.veilUseMobileLayout = () => {
  const mode = new URLSearchParams(location.search).get('touch');
  if (mode === '0') return false;
  return mode === '1' || innerWidth <= 900 || (matchMedia('(any-pointer: coarse)').matches && innerWidth <= 1366);
};
document.documentElement.classList.toggle('veil-mobile', window.veilUseMobileLayout());
