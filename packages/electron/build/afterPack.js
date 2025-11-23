// afterPack.js - Post-packaging hook
// Previously used to fix Sharp native dependencies, now a no-op placeholder
// Kept for potential future use with other native dependencies

exports.default = async function(context) {
  // No-op - native dependency fixups no longer required
  console.log('AfterPack: Complete');
};
