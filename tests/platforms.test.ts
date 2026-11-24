import { describe, expect, it } from "vitest";
import { repoName } from "../core/github";
import { elanArchive } from "../core/lean/setup";

describe("running on Windows and Linux", () => {
  it("downloads elan's own release for each computer", () => {
    const base = "https://github.com/leanprover/elan/releases/latest/download/";
    expect(elanArchive("win32", "x64")).toBe(`${base}elan-x86_64-pc-windows-msvc.zip`);
    expect(elanArchive("linux", "x64")).toBe(`${base}elan-x86_64-unknown-linux-gnu.tar.gz`);
    expect(elanArchive("linux", "arm64")).toBe(`${base}elan-aarch64-unknown-linux-gnu.tar.gz`);
    expect(elanArchive("darwin", "arm64")).toBe(`${base}elan-aarch64-apple-darwin.tar.gz`);
  });

  it("names a repository after the folder, whichever path separator it uses", () => {
    expect(repoName("/home/j/MackProjects/Odd Perfect Numbers")).toBe("odd-perfect-numbers");
    expect(repoName("C:\\Users\\J\\MackProjects\\Odd Perfect Numbers")).toBe("odd-perfect-numbers");
  });
});
