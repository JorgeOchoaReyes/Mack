// Upstream's two test tables for the scan rules (program-files/publish/src/rules.rs), unchanged.
import { describe, expect, it } from "vitest";
import { findings, maskSecrets, scanText } from "../core/secrets";

const found = (text: string) => scanText(text).map((m) => [m.rule, text.slice(m.start, m.end)] as const);

describe("secret scan rules v1", () => {
  it("each rule finds its secret", () => {
    const body = "\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB\n";
    const pem = `-----BEGIN OPENSSH PRIVATE KEY-----${body}-----END OPENSSH PRIVATE KEY-----`;
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const github = `ghp_${"a1B2".repeat(9)}`;
    const fineGrained = "github_pat_11ABCDEFG0_abcdefghijk";
    const google = ["AI", "zaSy0123456789abcdefghijklmnopqrstuvw"].join("");
    const npm = "npm_abcdefghijklmnopqrstuvwxyz0123456789";
    const pypi = `pypi-AgEIcHlwaS5vcmc${"A1b2".repeat(13)}`;
    // Assembled at run time, so the repository holds nothing a secret scanner takes for a live key.
    const stripe = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_");
    const hf = ["hf", "AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGh"].join("_");
    const fw = ["fw", "3x4mpl3K3yAbCdEfGh12345"].join("_");
    const table: [string, string, string][] = [
      [pem, "private-key", body],
      ["aws_id AKIAIOSFODNN7ABCDEFG here", "aws-access-key", "AKIAIOSFODNN7ABCDEFG"],
      [github, "github-token", github],
      [fineGrained, "github-token", fineGrained],
      ["use glpat-AbCdEfGhIjKlMnOpQrSt now", "gitlab-token", "glpat-AbCdEfGhIjKlMnOpQrSt"],
      ["key: sk-proj-Ab12Cd34Ef56Gh78Ij90", "sk-key", "sk-proj-Ab12Cd34Ef56Gh78Ij90"],
      ["sk-0123456789abcdef0123456789abcdef", "sk-key", "sk-0123456789abcdef0123456789abcdef"],
      ["xoxb-123456789012-abcdefABCDEF", "slack-token", "xoxb-123456789012-abcdefABCDEF"],
      [google, "google-api-key", google],
      [stripe, "stripe-key", stripe],
      [hf, "huggingface-token", hf],
      [npm, "npm-token", npm],
      [pypi, "pypi-token", pypi],
      [jwt, "jwt", jwt],
      ["curl -H 'Authorization: Bearer abc123def456ghi'", "authorization-header", "abc123def456ghi"],
      ['{"headers":{"authorization":"Basic dXNlcjpodW50ZXIy"}}', "authorization-header", "dXNlcjpodW50ZXIy"],
      ['{\\"Authorization\\": \\"Bearer tok3n-value-1\\"}', "authorization-header", "tok3n-value-1"],
      ["postgres://admin:s3cr3t-pw@db.internal:5432/app", "url-credentials", "s3cr3t-pw"],
      ["https://ci:9f8e7d6c5b@git.example.org/repo.git", "url-credentials", "9f8e7d6c5b"],
      ["DB_PASSWORD=hunter2hunter2", "secret-assignment", "hunter2hunter2"],
      ['password = "correct-horse-battery"', "secret-assignment", "correct-horse-battery"],
      ['{"client_secret": "Zx81kq0PmmT4"}', "secret-assignment", "Zx81kq0PmmT4"],
      ['{\\"api_key\\":\\"Zx81kq0PmmT4\\"}', "secret-assignment", "Zx81kq0PmmT4"],
      ["auth_token: 3f2a9c1b7d4e5f60718293a4", "secret-assignment", "3f2a9c1b7d4e5f60718293a4"],
      ["export API-KEY := 'q7w8e9r0t1y2'", "secret-assignment", "q7w8e9r0t1y2"],
      [`FIREWORKS_API_KEY=${fw}`, "fireworks-key", fw],
    ];
    for (const [text, rule, secret] of table) expect(found(text), `${rule} in ${text}`).toContainEqual([rule, secret]);
  });

  it("near misses are not findings", () => {
    const misses = [
      "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----",
      "-----BEGIN CERTIFICATE-----\nMIIDdzCCAl+gAwIBAgIEAgAAuTANBgkqhkiG9w0BAQUFADBa\n-----END CERTIFICATE-----",
      "-----BEGIN RSA PRIVATE KEY-----\n<paste your key here>\n-----END RSA PRIVATE KEY-----",
      "a key starts with BEGIN PRIVATE KEY and ends with END PRIVATE KEY",
      "commit 3f2a9c1b7d4e5f60718293a4b5c6d7e8f9012345",
      "sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "id = 123e4567-e89b-12d3-a456-426614174000",
      "AKIAIOSFODNN7EXAMPLE",
      "AKIAIOSFODNN7ABCDEFGH is one character too long",
      `ghp_${"a1B2".repeat(8)}`,
      `xghp_${"a1B2".repeat(9)}`,
      "risk-averse-and-task-oriented-planning-2024",
      "sk-learn-is-not-the-name-of-the-package",
      "hf_hub_download(repo_id, filename)",
      "eyJhbGciOiJIUzI1NiJ9 alone is one part",
      "Authorization: Bearer <token>",
      "Authorization: Bearer $OPENAI_API_KEY",
      "Authorization: Bearer YOUR_API_KEY_HERE1",
      "the authorization header carries a bearer token",
      "http://localhost:8080/path?mail=a@b.org",
      "git@github.com:org/repo.git",
      "https://user:password@host.example/",
      "https://user:${PASSWORD}@host/",
      "mailto:someone@example.org",
      "max_tokens: 4096abcd",
      "token_count = 1024abcd9",
      'password_hash = "5f4dcc3b5aa765d61d8327deb882cf99"',
      "password = getpass.getpass()",
      'token = response.json()["token"]',
      'api_key = os.environ["OPENAI_API_KEY"]',
      "secret: Optional[str] = None",
      'password = "Enter your password"',
      'password: "${DB_PASSWORD}"',
      "PASSWORD=changeme",
      'token = "xxxxxxxxxxxx"',
      "if password == stored1234:",
      "PRIVATE_KEY=/etc/ssl/private/server1.key",
      "the password is long and the secret is kept",
    ];
    for (const text of misses) expect(found(text), text).toEqual([]);
  });

  it("scans hostile text in bounded time", () => {
    const text =
      "-----BEGIN PRIVATE KEY-----".repeat(20_000) + "token=".repeat(50_000) + "sk-".repeat(50_000) + "://a:".repeat(50_000) + " eyJ".repeat(50_000);
    const started = Date.now();
    const f = scanText(text);
    expect(f.every((m) => m.rule === "private-key")).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("masks secrets and previews without them", () => {
    const text = "my key is ghp_" + "a1B2".repeat(9) + " ok";
    expect(maskSecrets(text)).toBe("my key is **** ok");
    expect(findings(text)).toEqual([{ rule: "github-token", preview: "my key is **** ok" }]);
  });
});
