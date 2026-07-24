module.exports = function beforeBuild() {
  // The editor frontend is bundled into dist-editor; the shell has no runtime
  // npm dependencies. Do not let electron-builder collect the root workspace.
  return false;
};
