// Feature flags and configuration. To rollback any of these changes, simply set
// the corresponding flag to false or change the value back to the original.

const params = new URLSearchParams(window.location.search);

export const CONFIG = {
  // Game name: 'Aeterna' (old) or 'Throbbin Abbey' (new)
  gameNameNew: params.get('oldName') !== '1',  // ?oldName=1 to use old name

  // Chanting text: true = new English lyrics, false = old Latin lyrics
  chantingNew: params.get('oldChant') !== '1', // ?oldChant=1 to use old chant

  // Title card dropdown: true = show Undying Abbots, false = hide
  dropdownShow: params.get('dropdown') !== '0', // ?dropdown=0 to hide
};
