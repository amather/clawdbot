import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

md.enable("strikethrough");

export function formatMatrixMessage(markdown: string): {
  body: string;
  formattedBody: string;
  format: "org.matrix.custom.html";
} {
  const body = markdown ?? "";
  const formattedBody = md.render(body).trim();
  return {
    body,
    formattedBody,
    format: "org.matrix.custom.html",
  };
}
