import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const targets = {
  "aarch64-apple-darwin": {
    config: "src-tauri/tauri.macos.conf.json",
    files: {
      "resources/leechcore/aarch64-apple-darwin/LICENSE.txt": null,
      "resources/leechcore/aarch64-apple-darwin/leechcore_ft601_driver_macos.dylib":
        "19c14732faf6c574365bcc58ee3a54e947ba030147f954f797b687118d510116",
      "resources/leechcore/aarch64-apple-darwin/libftd3xx.dylib":
        "70eb91d10524a5a750b5653407c3d955ac1c37f32389a2bb0ec41aeb23cf2b4d",
      "resources/leechcore/aarch64-apple-darwin/license_info_all.txt": null,
    },
  },
  "x86_64-unknown-linux-gnu": {
    config: "src-tauri/tauri.linux.conf.json",
    files: {
      "resources/leechcore/x86_64-unknown-linux-gnu/LICENSE.txt": null,
      "resources/leechcore/x86_64-unknown-linux-gnu/leechcore_driver.so":
        "2bfdbaaec4ee72ab43b08b958ab64738ac29aa3545cb60cf5f366acecde0975e",
      "resources/leechcore/x86_64-unknown-linux-gnu/leechcore_ft601_driver_linux.so":
        "9c56297663ef5330a22761936c8ae29f332efe9791990446169eca03e10e915d",
      "resources/leechcore/x86_64-unknown-linux-gnu/license_info_all.txt": null,
    },
  },
  "x86_64-pc-windows-msvc": {
    config: "src-tauri/tauri.windows.conf.json",
    files: {
      "resources/leechcore/x86_64-pc-windows-msvc/FTD3XX.dll":
        "3c0fc158fd4aa604c526d58ed8274ae830d53e69e01210cc5b5fa54ec5a9b7c0",
      "resources/leechcore/x86_64-pc-windows-msvc/FTD3XXWU.dll":
        "c507cb40f188740c4a7ba3aae4f848a305192b9b7c9e8e9264b1d66335824bfa",
      "resources/leechcore/x86_64-pc-windows-msvc/LICENSE.txt": null,
      "resources/leechcore/x86_64-pc-windows-msvc/leechcore_driver.dll":
        "18a0125f71ac1a37127207c364024739f134f9bdedc77c68db9e51dcb0736c70",
      "resources/leechcore/x86_64-pc-windows-msvc/license_info_all.txt": null,
      "resources/leechcore/x86_64-pc-windows-msvc/redist_vcruntime.txt": null,
      "resources/leechcore/x86_64-pc-windows-msvc/vcruntime140.dll":
        "e4d5a1842d65e99581e52225e0af6455e078e95b3ea3d3b49f673e4d5168b82d",
    },
  },
};

function fail(message) {
  console.error(`LeechCore resource verification failed: ${message}`);
  process.exit(1);
}

const target = process.argv[2];
const specification = targets[target];
if (!specification) {
  fail(`unsupported target ${JSON.stringify(target)}`);
}

const configPath = resolve(repositoryRoot, specification.config);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const configuredResources = config?.bundle?.resources;
if (!configuredResources || typeof configuredResources !== "object") {
  fail(`${specification.config} has no bundle.resources map`);
}

const expectedSources = Object.keys(specification.files).sort();
const configuredSources = Object.keys(configuredResources).sort();
if (JSON.stringify(expectedSources) !== JSON.stringify(configuredSources)) {
  fail(`${specification.config} does not contain the expected resource set`);
}

const destinations = new Set();
for (const [source, expectedSha256] of Object.entries(specification.files)) {
  const destination = configuredResources[source];
  if (
    typeof destination !== "string" ||
    !destination.startsWith("leechcore-runtime/") ||
    destinations.has(destination)
  ) {
    fail(`${source} has an invalid or duplicate bundle destination`);
  }
  destinations.add(destination);

  const sourcePath = resolve(repositoryRoot, "src-tauri", source);
  let metadata;
  try {
    metadata = statSync(sourcePath);
  } catch {
    fail(`${source} is missing`);
  }
  if (!metadata.isFile() || metadata.size === 0) {
    fail(`${source} is not a non-empty regular file`);
  }

  if (expectedSha256) {
    const actualSha256 = createHash("sha256")
      .update(readFileSync(sourcePath))
      .digest("hex");
    if (actualSha256 !== expectedSha256) {
      fail(`${source} SHA-256 is ${actualSha256}, expected ${expectedSha256}`);
    }
  }
}

console.log(
  `Verified ${expectedSources.length} LeechCore resources for ${target}.`,
);
