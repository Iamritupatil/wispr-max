import assert from "node:assert/strict";
import { test } from "node:test";
import { pickAsset } from "../api/download";

const asset = (name: string) => ({ name, browser_download_url: `https://github.com/x/releases/download/v0.3.0/${name}` });
const assets = [
  "Wispr-Max-Setup-0.3.0.exe",
  "Wispr-Max-Setup-0.3.0.exe.blockmap",
  "latest.yml",
  "Wispr-Max-0.3.0-arm64.dmg",
  "Wispr-Max-0.3.0-x64.dmg",
  "Wispr-Max-0.3.0-arm64-mac.zip",
  "Wispr-Max-0.3.0.AppImage",
].map(asset);

test("the Download button picks this computer's installer", () => {
  assert.equal(pickAsset(assets, "win", "x64")?.name, "Wispr-Max-Setup-0.3.0.exe");
  assert.equal(pickAsset(assets, "mac", "arm64")?.name, "Wispr-Max-0.3.0-arm64.dmg");
  assert.equal(pickAsset(assets, "mac", "x64")?.name, "Wispr-Max-0.3.0-x64.dmg");
  assert.equal(pickAsset(assets, "linux", "x64")?.name, "Wispr-Max-0.3.0.AppImage");
  // Whatever the file is called, as long as it's an installer.
  assert.equal(pickAsset([asset("WisprMax Installer.exe")], "win", "x64")?.name, "WisprMax Installer.exe");
  assert.equal(pickAsset([asset("Wispr-Max-Setup-0.3.0.exe")], "mac", "arm64"), undefined);
});
