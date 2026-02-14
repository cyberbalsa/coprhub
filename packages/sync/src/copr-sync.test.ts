import { describe, it, expect } from "vitest";
import { parseCoprProject, type CoprApiProject } from "./copr-sync.js";

describe("parseCoprProject", () => {
  it("converts COPR API response to database shape", () => {
    const apiProject: CoprApiProject = {
      id: 123,
      name: "lazygit",
      ownername: "atim",
      full_name: "atim/lazygit",
      description: "A simple terminal UI for git",
      instructions: "dnf copr enable atim/lazygit",
      homepage: "https://github.com/jesseduffield/lazygit",
      chroot_repos: {
        "fedora-40-x86_64": "https://download.copr.fedorainfracloud.org/...",
      },
      repo_url: "https://copr.fedorainfracloud.org/coprs/atim/lazygit/",
    };

    const result = parseCoprProject(apiProject);
    expect(result.coprId).toBe(123);
    expect(result.owner).toBe("atim");
    expect(result.name).toBe("lazygit");
    expect(result.fullName).toBe("atim/lazygit");
    expect(result.homepage).toBe("https://github.com/jesseduffield/lazygit");
    expect(result.chroots).toEqual(["fedora-40-x86_64"]);
  });
});
