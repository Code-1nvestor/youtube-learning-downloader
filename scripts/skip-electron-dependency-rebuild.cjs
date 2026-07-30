exports.default = async function skipElectronDependencyRebuild() {
  // desktop/package.json has no runtime Node dependencies; the server is bundled by esbuild.
  return false;
};
