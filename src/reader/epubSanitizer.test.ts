import { describe, expect, it } from "vitest";
import { sanitizeEpubHtml } from "./epubSanitizer";

describe("sanitizeEpubHtml", () => {
  it("preserves basic reading markup while stripping active content", () => {
    const html = `
      <section onclick="steal()">
        <h1>Chapter</h1>
        <p onmouseover="steal()">Read <em>quietly</em>.</p>
        <script>alert("x")</script>
        <form action="https://evil.example"><input name="token" /></form>
        <iframe src="https://evil.example"></iframe>
      </section>
    `;

    const sanitized = sanitizeEpubHtml(html);

    expect(sanitized).toContain("<h1>Chapter</h1>");
    expect(sanitized).toContain("<em>quietly</em>");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("onmouseover");
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("<form");
    expect(sanitized).not.toContain("<iframe");
  });

  it("removes unsafe links and resource-loading attributes", () => {
    const html = `
      <p>
        <a href="javascript:alert(1)" title="unsafe">bad link</a>
        <a href="#chapter-2">chapter link</a>
        <img src="https://evil.example/track.png" alt="tracker" />
        <span style="background-image: url(https://evil.example/x)">styled</span>
      </p>
    `;

    const sanitized = sanitizeEpubHtml(html);

    expect(sanitized).toContain("bad link");
    expect(sanitized).toContain('href="#chapter-2"');
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("https://evil.example");
    expect(sanitized).not.toContain("style=");
    expect(sanitized).not.toContain("<img");
  });

  it("sanitizes active descendants promoted from unsupported wrappers", () => {
    const html = `
      <x-wrapper>
        <x-epub onclick="outer()">
          <p onclick="inner()">Visible text</p>
          <script>alert("x")</script>
          <img src="https://evil.example/track.png" onerror="steal()" />
          <a href="javascript:alert(1)" onclick="steal()">unsafe link</a>
        </x-epub>
      </x-wrapper>
    `;

    const sanitized = sanitizeEpubHtml(html);

    expect(sanitized).toContain("Visible text");
    expect(sanitized).toContain("unsafe link");
    expect(sanitized).not.toContain("x-wrapper");
    expect(sanitized).not.toContain("x-epub");
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("<img");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("onerror");
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("https://evil.example");
  });
});
