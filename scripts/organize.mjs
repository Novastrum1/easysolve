import ts from "typescript";
import fs from "node:fs";
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile).config;
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, process.cwd());
const files = parsed.fileNames.filter(
  (f) => !f.includes("/.next/") && !f.includes("/node_modules/"),
);
const host = {
  getScriptFileNames: () => files,
  getScriptVersion: () => "0",
  getScriptSnapshot: (f) =>
    fs.existsSync(f)
      ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, "utf8"))
      : undefined,
  getCurrentDirectory: () => process.cwd(),
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
};
const service = ts.createLanguageService(host);
for (const file of files) {
  const edits = service.organizeImports(
    { type: "file", fileName: file },
    {},
    {},
  );
  for (const edit of edits) {
    let source = fs.readFileSync(edit.fileName, "utf8");
    for (const e of [...edit.textChanges].sort(
      (a, b) => b.span.start - a.span.start,
    ))
      source =
        source.slice(0, e.span.start) +
        e.newText +
        source.slice(e.span.start + e.span.length);
    fs.writeFileSync(edit.fileName, source);
  }
}
