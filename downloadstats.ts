import fetch from "node-fetch";

const owner = "Nimbalyst";
const repo = "nimbalyst";
const token = process.env.GITHUB_TOKEN; // optional but recommended

async function main() {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases`,
    {
      headers: token ? { Authorization: `token ${token}` } : {},
    }
  );

  if (!response.ok) {
    console.error(`GitHub API error: ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  const releases = (await response.json()) as any[];

  const allFiles: Array<{ name: string; count: number; release: string }> = [];

  for (const release of releases) {
    for (const asset of release.assets) {
      allFiles.push({
        name: asset.name,
        count: asset.download_count,
        release: release.tag_name,
      });
    }
  }

  // Sort by download count descending
  allFiles.sort((a, b) => b.count - a.count);

  for (const file of allFiles) {
    console.log(`${file.count.toString().padStart(4)}  ${file.name}`);
  }

  const total = allFiles.reduce((sum, f) => sum + f.count, 0);
  console.log(`\nTOTAL: ${total} downloads`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
