import fetch from "node-fetch";

const owner = "stravu";
const repo = "preditor-releases";
const token = process.env.GITHUB_TOKEN; // optional but recommended

async function main() {
  const releases = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases`,
    {
      headers: token ? { Authorization: `token ${token}` } : {},
    }
  ).then((res) => res.json()) as any[];

  for (const release of releases) {
    console.log(`\nRelease: ${release.name || release.tag_name}`);
    for (const asset of release.assets) {
      console.log(
        `  ${asset.name} — ${asset.download_count} downloads`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
