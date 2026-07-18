module.exports = function beforeBuild() {
  // The web app is bundled into dist; the desktop shell has no runtime npm dependencies.
  // Returning false tells electron-builder not to collect the repository's build dependencies.
  return false;
};
