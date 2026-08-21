import { readFile } from "node:fs/promises";

const [packageJson, packageLock] = await Promise.all(
  ["../package.json", "../package-lock.json"].map(async (path) =>
    JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")),
  ),
);

// The communication package stays a peer so a consumer keeps one copy of it. Publishing this package
// before that version is on the registry would ship a dependency nobody can install.
for (const name of ["rmcommunication-ts"]) {
  const peer = packageJson.peerDependencies?.[name];
  const development = packageJson.devDependencies?.[name];
  const lockedDevelopment = packageLock.packages?.[""]?.devDependencies?.[name];
  const lockedPackage = packageLock.packages?.[`node_modules/${name}`];

  if (typeof peer !== "string") throw new Error(`${name} must remain a peer dependency`);
  if (development !== peer || lockedDevelopment !== peer || lockedPackage?.link === true)
    throw new Error(
      `Publish ${name} first, then set devDependencies.${name} to ${JSON.stringify(peer)} and refresh package-lock.json`,
    );
}
