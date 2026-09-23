(function (root, factory) {
  const palette = factory();
  if (typeof module === 'object' && module.exports) module.exports = palette;
  else root.castlePalette = palette;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  // The original village palette: stone, pale yellow food, cyan military /
  // weapons, white industry, yellow town, red bad things and lavender good
  // things. RGB values follow the bundled item artwork (see asset notes).
  const colors = {
    'Bad Things': '#f88080', Castle: '#a0a0a0', Food: '#f8f8c0',
    Gatehouses: '#808080', 'Good Things': '#c0c0f8', Industry: '#e0e0e0',
    Military: '#88b0b8', 'Walls, Moat & Pitch': '#505050', Stairs: '#505050',
    Town: '#f8f840', Arabians: '#a0a0a0', Europeans: '#a0a0a0', Bedouins: '#b4d7a0', Misk: '#a0a0a0'
  };
  function categoryStyle(category) {
    const background = colors[category] || '#505050';
    return { background, foreground: ['#505050', '#087080'].includes(background) ? '#ffffff' : '#151515' };
  }
  function itemName(constants, type) {
    const name = constants?.[String(type)]?.name;
    return typeof name === 'string' && name.trim() ? name.trim() : `Item ${type}`;
  }
  return { colors, categoryStyle, itemName };
});
