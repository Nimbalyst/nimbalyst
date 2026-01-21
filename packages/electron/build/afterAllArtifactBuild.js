const fs = require('fs');
const path = require('path');

/**
 * Renames Mac build artifacts to use user-friendly architecture names:
 * - arm64 -> Apple-Silicon
 * - x64 -> Intel
 *
 * This runs after all artifacts are built and before publishing.
 */
exports.default = async function(buildResult) {
  const { artifactPaths } = buildResult;

  console.log('afterAllArtifactBuild: Renaming Mac artifacts for user-friendly names...');

  const renamedPaths = [];

  for (const artifactPath of artifactPaths) {
    const basename = path.basename(artifactPath);

    // Only rename macOS artifacts
    if (!basename.includes('macOS')) {
      renamedPaths.push(artifactPath);
      continue;
    }

    let newBasename = basename;

    // Replace architecture names with user-friendly versions
    // Handles patterns like: Nimbalyst-macOS-arm64.dmg -> Nimbalyst-macOS-Apple-Silicon.dmg
    if (basename.includes('-arm64.')) {
      newBasename = basename.replace('-arm64.', '-Apple-Silicon.');
    } else if (basename.includes('-x64.')) {
      newBasename = basename.replace('-x64.', '-Intel.');
    }

    if (newBasename !== basename) {
      const newPath = path.join(path.dirname(artifactPath), newBasename);

      console.log(`afterAllArtifactBuild: Renaming ${basename} -> ${newBasename}`);
      fs.renameSync(artifactPath, newPath);

      // Also rename associated blockmap files if they exist
      const blockmapPath = artifactPath + '.blockmap';
      if (fs.existsSync(blockmapPath)) {
        const newBlockmapPath = newPath + '.blockmap';
        console.log(`afterAllArtifactBuild: Renaming ${basename}.blockmap -> ${newBasename}.blockmap`);
        fs.renameSync(blockmapPath, newBlockmapPath);
      }

      renamedPaths.push(newPath);
    } else {
      renamedPaths.push(artifactPath);
    }
  }

  console.log('afterAllArtifactBuild: Artifact renaming complete');

  // Return the renamed paths so electron-builder knows about the new file names for publishing
  return renamedPaths;
};
