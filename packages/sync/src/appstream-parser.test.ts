import { describe, it, expect } from "vitest";
import { parseAppStreamXml, parseAppStreamYaml, type AppStreamEntry } from "./appstream-parser.js";

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<components version="0.8" origin="test">
  <component type="desktop">
    <id>firefox.desktop</id>
    <pkgname>firefox</pkgname>
    <name>Firefox</name>
    <categories>
      <category>Network</category>
      <category>WebBrowser</category>
    </categories>
  </component>
  <component type="desktop-application">
    <id>org.gnome.gitg</id>
    <pkgname>gitg</pkgname>
    <name>gitg</name>
    <categories>
      <category>Development</category>
      <category>RevisionControl</category>
    </categories>
  </component>
  <component type="desktop-application">
    <id>org.mozilla.firefox</id>
    <name>Firefox Flatpak</name>
    <categories>
      <category>Network</category>
      <category>WebBrowser</category>
    </categories>
  </component>
  <component type="addon">
    <id>some-addon</id>
    <name>Addon</name>
  </component>
</components>`;

const SAMPLE_YAML = `---
File: DEP-11
Version: '0.16'
Origin: test
---
Type: desktop-application
ID: org.gnome.gitg
Package: gitg
Categories:
- Development
- RevisionControl
---
Type: addon
ID: some-addon
Package: some-addon
---
Type: desktop-application
ID: org.mozilla.Firefox
Package: firefox
Categories:
- Network
- WebBrowser
`;

describe("parseAppStreamXml", () => {
  it("extracts desktop components with pkgname and categories", async () => {
    const entries = await parseAppStreamXml(SAMPLE_XML);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      packageName: "firefox",
      categories: ["Network", "WebBrowser"],
    });
    expect(entries[1]).toEqual({
      packageName: "gitg",
      categories: ["Development", "RevisionControl"],
    });
  });

  it("falls back to component ID last segment when no pkgname (Flatpak)", async () => {
    const entries = await parseAppStreamXml(SAMPLE_XML);
    // org.mozilla.firefox → "firefox"
    expect(entries[2]).toEqual({
      packageName: "firefox",
      categories: ["Network", "WebBrowser"],
    });
  });

  it("skips components without pkgname or ID", async () => {
    const entries = await parseAppStreamXml(SAMPLE_XML);
    const addon = entries.find((e) => e.packageName === "some-addon");
    expect(addon).toBeUndefined();
  });
});

describe("parseAppStreamYaml", () => {
  it("extracts desktop-application entries with Package and Categories", () => {
    const entries = parseAppStreamYaml(SAMPLE_YAML);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      packageName: "gitg",
      categories: ["Development", "RevisionControl"],
    });
    expect(entries[1]).toEqual({
      packageName: "firefox",
      categories: ["Network", "WebBrowser"],
    });
  });

  it("skips non-desktop-application entries", () => {
    const entries = parseAppStreamYaml(SAMPLE_YAML);
    const addon = entries.find((e) => e.packageName === "some-addon");
    expect(addon).toBeUndefined();
  });
});
